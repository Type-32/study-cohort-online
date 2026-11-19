import type { TimerState } from "#shared/utils/realtime";

/** Formats seconds as m:ss. */
export const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The shared focus timer as this client sees it, ticking once a second. */
export function useTimerView(timer: Ref<TimerState>, clockOffsetMs: Ref<number>) {
	const now = useNow({ interval: 1000 });
	const remainingMs = computed(() => (timer.value ? timer.value.endsAtServerMs - (now.value.getTime() + clockOffsetMs.value) : 0));
	const running = computed(() => remainingMs.value > 0);
	const totalMs = computed(() => (timer.value?.minutes ?? 0) * 60_000);
	// Clamped: right after a start, a clock-offset correction can briefly put the remaining time above the total.
	const elapsedMs = computed(() => Math.min(totalMs.value, Math.max(0, totalMs.value - remainingMs.value)));
	const countdown = computed(() => formatClock(Math.ceil(Math.max(0, remainingMs.value) / 1000)));
	const endsAtLocal = computed(() =>
		timer.value ? new Date(timer.value.endsAtServerMs - clockOffsetMs.value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "",
	);
	const phase = computed(() =>
		running.value
			? { key: "focus", label: "Focus", icon: "i-pixelarticons-zap", class: "text-primary", hint: `Everyone's heads-down until ${endsAtLocal.value}.` }
			: timer.value
				? { key: "break", label: "Break", icon: "i-pixelarticons-coffee", class: "text-success", hint: "Stretch, refill your tea. Start the next focus when you're ready." }
				: { key: "idle", label: "Idle", icon: "i-pixelarticons-clock", class: "text-muted", hint: "Pick a length. The whole house counts down together." },
	);
	return { running, totalMs, elapsedMs, countdown, phase };
}
