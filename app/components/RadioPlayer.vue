<script setup lang="ts">
/// <reference types="youtube" />
import { radioPositionMs } from "#shared/utils/radio";
import type { RadioPhase, RadioState } from "#shared/utils/radio";

/**
 * The YouTube player for the shared radio. Client only. Each client plays locally and steers
 * toward the shared position, seeking only when it drifts past 2 seconds.
 */
const props = defineProps<{ radio: NonNullable<RadioState>; clockOffsetMs: number; volume: number; muted: boolean }>();
const emit = defineEmits<{ title: [title: string] }>();
/**
 * What the player shows. `tuning` until it first shows the house's real state for the current
 * video: playing, or paused/cued when the house is paused, or past the end, or an error. While
 * tuning the video is covered, so YouTube's paused-looking thumbnail doesn't invite a click on a
 * radio that is about to start by itself.
 */
const phase = defineModel<RadioPhase>("phase", { default: "tuning" });

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
watch(error, (message) => message && (phase.value = "unavailable"));

const targetSeconds = () => radioPositionMs(props.radio, Date.now() + props.clockOffsetMs) / 1000;

function sync() {
	if (!player || !ready) return;
	const radio = props.radio;
	const paused = radio.pausedAtServerMs !== null;

	if (loadedId !== radio.videoId) {
		loadedId = radio.videoId;
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

	// seekTo starts playback from cued/unstarted states, so only correct drift on a started video.
	const started = state === PLAYING || state === BUFFERING || state === PAUSED;
	if (started && !live && !ended && Math.abs(player.getCurrentTime() - target) > 2) player.seekTo(target, true);

	if (paused || ended) {
		if (state === PLAYING || state === BUFFERING) player.pauseVideo();
		playRequestedAt = undefined;
		if (ended) phase.value = "ended";
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
		<!-- YouTube requires the player to stay visible and at least 200x200. It is not clickable:
		     the radio's own buttons below control it for everyone. -->
		<div class="relative aspect-video min-h-50 w-full overflow-hidden rounded-xl bg-black [&_iframe]:pointer-events-none">
			<div ref="el" class="size-full" />
			<AnimatePresence>
				<Motion
					v-if="phase === 'tuning' || phase === 'ended'"
					:key="phase"
					class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-sm text-white/70"
					role="status"
					:initial="{ opacity: phase === 'tuning' ? 1 : 0 }"
					:animate="{ opacity: 1 }"
					:exit="{ opacity: 0 }"
					:transition="{ duration: 0.4 }"
				>
					<template v-if="phase === 'tuning'">
						<UIcon name="i-pixelarticons-loader" class="size-6 animate-spin" />
						Tuning in…
					</template>
					<template v-else>
						<UIcon name="i-pixelarticons-music" class="size-6" />
						That track is over. Paste a link below to put on the next one.
					</template>
				</Motion>
			</AnimatePresence>
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
