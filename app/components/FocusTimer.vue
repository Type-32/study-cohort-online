<script setup lang="ts">
import type { TimerState } from "#shared/utils/realtime";

const props = defineProps<{ timer: TimerState; clockOffsetMs: number }>();
const emit = defineEmits<{ start: [minutes: number]; stop: [] }>();

// The length you last picked; read after mount so server and client renders agree.
const minutes = useLocalStorage("house:focus-minutes", 25, { initOnMounted: true });

const { running, totalMs, elapsedMs, countdown, phase } = useTimerView(toRef(props, "timer"), toRef(props, "clockOffsetMs"));
const display = computed(() => (running.value ? countdown.value : formatClock((minutes.value ?? 25) * 60)));

function start() {
	if (minutes.value) emit("start", minutes.value);
}
</script>

<template>
	<section id="focus-timer" class="flex scroll-mt-24 flex-col items-center gap-5 text-center" aria-label="Focus timer">
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
				<UTooltip text="Stops the timer for everyone">
					<UButton label="Stop" icon="i-pixelarticons-stop" color="neutral" variant="ghost" @click="emit('stop')" />
				</UTooltip>
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
				<UTooltip text="Everyone in the house counts down together">
					<UButton type="submit" label="Start focus" icon="i-pixelarticons-play" variant="soft" :disabled="!minutes" />
				</UTooltip>
				<UTooltip v-if="timer" text="Ends the break for everyone">
					<UButton label="Clear" color="neutral" variant="ghost" @click="emit('stop')" />
				</UTooltip>
			</Motion>
		</AnimatePresence>
	</section>
</template>
