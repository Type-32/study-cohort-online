import { defineWebSocketHandler } from 'h3'
import { addPeer, removePeer } from '#server/utils/bus'
import { connect, disconnect, setDoor, touch } from '#server/utils/presence'
import { setTimer, snapshot } from '#server/utils/house'
import { HouseError, playerReport, queue, radioAction, setWhenEmpty, suggest, unsuggest } from '#server/utils/radioQueue'
import { sendNote } from '#server/utils/notes'
import { useServerUsers } from '#server/utils/core/useServerUsers'
import { clientMsgSchema } from '#shared/utils/realtime'
import type { ServerMsg } from '#shared/utils/realtime'

type SessionSource = Parameters<typeof getUserSession>[0]
type MessageHook = NonNullable<Parameters<typeof defineWebSocketHandler>[0]['message']>
type Peer = Parameters<MessageHook>[0]
type Message = Parameters<MessageHook>[1]

// Re-read on open instead of passing state from `upgrade`: crossws 0.3 (dev) and 0.4 (Vercel)
// carry upgrade context differently.
async function memberOf(source: SessionSource) {
	const { user } = await getUserSession(source)
	const dbUser = await useServerUsers().getDbUserFromId(user?.id)
	return dbUser && !dbUser.banned ? dbUser : undefined
}

function send(peer: { send(data: string): unknown }, msg: ServerMsg) {
	peer.send(JSON.stringify(msg))
}

/**
 * The sender already applied its intent locally (optimistic UI). If the server could not, tell it
 * which intent failed (it drops its optimistic copy). A refusal (`HouseError`, "That one is already
 * on the shelf.") is shown as is. Anything else is logged, and the real state is sent back so the
 * sender snaps to it now instead of diverging until the next snapshot.
 */
async function rejectIntent(peer: { send(data: string): unknown }, what: string, intent: string | undefined, error: unknown) {
	if (error instanceof HouseError) return send(peer, { t: 'error', message: error.message, intent })
	console.error(`[ws] ${what} failed:`, error)
	send(peer, { t: 'error', message: `Couldn't ${what}. The house wasn't changed; try again.`, intent })
	try {
		send(peer, { t: 'snapshot', house: await snapshot(), serverMs: Date.now() })
	} catch (snapshotError) {
		console.error('[ws] snapshot failed:', snapshotError)
	}
}

async function handle(peer: Peer, message: Message) {
	let parsed
	try {
		parsed = clientMsgSchema.safeParse(message.json())
	} catch {
		return
	}
	if (!parsed.success) return
	const msg = parsed.data
	if (msg.t === 'ping') {
		await touch(peer.id)
		return send(peer, { t: 'pong', clientMs: msg.clientMs, serverMs: Date.now() })
	}
	// Read on every intent, not cached on the socket: a ban or a demotion applies at once.
	const user = await memberOf(peer)
	if (!user) return peer.close(4401, 'Unauthorized')
	const reject = (what: string) => (error: unknown) => rejectIntent(peer, what, 'id' in msg ? msg.id : undefined, error)
	switch (msg.t) {
		case 'door':
			return setDoor(user, msg.state, msg.id).catch(reject('move your door'))
		case 'timer':
			return setTimer(msg.action === 'start' ? msg.minutes! : null, msg.id).catch(reject('update the timer'))
		case 'suggest':
			return suggest(user, msg, msg.id).catch(reject('add your suggestion'))
		case 'unsuggest':
			return unsuggest(user, msg.suggestionId, msg.id).catch(reject('take that off the shelf'))
		case 'queue':
			return queue(user, msg.suggestionId, msg.to, msg.id).catch(reject('change the queue'))
		case 'radioWhenEmpty':
			return setWhenEmpty(user, msg.mode, msg.id).catch(reject('change what plays when the list runs out'))
		case 'note': {
			// One note a second per socket. In memory: a socket lives on one instance.
			const now = Date.now()
			if (now - (lastNoteAt.get(peer.id) ?? 0) < 1000) return reject('leave your note')(new HouseError('One note a second. Try again in a moment.'))
			lastNoteAt.set(peer.id, now)
			return sendNote(user, msg, msg.id).catch(reject('leave your note'))
		}
		case 'radio':
			switch (msg.action) {
				case 'ended':
				case 'unplayable':
					return playerReport(user, msg).catch((error) => console.error('[ws] player report failed:', error))
				default:
					return radioAction(user, msg, msg.id).catch(reject('update the radio'))
			}
	}
}

/**
 * Each socket's messages run one after another, so two quick clicks land in the order they were
 * made (the second one wins) and come back in that order (the client relies on it, see `confirm`).
 */
const queues = new Map<string, Promise<void>>()
/** When each socket last sent a note (the limit above). */
const lastNoteAt = new Map<string, number>()

export default defineWebSocketHandler({
	async upgrade(request) {
		if (!(await memberOf(request))) return new Response('Unauthorized', { status: 401 })
	},
	async open(peer) {
		const user = await memberOf(peer)
		if (!user) return peer.close(4401, 'Unauthorized')
		await addPeer(peer)
		try {
			await connect(peer.id, user)
			send(peer, { t: 'snapshot', house: await snapshot(), serverMs: Date.now() })
		} catch (error) {
			console.error('[ws] open failed:', error)
			send(peer, { t: 'error', message: "Couldn't load the house. Reload the page; if it keeps happening, tell the host." })
		}
	},
	message(peer, message) {
		const next = (queues.get(peer.id) ?? Promise.resolve())
			.then(() => handle(peer, message))
			.catch((error) => console.error('[ws] message failed:', error))
		queues.set(peer.id, next)
		return next
	},
	async close(peer) {
		queues.delete(peer.id)
		lastNoteAt.delete(peer.id)
		removePeer(peer)
		const { user } = await getUserSession(peer)
		if (user) await disconnect(peer.id, user.id)
	},
})
