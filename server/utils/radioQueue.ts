import { db, schema } from '@nuxthub/db'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { publish } from '#server/utils/bus'
import { presentMembers } from '#server/utils/presence'
import { satisfies } from '#shared/utils/roles'
import { SUGGESTION_LIMIT, nextRadio, nextUp, queuePositionFor } from '#shared/utils/radio'
import type { RadioState, Station, Suggestion, WhenEmpty } from '#shared/utils/radio'
import type { ServerMsg } from '#shared/utils/realtime'
import type { User } from '#shared/types/db'

// The radio's shelf (suggestions and the host's queue), its catalog of stations, and how it moves
// on. Every change runs under the `house_state` row lock: one house is small, and one lock makes
// "what plays next" impossible to race. See plans/online-gathering-v1.md, step 8.

const { houseState, radioSuggestion, radioTrack, youtubeVideo, user } = schema
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type HouseRow = typeof houseState.$inferSelect
type Broadcast = Extract<ServerMsg, { t: 'radio' | 'suggestion' | 'unsuggest' | 'radioWhenEmpty' }>

/** A refusal the sender should read as is ("That one is already on the shelf."). */
export class HouseError extends Error {}

/** The host and moderators manage the radio. */
export const managesRadio = (member: User) => satisfies(member, { minRole: 'moderator' })

function requireHost(member: User) {
	if (!managesRadio(member)) throw new HouseError('Only the host and moderators can do that.')
}

export const radioOf = (row: HouseRow | undefined): RadioState =>
	row?.radioVideoId && row.radioStartedAt
		? {
				videoId: row.radioVideoId,
				startedAtServerMs: row.radioStartedAt.getTime(),
				pausedAtServerMs: row.radioPausedAt?.getTime() ?? null,
				title: row.radioTitle,
				by: row.radioBy,
				station: row.radioStation,
			}
		: null

/** The shelf with titles and who suggested each track. */
export async function loadShelf(tx: Pick<typeof db, 'select'> = db): Promise<Suggestion[]> {
	const rows = await tx.select({
		id: radioSuggestion.id,
		videoId: radioSuggestion.videoId,
		title: youtubeVideo.title,
		userId: radioSuggestion.userId,
		username: user.username,
		queuePosition: radioSuggestion.queuePosition,
		createdAt: radioSuggestion.createdAt,
	})
		.from(radioSuggestion)
		.innerJoin(user, eq(user.id, radioSuggestion.userId))
		.leftJoin(youtubeVideo, eq(youtubeVideo.videoId, radioSuggestion.videoId))
	return rows.map(({ createdAt, ...rest }) => ({ ...rest, createdAtServerMs: createdAt.getTime() }))
}

/** The catalog, for the tuner: every track that has been on air, with its station. */
export async function listStations(): Promise<Station[]> {
	const rows = await db.select({
		videoId: radioTrack.videoId,
		title: youtubeVideo.title,
		station: radioTrack.station,
		plays: radioTrack.plays,
		lastPlayedAt: radioTrack.lastPlayedAt,
		addedBy: user.username,
		unplayableAt: radioTrack.unplayableAt,
	})
		.from(radioTrack)
		.leftJoin(youtubeVideo, eq(youtubeVideo.videoId, radioTrack.videoId))
		.leftJoin(user, eq(user.id, radioTrack.addedBy))
		.orderBy(radioTrack.station)
	return rows.map(({ lastPlayedAt, unplayableAt, ...rest }) => ({ ...rest, lastPlayedAtServerMs: lastPlayedAt.getTime(), unplayable: !!unplayableAt }))
}

/**
 * Takes a station off the dial (and out of the shuffle pool); the route checks the role. If the
 * track goes on air again it gets a new station. The track on air can't be removed: skip it first.
 */
export async function removeStation(videoId: string) {
	await inHouse(undefined, async (tx, row) => {
		if (row.radioVideoId === videoId && !row.radioEndedAt) throw new HouseError("That one is on air. Skip it first, then remove it.")
		await tx.delete(radioTrack).where(eq(radioTrack.videoId, videoId))
	})
}

/**
 * A video's title from YouTube's oEmbed endpoint (no API key), cached in `youtube_video`. Refuses a
 * video YouTube doesn't know. A video YouTube won't describe (often one that refuses embedding) is
 * kept without a title; so is one when YouTube doesn't answer in 3 s, uncached so the next try asks again.
 */
export async function videoTitle(videoId: string): Promise<string | null> {
	const cached = await db.query.youtubeVideo.findFirst({ where: eq(youtubeVideo.videoId, videoId) })
	if (cached) return cached.title
	let title: string | null = null
	try {
		const data = await $fetch<{ title?: string }>('https://www.youtube.com/oembed', {
			query: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
			timeout: 3000,
		})
		title = data.title ?? null
	} catch (error) {
		const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
		if (status === 400 || status === 404) throw new HouseError("YouTube doesn't know that video. Check the link.")
		if (status !== 401 && status !== 403) return null
	}
	await db.insert(youtubeVideo).values({ videoId, title }).onConflictDoNothing()
	return title
}

/**
 * Runs `work` under the house row lock and publishes what it pushed to `out`, in order, inside the
 * same transaction. The intent id rides on the last message, so the sender drops its optimistic
 * copy only once everything the intent caused has arrived. An intent that changed nothing still
 * gets an answer: the radio as it is.
 */
async function inHouse(intent: string | undefined, work: (tx: Tx, row: HouseRow, out: Broadcast[]) => Promise<void>) {
	await db.transaction(async (tx) => {
		await tx.insert(houseState).values({ id: 1 }).onConflictDoNothing()
		const [row] = await tx.select().from(houseState).where(eq(houseState.id, 1)).for('update')
		const out: Broadcast[] = []
		await work(tx, row!, out)
		if (intent) {
			if (!out.length) out.push({ t: 'radio', radio: radioOf(row) })
			out.at(-1)!.intent = intent
		}
		for (const msg of out) await publish(msg, { tx })
	})
}

async function writeRadio(tx: Tx, radio: RadioState, endedAt: Date | null = null, unplayableBy: string[] = []) {
	await tx.update(houseState).set({
		radioVideoId: radio?.videoId ?? null,
		radioStartedAt: radio && new Date(radio.startedAtServerMs),
		radioPausedAt: radio?.pausedAtServerMs != null ? new Date(radio.pausedAtServerMs) : null,
		radioTitle: radio?.title ?? null,
		radioBy: radio?.by ?? null,
		radioStation: radio?.station ?? null,
		radioEndedAt: endedAt,
		radioUnplayableBy: unplayableBy,
	}).where(eq(houseState.id, 1))
}

/**
 * Puts a track on air and records it in the catalog: a new track gets the next station number, a
 * known one another play (and loses an unplayable mark: someone chose it again).
 */
async function startTrack(tx: Tx, videoId: string, by: { id: string; username: string } | null, now: number): Promise<RadioState> {
	const [video] = await tx.select({ title: youtubeVideo.title }).from(youtubeVideo).where(eq(youtubeVideo.videoId, videoId))
	const [track] = await tx.insert(radioTrack)
		.values({
			videoId,
			station: sql`(select coalesce(max(${radioTrack.station}), 0) + 1 from ${radioTrack})`,
			plays: 1,
			lastPlayedAt: new Date(now),
			addedBy: by?.id ?? null,
		})
		.onConflictDoUpdate({ target: radioTrack.videoId, set: { plays: sql`${radioTrack.plays} + 1`, lastPlayedAt: new Date(now), unplayableAt: null } })
		.returning({ station: radioTrack.station })
	const radio = nextRadio(null, { action: 'play', videoId, title: video?.title ?? null, by: by?.username ?? null, station: track!.station }, now)
	await writeRadio(tx, radio)
	return radio
}

async function takeFromShelf(tx: Tx, suggestion: Suggestion, now: number, out: Broadcast[]) {
	await tx.delete(radioSuggestion).where(eq(radioSuggestion.id, suggestion.id))
	out.push({ t: 'unsuggest', suggestionId: suggestion.id })
	out.push({ t: 'radio', radio: await startTrack(tx, suggestion.videoId, { id: suggestion.userId, username: suggestion.username }, now) })
}

/**
 * Moves on to what plays next: the queue, then the oldest suggestion, then the "when empty"
 * setting. With nothing to play, a skip turns the radio off, and a track that ended stays on air
 * as "Track over" (`radioEndedAt`), so the next suggestion plays at once.
 */
async function advance(tx: Tx, row: HouseRow, now: number, out: Broadcast[], how: 'ended' | 'skip') {
	const next = nextUp(await loadShelf(tx))
	if (next) return takeFromShelf(tx, next, now, out)
	if (row.radioWhenEmpty === 'shuffle') {
		const [pick] = await tx.select({ videoId: radioTrack.videoId })
			.from(radioTrack)
			.where(and(isNull(radioTrack.unplayableAt), row.radioVideoId ? ne(radioTrack.videoId, row.radioVideoId) : undefined))
			.orderBy(sql`random()`)
			.limit(1)
		if (pick) return void out.push({ t: 'radio', radio: await startTrack(tx, pick.videoId, null, now) })
	}
	if (how === 'skip') {
		await writeRadio(tx, null)
		out.push({ t: 'radio', radio: null })
	} else {
		await tx.update(houseState).set({ radioEndedAt: new Date(now) }).where(eq(houseState.id, 1))
	}
}

/** Off, or a track that's over: a new suggestion or the shuffle setting starts something at once. */
const idle = (row: HouseRow) => !row.radioVideoId || !!row.radioEndedAt

export async function suggest(member: User, s: { suggestionId: string; videoId: string; queue?: boolean }, intent?: string) {
	const host = managesRadio(member)
	if (s.queue) requireHost(member)
	const title = await videoTitle(s.videoId)
	await inHouse(intent, async (tx, row, out) => {
		if (row.radioVideoId === s.videoId && !row.radioEndedAt) throw new HouseError("That one is on air right now.")
		const shelf = await loadShelf(tx)
		if (shelf.some((x) => x.videoId === s.videoId)) throw new HouseError('That one is already on the shelf.')
		if (!host && shelf.filter((x) => x.userId === member.id).length >= SUGGESTION_LIMIT)
			throw new HouseError(`You have ${SUGGESTION_LIMIT} suggestions waiting. Withdraw one, or wait for one to play.`)
		const queuePosition = s.queue ? queuePositionFor(shelf, s.suggestionId, 'last') : null
		const [created] = await tx.insert(radioSuggestion).values({ id: s.suggestionId, userId: member.id, videoId: s.videoId, queuePosition }).returning()
		out.push({
			t: 'suggestion',
			suggestion: { id: created!.id, videoId: s.videoId, title, userId: member.id, username: member.username, queuePosition, createdAtServerMs: created!.createdAt.getTime() },
		})
		if (idle(row)) await advance(tx, row, Date.now(), out, 'ended')
	})
}

export async function unsuggest(member: User, suggestionId: string, intent?: string) {
	await inHouse(intent, async (tx, _row, out) => {
		const [found] = await tx.select({ userId: radioSuggestion.userId }).from(radioSuggestion).where(eq(radioSuggestion.id, suggestionId))
		if (found && found.userId !== member.id) requireHost(member)
		if (found) await tx.delete(radioSuggestion).where(eq(radioSuggestion.id, suggestionId))
		// Already gone (it just played, or a second tab withdrew it): the answer is the same.
		out.push({ t: 'unsuggest', suggestionId })
	})
}

export async function queue(member: User, suggestionId: string, to: 'next' | 'last' | 'off', intent?: string) {
	requireHost(member)
	await inHouse(intent, async (tx, _row, out) => {
		const shelf = await loadShelf(tx)
		const suggestion = shelf.find((x) => x.id === suggestionId)
		if (!suggestion) throw new HouseError("That track isn't on the shelf any more.")
		const queuePosition = queuePositionFor(shelf, suggestionId, to)
		await tx.update(radioSuggestion).set({ queuePosition }).where(eq(radioSuggestion.id, suggestionId))
		out.push({ t: 'suggestion', suggestion: { ...suggestion, queuePosition } })
	})
}

export async function setWhenEmpty(member: User, mode: WhenEmpty, intent?: string) {
	requireHost(member)
	await inHouse(intent, async (tx, row, out) => {
		await tx.update(houseState).set({ radioWhenEmpty: mode }).where(eq(houseState.id, 1))
		out.push({ t: 'radioWhenEmpty', mode })
		if (mode === 'shuffle' && idle(row)) await advance(tx, { ...row, radioWhenEmpty: mode }, Date.now(), out, 'ended')
	})
}

type RadioAction =
	| { action: 'pause' | 'resume' }
	| { action: 'skip' | 'stop' }
	| { action: 'play'; videoId: string }
	| { action: 'playSuggestion'; suggestionId: string }
	| { action: 'seek'; positionMs: number }

export async function radioAction(member: User, a: RadioAction, intent?: string) {
	if (a.action !== 'pause' && a.action !== 'resume') requireHost(member)
	// Fetched before taking the lock: YouTube can take seconds to answer.
	if (a.action === 'play') await videoTitle(a.videoId)
	await inHouse(intent, async (tx, row, out) => {
		const now = Date.now()
		switch (a.action) {
			case 'pause':
			case 'resume':
			case 'seek': {
				const current = radioOf(row)
				const next = nextRadio(current, a, now)
				if (next !== current) await writeRadio(tx, next, row.radioEndedAt, row.radioUnplayableBy)
				out.push({ t: 'radio', radio: next })
				return
			}
			case 'stop':
				await writeRadio(tx, null)
				out.push({ t: 'radio', radio: null })
				return
			case 'skip':
				return advance(tx, row, now, out, 'skip')
			case 'play': {
				// Playing a track that's on the shelf takes it off the shelf.
				const shelved = (await loadShelf(tx)).find((x) => x.videoId === a.videoId)
				if (shelved) {
					await tx.delete(radioSuggestion).where(eq(radioSuggestion.id, shelved.id))
					out.push({ t: 'unsuggest', suggestionId: shelved.id })
				}
				out.push({ t: 'radio', radio: await startTrack(tx, a.videoId, { id: member.id, username: member.username }, now) })
				return
			}
			case 'playSuggestion': {
				const suggestion = (await loadShelf(tx)).find((x) => x.id === a.suggestionId)
				if (!suggestion) throw new HouseError("That track isn't on the shelf any more.")
				return takeFromShelf(tx, suggestion, now, out)
			}
		}
	})
}

/**
 * A player reports the track it was playing is over, or that YouTube refused it. Only a report about
 * the track still on air, playing and not yet over, counts, so twenty players reporting the same end
 * make one change and a late report about an old track does nothing.
 *
 * A refusal moves on only once every member present has been refused: YouTube's "embedding not
 * allowed" can depend on the viewer (their region, the page's address), so one player's refusal
 * mustn't skip a track the others are hearing, or mark it unplayable for shuffle.
 */
export async function playerReport(member: User, r: { action: 'ended' | 'unplayable'; videoId: string; startedAtServerMs: number }) {
	await inHouse(undefined, async (tx, row, out) => {
		const current = row.radioVideoId === r.videoId && row.radioStartedAt?.getTime() === r.startedAtServerMs
		if (!current || row.radioPausedAt || row.radioEndedAt) return
		if (r.action === 'unplayable') {
			const refused = [...new Set([...row.radioUnplayableBy, member.id])]
			const present = (await presentMembers()).map((m) => m.userId)
			if (!present.every((id) => refused.includes(id))) {
				await tx.update(houseState).set({ radioUnplayableBy: refused }).where(eq(houseState.id, 1))
				return
			}
			await tx.update(radioTrack).set({ unplayableAt: new Date() }).where(eq(radioTrack.videoId, r.videoId))
		}
		await advance(tx, row, Date.now(), out, 'ended')
	})
}
