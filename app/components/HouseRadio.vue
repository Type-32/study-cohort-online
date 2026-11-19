<script setup lang="ts">
import { parseYouTubeId } from "#shared/utils/radio";
import type { RadioIntent, RadioState } from "#shared/utils/radio";

const props = defineProps<{ radio: RadioState; clockOffsetMs: number }>();
const emit = defineEmits<{ intent: [intent: RadioIntent] }>();

const link = ref("");
const videoId = computed(() => parseYouTubeId(link.value));
const title = ref<string>();

// Sound settings are per listener; read after mount so server and client renders agree.
const volume = useLocalStorage("house:radio-volume", 60, { initOnMounted: true });
const muted = useLocalStorage("house:radio-muted", false, { initOnMounted: true });

const paused = computed(() => props.radio?.pausedAtServerMs != null);
const status = computed(() => (!props.radio ? "Off" : paused.value ? "Paused" : "On air"));

watch(() => props.radio?.videoId, () => (title.value = undefined));

function play() {
	if (!videoId.value) return;
	emit("intent", { action: "play", videoId: videoId.value });
	link.value = "";
}
</script>

<template>
	<section class="flex flex-col gap-4" aria-labelledby="radio-title">
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
						:volume="volume"
						:muted="muted"
						@title="title = $event"
						@intent="emit('intent', $event)"
					/>
					<template #fallback>
						<USkeleton class="aspect-video w-full rounded-lg" />
					</template>
				</ClientOnly>
			</Motion>
		</AnimatePresence>

		<div v-if="radio" class="flex items-center gap-1">
			<UButton
				:icon="paused ? 'i-pixelarticons-play' : 'i-pixelarticons-pause'"
				:aria-label="paused ? 'Resume' : 'Pause'"
				color="neutral"
				variant="ghost"
				@click="emit('intent', { action: paused ? 'resume' : 'pause' })"
			/>
			<UButton icon="i-pixelarticons-stop" aria-label="Turn off" color="neutral" variant="ghost" @click="emit('intent', { action: 'stop' })" />
			<div class="ml-auto flex w-40 items-center gap-2">
				<UButton
					:icon="muted || volume === 0 ? 'i-pixelarticons-volume-x' : 'i-pixelarticons-volume-2'"
					:aria-label="muted ? 'Unmute' : 'Mute'"
					color="neutral"
					variant="ghost"
					@click="muted = !muted"
				/>
				<USlider v-model="volume" :min="0" :max="100" size="xs" color="neutral" aria-label="Volume" />
			</div>
		</div>

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
					<UButton type="submit" icon="i-pixelarticons-play" aria-label="Play for everyone" size="sm" variant="ghost" :disabled="!videoId" />
				</template>
			</UInput>
		</form>
	</section>
</template>
