import { defineWebSocketHandler } from 'h3'
import { addPeer, removePeer } from '#server/utils/bus'
import { connect, disconnect, setDoor, touch } from '#server/utils/presence'
import { applyRadio, setTimer, snapshot } from '#server/utils/house'
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
 * which intent failed (it drops its optimistic copy) and send the real state back, so the sender
 * snaps to it now instead of diverging until the next snapshot.
 */
async function rejectIntent(peer: { send(data: string): unknown }, what: string, intent: string | undefined, error: unknown) {
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
	switch (msg.t) {
		case 'ping':
			await touch(peer.id)
			send(peer, { t: 'pong', clientMs: msg.clientMs, serverMs: Date.now() })
			break
		case 'door': {
			const user = await memberOf(peer)
			if (!user) return peer.close(4401, 'Unauthorized')
			await setDoor(user, msg.state, msg.id).catch((error) => rejectIntent(peer, 'move your door', msg.id, error))
			break
		}
		case 'timer':
			await setTimer(msg.action === 'start' ? msg.minutes! : null, msg.id)
				.catch((error) => rejectIntent(peer, 'update the timer', msg.id, error))
			break
		case 'radio':
			await applyRadio(msg.action === 'play' ? { action: 'play', videoId: msg.videoId } : { action: msg.action }, msg.id)
				.catch((error) => rejectIntent(peer, 'update the radio', msg.id, error))
			break
	}
}

/**
 * Each socket's messages run one after another, so two quick clicks land in the order they were
 * made (the second one wins) and come back in that order (the client relies on it, see `confirm`).
 */
const queues = new Map<string, Promise<void>>()

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
		removePeer(peer)
		const { user } = await getUserSession(peer)
		if (user) await disconnect(peer.id, user.id)
	},
})
