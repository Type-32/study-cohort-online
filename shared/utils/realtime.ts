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

export const clientMsgSchema = z.discriminatedUnion('t', [
	z.object({ t: z.literal('ping'), clientMs: z.number() }),
	z.object({ t: z.literal('door'), state: z.enum(DOORS) }),
	z.object({
		t: z.literal('timer'),
		action: z.enum(['start', 'stop']),
		minutes: z.number().int().min(1).max(180).optional(),
	}).refine((m) => m.action === 'stop' || m.minutes !== undefined, 'start needs minutes'),
	z.discriminatedUnion('action', [
		z.object({ t: z.literal('radio'), action: z.literal('play'), videoId: youtubeIdSchema }),
		z.object({ t: z.literal('radio'), action: z.enum(['pause', 'resume', 'stop']) }),
	]),
])

export type ClientMsg = z.infer<typeof clientMsgSchema>

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

export type ServerMsg =
	| { t: 'snapshot'; house: HouseState; serverMs: number }
	| { t: 'member'; member: MemberState }
	| { t: 'leave'; userId: string }
	| { t: 'pong'; clientMs: number; serverMs: number }
	| { t: 'timer'; timer: TimerState }
	| { t: 'radio'; radio: RadioState }
	/** Something the sender asked for failed; a fresh snapshot follows when there is one. */
	| { t: 'error'; message: string }
