import { z } from 'zod'
import { youtubeIdSchema } from './radio'
import type { RadioState } from './radio'

// Wire protocol for /api/ws. Clients send intents; the server validates them and broadcasts
// whole entities. See plans/online-gathering-v1.md, step 2.

/** Client heartbeat cadence. The server treats a connection as gone after 3 missed pings. */
export const PING_INTERVAL_MS = 20_000

/**
 * How far a member is from the commons. Open: at their desk, hearing the radio. Ajar: lamp on,
 * the radio faint. Closed: a light under the door, no radio. Nobody is ever invisible.
 */
export const DOORS = ['open', 'ajar', 'closed'] as const
export type Door = (typeof DOORS)[number]

/**
 * Sent with every intent. The broadcast the intent causes carries it back, so the sender knows its
 * click landed and can drop its optimistic copy in the same tick the real state arrives.
 */
const intentId = z.string().max(64).optional()

export const clientMsgSchema = z.discriminatedUnion('t', [
	z.object({ t: z.literal('ping'), clientMs: z.number() }),
	z.object({ t: z.literal('door'), state: z.enum(DOORS), id: intentId }),
	z.object({
		t: z.literal('timer'),
		action: z.enum(['start', 'stop']),
		minutes: z.number().int().min(1).max(180).optional(),
		id: intentId,
	}).refine((m) => m.action === 'stop' || m.minutes !== undefined, 'start needs minutes'),
	z.discriminatedUnion('action', [
		z.object({ t: z.literal('radio'), action: z.literal('play'), videoId: youtubeIdSchema, id: intentId }),
		z.object({ t: z.literal('radio'), action: z.enum(['pause', 'resume', 'stop']), id: intentId }),
	]),
])

export type ClientMsg = z.infer<typeof clientMsgSchema>
/** Everything a member can ask the house to change. */
export type Intent = Exclude<ClientMsg, { t: 'ping' }>

export interface MemberState {
	userId: string
	username: string
	door: Door
}

/** The shared focus timer. Clients count down from `endsAtServerMs` with their clock offset. */
export type TimerState = { endsAtServerMs: number; minutes: number } | null

export interface HouseState {
	members: MemberState[]
	timer: TimerState
	radio: RadioState
}

/** `intent`: the id of the intent that caused this change, if any (see `intentId`). */
export type ServerMsg =
	| { t: 'snapshot'; house: HouseState; serverMs: number }
	| { t: 'member'; member: MemberState; intent?: string }
	| { t: 'leave'; userId: string }
	| { t: 'pong'; clientMs: number; serverMs: number }
	| { t: 'timer'; timer: TimerState; intent?: string }
	| { t: 'radio'; radio: RadioState; intent?: string }
	/** Something the sender asked for failed; a fresh snapshot follows when there is one. */
	| { t: 'error'; message: string; intent?: string }
