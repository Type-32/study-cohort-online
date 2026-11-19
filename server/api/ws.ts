import { defineWebSocketHandler } from 'h3'
import { addPeer, removePeer } from '#server/utils/bus'
import { connect, disconnect, touch } from '#server/utils/presence'
import { setTimer, snapshot } from '#server/utils/house'
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

export default defineWebSocketHandler({
	async upgrade(request) {
		if (!(await memberOf(request))) return new Response('Unauthorized', { status: 401 })
	},
	async open(peer) {
		const user = await memberOf(peer)
		if (!user) return peer.close(4401, 'Unauthorized')
		await addPeer(peer)
		await connect(peer.id, { userId: user.id, username: user.username })
		send(peer, { t: 'snapshot', house: await snapshot(), serverMs: Date.now() })
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
				break
		}
	},
	async close(peer) {
		removePeer(peer)
		const { user } = await getUserSession(peer)
		if (user) await disconnect(peer.id, user.id)
	},
})
