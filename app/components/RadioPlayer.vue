<script setup lang="ts">
/// <reference types="youtube" />
import { radioPositionMs } from "#shared/utils/radio";
import type { RadioPhase, RadioState } from "#shared/utils/radio";

/**
 * The YouTube player for the shared radio. Client only. Each client plays locally and steers
 * toward the shared position, seeking only when it drifts past 2 seconds. It reports when the track
 * is over or YouTube refuses it (once per track), so the house moves on, and its length (`null`
 * for a live stream).
 */
const props = defineProps<{ radio: NonNullable<RadioState>; clockOffsetMs: number; volume: number; muted: boolean }>();
const emit = defineEmits<{ title: [title: string]; duration: [seconds: number | null]; report: [action: "ended" | "unplayable"] }>();
/**
 * What the player shows. `tuning` until it first shows the house's real state for the current
 * video: playing, or paused/cued when the house is paused, or past the end, or an error. While
 * tuning the video is covered, so YouTube's paused-looking thumbnail doesn't invite a click on a
 * radio that is about to start by itself.
 */
const phase = defineModel<RadioPhase>("phase", { default: "tuning" });
/** The screen is covered while tuning, after the track ends, and when YouTube refuses it. */
const covered = computed(() => phase.value === "tuning" || phase.value === "ended" || phase.value === "unavailable");

const el = useTemplateRef<HTMLDivElement>("el");
let player: YT.Player | undefined;
let ready = false;
let loadedId: string | undefined;
/** When this client first asked a stalled player to play; reset once it plays or should not. */
let playRequestedAt: number | undefined;
/** The track this player last reported, so each player reports a track once. */
let reported: string | undefined;
let lastDuration: number | null | undefined;

function reportOnce(action: "ended" | "unplayable") {
	const track = `${props.radio.videoId}@${props.radio.startedAtServerMs}`;
	if (reported === track) return;
	reported = track;
	emit("report", action);
}
/** The browser refused to start with sound, so the player runs muted until the user taps. */
const autoMuted = ref(false);
/** Why YouTube refused the current video, if it did. Cleared when the house picks another one. */
const error = ref<string>();
watch(error, (message) => message && (phase.value = "unavailable"));

const targetSeconds = () => radioPositionMs(props.radio, Date.now() + props.clockOffsetMs) / 1000;

function sync() {
	if (!player || !ready) return;
	const radio = props.radio;
	const paused = radio.pausedAtServerMs !== null;

	if (loadedId !== radio.videoId) {
		loadedId = radio.videoId;
		lastDuration = undefined;
		error.value = undefined;
		phase.value = "tuning";
		const args = { videoId: radio.videoId, startSeconds: targetSeconds() };
		if (paused) player.cueVideoById(args);
		else player.loadVideoById(args);
		return;
	}
	if (error.value) return;

	const { PLAYING, BUFFERING, PAUSED, ENDED } = YT.PlayerState;
	const state = player.getPlayerState();
	const data = player.getVideoData();
	// `isLive` is undocumented; live streams have no shared position, everyone sits at the live edge.
	const live = "isLive" in data && data.isLive === true;
	const duration = player.getDuration();
	const target = targetSeconds();
	// A player that just finished may be a moment ahead of the house; don't replay the last seconds.
	const ended = !live && duration > 0 && target >= duration - (state === ENDED ? 3 : 0);
	const length = live ? null : duration > 0 ? duration : undefined;
	if (length !== undefined && length !== lastDuration) emit("duration", (lastDuration = length));

	// seekTo starts playback from cued/unstarted states, so only correct drift on a started video.
	const started = state === PLAYING || state === BUFFERING || state === PAUSED;
	if (started && !live && !ended && Math.abs(player.getCurrentTime() - target) > 2) player.seekTo(target, true);

	if (paused || ended) {
		if (state === PLAYING || state === BUFFERING) player.pauseVideo();
		playRequestedAt = undefined;
		if (ended) {
			phase.value = "ended";
			if (!paused) reportOnce("ended");
		}
		return;
	}
	if (state === PLAYING || state === BUFFERING) {
		playRequestedAt = undefined;
		return;
	}
	player.playVideo();
	playRequestedAt ??= Date.now();
	// Without any click on the page yet, browsers refuse to start with sound and the player just sits there.
	// After 3s of that, play muted to stay in sync and offer a tap to unmute. With a click on record
	// (sticky activation), sound is allowed, so keep asking instead of muting.
	const blocked = !navigator.userActivation?.hasBeenActive && Date.now() - playRequestedAt > 3000;
	if (blocked && !player.isMuted()) {
		player.mute();
		autoMuted.value = true;
		player.playVideo();
	}
}

function applySound() {
	if (!player || !ready) return;
	player.setVolume(props.volume);
	if (props.muted || autoMuted.value) player.mute();
	else player.unMute();
}

function unmute() {
	autoMuted.value = false;
	applySound();
	player?.playVideo();
}

onMounted(async () => {
	const yt = await loadYouTubeApi();
	if (!el.value) return;
	// YouTube replaces the element it is given with an iframe; hand it a child Vue doesn't track,
	// or Vue later patches a node that no longer exists.
	const target = el.value.appendChild(document.createElement("div"));
	player = new yt.Player(target, {
		host: "https://www.youtube-nocookie.com",
		width: "100%",
		height: "100%",
		playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3 },
		events: {
			onReady() {
				ready = true;
				applySound();
				sync();
			},
			onStateChange(event) {
				const { PLAYING, PAUSED, CUED, ENDED } = yt.PlayerState;
				const housePaused = props.radio.pausedAtServerMs !== null;
				if (event.data === PLAYING) phase.value = "playing";
				else if (housePaused && (event.data === PAUSED || event.data === CUED)) phase.value = "paused";
				else if (event.data === ENDED) phase.value = "ended";
				if (event.data === PLAYING) {
					playRequestedAt = undefined;
					// Right away rather than on the next tick: a track that's already over (or far off the
					// house's position) shouldn't play out loud for up to 2 seconds first.
					sync();
				}
				const title = player?.getVideoData().title;
				if (title) emit("title", title);
			},
			onError(event) {
				// 101 and 150: the owner disabled embedding. 100: removed or private. 2, 5: bad id or player error.
				error.value = event.data === 101 || event.data === 150
					? "No signal here: this video's owner doesn't allow it outside YouTube."
					: event.data === 100
						? "No signal: this video is private or was removed."
						: "No signal: YouTube couldn't play this video here.";
				// The server moves on only once every member present reports a refusal: some refusals
				// depend on the viewer (region, the page's address), so others may still be listening.
				// 2 and 5 may be this browser only and aren't reported.
				if (event.data === 100 || event.data === 101 || event.data === 150) reportOnce("unplayable");
			},
		},
	});
});

watch(() => props.radio, sync, { deep: true });
watch(() => [props.volume, props.muted], applySound);
useIntervalFn(sync, 2000);
onBeforeUnmount(() => player?.destroy());
</script>

<template>
	<div class="flex flex-col gap-2">
		<!-- YouTube requires the player to stay visible and at least 200x200. It is not clickable:
		     the radio's own buttons below control it for everyone. -->
		<div class="relative aspect-video min-h-50 w-full overflow-hidden rounded-xl bg-black [&_iframe]:pointer-events-none">
			<div ref="el" class="size-full" />
			<!-- Always rendered and faded with CSS: AnimatePresence left a faded-out "Tuning in…" in the
			     page (and in the screen reader's live region) when the phase changed quickly. It also
			     covers YouTube's own "Video unavailable" page with the reason, in the radio's words. -->
			<div
				class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-sm text-balance text-white/70 transition-opacity duration-400"
				:class="covered ? 'opacity-100' : 'pointer-events-none opacity-0'"
				:role="covered ? 'status' : undefined"
				:aria-hidden="!covered"
			>
				<template v-if="phase === 'unavailable'">
					<UIcon name="i-pixelarticons-alert" class="size-6 text-error" />
					{{ error }}
				</template>
				<template v-else-if="phase === 'ended'">
					<UIcon name="i-pixelarticons-music" class="size-6" />
					That track is over. Paste a link below for the next one.
				</template>
				<template v-else-if="phase === 'tuning'">
					<UIcon name="i-pixelarticons-loader" class="size-6 animate-spin" />
					Tuning in…
				</template>
			</div>
		</div>
		<UButton
			v-if="autoMuted && !muted && !error"
			label="Your browser muted the radio. Tap to listen."
			icon="i-pixelarticons-volume-x"
			color="warning"
			variant="soft"
			block
			class="min-h-11"
			@click="unmute"
		/>
	</div>
</template>
