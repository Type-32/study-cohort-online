<script setup lang="ts">
import { FM_MAX, FM_MIN } from "#shared/utils/radio";

/**
 * The tuner's window: a lit FM scale with a tick per track station, a band (a playlist) as a lit
 * strip with a mark per track, a marker under what's on air, and a needle. Pointer only and
 * `aria-hidden`: the tuning knob is its keyboard and screen-reader control.
 */
const props = defineProps<{
	/** Every place the needle can rest on this scale, in dial order (frequencies). */
	stops: number[];
	ticks: number[];
	strips: { key: string; from: number; to: number; marks: number[] }[];
	needle: number | null;
	onAir: number | null;
}>();
/** The index (in `stops`) of the stop nearest the pointer. */
const emit = defineEmits<{ tune: [stop: number] }>();

const pct = (mhz: number) => `${((mhz - FM_MIN) / (FM_MAX - FM_MIN)) * 100}%`;
const width = (from: number, to: number) => `${((to - from) / (FM_MAX - FM_MIN)) * 100}%`;
const labels = [88, 92, 96, 100, 104, 108];
const minor = Array.from({ length: 21 }, (_, i) => 88 + i);

/** Dragging along the scale snaps the needle to the nearest stop. */
const scale = useTemplateRef<HTMLElement>("scale");
let dragging = false;
function tuneAt(event: PointerEvent) {
	const box = scale.value?.getBoundingClientRect();
	if (!box || !props.stops.length) return;
	const mhz = FM_MIN + Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * (FM_MAX - FM_MIN);
	let nearest = 0;
	props.stops.forEach((stop, i) => Math.abs(stop - mhz) < Math.abs(props.stops[nearest]! - mhz) && (nearest = i));
	emit("tune", nearest);
}
function down(event: PointerEvent) {
	dragging = true;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	tuneAt(event);
}
function move(event: PointerEvent) {
	if (dragging) tuneAt(event);
}
function up() {
	dragging = false;
}
</script>

<template>
	<div
		class="relative h-14 touch-none overflow-hidden rounded-lg bg-(--radio-lcd-bg) font-mono text-(--radio-lcd-fg) select-none"
		:class="stops.length > 0 && 'cursor-ew-resize'"
		aria-hidden="true"
		@pointerdown.prevent="down"
		@pointermove="move"
		@pointerup="up"
		@pointercancel="up"
	>
		<!-- Inset, so the needle and the end labels aren't cut off at 87.5 and 108. -->
		<div ref="scale" class="absolute inset-x-4 inset-y-0">
			<span v-for="mhz in labels" :key="mhz" class="absolute top-1 -translate-x-1/2 text-[10px] leading-none opacity-70" :style="{ left: pct(mhz) }">{{ mhz }}</span>
			<span v-for="mhz in minor" :key="mhz" class="absolute bottom-0 h-1.5 w-px bg-current opacity-30" :style="{ left: pct(mhz) }" />
			<!-- A band: a lit strip of the scale with a bright top edge, a mark per track. -->
			<div v-for="strip in strips" :key="strip.key" class="absolute bottom-0 h-6 rounded-t-sm border-t-2 border-current bg-current/20" :style="{ left: pct(strip.from), width: width(strip.from, strip.to) }">
				<span v-for="(mark, i) in strip.marks" :key="i" class="absolute bottom-0 h-3 w-px -translate-x-1/2 bg-current" :style="{ left: `${((mark - strip.from) / (strip.to - strip.from)) * 100}%` }" />
			</div>
			<span v-for="mhz in ticks" :key="mhz" class="absolute bottom-0 h-4 w-0.5 -translate-x-1/2 bg-current" :style="{ left: pct(mhz) }" />
			<span v-if="onAir !== null" class="absolute bottom-7.5 size-1.5 -translate-x-1/2 rounded-full bg-current" :style="{ left: pct(onAir) }" />
			<span
				v-if="needle !== null"
				class="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-(--radio-needle) transition-[left] duration-200 motion-reduce:transition-none"
				:style="{ left: pct(needle) }"
			/>
		</div>
		<span v-if="!stops.length" class="absolute inset-x-0 bottom-1.5 text-center text-[11px] tracking-wider uppercase">No stations yet</span>
	</div>
</template>
