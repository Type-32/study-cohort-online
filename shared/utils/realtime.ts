import { z } from 'zod'
import { WHEN_EMPTY, playlistIdSchema, youtubeIdSchema } from './radio'
import type { RadioState, Suggestion, WhenEmpty } from './radio'

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

/** Notes left on the table: plain text, deleted 24 hours after they were sent. */
export const NOTE_MAX_LENGTH = 280
export const NOTE_TTL_MS = 24 * 3_600_000
/** How many notes a snapshot carries, newest kept. */
export const NOTES_IN_SNAPSHOT = 50

export interface Note {
	id: string
	userId: string
	username: string
	text: string
	createdAtServerMs: number
}

/**
 * Sent with every intent. The broadcast the intent causes carries it back, so the sender knows its
 * click landed and can drop its optimistic copy in the same tick the real state arrives.
 */
const intentId = z.string().max(64).optional()

/** Which track a player is talking about: a video can be played twice, so its start time too. */
const trackRef = { videoId: youtubeIdSchema, startedAtServerMs: z.number() }

export const clientMsgSchema = z.discriminatedUnion('t', [
	z.object({ t: z.literal('ping'), clientMs: z.number() }),
	z.object({ t: z.literal('door'), state: z.enum(DOORS), id: intentId }),
	z.object({
		t: z.literal('timer'),
		action: z.enum(['start', 'stop']),
		minutes: z.number().int().min(1).max(180).optional(),
		id: intentId,
	}).refine((m) => m.action === 'stop' || m.minutes !== undefined, 'start needs minutes'),
	// Everyone: a track (`videoId`) or a band (`playlistId`). `queue` (host only) puts the host's own pick at the back of the queue.
	z.object({
		t: z.literal('suggest'),
		suggestionId: z.uuid(),
		videoId: youtubeIdSchema.optional(),
		playlistId: playlistIdSchema.optional(),
		queue: z.boolean().optional(),
		id: intentId,
	}).refine((m) => (m.videoId === undefined) !== (m.playlistId === undefined), 'a track or a band'),
	// Your own suggestion; the host, anyone's.
	z.object({ t: z.literal('unsuggest'), suggestionId: z.uuid(), id: intentId }),
	// Host.
	z.object({ t: z.literal('queue'), suggestionId: z.uuid(), to: z.enum(['next', 'last', 'off']), id: intentId }),
	z.object({ t: z.literal('radioWhenEmpty'), mode: z.enum(WHEN_EMPTY), id: intentId }),
	// Everyone. Trimmed; the client trims too, so its optimistic copy matches.
	z.object({ t: z.literal('note'), noteId: z.uuid(), text: z.string().trim().min(1).max(NOTE_MAX_LENGTH), id: intentId }),
	z.discriminatedUnion('action', [
		// Everyone.
		z.object({ t: z.literal('radio'), action: z.enum(['pause', 'resume']), id: intentId }),
		// Host: a pasted link, a band from one of its tracks, or a shelf item, on air now; skip (the
		// band's next track); leave the band; turn off; move the position.
		z.object({ t: z.literal('radio'), action: z.literal('play'), videoId: youtubeIdSchema, id: intentId }),
		z.object({ t: z.literal('radio'), action: z.literal('playBand'), playlistId: playlistIdSchema, index: z.number().int().min(0).max(199).optional(), id: intentId }),
		z.object({ t: z.literal('radio'), action: z.literal('playSuggestion'), suggestionId: z.uuid(), id: intentId }),
		z.object({ t: z.literal('radio'), action: z.literal('skip'), id: intentId }),
		z.object({ t: z.literal('radio'), action: z.literal('leaveBand'), id: intentId }),
		z.object({ t: z.literal('radio'), action: z.literal('stop'), id: intentId }),
		z.object({ t: z.literal('radio'), action: z.literal('seek'), positionMs: z.number().min(0).max(24 * 3_600_000), id: intentId }),
		// Sent by every player, not by a person: the track is over, or YouTube refused it (errors 100, 101, 150).
		z.object({ t: z.literal('radio'), action: z.enum(['ended', 'unplayable']), ...trackRef }),
	]),
])

export type ClientMsg = z.infer<typeof clientMsgSchema>
/** Everything a member can ask the house to change. Player reports aren't intents: nobody waits on them. */
export type Intent = Exclude<ClientMsg, { t: 'ping' } | { action: 'ended' | 'unplayable' }>
export type PlayerReport = Extract<ClientMsg, { action: 'ended' | 'unplayable' }>

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
	/** The shelf: the host's queue and members' suggestions, in no particular order (see `shelfOrder`). */
	suggestions: Suggestion[]
	radioWhenEmpty: WhenEmpty
	/** Notes younger than 24 hours, oldest first (the last `NOTES_IN_SNAPSHOT` in a snapshot). */
	notes: Note[]
}

/** `intent`: the id of the intent that caused this change, if any (see `intentId`). */
export type ServerMsg =
	| { t: 'snapshot'; house: HouseState; serverMs: number }
	| { t: 'member'; member: MemberState; intent?: string }
	| { t: 'leave'; userId: string }
	| { t: 'pong'; clientMs: number; serverMs: number }
	| { t: 'timer'; timer: TimerState; intent?: string }
	| { t: 'radio'; radio: RadioState; intent?: string }
	| { t: 'suggestion'; suggestion: Suggestion; intent?: string }
	| { t: 'unsuggest'; suggestionId: string; intent?: string }
	| { t: 'radioWhenEmpty'; mode: WhenEmpty; intent?: string }
	| { t: 'note'; note: Note; intent?: string }
	/** Something the sender asked for failed; a fresh snapshot follows when there is one. */
	| { t: 'error'; message: string; intent?: string }
