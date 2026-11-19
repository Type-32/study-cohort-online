<script setup lang="ts">
/// <reference types="youtube" />
import { radioPositionMs } from "#shared/utils/radio";
import type { RadioIntent, RadioState } from "#shared/utils/radio";

/**
 * The YouTube player for the shared radio. Client only. Each client plays locally and steers
 * toward the shared position, seeking only when it drifts past 2 seconds.
 */
const props = defineProps<{ radio: NonNullable<RadioState>; clockOffsetMs: number; volume: number; muted: boolean }>();
const emit = defineEmits<{ title: [title: string]; intent: [intent: RadioIntent] }>();

const el = useTemplateRef<HTMLDivElement>("el");
let player: YT.Player | undefined;
let ready = false;
let loadedId: string | undefined;
/** When this client first asked a stalled player to play; reset once it plays or should not. */
let playRequestedAt: number | undefined;
/** The browser refused to start with sound, so the player runs muted until the user taps. */
const autoMuted = ref(false);
/** Why YouTube refused the current video, if it did. Cleared when the house picks another one. */
const error = ref<string>();

// The player's own play/pause buttons control the radio for everyone, like ours. Clicks inside the
// cross-origin iframe are invisible, but clicking it moves focus there and blurs the window; a state
// change right after that came from the user, not from `sync`. Focus is handed back so the next
// click in the player blurs the window again.
let playerTouchedAt = 0;
useEventListener("blur", () => {
	const active = document.activeElement;
	if (!(active instanceof HTMLIFrameElement) || !el.value?.contains(active)) return;
	playerTouchedAt = Date.now();
	setTimeout(() => active.blur(), 300);
});

const targetSeconds = () => radioPositionMs(props.radio, Date.now() + props.clockOffsetMs) / 1000;

function sync() {
	if (!player || !ready) return;
	const radio = props.radio;
	const paused = radio.pausedAtServerMs !== null;

	if (loadedId !== radio.videoId) {
		loadedId = radio.videoId;
		error.value = undefined;
		const args = { videoId: radio.videoId, startSeconds: targetSeconds() };
		if (paused) player.cueVideoById(args);
		else player.loadVideoById(args);
		return;
	}
	if (error.value) return;

	const { PLAYING, BUFFERING, PAUSED } = YT.PlayerState;
	const state = player.getPlayerState();
	const data = player.getVideoData();
	// `isLive` is undocumented; live streams have no shared position, everyone sits at the live edge.
	const live = "isLive" in data && data.isLive === true;
	const duration = player.getDuration();
	const target = targetSeconds();
	const ended = !live && duration > 0 && target >= duration;

	// seekTo starts playback from cued/unstarted states, so only correct drift on a started video.
	const started = state === PLAYING || state === BUFFERING || state === PAUSED;
	if (started && !live && !ended && Math.abs(player.getCurrentTime() - target) > 2) player.seekTo(target, true);

	if (paused || ended) {
		if (state === PLAYING || state === BUFFERING) player.pauseVideo();
		playRequestedAt = undefined;
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
				if (event.data === yt.PlayerState.PLAYING) {
					playRequestedAt = undefined;
					const title = player?.getVideoData().title;
					if (title) emit("title", title);
				}
				if (Date.now() - playerTouchedAt > 1500) return;
				const sharedPaused = props.radio.pausedAtServerMs !== null;
				if (event.data === yt.PlayerState.PAUSED && !sharedPaused) emit("intent", { action: "pause" });
				if (event.data === yt.PlayerState.PLAYING && sharedPaused) emit("intent", { action: "resume" });
			},
			onError(event) {
				// 101 and 150: the owner disabled embedding. 100: removed or private. 2, 5: bad id or player error.
				error.value = event.data === 101 || event.data === 150
					? "This video's owner doesn't allow it to play outside YouTube. Try another link."
					: event.data === 100
						? "This video is private or was removed. Try another link."
						: "YouTube couldn't play this video. Try another link.";
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
		<!-- YouTube requires the player to stay visible and at least 200x200. -->
		<div class="aspect-video min-h-50 w-full overflow-hidden rounded-lg bg-black">
			<div ref="el" class="size-full" />
		</div>
		<UAlert v-if="error" :title="error" icon="i-pixelarticons-alert" color="error" variant="soft" />
		<UButton
			v-else-if="autoMuted && !muted"
			label="Your browser muted the radio. Tap to listen."
			icon="i-pixelarticons-volume-x"
			color="warning"
			variant="soft"
			block
			@click="unmute"
		/>
	</div>
</template>
