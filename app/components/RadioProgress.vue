<script setup lang="ts">
import { formatTrackTime as clock } from "#shared/utils/radio";

/**
 * Where the track is. Everyone sees it; the host and moderators can drag it (`canSeek`), and only
 * the release is sent, once. `durationMs`: null for a live stream (no bar, `LIVE`), undefined while
 * unknown. `chapters` (from a video's description, not supplied yet) split the bar into segments.
 */
const props = defineProps<{
	positionMs: number;
	durationMs: number | null | undefined;
	canSeek: boolean;
	chapters?: { startMs: number; title: string }[];
}>();
const emit = defineEmits<{ seek: [positionMs: number] }>();

// The bar stops 1 s short of the end: the server can't check the length, and a seek past the end
// would just end the track.
const maxS = computed(() => Math.max(0, Math.floor((props.durationMs ?? 0) / 1000) - 1));

/** Where the thumb is while being dragged; nothing is sent until it's let go. */
const scrubS = ref<number>();
const shownMs = computed(() => (scrubS.value !== undefined ? scrubS.value * 1000 : Math.min(props.positionMs, props.durationMs ?? Infinity)));

const chapterAt = (ms: number) => props.chapters?.findLast((c) => c.startMs <= ms);
const chapter = computed(() => chapterAt(shownMs.value));

// Arrow keys commit on every press; wait until they rest. A drag commits once, on release.
const commit = useDebounceFn(() => {
	if (scrubS.value === undefined) return;
	emit("seek", scrubS.value * 1000);
	// The sender's optimistic copy now has the new position, so the bar doesn't jump back.
	scrubS.value = undefined;
}, 250);

/** The time under the pointer, shown above the bar with its chapter. */
const hoverMs = ref<number>();
function hover(event: PointerEvent) {
	if (!props.durationMs) return;
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	hoverMs.value = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * props.durationMs;
}
const hoverLabel = computed(() => {
	if (hoverMs.value === undefined) return;
	const c = chapterAt(hoverMs.value);
	return c ? `${clock(hoverMs.value)} · ${c.title}` : clock(hoverMs.value);
});
</script>

<template>
	<div class="flex items-center gap-3 text-xs text-muted tabular-nums">
		<template v-if="durationMs === null">
			<UBadge label="LIVE" color="error" variant="subtle" size="sm" />
			<span>Live streams play at the live edge.</span>
		</template>
		<template v-else>
			<span class="w-14 shrink-0">{{ clock(shownMs) }}</span>
			<div v-if="durationMs" class="relative flex-1 py-2" @pointermove="hover" @pointerleave="hoverMs = undefined">
				<USlider
					v-if="canSeek"
					:model-value="shownMs / 1000"
					:min="0"
					:max="maxS"
					:step="1"
					size="xs"
					aria-label="Track position, for everyone"
					@update:model-value="(s) => (scrubS = typeof s === 'number' ? s : undefined)"
					@change="commit"
				/>
				<UProgress v-else :model-value="shownMs" :max="durationMs" size="xs" aria-label="Track position" />
				<!-- Chapter boundaries: gaps cut into the bar, like YouTube's. -->
				<span
					v-for="c in chapters?.slice(1)"
					:key="c.startMs"
					class="pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-(--ui-bg)"
					:style="{ left: `${(c.startMs / durationMs) * 100}%` }"
				/>
				<span
					v-if="hoverLabel"
					class="pointer-events-none absolute -top-5 -translate-x-1/2 rounded bg-inverted px-1.5 py-0.5 whitespace-nowrap text-inverted"
					:style="{ left: `${((hoverMs ?? 0) / durationMs) * 100}%` }"
				>
					{{ hoverLabel }}
				</span>
			</div>
			<div v-else class="flex-1" />
			<span class="w-14 shrink-0 text-right">{{ durationMs ? clock(durationMs) : "--:--" }}</span>
			<span v-if="chapter" class="hidden max-w-40 truncate sm:inline" :title="chapter.title">{{ chapter.title }}</span>
		</template>
	</div>
</template>
