import { expect, test } from 'bun:test'
import { nextRadio, parseYouTubeId, radioPositionMs } from '../shared/utils/radio'

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
