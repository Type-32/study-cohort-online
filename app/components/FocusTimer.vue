<script setup lang="ts">
import type { TimerState } from "#shared/utils/realtime";

const props = defineProps<{ timer: TimerState; clockOffsetMs: number }>();
const emit = defineEmits<{ start: [minutes: number]; stop: [] }>();

const now = useNow({ interval: 1000 });
const remainingMs = computed(() => (props.timer ? props.timer.endsAtServerMs - (now.value.getTime() + props.clockOffsetMs) : 0));
const running = computed(() => remainingMs.value > 0);
const totalMs = computed(() => (props.timer?.minutes ?? 0) * 60_000);

const display = computed(() => {
	if (!running.value) return "0:00";
	const total = Math.ceil(remainingMs.value / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
});
const endsAtLocal = computed(() =>
	props.timer ? new Date(props.timer.endsAtServerMs - props.clockOffsetMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "",
);
const phase = computed(() =>
	running.value
		? { label: "Focus", color: "primary" as const, icon: "i-pixelarticons-zap", hint: `Everyone's heads-down until ${endsAtLocal.value}.` }
		: props.timer
			? { label: "Break", color: "success" as const, icon: "i-pixelarticons-coffee", hint: "Stretch, refill your tea. Start the next focus when you're ready." }
			: { label: "Idle", color: "neutral" as const, icon: "i-pixelarticons-clock", hint: "Start a focus and the whole house counts down together." },
);
</script>

<template>
	<UCard :ui="{ body: 'flex flex-col items-center gap-5 py-10 sm:py-12 text-center' }">
		<UBadge :label="phase.label" :icon="phase.icon" :color="phase.color" variant="subtle" size="lg" />

		<p
			class="font-mono text-7xl font-semibold tabular-nums sm:text-8xl"
			:class="running ? 'text-highlighted' : 'text-dimmed'"
			role="timer"
			aria-live="off"
		>
			{{ display }}
		</p>

		<UProgress
			v-if="running"
			:model-value="totalMs - remainingMs"
			:max="totalMs"
			size="sm"
			class="w-full max-w-sm"
		/>

		<p class="max-w-sm text-muted">{{ phase.hint }}</p>

		<div class="flex flex-wrap justify-center gap-2">
			<template v-if="!running">
				<UButton label="Focus 25 min" icon="i-pixelarticons-play" size="lg" @click="emit('start', 25)" />
				<UButton label="Focus 50 min" icon="i-pixelarticons-play" size="lg" color="neutral" variant="subtle" @click="emit('start', 50)" />
			</template>
			<UButton v-if="timer" :label="running ? 'Stop' : 'Clear'" icon="i-pixelarticons-stop" size="lg" color="neutral" variant="ghost" @click="emit('stop')" />
		</div>
	</UCard>
</template>
