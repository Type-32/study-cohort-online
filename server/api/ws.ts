import { defineWebSocketHandler } from 'h3'
import { addPeer, removePeer } from '#server/utils/bus'
import { connect, disconnect, touch } from '#server/utils/presence'
import { applyRadio, setTimer, snapshot } from '#server/utils/house'
import { useServerUsers } from '#server/utils/core/useServerUsers'
import { clientMsgSchema } from '#shared/utils/realtime'
import type { ServerMsg } from '#shared/utils/realtime'

type SessionSource = Parameters<typeof getUserSession>[0]

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
 * The sender already applied its intent locally (optimistic UI). If the server could not, send the
 * real state back so the sender snaps to it now, instead of silently diverging until the next
 * snapshot (the next reconnect, up to the function's max duration later).
 */
async function rejectIntent(peer: { send(data: string): unknown }, what: string, error: unknown) {
	console.error(`[ws] ${what} failed:`, error)
	send(peer, { t: 'error', message: `Couldn't ${what}. The house wasn't changed; try again.` })
	try {
		send(peer, { t: 'snapshot', house: await snapshot(), serverMs: Date.now() })
	} catch (snapshotError) {
		console.error('[ws] snapshot failed:', snapshotError)
	}
}

export default defineWebSocketHandler({
	async upgrade(request) {
		if (!(await memberOf(request))) return new Response('Unauthorized', { status: 401 })
	},
	async open(peer) {
		const user = await memberOf(peer)
		if (!user) return peer.close(4401, 'Unauthorized')
		await addPeer(peer)
		try {
			await connect(peer.id, { userId: user.id, username: user.username })
			send(peer, { t: 'snapshot', house: await snapshot(), serverMs: Date.now() })
		} catch (error) {
			console.error('[ws] open failed:', error)
			send(peer, { t: 'error', message: "Couldn't load the house. Reload the page; if it keeps happening, tell the host." })
		}
	},
	async message(peer, message) {
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
			case 'timer':
				await setTimer(msg.action === 'start' ? msg.minutes! : null)
					.catch((error) => rejectIntent(peer, 'update the timer', error))
				break
			case 'radio':
				await applyRadio(msg.action === 'play' ? { action: 'play', videoId: msg.videoId } : { action: msg.action })
					.catch((error) => rejectIntent(peer, 'update the radio', error))
				break
		}
	},
	async close(peer) {
		removePeer(peer)
		const { user } = await getUserSession(peer)
		if (user) await disconnect(peer.id, user.id)
	},
})
