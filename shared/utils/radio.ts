import { z } from 'zod'
import type { Door } from './realtime'

/** A YouTube video id: 11 characters of [A-Za-z0-9_-]. */
export const youtubeIdSchema = z.string().regex(/^[\w-]{11}$/)

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
} | null

export type RadioIntent =
	| { action: 'play'; videoId: string; title?: string | null; by?: string | null; station?: number | null }
	| { action: 'pause' | 'resume' | 'stop' }
	| { action: 'seek'; positionMs: number }

/** What plays when the queue and the suggestions run out: a random station, or nothing. */
export type WhenEmpty = 'shuffle' | 'stop'
export const WHEN_EMPTY = ['shuffle', 'stop'] as const

/** How many suggestions a member can have on the shelf at once (the host isn't limited). */
export const SUGGESTION_LIMIT = 3

/** A track on the shelf. `queuePosition` set: the host queued it (lowest plays first). Null: it waits as a suggestion. */
export interface Suggestion {
	id: string
	videoId: string
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
			return { videoId: intent.videoId, startedAtServerMs: serverNow, pausedAtServerMs: null, title: intent.title ?? null, by: intent.by ?? null, station: intent.station ?? null }
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

/** Extracts the video id from a pasted YouTube link (watch, youtu.be, shorts, live, embed, music) or a bare id. */
export function parseYouTubeId(input: string): string | undefined {
	const text = input.trim()
	if (youtubeIdSchema.safeParse(text).success) return text
	let url: URL
	try {
		url = new URL(text.includes('://') ? text : `https://${text}`)
	} catch {
		return
	}
	const host = url.hostname.replace(/^(www|m|music)\./, '')
	const candidate = host === 'youtu.be'
		? url.pathname.split('/')[1]
		: host === 'youtube.com' || host === 'youtube-nocookie.com'
			? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/)?.[1]
			: undefined
	return candidate && youtubeIdSchema.safeParse(candidate).success ? candidate : undefined
}
