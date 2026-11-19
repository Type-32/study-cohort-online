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
const status = computed(() =>
	!props.radio
		? { label: "Off", color: "neutral" as const }
		: paused.value
			? { label: "Paused", color: "warning" as const }
			: { label: "On air", color: "primary" as const },
);

watch(() => props.radio?.videoId, () => (title.value = undefined));

function play() {
	if (!videoId.value) return;
	emit("intent", { action: "play", videoId: videoId.value });
	link.value = "";
}
</script>

<template>
	<UCard :ui="{ body: 'flex flex-col gap-4' }">
		<template #header>
			<div class="flex items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-2">
					<UIcon name="i-pixelarticons-radio" class="size-5 shrink-0 text-primary" />
					<h2 class="truncate text-lg font-semibold text-highlighted">{{ title ?? "Radio" }}</h2>
				</div>
				<UBadge :label="status.label" :color="status.color" variant="subtle" />
			</div>
		</template>

		<ClientOnly v-if="radio">
			<RadioPlayer :radio="radio" :clock-offset-ms="clockOffsetMs" :volume="volume" :muted="muted" @title="title = $event" />
			<template #fallback>
				<USkeleton class="aspect-video w-full" />
			</template>
		</ClientOnly>
		<p v-else class="text-muted">Nothing on. Paste a YouTube link and the whole house hears it together.</p>

		<form class="flex flex-col gap-1" @submit.prevent="play">
			<UFieldGroup class="w-full">
				<UInput v-model="link" placeholder="Paste a YouTube link" icon="i-pixelarticons-music" class="flex-1" aria-label="YouTube link" />
				<UButton type="submit" label="Play for everyone" icon="i-pixelarticons-play" :disabled="!videoId" />
			</UFieldGroup>
			<p v-if="link && !videoId" class="text-xs text-error">That doesn't look like a YouTube link.</p>
		</form>

		<div v-if="radio" class="flex flex-wrap items-center gap-2">
			<UButton
				:label="paused ? 'Resume' : 'Pause'"
				:icon="paused ? 'i-pixelarticons-play' : 'i-pixelarticons-pause'"
				color="neutral"
				@click="emit('intent', { action: paused ? 'resume' : 'pause' })"
			/>
			<UButton label="Turn off" icon="i-pixelarticons-stop" color="neutral" variant="ghost" @click="emit('intent', { action: 'stop' })" />

			<div class="ml-auto flex w-48 items-center gap-2">
				<UButton
					:icon="muted || volume === 0 ? 'i-pixelarticons-volume-x' : 'i-pixelarticons-volume-2'"
					:aria-label="muted ? 'Unmute' : 'Mute'"
					color="neutral"
					variant="ghost"
					@click="muted = !muted"
				/>
				<USlider v-model="volume" :min="0" :max="100" size="sm" aria-label="Volume" />
			</div>
		</div>

		<p class="text-xs text-muted">Play, pause and turn off are for everyone. Volume and mute are just for you.</p>
	</UCard>
</template>
