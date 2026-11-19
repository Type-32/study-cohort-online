import { defineWebSocketHandler } from 'h3'
import { addPeer, removePeer } from '#server/utils/bus'

export default defineWebSocketHandler({
	async upgrade(request) {
		const { user } = await getUserSession(request)
		if (!user) return new Response('Unauthorized', { status: 401 })
	},
	open: addPeer,
	message(peer, message) {
		peer.send(message.text())
	},
	close: removePeer,
})
