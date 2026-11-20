import { DEFAULT_DOOR_SOUND } from "#shared/utils/radio";
import type { DoorSoundSettings } from "#shared/utils/radio";

/** How the radio sounds through this listener's door. Per browser; every caller shares the value. */
export function useDoorSoundSettings() {
	// Read after mount so the server render and the first client render agree.
	return useLocalStorage<DoorSoundSettings>("house:door-sound", { ...DEFAULT_DOOR_SOUND }, { initOnMounted: true, mergeDefaults: true });
}

/**
 * The low rumble laid over the radio when a door muffles it (YouTube's own audio can't be filtered).
 * Brown noise, low-passed, from a 2 s buffer looped seamlessly. `level` is the gain; at 0 nothing is
 * created, and changes glide over about 300 ms so opening or closing the door doesn't click.
 */
export function useDoorBed(level: MaybeRefOrGetter<number>) {
	let source: AudioBufferSourceNode | undefined;
	let gain: GainNode | undefined;

	function glide() {
		gain?.gain.setTargetAtTime(toValue(level), gain.context.currentTime, 0.1);
	}

	const start = useAudioContext((context) => {
		if (gain) return glide();
		if (toValue(level) <= 0) return;
		const length = context.sampleRate * 2;
		const buffer = context.createBuffer(1, length, context.sampleRate);
		const data = buffer.getChannelData(0);
		let last = 0;
		for (let i = 0; i < length; i++) {
			last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
			data[i] = last * 3.5;
		}
		// Tilt the buffer so its end meets its start; otherwise the loop clicks every 2 seconds.
		const drift = data[length - 1]! - data[0]!;
		for (let i = 0; i < length; i++) data[i]! -= (drift * i) / (length - 1);

		source = context.createBufferSource();
		source.buffer = buffer;
		source.loop = true;
		const wall = context.createBiquadFilter();
		wall.type = "lowpass";
		wall.frequency.value = 400;
		gain = context.createGain();
		gain.gain.value = 0;
		source.connect(wall).connect(gain).connect(context.destination);
		source.start();
		glide();
	});

	watch(() => toValue(level), () => (gain ? glide() : start()));

	onScopeDispose(() => {
		source?.stop();
		source?.disconnect();
		source = undefined;
		gain = undefined;
	});
}
