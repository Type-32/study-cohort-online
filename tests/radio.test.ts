import { expect, test } from 'bun:test'
import { DEFAULT_DOOR_SOUND, doorSound, nextRadio, parseYouTubeId, radioPositionMs } from '../shared/utils/radio'
import type { DoorSoundSettings } from '../shared/utils/radio'

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

test('parseYouTubeId accepts the common link shapes and rejects the rest', () => {
	for (const link of [
		ID,
		`https://www.youtube.com/watch?v=${ID}&t=42s`,
		`youtube.com/watch?v=${ID}`,
		`https://youtu.be/${ID}?si=abc`,
		`https://m.youtube.com/watch?v=${ID}`,
		`https://music.youtube.com/watch?v=${ID}&list=RD`,
		`https://www.youtube.com/live/${ID}?feature=share`,
		`https://youtube.com/shorts/${ID}`,
		`https://www.youtube-nocookie.com/embed/${ID}`,
	]) expect(parseYouTubeId(link)).toBe(ID)

	for (const bad of ['', 'hello', `https://vimeo.com/${ID}`, 'https://www.youtube.com/watch?v=short', 'https://youtu.be/'])
		expect(parseYouTubeId(bad)).toBeUndefined()
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
