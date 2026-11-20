<script setup lang="ts">
import { formatTrackTime } from "#shared/utils/radio";
import type { RadioPhase } from "#shared/utils/radio";
import type { Door } from "#shared/utils/realtime";

/**
 * The radio's display. Decoration for screen readers (`aria-hidden`): the radio's heading and status
 * say the same in words. Upper case comes from CSS, so the props stay in normal case.
 */
const props = defineProps<{
	state: "connecting" | "off" | RadioPhase;
	title?: string | null;
	positionMs: number;
	/** Null for a live stream; undefined while the length is unknown. */
	durationMs: number | null | undefined;
	/** Who picked the track; null for a shuffle pick. */
	by?: string | null;
	/** What plays next: a title, or null when the shelf is empty. */
	next: string | null;
	shuffleWhenEmpty: boolean;
	door: Door;
	/** How the radio sounds through the door ("muffled"); none when it's open. */
	doorSound?: string;
	queueLength: number;
	/** Set while the volume knob turns: the bottom line shows the volume instead. */
	volume?: number;
	/** The on-air station's frequency (`94.3 FM`), once the server has named the station. */
	frequency?: string;
	/** Set while the tuner browses: the station under the needle replaces the radio's own lines. */
	browse?: { frequency: string; title: string | null; plays: number; lastPlayedAtServerMs: number; addedBy: string | null; status?: string };
}>();

type Line = { text: string; scroll?: boolean; blink?: boolean; lit?: boolean };

const time = computed(() =>
	props.durationMs === null ? "LIVE" : `${formatTrackTime(props.positionMs)} / ${props.durationMs ? formatTrackTime(props.durationMs) : "--:--"}`,
);
const nextLine = computed(() => `Next ▸ ${props.next ?? (props.shuffleWhenEmpty ? "Shuffle" : "—")}`);

const lines = computed<Line[]>(() => {
	if (props.browse) {
		const b = props.browse;
		return [
			{ text: `▸ ${b.frequency}`, lit: true },
			{ text: b.title ?? "Untitled track", scroll: true },
			{ text: `Played ${b.plays}× · ${formatTimeAgo(new Date(b.lastPlayedAtServerMs))}` },
			...(b.addedBy ? [{ text: `First played by ${b.addedBy}` }] : []),
			...(b.status ? [{ text: b.status }] : []),
		];
	}
	const title = props.title ?? "Untitled track";
	switch (props.state) {
		case "connecting":
			return [{ text: "Connecting…" }];
		case "off":
			return [{ text: "Off" }, { text: "Insert a link" }];
		case "tuning":
			return [{ text: "Tuning…", blink: true }, { text: title, scroll: true }];
		case "playing":
			return [
				{ text: props.frequency ? `● On air ${props.frequency}` : "● On air", lit: true },
				{ text: title, scroll: true },
				{ text: time.value },
				{ text: props.by ? `Picked by ${props.by}` : "Shuffle" },
				{ text: nextLine.value },
			];
		case "paused":
			return [{ text: "Paused" }, { text: title, scroll: true }, { text: time.value, blink: true }];
		case "ended":
			return [
				{ text: "Track over" },
				{ text: props.next || props.shuffleWhenEmpty ? nextLine.value : "Insert a link" },
			];
		case "unavailable":
			return [{ text: "No signal" }, { text: title, scroll: true }];
	}
});

const bottomLeft = computed(() => {
	if (props.volume !== undefined) {
		const bars = Math.round(props.volume / 10);
		return `Vol ${"▮".repeat(bars)}${"▯".repeat(10 - bars)} ${props.volume}`;
	}
	return props.door === "open" ? "Door open" : `Door ${props.door} · ${props.doorSound}`;
});

// A title that doesn't fit scrolls back and forth; one that fits stays put.
const titleBox = useTemplateRef<HTMLElement[]>("titleBox");
const overflowPx = ref(0);
function measure() {
	const box = titleBox.value?.[0];
	overflowPx.value = box ? Math.max(0, (box.firstElementChild?.scrollWidth ?? 0) - box.clientWidth) : 0;
}
useResizeObserver(() => titleBox.value?.[0], measure);
watch(() => lines.value.find((line) => line.scroll)?.text, () => nextTick(measure));
</script>

<template>
	<div
		class="flex min-h-36 min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-lg bg-(--radio-lcd-bg) px-3 py-2.5 font-mono text-xs leading-5 tracking-wider text-(--radio-lcd-fg) uppercase"
		aria-hidden="true"
	>
		<div class="flex min-w-0 flex-col">
			<template v-for="(line, index) in lines" :key="index">
				<div v-if="line.scroll" ref="titleBox" class="overflow-hidden whitespace-nowrap">
					<span
						class="inline-block"
						:class="overflowPx > 0 && 'lcd-marquee'"
						:style="{ '--lcd-shift': `-${overflowPx}px`, '--lcd-duration': `${4 + overflowPx / 25}s` }"
					>{{ line.text }}</span>
				</div>
				<div v-else class="truncate" :class="[line.blink && 'lcd-blink', line.lit && 'font-bold']">{{ line.text }}</div>
			</template>
		</div>
		<div class="flex justify-between gap-3 border-t border-current/20 pt-1.5 text-[11px]">
			<span class="truncate">{{ bottomLeft }}</span>
			<span class="shrink-0">Q {{ queueLength }}</span>
		</div>
	</div>
</template>

<style scoped>
.lcd-marquee {
	animation: lcd-marquee var(--lcd-duration) ease-in-out infinite alternate;
}
@keyframes lcd-marquee {
	0%,
	15% {
		transform: translateX(0);
	}
	85%,
	100% {
		transform: translateX(var(--lcd-shift));
	}
}
.lcd-blink {
	animation: lcd-blink 1s steps(1) infinite;
}
@keyframes lcd-blink {
	50% {
		opacity: 0.25;
	}
}
@media (prefers-reduced-motion: reduce) {
	.lcd-marquee,
	.lcd-blink {
		animation: none;
	}
	/* Without the scroll, a long title ends in an ellipsis instead of being cut off. */
	.lcd-marquee {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
}
</style>
