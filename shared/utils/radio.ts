import { z } from 'zod'
import type { Door } from './realtime'

/** A YouTube video id: 11 characters of [A-Za-z0-9_-]. */
export const youtubeIdSchema = z.string().regex(/^[\w-]{11}$/)
/** A YouTube playlist id (`PL…`, `OLAK…`, `UU…`). Mixes (`RD…`) aren't real playlists: the API can't list them. */
export const playlistIdSchema = z.string().regex(/^[\w-]{12,64}$/).refine((id) => !id.startsWith('RD'))

/** A band: a playlist on air, played track after track. `index` is the track on air (0-based). */
export type RadioBand = { id: string; title: string | null; index: number; length: number }

/**
 * The shared radio. The server stores timestamps only; every client derives the position.
 * Paused: `pausedAtServerMs` is set, and the position stays frozen at `pausedAt - startedAt`.
 */
export type RadioState = {
	videoId: string
	startedAtServerMs: number
	pausedAtServerMs: number | null
	/** From YouTube when it went on air; null if YouTube gave none. */
	title: string | null
	/** Who picked it (a username), or null for a shuffle pick. */
	by: string | null
	/** Its station in the catalog; null in the sender's optimistic copy until the server answers. */
	station: number | null
	/** Set while a band (playlist) is on air; `videoId` is its track `index`. */
	band: RadioBand | null
} | null

export type RadioIntent =
	| { action: 'play'; videoId: string; title?: string | null; by?: string | null; station?: number | null; band?: RadioBand | null }
	| { action: 'pause' | 'resume' | 'stop' }
	| { action: 'seek'; positionMs: number }

/** What plays when the queue and the suggestions run out: a random station, or nothing. */
export type WhenEmpty = 'shuffle' | 'stop'
export const WHEN_EMPTY = ['shuffle', 'stop'] as const

/** How many suggestions a member can have on the shelf at once (the host isn't limited). */
export const SUGGESTION_LIMIT = 3

/**
 * A track or a band on the shelf. `queuePosition` set: the host queued it (lowest plays first).
 * Null: it waits as a suggestion. A band has `band` set and no `videoId`.
 */
export interface Suggestion {
	id: string
	videoId: string | null
	/** `cover`: its first track, for the thumbnail; null until the server answers. */
	band: { id: string; length: number; cover: string | null } | null
	title: string | null
	userId: string
	username: string
	queuePosition: number | null
	createdAtServerMs: number
}

/** The shelf in play order: the host's queue by position, then the suggestions, oldest first. */
export function shelfOrder(suggestions: Suggestion[]) {
	const byAge = (a: Suggestion, b: Suggestion) => a.createdAtServerMs - b.createdAtServerMs || a.id.localeCompare(b.id)
	return {
		queued: suggestions.filter((s) => s.queuePosition !== null).sort((a, b) => a.queuePosition! - b.queuePosition! || byAge(a, b)),
		waiting: suggestions.filter((s) => s.queuePosition === null).sort(byAge),
	}
}

/** What plays when the current track ends. Undefined when the shelf is empty; the "when empty" setting decides then. */
export function nextUp(suggestions: Suggestion[]): Suggestion | undefined {
	const { queued, waiting } = shelfOrder(suggestions)
	return queued[0] ?? waiting[0]
}

/** The queue position `to` gives a suggestion: ahead of the queue, behind it, or out of it (null). */
export function queuePositionFor(suggestions: Suggestion[], id: string, to: 'next' | 'last' | 'off'): number | null {
	if (to === 'off') return null
	const positions = suggestions.filter((s) => s.id !== id && s.queuePosition !== null).map((s) => s.queuePosition!)
	if (!positions.length) return 0
	return to === 'next' ? Math.min(...positions) - 1 : Math.max(...positions) + 1
}

/** YouTube's 320×180 thumbnail for a video. */
export const youtubeThumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`

/** A track position or length as `m:ss`, or `h:mm:ss` from an hour up. */
export function formatTrackTime(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000))
	const mm = String(Math.floor((s % 3600) / 60))
	const ss = String(s % 60).padStart(2, '0')
	return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** A station on the dial, as the tuner lists it (`GET /api/v1/radio/stations`): a track or a band. */
export interface Station {
	/** The video id, or the playlist id for a band. */
	id: string
	kind: 'track' | 'band'
	title: string | null
	station: number
	plays: number
	lastPlayedAtServerMs: number
	/** Who first put it on air; null for a member who has left. */
	addedBy: string | null
	/** YouTube refused it the last time it was on air (tracks only). */
	unplayable: boolean
	/** A band's tracks, in play order. */
	tracks?: { videoId: string; title: string | null }[]
}

/** The FM scale: 87.5 to 108.0 MHz in steps of 0.1, 206 places. */
export const FM_MIN = 87.5
export const FM_MAX = 108
const FM_PLACES = 206
/**
 * Places in the order stations get them: bit-reversed (0, 128, 64, 192, 32, …), skipping those past
 * the band, so the first few stations spread across the dial instead of crowding its left edge.
 */
const PLACE_ORDER = Array.from({ length: 256 }, (_, i) => Number.parseInt(i.toString(2).padStart(8, '0').split('').reverse().join(''), 2))
	.filter((place) => place < FM_PLACES)

/**
 * Where station `n` (1, 2, …; fixed per track or band) sits on the dial. The scale fills after 206
 * stations; station 207 is the first on the second scale (`fm: 2`, shown `FM2`).
 */
export function stationFrequency(station: number) {
	const index = station - 1
	return { fm: Math.floor(index / FM_PLACES) + 1, mhz: (FM_MIN * 10 + PLACE_ORDER[index % FM_PLACES]!) / 10 }
}

/** `94.3 FM`, or `94.3 FM2` on the second scale. */
export function formatFrequency(station: number) {
	const { fm, mhz } = stationFrequency(station)
	return `${mhz.toFixed(1)} FM${fm > 1 ? fm : ''}`
}

/**
 * A band on the dial: a strip around its station's frequency, 0.1 MHz a track (0.4 to 2.0), kept
 * inside the scale, with a mark per track. It may cover a neighbour's tick; the knob steps over the
 * band as a block, so it never interleaves the two.
 */
export function bandStrip(station: number, tracks: number) {
	const width = Math.min(2, Math.max(0.4, tracks * 0.1))
	const from = Math.min(FM_MAX - width, Math.max(FM_MIN, stationFrequency(station).mhz - width / 2))
	return { from, to: from + width, marks: Array.from({ length: tracks }, (_, i) => from + (width * (i + 0.5)) / tracks) }
}

/**
 * What a client's player shows for the house's radio. `tuning`: loading the track; `ended`: the
 * house's position is past the end of the track; `unavailable`: YouTube refused to play it here.
 */
export type RadioPhase = 'tuning' | 'playing' | 'paused' | 'ended' | 'unavailable'

/** Playback position in ms at server time `serverNow`. */
export function radioPositionMs(radio: NonNullable<RadioState>, serverNow: number) {
	return (radio.pausedAtServerMs ?? serverNow) - radio.startedAtServerMs
}

/** How the radio sounds through a door that isn't open. Each listener picks; stored in their browser. */
export type DoorSoundSettings = { ajar: 'quieter' | 'muffled'; closed: 'silent' | 'quieter' | 'muffled' }
export const DEFAULT_DOOR_SOUND: DoorSoundSettings = { ajar: 'quieter', closed: 'silent' }

/**
 * Starting levels, to be tuned by ear. `music`: share of the listener's volume slider. `bed`: gain of
 * the noise laid over the music for "muffled", at full slider. YouTube's audio can't be filtered, so
 * muffled is the music turned down further with a low rumble masking its high end.
 */
export const DOOR_SOUND_LEVELS = {
	ajar: { quieter: { music: 0.25, bed: 0 }, muffled: { music: 0.15, bed: 0.05 } },
	closed: { silent: { music: 0, bed: 0 }, quieter: { music: 0.08, bed: 0 }, muffled: { music: 0.05, bed: 0.08 } },
} as const

/**
 * What this listener hears of the radio through their door. `volume`: their slider, 0 to 100.
 * Returns the player's volume (0 to 100), whether to mute it, and the noise bed's gain.
 */
export function doorSound(door: Door, settings: DoorSoundSettings, volume: number) {
	if (door === 'open') return { volume, muted: false, bed: 0 }
	const levels: Record<string, { music: number; bed: number }> = DOOR_SOUND_LEVELS[door]
	// Settings come from localStorage; an unknown value falls back to the default.
	const { music, bed } = levels[settings[door]] ?? levels[DEFAULT_DOOR_SOUND[door]]!
	return { volume: Math.round(volume * music), muted: music === 0, bed: bed * (volume / 100) }
}

/**
 * Applies an intent. Shared by the server (authoritative) and the client (optimistic), so both
 * compute the same state. Returns `current` itself when the intent changes nothing.
 */
export function nextRadio(current: RadioState, intent: RadioIntent, serverNow: number): RadioState {
	switch (intent.action) {
		case 'play':
			return { videoId: intent.videoId, startedAtServerMs: serverNow, pausedAtServerMs: null, title: intent.title ?? null, by: intent.by ?? null, station: intent.station ?? null, band: intent.band ?? null }
		case 'pause':
			return current && current.pausedAtServerMs === null ? { ...current, pausedAtServerMs: serverNow } : current
		case 'resume':
			// Shift the start forward by the paused time so the position picks up where it stopped.
			return current && current.pausedAtServerMs !== null
				? { ...current, startedAtServerMs: current.startedAtServerMs + serverNow - current.pausedAtServerMs, pausedAtServerMs: null }
				: current
		case 'stop':
			return null
		case 'seek':
			// Moving the start moves the position; a paused track stays paused at the new point.
			return current && { ...current, startedAtServerMs: (current.pausedAtServerMs ?? serverNow) - Math.max(0, intent.positionMs) }
	}
}

/**
 * What a pasted YouTube link (watch, youtu.be, shorts, live, embed, music, playlist) or bare id
 * points at. A link with a playlist (`list=`) is the playlist, even from a watch page: that's what
 * the address bar holds while you're in one. Mixes (`RD…`) fall back to the video.
 */
export function parseYouTubeLink(input: string): { kind: 'track' | 'band'; id: string } | undefined {
	const text = input.trim()
	if (youtubeIdSchema.safeParse(text).success) return { kind: 'track', id: text }
	// A bare playlist id needs a playlist prefix, so a long word typed in isn't taken for one.
	if (/^(PL|OL|UU|FL)/.test(text) && playlistIdSchema.safeParse(text).success) return { kind: 'band', id: text }
	let url: URL
	try {
		url = new URL(text.includes('://') ? text : `https://${text}`)
	} catch {
		return
	}
	const host = url.hostname.replace(/^(www|m|music)\./, '')
	const youtube = host === 'youtube.com' || host === 'youtube-nocookie.com'
	const list = url.searchParams.get('list')
	if ((youtube || host === 'youtu.be') && list && playlistIdSchema.safeParse(list).success) return { kind: 'band', id: list }
	const candidate = host === 'youtu.be'
		? url.pathname.split('/')[1]
		: youtube
			? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/)?.[1]
			: undefined
	return candidate && youtubeIdSchema.safeParse(candidate).success ? { kind: 'track', id: candidate } : undefined
}
