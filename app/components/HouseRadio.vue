<script setup lang="ts">
import { doorSound, parseYouTubeId, radioPositionMs } from "#shared/utils/radio";
import type { RadioPhase } from "#shared/utils/radio";

const emit = defineEmits<{ settled: [] }>();

const { house, clockOffsetMs, loaded, myDoor: door } = storeToRefs(useHouseStore());
const radio = computed(() => house.value.radio);
const { mutate: sendIntent, isLoading: sending } = useHouseIntent();

const link = ref("");
const videoId = computed(() => parseYouTubeId(link.value));
const title = ref<string>();

// Sound settings are per listener; read after mount so server and client renders agree.
const volume = useLocalStorage("house:radio-volume", 60, { initOnMounted: true });
const muted = useLocalStorage("house:radio-muted", false, { initOnMounted: true });

// Your door sets how much of the commons you hear, as you chose in the door's sound settings:
// quieter, muffled (quieter with a rumble laid over it), or silent. The player keeps playing in sync
// either way, so opening the door is instant.
const doorSettings = useDoorSoundSettings();
const sound = computed(() => doorSound(door.value, doorSettings.value, volume.value));
const doorVolume = computed(() => sound.value.volume);
const doorMuted = computed(() => muted.value || sound.value.muted);
const doorHint = computed(() => {
	if (door.value === "open") return;
	const how = { quieter: door.value === "ajar" ? "the radio is faint" : "the radio is very faint", muffled: "the radio sounds muffled", silent: "you can't hear the radio" };
	return `Your door is ${door.value}, so ${how[doorSettings.value[door.value]] ?? how.silent}.`;
});

const paused = computed(() => radio.value?.pausedAtServerMs != null);

watch(() => radio.value?.videoId, () => {
	title.value = undefined;
	phase.value = "tuning";
});

/** What the player shows. `tuning` until it shows the house's real state; shared controls wait for it. */
const phase = ref<RadioPhase>("tuning");
const tuning = computed(() => !!radio.value && phase.value === "tuning");
watch(tuning, (now) => !now && emit("settled"));
const status = computed(() => {
	if (!loaded.value) return "Connecting";
	if (!radio.value) return "Off";
	return { tuning: "Tuning in", playing: "On air", paused: "Paused", ended: "Track over", unavailable: "Can't play" }[phase.value];
});
const heading = computed(() => {
	if (!loaded.value) return "…";
	if (!radio.value) return "Nothing on";
	if (title.value) return title.value;
	return phase.value === "tuning" ? "Tuning in…" : phase.value === "unavailable" ? "Can't play this one" : "Untitled track";
});
const onAir = computed(() => !!radio.value && phase.value === "playing");
// The rumble plays only while the music does, and follows your mute.
useDoorBed(() => (onAir.value && !muted.value ? sound.value.bed : 0));

function play() {
	if (!videoId.value) return;
	sendIntent({ t: "radio", action: "play", videoId: videoId.value });
	link.value = "";
}

/** Opens the track on YouTube at the house's current position. */
function openOnYouTube() {
	if (!radio.value) return;
	const seconds = Math.floor(radioPositionMs(radio.value, Date.now() + clockOffsetMs.value) / 1000);
	window.open(`https://www.youtube.com/watch?v=${radio.value.videoId}&t=${seconds}s`, "_blank", "noopener");
}
</script>

<template>
	<section id="house-radio" class="flex scroll-mt-24 flex-col gap-4" aria-labelledby="radio-title">
		<div class="flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
			<span class="relative flex size-2">
				<span v-if="onAir" class="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
				<span class="relative inline-flex size-2 rounded-full" :class="onAir ? 'bg-primary' : 'bg-(--ui-text-dimmed)'" />
			</span>
			Radio · {{ status }}
		</div>

		<!-- Swapped, not cross-faded: the heading can change several times in a second while a track
		     loads, and an exit animation would leave a stale line ("Nothing on") showing meanwhile. -->
		<Motion
			:key="heading"
			as="h2"
			id="radio-title"
			class="font-serif text-2xl text-highlighted text-balance"
			:initial="{ opacity: 0, y: 6 }"
			:animate="{ opacity: 1, y: 0 }"
			:transition="{ duration: 0.25 }"
		>
			{{ heading }}
		</Motion>

		<AnimatePresence>
			<Motion
				v-if="radio"
				key="player"
				:initial="{ opacity: 0, scale: 0.98 }"
				:animate="{ opacity: 1, scale: 1 }"
				:exit="{ opacity: 0, scale: 0.98 }"
				:transition="{ duration: 0.3 }"
			>
				<ClientOnly>
					<RadioPlayer
						:radio="radio"
						:clock-offset-ms="clockOffsetMs"
						:volume="doorVolume"
						:muted="doorMuted"
						v-model:phase="phase"
						@title="title = $event"
					/>
					<template #fallback>
						<USkeleton class="aspect-video w-full rounded-xl" />
					</template>
				</ClientOnly>
			</Motion>
		</AnimatePresence>

		<div v-if="radio" class="flex items-center gap-1">
			<UTooltip v-if="phase !== 'ended'" :text="paused ? 'Resume for everyone' : 'Pause for everyone'">
				<UButton
					:icon="paused ? 'i-pixelarticons-play' : 'i-pixelarticons-pause'"
					:aria-label="paused ? 'Resume' : 'Pause'"
					color="neutral"
					variant="ghost"
					:disabled="tuning"
					@click="sendIntent({ t: 'radio', action: paused ? 'resume' : 'pause' })"
				/>
			</UTooltip>
			<UTooltip text="Turn off for everyone">
				<UButton icon="i-pixelarticons-stop" aria-label="Turn off" color="neutral" variant="ghost" :disabled="tuning" @click="sendIntent({ t: 'radio', action: 'stop' })" />
			</UTooltip>
			<UTooltip text="Open on YouTube at this moment">
				<UButton icon="i-pixelarticons-external-link" aria-label="Open on YouTube" color="neutral" variant="ghost" :disabled="tuning" @click="openOnYouTube" />
			</UTooltip>

			<div class="ml-auto flex w-40 items-center gap-2">
				<UTooltip :text="muted ? 'Unmute (just you)' : 'Mute (just you)'">
					<UButton
						:icon="muted || volume === 0 ? 'i-pixelarticons-volume-x' : 'i-pixelarticons-volume-2'"
						:aria-label="muted ? 'Unmute' : 'Mute'"
						color="neutral"
						variant="ghost"
						@click="muted = !muted"
					/>
				</UTooltip>
				<UTooltip text="Volume (just you)" class="flex-1">
					<USlider v-model="volume" :min="0" :max="100" size="xs" color="neutral" aria-label="Volume" />
				</UTooltip>
			</div>
		</div>

		<AnimatePresence mode="wait">
			<Motion
				v-if="radio && doorHint"
				:key="doorHint"
				as="p"
				class="flex items-center gap-1.5 text-xs text-muted"
				:initial="{ opacity: 0, height: 0 }"
				:animate="{ opacity: 1, height: 'auto' }"
				:exit="{ opacity: 0, height: 0 }"
				:transition="{ duration: 0.2 }"
			>
				<UIcon :name="door === 'closed' ? 'i-pixelarticons-door-closed' : 'i-pixelarticons-lightbulb-on'" class="size-3.5" />
				{{ doorHint }}
			</Motion>
		</AnimatePresence>

		<form @submit.prevent="play">
			<UInput
				v-model="link"
				placeholder="Paste a YouTube link to play it for everyone"
				icon="i-pixelarticons-music"
				variant="soft"
				class="w-full"
				aria-label="YouTube link"
				:color="link && !videoId ? 'error' : 'primary'"
				:highlight="!!link && !videoId"
			>
				<template #trailing>
					<UTooltip :text="link && !videoId ? 'That doesn\'t look like a YouTube link' : 'Play for everyone'">
						<UButton type="submit" icon="i-pixelarticons-play" aria-label="Play for everyone" size="sm" variant="ghost" :disabled="!videoId" :loading="sending" />
					</UTooltip>
				</template>
			</UInput>
		</form>
	</section>
</template>
