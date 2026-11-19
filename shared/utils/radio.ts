import { z } from 'zod'

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
