<script setup lang="ts">
import type { TimerState } from "#shared/utils/realtime";

const props = defineProps<{ timer: TimerState; clockOffsetMs: number }>();
const emit = defineEmits<{ start: [minutes: number]; stop: [] }>();

const now = useNow({ interval: 1000 });
const remainingMs = computed(() => (props.timer ? props.timer.endsAtServerMs - (now.value.getTime() + props.clockOffsetMs) : 0));
const running = computed(() => remainingMs.value > 0);
const display = computed(() => {
	const total = Math.ceil(remainingMs.value / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
});
</script>

<template>
	<UPageCard :title="running ? 'Focus' : timer ? 'Break' : 'No timer'">
		<p v-if="running" class="font-mono text-4xl tabular-nums" role="timer">{{ display }}</p>
		<div class="flex gap-2">
			<template v-if="!running">
				<UButton label="Focus 25 min" @click="emit('start', 25)" />
				<UButton label="Focus 50 min" color="neutral" variant="subtle" @click="emit('start', 50)" />
			</template>
			<UButton v-if="timer" label="Stop" color="neutral" variant="ghost" @click="emit('stop')" />
		</div>
	</UPageCard>
</template>
