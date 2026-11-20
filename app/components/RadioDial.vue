<script setup lang="ts">
import { FM_MAX, FM_MIN } from "#shared/utils/radio";

/**
 * The tuner's window: a lit FM scale with a tick per station, a marker under the station on air and
 * a needle. Pointer only and `aria-hidden`: the tuning knob is its keyboard and screen-reader control.
 */
const props = defineProps<{
	/** The stations on the band shown, as frequencies. */
	stations: { station: number; mhz: number }[];
	needle: number | null;
	onAir: number | null;
}>();
const emit = defineEmits<{ tune: [station: number] }>();

const pct = (mhz: number) => `${((mhz - FM_MIN) / (FM_MAX - FM_MIN)) * 100}%`;
const labels = [88, 92, 96, 100, 104, 108];
const minor = Array.from({ length: 21 }, (_, i) => 88 + i);

/** Dragging along the scale snaps the needle to the nearest station. */
const scale = useTemplateRef<HTMLElement>("scale");
let dragging = false;
function tuneAt(event: PointerEvent) {
	const box = scale.value?.getBoundingClientRect();
	if (!box || !props.stations.length) return;
	const mhz = FM_MIN + Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * (FM_MAX - FM_MIN);
	const nearest = props.stations.reduce((best, s) => (Math.abs(s.mhz - mhz) < Math.abs(best.mhz - mhz) ? s : best));
	emit("tune", nearest.station);
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
		:class="stations.length > 0 && 'cursor-ew-resize'"
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
			<span v-for="s in stations" :key="s.station" class="absolute bottom-0 h-4 w-0.5 -translate-x-1/2 bg-current" :style="{ left: pct(s.mhz) }" />
			<span v-if="onAir !== null" class="absolute bottom-5 size-1.5 -translate-x-1/2 rounded-full bg-current" :style="{ left: pct(onAir) }" />
			<span
				v-if="needle !== null"
				class="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-(--radio-needle) transition-[left] duration-200 motion-reduce:transition-none"
				:style="{ left: pct(needle) }"
			/>
		</div>
		<span v-if="!stations.length" class="absolute inset-x-0 bottom-1.5 text-center text-[11px] tracking-wider uppercase">No stations yet</span>
	</div>
</template>
