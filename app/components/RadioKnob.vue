<script setup lang="ts">
/**
 * A knob over a native range input: the input (visually hidden) gives keyboard and screen-reader
 * support; the knob turns with a vertical drag or the mouse wheel. Emits `turn` on user input only,
 * so the radio can show the value while it changes.
 */
const model = defineModel<number>({ required: true });
const props = withDefaults(defineProps<{ label: string; ariaLabel?: string; min?: number; max?: number; step?: number }>(), {
	min: 0,
	max: 100,
	step: 1,
});
const emit = defineEmits<{ turn: [value: number] }>();

const input = useTemplateRef<HTMLInputElement>("input");
/** -135° at the minimum to +135° at the maximum, like a real knob's sweep. */
const angle = computed(() => -135 + ((model.value - props.min) / (props.max - props.min)) * 270);

function set(value: number) {
	const next = Math.min(props.max, Math.max(props.min, Math.round(value / props.step) * props.step));
	if (next === model.value) return;
	model.value = next;
	emit("turn", next);
}

/** A full sweep is 150 px of vertical drag. */
let drag: { y: number; value: number } | undefined;
function down(event: PointerEvent) {
	input.value?.focus();
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	drag = { y: event.clientY, value: model.value };
}
function move(event: PointerEvent) {
	if (drag) set(drag.value + ((drag.y - event.clientY) * (props.max - props.min)) / 150);
}
function up() {
	drag = undefined;
}
function wheel(event: WheelEvent) {
	set(model.value - Math.sign(event.deltaY) * props.step * 5);
}
</script>

<template>
	<label class="group flex flex-col items-center gap-1 select-none">
		<span
			class="relative grid size-14 cursor-ns-resize touch-none place-items-center rounded-full bg-(--radio-key) shadow-[inset_0_-3px_0_var(--radio-trim)] ring-1 ring-(--radio-trim) group-has-[input:focus-visible]:ring-2 group-has-[input:focus-visible]:ring-primary"
			@pointerdown.prevent="down"
			@pointermove="move"
			@pointerup="up"
			@pointercancel="up"
			@wheel.prevent="wheel"
		>
			<span class="absolute inset-1.5 rounded-full transition-transform duration-75 motion-reduce:transition-none" :style="{ transform: `rotate(${angle}deg)` }">
				<span class="absolute top-0.5 left-1/2 h-3 w-1 -translate-x-1/2 rounded-full bg-inverted" />
			</span>
		</span>
		<input
			ref="input"
			type="range"
			class="sr-only"
			:min="min"
			:max="max"
			:step="step"
			:value="model"
			:aria-label="ariaLabel ?? label"
			@input="set(Number(($event.target as HTMLInputElement).value))"
		/>
		<span class="text-[10px] tracking-widest text-muted uppercase">{{ label }}</span>
	</label>
</template>
