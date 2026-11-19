<script setup lang="ts">
import type { TimerState } from "#shared/utils/realtime";

const props = defineProps<{ timer: TimerState; clockOffsetMs: number }>();
const emit = defineEmits<{ start: [minutes: number]; stop: [] }>();

// The length you last picked; read after mount so server and client renders agree.
const minutes = useLocalStorage("house:focus-minutes", 25, { initOnMounted: true });

const now = useNow({ interval: 1000 });
const remainingMs = computed(() => (props.timer ? props.timer.endsAtServerMs - (now.value.getTime() + props.clockOffsetMs) : 0));
const running = computed(() => remainingMs.value > 0);
const totalMs = computed(() => (props.timer?.minutes ?? 0) * 60_000);
// Clamped: right after a start, a clock-offset correction can briefly put the remaining time above the total.
const elapsedMs = computed(() => Math.min(totalMs.value, Math.max(0, totalMs.value - remainingMs.value)));

const display = computed(() => {
	const total = running.value ? Math.ceil(remainingMs.value / 1000) : (minutes.value ?? 25) * 60;
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
});
const endsAtLocal = computed(() =>
	props.timer ? new Date(props.timer.endsAtServerMs - props.clockOffsetMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "",
);
const phase = computed(() =>
	running.value
		? { key: "focus", label: "Focus", icon: "i-pixelarticons-zap", class: "text-primary", hint: `Everyone's heads-down until ${endsAtLocal.value}.` }
		: props.timer
			? { key: "break", label: "Break", icon: "i-pixelarticons-coffee", class: "text-success", hint: "Stretch, refill your tea. Start the next focus when you're ready." }
			: { key: "idle", label: "Idle", icon: "i-pixelarticons-clock", class: "text-muted", hint: "Pick a length. The whole house counts down together." },
);

function start() {
	if (minutes.value) emit("start", minutes.value);
}
</script>

<template>
	<section class="flex flex-col items-center gap-5 text-center" aria-label="Focus timer">
		<AnimatePresence mode="wait">
			<Motion
				:key="phase.key"
				as="p"
				class="flex items-center gap-1.5 text-xs tracking-widest uppercase"
				:class="phase.class"
				:initial="{ opacity: 0, y: -6 }"
				:animate="{ opacity: 1, y: 0 }"
				:exit="{ opacity: 0, y: 6 }"
				:transition="{ duration: 0.2 }"
			>
				<UIcon :name="phase.icon" class="size-4" />
				{{ phase.label }}
			</Motion>
		</AnimatePresence>

		<Motion
			as="p"
			class="font-mono text-7xl font-semibold tabular-nums sm:text-8xl"
			:class="running ? 'text-highlighted' : 'text-dimmed'"
			role="timer"
			aria-live="off"
			:animate="{ scale: running ? 1 : 0.94 }"
			:transition="{ type: 'spring', stiffness: 260, damping: 24 }"
		>
			{{ display }}
		</Motion>

		<div class="h-1 w-full max-w-xs">
			<UProgress v-if="running" :model-value="elapsedMs" :max="totalMs" size="2xs" />
		</div>

		<p class="max-w-sm text-sm text-muted">{{ phase.hint }}</p>

		<AnimatePresence mode="wait">
			<Motion
				v-if="running"
				key="running"
				:initial="{ opacity: 0 }"
				:animate="{ opacity: 1 }"
				:exit="{ opacity: 0 }"
				:transition="{ duration: 0.15 }"
			>
				<UButton label="Stop" icon="i-pixelarticons-stop" color="neutral" variant="ghost" @click="emit('stop')" />
			</Motion>
			<Motion
				v-else
				key="idle"
				as="form"
				class="flex flex-wrap items-center justify-center gap-2"
				:initial="{ opacity: 0, y: 4 }"
				:animate="{ opacity: 1, y: 0 }"
				:exit="{ opacity: 0 }"
				:transition="{ duration: 0.15 }"
				@submit.prevent="start"
			>
				<UInputNumber v-model="minutes" :min="1" :max="180" variant="soft" class="w-32" aria-label="Focus length in minutes" />
				<span class="text-sm text-muted">min</span>
				<UButton type="submit" label="Start focus" icon="i-pixelarticons-play" variant="soft" :disabled="!minutes" />
				<UButton v-if="timer" label="Clear" color="neutral" variant="ghost" @click="emit('stop')" />
			</Motion>
		</AnimatePresence>
	</section>
</template>
