// ponytail: nitropack 2's Vercel runtime ignores WebSocket upgrades. This replaces it and does what
// Nitro v3's runtime does. It drops nitropack's ISR URL rewrite (no `isr` route rules here).
// Delete this file and the `nitro:init` hook in nuxt.config.ts when moving to Nitro v3.
import { toNodeListener } from 'h3'
import { useNitroApp } from 'nitropack/runtime'
import vercelAdapter from 'crossws/adapters/vercel'
import type { IncomingMessage, ServerResponse } from 'node:http'

const nitroApp = useNitroApp()
const listener = toNodeListener(nitroApp.h3App)
const ws = vercelAdapter(nitroApp.h3App.websocket as Parameters<typeof vercelAdapter>[0])

export default async function handler(req: IncomingMessage, res: ServerResponse) {
	if (await ws.handleNodeUpgrade(req, res)) return
	return listener(req, res)
}
