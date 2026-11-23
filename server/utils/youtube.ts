import { z } from 'zod'

// YouTube's Data API v3, for playlists (oEmbed can't list a playlist's tracks). Needs an API key
// (`NUXT_YOUTUBE_API_KEY`); each call costs 1 unit of the free 10,000 a day, so a 200-track
// playlist costs 5. No Nuxt imports here, so the unit tests can load it.

const API = 'https://www.googleapis.com/youtube/v3'
/** The most tracks a band takes from a playlist. */
export const BAND_TRACK_LIMIT = 200

const playlistsResponse = z.object({
	items: z.array(z.object({ snippet: z.object({ title: z.string().optional() }).optional() })).default([]),
})
const playlistItemsResponse = z.object({
	nextPageToken: z.string().optional(),
	items: z.array(z.object({
		snippet: z.object({ title: z.string().optional(), resourceId: z.object({ videoId: z.string().optional() }).optional() }).optional(),
		status: z.object({ privacyStatus: z.string().optional() }).optional(),
	})).default([]),
})

/**
 * The tracks in a page of `playlistItems` the radio can play: public or unlisted, with a video id.
 * Deleted and private videos stay in a playlist as placeholders ("Deleted video") and are dropped.
 */
export function playableItems(response: unknown) {
	return playlistItemsResponse.parse(response).items.flatMap((item) => {
		const videoId = item.snippet?.resourceId?.videoId
		const privacy = item.status?.privacyStatus
		return videoId && /^[\w-]{11}$/.test(videoId) && (privacy === 'public' || privacy === 'unlisted')
			? [{ videoId, title: item.snippet?.title ?? null }]
			: []
	})
}

/** Why YouTube's API gave nothing, in words for the member who pasted the link. */
export class YouTubeApiError extends Error {}

async function get(path: string, query: Record<string, string | number | undefined>, key: string): Promise<unknown> {
	try {
		return await $fetch(`${API}/${path}`, { query: { ...query, key }, timeout: 5000 })
	} catch (error) {
		const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
		if (status === 404) throw new YouTubeApiError("YouTube doesn't know that playlist, or it's private.")
		if (status === 400 || status === 403) throw new YouTubeApiError('YouTube refused to list that playlist. The API key may be wrong or out of quota; tell the host.')
		throw new YouTubeApiError("YouTube didn't answer. Try again in a moment.")
	}
}

/** A playlist's title and its playable tracks in order, up to `BAND_TRACK_LIMIT`. */
export async function fetchPlaylist(playlistId: string, key: string) {
	if (!key) throw new YouTubeApiError("Playlists need a YouTube API key on the server (NUXT_YOUTUBE_API_KEY). Paste single tracks for now.")
	const meta = playlistsResponse.parse(await get('playlists', { part: 'snippet', id: playlistId }, key))
	if (!meta.items.length) throw new YouTubeApiError("YouTube doesn't know that playlist, or it's private.")
	const tracks: { videoId: string; title: string | null }[] = []
	let pageToken: string | undefined
	do {
		const response = await get('playlistItems', { part: 'snippet,status', playlistId, maxResults: 50, pageToken }, key)
		tracks.push(...playableItems(response))
		pageToken = playlistItemsResponse.parse(response).nextPageToken
	} while (pageToken && tracks.length < BAND_TRACK_LIMIT)
	if (!tracks.length) throw new YouTubeApiError('That playlist has no tracks the radio can play.')
	return { title: meta.items[0]!.snippet?.title ?? null, tracks: tracks.slice(0, BAND_TRACK_LIMIT) }
}
