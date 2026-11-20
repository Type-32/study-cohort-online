import { z } from 'zod'
import type { Door } from './realtime'

/** A YouTube video id: 11 characters of [A-Za-z0-9_-]. */
export const youtubeIdSchema = z.string().regex(/^[\w-]{11}$/)

/**
 * The shared radio. The server stores timestamps only; every client derives the position.
 * Paused: `pausedAtServerMs` is set, and the position stays frozen at `pausedAt - startedAt`.
 */
export type RadioState = { videoId: string; startedAtServerMs: number; pausedAtServerMs: number | null } | null

export type RadioIntent =
	| { action: 'play'; videoId: string }
	| { action: 'pause' | 'resume' | 'stop' }

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
			return { videoId: intent.videoId, startedAtServerMs: serverNow, pausedAtServerMs: null }
		case 'pause':
			return current && current.pausedAtServerMs === null ? { ...current, pausedAtServerMs: serverNow } : current
		case 'resume':
			// Shift the start forward by the paused time so the position picks up where it stopped.
			return current && current.pausedAtServerMs !== null
				? { ...current, startedAtServerMs: current.startedAtServerMs + serverNow - current.pausedAtServerMs, pausedAtServerMs: null }
				: current
		case 'stop':
			return null
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
