import { expect, test } from 'bun:test'
import { DEFAULT_DOOR_SOUND, FM_MAX, FM_MIN, bandStrip, doorSound, formatFrequency, nextRadio, nextUp, parseYouTubeLink, queuePositionFor, radioPositionMs, shelfOrder, stationFrequency } from '../shared/utils/radio'
import type { DoorSoundSettings, Suggestion } from '../shared/utils/radio'
import { playableItems } from '../server/utils/youtube'

const ID = 'jfKfPfyJRdk'

test('pause freezes the position and resume continues from it', () => {
	const playing = nextRadio(null, { action: 'play', videoId: ID }, 1_000)!
	const paused = nextRadio(playing, { action: 'pause' }, 31_000)!
	expect(radioPositionMs(paused, 999_000)).toBe(30_000)

	const resumed = nextRadio(paused, { action: 'resume' }, 91_000)!
	expect(resumed.pausedAtServerMs).toBeNull()
	expect(radioPositionMs(resumed, 91_000)).toBe(30_000)
	expect(radioPositionMs(resumed, 101_000)).toBe(40_000)
})

test('no-op intents return the same state', () => {
	const playing = nextRadio(null, { action: 'play', videoId: ID }, 0)
	expect(nextRadio(playing, { action: 'resume' }, 5)).toBe(playing)
	expect(nextRadio(null, { action: 'pause' }, 5)).toBeNull()
	const paused = nextRadio(playing, { action: 'pause' }, 5)
	expect(nextRadio(paused, { action: 'pause' }, 9)).toBe(paused)
})

test('seek moves the position; a paused track stays paused at the new point', () => {
	const playing = nextRadio(null, { action: 'play', videoId: ID }, 0)!
	expect(radioPositionMs(nextRadio(playing, { action: 'seek', positionMs: 90_000 }, 10_000)!, 10_000)).toBe(90_000)

	const paused = nextRadio(playing, { action: 'pause' }, 10_000)!
	const moved = nextRadio(paused, { action: 'seek', positionMs: 5_000 }, 50_000)!
	expect(moved.pausedAtServerMs).toBe(10_000)
	expect(radioPositionMs(moved, 99_000)).toBe(5_000)
	expect(radioPositionMs(nextRadio(moved, { action: 'resume' }, 60_000)!, 61_000)).toBe(6_000)

	expect(radioPositionMs(nextRadio(playing, { action: 'seek', positionMs: -5 }, 7_000)!, 7_000)).toBe(0)
	expect(nextRadio(null, { action: 'seek', positionMs: 1 }, 7)).toBeNull()
})

const shelf = (...rows: [id: string, queuePosition: number | null, createdAtServerMs: number][]): Suggestion[] =>
	rows.map(([id, queuePosition, createdAtServerMs]) => ({ id, videoId: `${id}`.padEnd(11, '_'), title: id, userId: 'u', username: 'Mina', queuePosition, createdAtServerMs }))

test('the queue plays first, in the host order; then suggestions, oldest first', () => {
	const s = shelf(['new', null, 300], ['old', null, 100], ['q2', 5, 900], ['q1', -1, 950])
	expect(shelfOrder(s).queued.map((x) => x.id)).toEqual(['q1', 'q2'])
	expect(shelfOrder(s).waiting.map((x) => x.id)).toEqual(['old', 'new'])
	expect(nextUp(s)?.id).toBe('q1')
	expect(nextUp(shelf(['new', null, 300], ['old', null, 100]))?.id).toBe('old')
	expect(nextUp([])).toBeUndefined()
})

test('queuePositionFor puts a track ahead of, behind, or out of the queue', () => {
	const s = shelf(['a', 0, 1], ['b', 3, 2], ['c', null, 3])
	expect(queuePositionFor(s, 'c', 'next')).toBe(-1)
	expect(queuePositionFor(s, 'c', 'last')).toBe(4)
	expect(queuePositionFor(s, 'a', 'off')).toBeNull()
	// Moving the only queued track keeps it queued, and a track isn't measured against itself.
	expect(queuePositionFor(shelf(['a', 7, 1]), 'a', 'next')).toBe(0)
	expect(queuePositionFor(s, 'b', 'last')).toBe(1)
})

test('parseYouTubeLink: tracks from the common link shapes, bands from playlist links, nothing from the rest', () => {
	for (const link of [
		ID,
		`https://www.youtube.com/watch?v=${ID}&t=42s`,
		`youtube.com/watch?v=${ID}`,
		`https://youtu.be/${ID}?si=abc`,
		`https://m.youtube.com/watch?v=${ID}`,
		`https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
		`https://www.youtube.com/live/${ID}?feature=share`,
		`https://youtube.com/shorts/${ID}`,
		`https://www.youtube-nocookie.com/embed/${ID}`,
	]) expect(parseYouTubeLink(link)).toEqual({ kind: 'track', id: ID })

	const PL = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'
	for (const link of [PL, `https://www.youtube.com/playlist?list=${PL}`, `https://www.youtube.com/watch?v=${ID}&list=${PL}&index=3`, `https://music.youtube.com/playlist?list=${PL}`])
		expect(parseYouTubeLink(link)).toEqual({ kind: 'band', id: PL })

	for (const bad of ['', 'hello', 'helloworldhello', `https://vimeo.com/${ID}`, 'https://www.youtube.com/watch?v=short', 'https://youtu.be/', 'https://www.youtube.com/playlist?list=WL'])
		expect(parseYouTubeLink(bad)).toBeUndefined()
})

test('doorSound: open is untouched, quieter lowers, silent mutes, muffled adds a bed that follows the slider', () => {
	expect(doorSound('open', { ajar: 'muffled', closed: 'muffled' }, 60)).toEqual({ volume: 60, muted: false, bed: 0 })

	// The defaults are the behaviour before the setting existed: ajar at a quarter, closed silent.
	expect(doorSound('ajar', DEFAULT_DOOR_SOUND, 60)).toEqual({ volume: 15, muted: false, bed: 0 })
	expect(doorSound('closed', DEFAULT_DOOR_SOUND, 60)).toMatchObject({ muted: true, bed: 0 })

	const muffled = doorSound('ajar', { ajar: 'muffled', closed: 'silent' }, 100)
	expect(muffled.volume).toBeLessThan(doorSound('ajar', DEFAULT_DOOR_SOUND, 100).volume)
	expect(muffled.bed).toBeGreaterThan(0)
	expect(doorSound('ajar', { ajar: 'muffled', closed: 'silent' }, 50).bed).toBeCloseTo(muffled.bed / 2)
	expect(doorSound('ajar', { ajar: 'muffled', closed: 'silent' }, 0)).toMatchObject({ volume: 0, bed: 0 })

	const closedQuieter = doorSound('closed', { ajar: 'quieter', closed: 'quieter' }, 100)
	expect(closedQuieter.muted).toBe(false)
	expect(closedQuieter.volume).toBeLessThan(doorSound('ajar', DEFAULT_DOOR_SOUND, 100).volume)

	// A stale or edited localStorage value falls back to the default instead of throwing.
	expect(doorSound('closed', { ajar: 'quieter', closed: 'loud' } as unknown as DoorSoundSettings, 60)).toMatchObject({ muted: true })
})

test('206 stations get 206 different places on the scale, spread from the start, and never move', () => {
	const places = Array.from({ length: 206 }, (_, i) => stationFrequency(i + 1))
	expect(new Set(places.map((p) => p.mhz)).size).toBe(206)
	expect(places.every((p) => p.fm === 1 && p.mhz >= FM_MIN && p.mhz <= FM_MAX && Math.round(p.mhz * 10) === p.mhz * 10)).toBe(true)
	expect(places.slice(0, 4).map((p) => p.mhz)).toEqual([87.5, 100.3, 93.9, 106.7])
	expect(stationFrequency(42)).toEqual(stationFrequency(42))
	expect(stationFrequency(207)).toEqual({ fm: 2, mhz: 87.5 })
	expect(formatFrequency(2)).toBe('100.3 FM')
	expect(formatFrequency(208)).toBe('100.3 FM2')
})

test('bandStrip: a strip around the station, 0.2 MHz a track within 0.8 to 3.0, inside the scale, a mark per track', () => {
	const mid = bandStrip(2, 8) // 100.3
	expect(mid.from).toBeCloseTo(99.5)
	expect(mid.to).toBeCloseTo(101.1)
	expect(mid.marks).toHaveLength(8)
	expect(mid.marks.every((m, i) => m > mid.from && m < mid.to && (i === 0 || m > mid.marks[i - 1]!))).toBe(true)
	expect(bandStrip(2, 1).to - bandStrip(2, 1).from).toBeCloseTo(0.8)
	expect(bandStrip(2, 200).to - bandStrip(2, 200).from).toBeCloseTo(3)
	// Station 1 sits at 87.5, the scale's left end: the strip starts there instead of hanging off it.
	expect(bandStrip(1, 10).from).toBe(FM_MIN)
})

test('playableItems keeps public and unlisted tracks in order, drops deleted and private placeholders', () => {
	const item = (videoId: string | undefined, privacyStatus: string, title: string) => ({ snippet: { title, resourceId: { kind: 'youtube#video', videoId } }, status: { privacyStatus } })
	const page = {
		kind: 'youtube#playlistItemListResponse',
		nextPageToken: 'CAUQAA',
		items: [
			item('aaaaaaaaaaa', 'public', 'One'),
			item('bbbbbbbbbbb', 'privacyStatusUnspecified', 'Deleted video'),
			item('ccccccccccc', 'private', 'Private video'),
			item('ddddddddddd', 'unlisted', 'Four'),
			item(undefined, 'public', 'No id'),
		],
	}
	expect(playableItems(page)).toEqual([{ videoId: 'aaaaaaaaaaa', title: 'One' }, { videoId: 'ddddddddddd', title: 'Four' }])
	expect(playableItems({})).toEqual([])
})
