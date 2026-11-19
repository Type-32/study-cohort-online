<script setup lang="ts">
import { parseYouTubeId, radioPositionMs } from "#shared/utils/radio";
import type { RadioIntent, RadioState } from "#shared/utils/radio";
import type { Door } from "#shared/utils/realtime";

const props = defineProps<{ radio: RadioState; clockOffsetMs: number; door: Door }>();
const emit = defineEmits<{ intent: [intent: RadioIntent]; settled: [] }>();

const link = ref("");
const videoId = computed(() => parseYouTubeId(link.value));
const title = ref<string>();

// Sound settings are per listener; read after mount so server and client renders agree.
const volume = useLocalStorage("house:radio-volume", 60, { initOnMounted: true });
const muted = useLocalStorage("house:radio-muted", false, { initOnMounted: true });

// Your door sets how much of the commons you hear: all of it, a quarter through an ajar door, none
// through a closed one. The player keeps playing in sync either way, so opening the door is instant.
const doorVolume = computed(() => Math.round(volume.value * (props.door === "ajar" ? 0.25 : 1)));
const doorMuted = computed(() => muted.value || props.door === "closed");
const doorHint = computed(() =>
	props.door === "ajar" ? "Your door is ajar, so the radio is faint." : props.door === "closed" ? "Your door is closed, so you can't hear the radio." : undefined,
);

const paused = computed(() => props.radio?.pausedAtServerMs != null);

watch(() => props.radio?.videoId, () => (title.value = undefined));

/** The player is still loading the track; shared controls wait until it shows the real state. */
const playerLoading = ref(true);
watch(playerLoading, (loading) => !loading && emit("settled"));
const status = computed(() => (!props.radio ? "Off" : playerLoading.value ? "Tuning in" : paused.value ? "Paused" : "On air"));

function play() {
	if (!videoId.value) return;
	emit("intent", { action: "play", videoId: videoId.value });
	link.value = "";
}

/** Opens the track on YouTube at the house's current position. */
function openOnYouTube() {
	if (!props.radio) return;
	const seconds = Math.floor(radioPositionMs(props.radio, Date.now() + props.clockOffsetMs) / 1000);
	window.open(`https://www.youtube.com/watch?v=${props.radio.videoId}&t=${seconds}s`, "_blank", "noopener");
}
</script>

<template>
	<section id="house-radio" class="flex scroll-mt-24 flex-col gap-4" aria-labelledby="radio-title">
		<div class="flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
			<span class="relative flex size-2">
				<span v-if="radio && !paused" class="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
				<span class="relative inline-flex size-2 rounded-full" :class="radio && !paused ? 'bg-primary' : 'bg-(--ui-text-dimmed)'" />
			</span>
			Radio · {{ status }}
		</div>

		<AnimatePresence mode="wait">
			<Motion
				:key="title ?? 'untitled'"
				as="h2"
				id="radio-title"
				class="font-serif text-2xl text-highlighted text-balance"
				:initial="{ opacity: 0, y: 6 }"
				:animate="{ opacity: 1, y: 0 }"
				:exit="{ opacity: 0, y: -6 }"
				:transition="{ duration: 0.25 }"
			>
				{{ title ?? (radio ? "Tuning in…" : "Nothing on") }}
			</Motion>
		</AnimatePresence>

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
						v-model:loading="playerLoading"
						@title="title = $event"
					/>
					<template #fallback>
						<USkeleton class="aspect-video w-full rounded-xl" />
					</template>
				</ClientOnly>
			</Motion>
		</AnimatePresence>

		<div v-if="radio" class="flex items-center gap-1">
			<UTooltip :text="paused ? 'Resume for everyone' : 'Pause for everyone'">
				<UButton
					:icon="paused ? 'i-pixelarticons-play' : 'i-pixelarticons-pause'"
					:aria-label="paused ? 'Resume' : 'Pause'"
					color="neutral"
					variant="ghost"
					:disabled="playerLoading"
					@click="emit('intent', { action: paused ? 'resume' : 'pause' })"
				/>
			</UTooltip>
			<UTooltip text="Turn off for everyone">
				<UButton icon="i-pixelarticons-stop" aria-label="Turn off" color="neutral" variant="ghost" :disabled="playerLoading" @click="emit('intent', { action: 'stop' })" />
			</UTooltip>
			<UTooltip text="Open on YouTube at this moment">
				<UButton icon="i-pixelarticons-external-link" aria-label="Open on YouTube" color="neutral" variant="ghost" :disabled="playerLoading" @click="openOnYouTube" />
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
						<UButton type="submit" icon="i-pixelarticons-play" aria-label="Play for everyone" size="sm" variant="ghost" :disabled="!videoId" />
					</UTooltip>
				</template>
			</UInput>
		</form>
	</section>
</template>
