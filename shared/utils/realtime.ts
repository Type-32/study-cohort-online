import { z } from 'zod'

// Wire protocol for /api/ws. Clients send intents; the server validates them and broadcasts
// whole entities. See plans/online-gathering-v1.md, step 2.

/** Client heartbeat cadence. The server treats a connection as gone after 3 missed pings. */
export const PING_INTERVAL_MS = 20_000

export const clientMsgSchema = z.discriminatedUnion('t', [
	z.object({ t: z.literal('ping'), clientMs: z.number() }),
])

export type ClientMsg = z.infer<typeof clientMsgSchema>

export interface MemberState {
	userId: string
	username: string
}

export interface HouseState {
	members: MemberState[]
}

export type ServerMsg =
	| { t: 'snapshot'; house: HouseState; serverMs: number }
	| { t: 'member'; member: MemberState }
	| { t: 'leave'; userId: string }
	| { t: 'pong'; clientMs: number; serverMs: number }
