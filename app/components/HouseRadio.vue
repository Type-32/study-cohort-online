<script setup lang="ts">
import { SUGGESTION_LIMIT, bandStrip, doorSound, formatFrequency, nextUp, parseYouTubeLink, radioPositionMs, stationFrequency } from "#shared/utils/radio";
import type { RadioPhase, Station, WhenEmpty } from "#shared/utils/radio";
import type { Intent } from "#shared/utils/realtime";
import { satisfies } from "#shared/utils/roles";
import { useAuthSession } from "~/composables/core/useAuthSession";

const emit = defineEmits<{ settled: [] }>();

const store = useHouseStore();
const { house, clockOffsetMs, loaded, myDoor: door } = storeToRefs(store);
const radio = computed(() => house.value.radio);
const { mutate: sendIntent } = useHouseIntent();
// Its own mutation, so only the link box's button spins while a link is on its way.
const { mutate: sendLink, isLoading: sending } = useHouseIntent();

// The host and moderators put tracks on air, skip and turn the radio off; members suggest.
const { user } = useAuthSession();
const isHost = computed(() => !!user.value && satisfies(user.value, { minRole: "moderator" }));
const suggestionsLeft = computed(() => SUGGESTION_LIMIT - house.value.suggestions.filter((s) => s.userId === user.value?.id).length);

const link = ref("");
/** What the pasted link points at: a track, or a playlist (a band). */
const linked = computed(() => parseYouTubeLink(link.value));
/** The title the player reports; the server's (from YouTube) shows until then. */
const title = ref<string>();
/** The track's length from the player, in seconds; null for a live stream. */
const durationS = ref<number | null>();

// Sound settings are per listener; read after mount so server and client renders agree.
const volume = useLocalStorage("house:radio-volume", 60, { initOnMounted: true });
const muted = useLocalStorage("house:radio-muted", false, { initOnMounted: true });

// Your door sets how much of the commons you hear, as you chose in the door's sound settings:
// quieter, muffled (quieter with a rumble laid over it), or silent. The player keeps playing in sync
// either way, so opening the door is instant.
const doorSettings = useDoorSoundSettings();
const sound = computed(() => doorSound(door.value, doorSettings.value, volume.value));
const doorVolume = computed(() => sound.value.volume);
const doorMuted = computed(() => muted.value || sound.value.muted);
const doorHint = computed(() => {
	if (door.value === "open") return;
	const how = { quieter: door.value === "ajar" ? "the radio is faint" : "the radio is very faint", muffled: "the radio sounds muffled", silent: "you can't hear the radio" };
	return `Your door is ${door.value}, so ${how[doorSettings.value[door.value]] ?? how.silent}.`;
});

/** The door-sound switch offers the choices for the door you have now. */
const doorSoundChoices = computed(() =>
	door.value === "ajar"
		? [
				{ value: "quieter", label: "Quieter", tip: "The music at a quarter of your volume" },
				{ value: "muffled", label: "Muffled", tip: "Quieter still, with a low rumble over it, as if through a wall. YouTube's sound can't be filtered, so the rumble stands in." },
			]
		: door.value === "closed"
			? [
					{ value: "silent", label: "Silent", tip: "Nothing from the living room" },
					{ value: "quieter", label: "Quieter", tip: "The music, very faint" },
					{ value: "muffled", label: "Muffled", tip: "Very faint, with a low rumble over it" },
				]
			: [],
);
function setDoorSound(value: string) {
	if (door.value === "ajar" && (value === "quieter" || value === "muffled")) doorSettings.value = { ...doorSettings.value, ajar: value };
	if (door.value === "closed" && (value === "silent" || value === "quieter" || value === "muffled")) doorSettings.value = { ...doorSettings.value, closed: value };
}
const doorSoundNow = computed(() => (door.value === "open" ? undefined : doorSettings.value[door.value]));

const whenEmptyChoices: { mode: WhenEmpty; label: string; tip: string }[] = [
	{ mode: "shuffle", label: "Shuffle", tip: "When the shelf runs out, play a random station the house has played before" },
	{ mode: "stop", label: "Stop", tip: "When the shelf runs out, play nothing until someone suggests a track" },
];

/** While the knob turns, the LCD's bottom line shows the volume. */
const volumeShown = ref<number>();
const { start: hideVolume } = useTimeoutFn(() => (volumeShown.value = undefined), 1500, { immediate: false });
function turned(value: number) {
	volumeShown.value = value;
	hideVolume();
}

const paused = computed(() => radio.value?.pausedAtServerMs != null);

watch(() => radio.value?.videoId, () => {
	title.value = undefined;
	durationS.value = undefined;
	phase.value = "tuning";
});

/** What the player shows. `tuning` until it shows the house's real state; shared controls wait for it. */
const phase = ref<RadioPhase>("tuning");
const tuning = computed(() => !!radio.value && phase.value === "tuning");
watch(tuning, (now) => !now && emit("settled"));
const status = computed(() => {
	if (!loaded.value) return "Connecting";
	if (!radio.value) return "Off";
	return { tuning: "Tuning in", playing: "On air", paused: "Paused", ended: "Track over", unavailable: "Can't play" }[phase.value];
});
const heading = computed(() => {
	if (!loaded.value) return "…";
	if (!radio.value) return "Nothing on";
	const known = title.value ?? radio.value.title;
	if (known) return known;
	return phase.value === "tuning" ? "Tuning in…" : phase.value === "unavailable" ? "Can't play this one" : "Untitled track";
});
const byline = computed(() => (radio.value ? (radio.value.by ? `Picked by ${radio.value.by}` : "A shuffle pick") : undefined));
const lcdState = computed(() => (!loaded.value ? "connecting" : !radio.value ? "off" : phase.value));
const nextTitle = computed(() => {
	// In a band, its next track comes before the shelf.
	const band = radio.value?.band;
	if (band && band.index + 1 < band.length) {
		const track = stationList.value?.find((s) => s.id === band.id)?.tracks?.[band.index + 1];
		return track?.title ?? `Track ${band.index + 2}/${band.length}`;
	}
	const next = nextUp(house.value.suggestions);
	return next ? (next.title ?? (next.band ? "A band" : "Untitled track")) : null;
});
const onAir = computed(() => !!radio.value && phase.value === "playing");
// The rumble plays only while the music does, and follows your mute.
useDoorBed(() => (onAir.value && !muted.value ? sound.value.bed : 0));

const now = useNow({ interval: 1000 });
const positionMs = computed(() => (radio.value ? radioPositionMs(radio.value, now.value.getTime() + clockOffsetMs.value) : 0));

/**
 * A track or band going on air now (host), to the back of the queue (host), or as a suggestion
 * (member). A band plays from track `track` when put on air now; on the shelf it starts at its first.
 */
function addIntent(how: "play" | "queue" | "suggest", target: { kind: "track" | "band"; id: string; track?: number | null }): Intent {
	if (how === "play") return target.kind === "band" ? { t: "radio", action: "playBand", playlistId: target.id, index: target.track ?? 0 } : { t: "radio", action: "play", videoId: target.id };
	const item = target.kind === "band" ? { playlistId: target.id } : { videoId: target.id };
	return { t: "suggest", suggestionId: newId(), ...item, queue: how === "queue" };
}

function submitLink(how: "play" | "queue" | "suggest") {
	if (!linked.value) return;
	sendLink(addIntent(how, linked.value));
	link.value = "";
}

// The tuner (step 10): every track and band the house has played is a station. Browsing is yours
// alone: it sends nothing, and the needle goes back to the station on air after 10 s or on Escape.
// Fetched once the socket is up (the request needs the browser's session), and again whenever
// something new goes on air, so a new station and play counts show without a reload.
// ponytail: the whole list per change; send only the changed station if the catalog gets big.
const { data: stationList, refetch: refetchStations } = useQuery({
	key: ["radio-stations"],
	query: () => $fetch<Station[]>("/api/v1/radio/stations"),
	enabled: loaded,
});
watch(
	() => (radio.value?.station != null ? `${radio.value.station}:${radio.value.band?.id ?? radio.value.videoId}` : undefined),
	(key) => key && stationList.value && refetchStations(),
);

/**
 * Where the needle can rest, in dial order: a track station, or one of a band's tracks (`track`).
 * A band's tracks follow each other, so the knob crosses a band as a block.
 */
type Stop = { station: Station; fm: number; mhz: number; track: number | null };
const stops = computed<Stop[]>(() =>
	(stationList.value ?? [])
		.map((station) => ({ station, ...stationFrequency(station.station) }))
		.sort((a, b) => a.fm - b.fm || a.mhz - b.mhz)
		.flatMap(({ station, fm, mhz }) =>
			station.kind === "band" && station.tracks?.length
				? bandStrip(station.station, station.tracks.length).marks.map((mark, track) => ({ station, fm, mhz: mark, track }))
				: [{ station, fm, mhz, track: null }],
		),
);
const stopIndex = (target: { station: number; track: number | null } | null) => {
	if (!target) return -1;
	const exact = stops.value.findIndex((s) => s.station.station === target.station && s.track === target.track);
	return exact >= 0 ? exact : stops.value.findIndex((s) => s.station.station === target.station);
};
/** Each station once, in dial order, for the station list. */
const dialStations = computed(() => [...new Map(stops.value.map((s) => [s.station.id, s.station])).values()]);
const browsing = ref<{ station: number; track: number | null } | null>(null);
const onAirStop = computed(() => stops.value[stopIndex(radio.value?.station != null ? { station: radio.value.station, track: radio.value.band?.index ?? null } : null)]);
const needleStop = computed(() => (browsing.value ? stops.value[stopIndex(browsing.value)] : onAirStop.value));
/** The FM scale the needle is on; the dial shows one at a time. */
const scaleStops = computed(() => stops.value.filter((s) => s.fm === (needleStop.value?.fm ?? 1)));
const dialTicks = computed(() => scaleStops.value.filter((s) => s.track === null).map((s) => s.mhz));
const dialStrips = computed(() =>
	scaleStops.value.filter((s) => s.track === 0).map((s) => ({ key: s.station.id, ...bandStrip(s.station.station, s.station.tracks!.length) })),
);
const onScale = (stop: Stop | undefined) => (stop && stop.fm === (needleStop.value?.fm ?? 1) ? stop.mhz : null);
const browsed = computed(() => (browsing.value ? needleStop.value : undefined));
const { start: holdNeedle } = useTimeoutFn(() => (browsing.value = null), 10_000, { immediate: false });
function tuneTo(stop: Stop | undefined) {
	if (!stop) return;
	browsing.value = { station: stop.station.station, track: stop.track };
	holdNeedle();
}
onKeyStroke("Escape", () => (browsing.value = null));
/** The tuning knob steps from stop to stop: its value is the needle's place in dial order. */
const tunerIndex = computed({
	get: () => Math.max(0, needleStop.value ? stops.value.indexOf(needleStop.value) : 0),
	set: (index) => tuneTo(stops.value[index]),
});
const trackTitle = (stop: Stop) => (stop.track === null ? stop.station.title : stop.station.tracks?.[stop.track]?.title) ?? "Untitled track";
const tunerText = computed(() => {
	const s = stops.value[tunerIndex.value];
	if (!s) return "No stations yet";
	const where = s.track === null ? "" : `, band ${s.station.title ?? "untitled"}, track ${s.track + 1} of ${s.station.tracks!.length}`;
	return `${formatFrequency(s.station.station)}${where}, ${trackTitle(s)}${s === onAirStop.value && phase.value !== "ended" ? ", on air" : ""}`;
});

/** The track or band on air, unless it's over (then the house moves on as soon as something is added). */
const onAirId = computed(() => (radio.value && phase.value !== "ended" ? (radio.value.band?.id ?? radio.value.videoId) : undefined));
const onShelf = (station: Station) => house.value.suggestions.some((s) => (station.kind === "band" ? s.band?.id : s.videoId) === station.id);
/** Why the station under the needle can't go on air now (`play`) or on the shelf, if it can't. */
function addBlocked(how: "play" | "queue" | "suggest") {
	const stop = browsed.value;
	if (!stop) return "Turn the tuning knob to a station first";
	const onAirNow = stop.station.id === onAirId.value;
	// Another track of the band on air can be played now: the band jumps there.
	if (onAirNow && (how !== "play" || stop === onAirStop.value)) return stop.track === null ? "That one is on air right now" : "That band is on air right now";
	if (onShelf(stop.station)) return "That one is already on the shelf";
	if (!isHost.value && suggestionsLeft.value <= 0) return `You have ${SUGGESTION_LIMIT} suggestions waiting`;
}
function addBrowsed(how: "play" | "queue" | "suggest") {
	const stop = browsed.value;
	if (!stop || addBlocked(how)) return;
	sendIntent(addIntent(how, { kind: stop.station.kind, id: stop.station.id, track: stop.track }));
	// Played now, the needle is on air; added to the shelf, it stays to show that.
	if (how === "play") browsing.value = null;
	else holdNeedle();
}
const lcdBrowse = computed(() => {
	const stop = browsed.value;
	if (!stop) return undefined;
	const s = stop.station;
	// The status line also says why the add key is disabled: a disabled key shows no tooltip.
	const status = stop === onAirStop.value && phase.value !== "ended"
		? "On air now"
		: s.id === onAirId.value
			? `Band on air · track ${radio.value!.band!.index + 1}`
			: onShelf(s)
				? "On the shelf"
				: !isHost.value && suggestionsLeft.value <= 0
					? `${SUGGESTION_LIMIT} of ${SUGGESTION_LIMIT} suggestions waiting`
					: s.unplayable ? "No signal last time" : undefined;
	return {
		frequency: `${formatFrequency(s.station)}${stop.track === null ? "" : " · Band"}`,
		title: s.title,
		track: stop.track === null ? undefined : `Track ${stop.track + 1}/${s.tracks!.length} · ${trackTitle(stop)}`,
		plays: s.plays,
		lastPlayedAtServerMs: s.lastPlayedAtServerMs,
		addedBy: s.addedBy,
		status,
	};
});

/** This player saw the track end, or YouTube refused it: tell the house, so it moves on. */
function reportTrack(action: "ended" | "unplayable") {
	if (radio.value) store.report({ t: "radio", action, videoId: radio.value.videoId, startedAtServerMs: radio.value.startedAtServerMs });
}

/** Opens the track on YouTube at the house's current position. */
function openOnYouTube() {
	if (!radio.value) return;
	const seconds = Math.floor(radioPositionMs(radio.value, Date.now() + clockOffsetMs.value) / 1000);
	window.open(`https://www.youtube.com/watch?v=${radio.value.videoId}&t=${seconds}s`, "_blank", "noopener");
}

/** A key on the cabinet: at least 44 px, pressed in with a spring (`whilePress`). */
const keyClass = "min-h-11 min-w-11 justify-center rounded-lg bg-(--radio-key) shadow-[inset_0_-2px_0_var(--radio-trim)] ring-1 ring-(--radio-trim)";
const keyPress = { scale: 0.94, y: 1 };
</script>

<template>
	<section id="house-radio" class="radio flex scroll-mt-24 flex-col gap-4" aria-labelledby="radio-title">
		<!-- The LCD says this visually; screen readers get it in words. -->
		<h2 id="radio-title" class="sr-only">Radio: {{ heading }}</h2>
		<p class="sr-only">{{ [`${status}.`, byline && `${byline}.`, doorHint].filter(Boolean).join(" ") }}</p>

		<div class="flex flex-col gap-3 rounded-(--radio-radius) bg-(--radio-body) p-3 ring-1 ring-(--radio-trim) sm:p-4">
			<!-- The tuner's window and its keys. On phones the keys go under the dial. -->
			<div class="flex flex-wrap items-center justify-end gap-2">
				<RadioDial
					class="w-full sm:w-auto sm:min-w-0 sm:flex-1"
					:stops="scaleStops.map((s) => s.mhz)"
					:ticks="dialTicks"
					:strips="dialStrips"
					:needle="onScale(needleStop)"
					:on-air="onScale(onAirStop)"
					@tune="(i) => tuneTo(scaleStops[i])"
				/>
				<template v-if="isHost">
					<UTooltip :text="addBlocked('play') ?? (browsed?.track != null ? `Play this band now from track ${browsed.track + 1}, for everyone` : 'Play this station now, for everyone')">
						<Motion as-child :while-press="keyPress">
							<UButton icon="i-pixelarticons-play" aria-label="Play the station under the needle now" color="neutral" variant="ghost" :class="keyClass" :disabled="!!addBlocked('play')" @click="addBrowsed('play')" />
						</Motion>
					</UTooltip>
					<UTooltip :text="addBlocked('queue') ?? (browsed?.track != null ? 'Add this band to the end of the queue (from its first track)' : 'Add this station to the end of the queue')">
						<Motion as-child :while-press="keyPress">
							<UButton icon="i-pixelarticons-playlist" aria-label="Queue the station under the needle" color="neutral" variant="ghost" :class="keyClass" :disabled="!!addBlocked('queue')" @click="addBrowsed('queue')" />
						</Motion>
					</UTooltip>
				</template>
				<UTooltip v-else :text="addBlocked('suggest') ?? `Suggest this ${browsed?.track != null ? 'band' : 'station'} (${suggestionsLeft} of ${SUGGESTION_LIMIT} left)`">
					<Motion as-child :while-press="keyPress">
						<UButton icon="i-pixelarticons-plus" aria-label="Suggest the station under the needle" color="neutral" variant="ghost" :class="keyClass" :disabled="!!addBlocked('suggest')" @click="addBrowsed('suggest')" />
					</Motion>
				</UTooltip>
				<RadioStationList
					:stations="dialStations"
					:on-air-id="onAirId"
					:can-remove="isHost"
					:key-class="keyClass"
					@choose="(n) => tuneTo(stops.find((s) => s.station.station === n && (s.track ?? 0) === 0))"
				/>
			</div>

			<!-- minmax(0, …): without it a column is at least as wide as its widest content: the LCD's
			     title on wide screens, and on phones the player (200 px tall at 16:9 is 356 px wide),
			     which then sticks out of the cabinet. -->
			<div class="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<!-- The screen: the YouTube player, or a dark panel while the radio is off. Swapped with a
				     fade-in only: with AnimatePresence mode="wait", the server-rendered panel's exit never
				     finished after a reload, so the player never mounted and the radio sat at "Tuning". -->
				<Motion v-if="radio" key="player" :initial="{ opacity: 0 }" :animate="{ opacity: 1 }" :transition="{ duration: 0.3 }">
					<ClientOnly>
						<RadioPlayer
							:radio="radio"
							:clock-offset-ms="clockOffsetMs"
							:volume="doorVolume"
							:muted="doorMuted"
							v-model:phase="phase"
							@title="title = $event"
							@duration="durationS = $event"
							@report="reportTrack"
						/>
						<template #fallback>
							<USkeleton class="aspect-video w-full rounded-xl" />
						</template>
					</ClientOnly>
				</Motion>
				<div v-else class="grid aspect-video min-h-50 w-full place-items-center rounded-xl bg-black p-6 text-center text-sm text-white/50">
					{{ loaded ? "The radio is off. Insert a link below." : "Connecting…" }}
				</div>

				<div class="flex min-w-0 flex-col gap-3">
					<RadioLcd
						class="flex-1"
						:state="lcdState"
						:title="title ?? radio?.title"
						:position-ms="positionMs"
						:duration-ms="durationS === null ? null : durationS === undefined ? undefined : durationS * 1000"
						:by="radio?.by"
						:next="nextTitle"
						:shuffle-when-empty="house.radioWhenEmpty === 'shuffle'"
						:door="door"
						:door-sound="doorSoundNow"
						:queue-length="house.suggestions.length"
						:volume="volumeShown"
						:frequency="radio?.station != null ? formatFrequency(radio.station) : undefined"
						:band="radio?.band ?? undefined"
						:browse="lcdBrowse"
					/>
					<div class="flex items-end justify-between gap-3">
						<UTooltip text="Your volume (just you). Drag up or down, scroll, or use the arrow keys.">
							<RadioKnob v-model="volume" label="Volume" aria-label="Volume, just you" @turn="turned" />
						</UTooltip>
						<UTooltip text="Tuning: browse the stations (just you). Drag, scroll, or use the arrow keys; Escape goes back to the station on air.">
							<RadioKnob
								v-model="tunerIndex"
								label="Tuning"
								aria-label="Tuning, browse the stations"
								:value-text="tunerText"
								:max="Math.max(0, stops.length - 1)"
								:wheel-step="1"
								:disabled="stops.length < 2"
							/>
						</UTooltip>
						<!-- The grille moves while the radio is on air. It's decoration: the audio can't be read. -->
						<!-- min-w-0, no gap, shrinkable bars: with two knobs the grille gets whatever room is left
						     instead of pushing past the cabinet's edge. -->
						<div class="grille flex h-14 min-w-0 flex-1 items-center justify-evenly overflow-hidden" :class="onAir && 'grille-on'" aria-hidden="true">
							<span v-for="n in 12" :key="n" class="h-full w-1.5 min-w-0.5 rounded-full bg-(--radio-grille)" :style="{ animationDelay: `${(n * 137) % 900}ms` }" />
						</div>
					</div>
				</div>
			</div>

			<RadioProgress
				v-if="radio && phase !== 'unavailable'"
				:position-ms="positionMs"
				:duration-ms="durationS === null ? null : durationS === undefined ? undefined : durationS * 1000"
				:can-seek="isHost && !tuning"
				@seek="(ms) => sendIntent({ t: 'radio', action: 'seek', positionMs: ms })"
			/>

			<div class="flex flex-wrap items-center gap-2">
				<template v-if="radio">
					<UTooltip v-if="phase !== 'ended'" :text="paused ? 'Resume for everyone' : 'Pause for everyone'">
						<Motion as-child :while-press="keyPress">
							<UButton
								:icon="paused ? 'i-pixelarticons-play' : 'i-pixelarticons-pause'"
								:aria-label="paused ? 'Resume' : 'Pause'"
								color="neutral"
								variant="ghost"
								:class="keyClass"
								:disabled="tuning"
								@click="sendIntent({ t: 'radio', action: paused ? 'resume' : 'pause' })"
							/>
						</Motion>
					</UTooltip>
					<template v-if="isHost">
						<UTooltip :text="radio.band && radio.band.index + 1 < radio.band.length ? 'Skip to the band\'s next track, for everyone' : 'Skip to what\'s next, for everyone'">
							<Motion as-child :while-press="keyPress">
								<UButton icon="i-pixelarticons-next" aria-label="Skip" color="neutral" variant="ghost" :class="keyClass" :disabled="tuning" @click="sendIntent({ t: 'radio', action: 'skip' })" />
							</Motion>
						</UTooltip>
						<UTooltip v-if="radio.band" text="Leave the band: skip its remaining tracks, for everyone">
							<Motion as-child :while-press="keyPress">
								<UButton icon="i-pixelarticons-logout" aria-label="Leave the band" color="neutral" variant="ghost" :class="keyClass" :disabled="tuning" @click="sendIntent({ t: 'radio', action: 'leaveBand' })" />
							</Motion>
						</UTooltip>
						<UTooltip text="Turn off for everyone">
							<Motion as-child :while-press="keyPress">
								<UButton icon="i-pixelarticons-stop" aria-label="Turn off" color="neutral" variant="ghost" :class="keyClass" :disabled="tuning" @click="sendIntent({ t: 'radio', action: 'stop' })" />
							</Motion>
						</UTooltip>
					</template>
				</template>
				<UTooltip :text="muted ? 'Unmute (just you)' : 'Mute (just you)'">
					<Motion as-child :while-press="keyPress">
						<UButton
							:icon="muted || volume === 0 ? 'i-pixelarticons-volume-x' : 'i-pixelarticons-volume-2'"
							:aria-label="muted ? 'Unmute' : 'Mute'"
							:aria-pressed="muted"
							color="neutral"
							variant="ghost"
							:class="keyClass"
							@click="muted = !muted"
						/>
					</Motion>
				</UTooltip>
				<UTooltip v-if="radio" text="Open on YouTube at this moment">
					<Motion as-child :while-press="keyPress">
						<UButton icon="i-pixelarticons-external-link" aria-label="Open on YouTube" color="neutral" variant="ghost" :class="keyClass" :disabled="tuning" @click="openOnYouTube" />
					</Motion>
				</UTooltip>

				<!-- What plays when the shelf runs out: the host moves it, members see where it stands. -->
				<div class="ml-auto flex items-center gap-2">
					<span class="text-[10px] tracking-widest text-muted uppercase">When empty</span>
					<UFieldGroup size="xs">
						<UTooltip v-for="choice in whenEmptyChoices" :key="choice.mode" :text="isHost ? choice.tip : `${choice.tip}. The host chooses.`">
							<UButton
								:label="choice.label"
								:color="house.radioWhenEmpty === choice.mode ? 'primary' : 'neutral'"
								:variant="house.radioWhenEmpty === choice.mode ? 'soft' : 'ghost'"
								:aria-pressed="house.radioWhenEmpty === choice.mode"
								:disabled="!isHost"
								class="min-h-11 min-w-11 justify-center font-mono uppercase"
								@click="house.radioWhenEmpty !== choice.mode && sendIntent({ t: 'radioWhenEmpty', mode: choice.mode })"
							/>
						</UTooltip>
					</UFieldGroup>
				</div>
			</div>

			<!-- How the radio sounds through your door, for the door you have now (step 7's setting). -->
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-[10px] tracking-widest text-muted uppercase">Door sound</span>
				<UFieldGroup v-if="doorSoundChoices.length" size="xs">
					<UTooltip v-for="choice in doorSoundChoices" :key="choice.value" :text="`${choice.tip} (just you)`">
						<UButton
							:label="choice.label"
							:color="doorSoundNow === choice.value ? 'primary' : 'neutral'"
							:variant="doorSoundNow === choice.value ? 'soft' : 'ghost'"
							:aria-pressed="doorSoundNow === choice.value"
							class="min-h-11 min-w-11 justify-center font-mono uppercase"
							@click="setDoorSound(choice.value)"
						/>
					</UTooltip>
				</UFieldGroup>
				<span v-else class="text-xs text-muted">Your door is open: you hear the radio at your volume.</span>
			</div>

			<!-- The tape slot: members suggest; the host plays now or queues. A playlist link is a band. -->
			<form @submit.prevent="submitLink(isHost ? 'play' : 'suggest')">
				<UInput
					v-model="link"
					:placeholder="isHost ? 'Insert a YouTube link or playlist to play or queue it' : 'Insert a YouTube link or playlist to suggest it'"
					:icon="linked?.kind === 'band' ? 'i-pixelarticons-playlist' : 'i-pixelarticons-music'"
					variant="soft"
					size="lg"
					class="w-full"
					aria-label="YouTube link or playlist"
					aria-describedby="radio-link-hint"
					:color="link && !linked ? 'error' : 'primary'"
					:highlight="!!link && !linked"
					:disabled="!isHost && suggestionsLeft <= 0"
					:ui="{ base: 'font-mono', trailing: 'pe-1' }"
				>
					<template #trailing>
						<template v-if="isHost">
							<UTooltip :text="link && !linked ? 'That doesn\'t look like a YouTube link' : linked?.kind === 'band' ? 'Play the playlist now as a band, for everyone' : 'Play now, for everyone'">
								<UButton type="submit" icon="i-pixelarticons-play" aria-label="Play now" variant="ghost" class="min-h-11 min-w-11 justify-center" :disabled="!linked" :loading="sending" />
							</UTooltip>
							<UTooltip text="Add to the end of the queue">
								<UButton icon="i-pixelarticons-playlist" aria-label="Add to the queue" variant="ghost" class="min-h-11 min-w-11 justify-center" :disabled="!linked" @click="submitLink('queue')" />
							</UTooltip>
						</template>
						<UTooltip v-else :text="link && !linked ? 'That doesn\'t look like a YouTube link' : 'Suggest it; the host decides when it plays'">
							<UButton type="submit" icon="i-pixelarticons-plus" aria-label="Suggest" variant="ghost" class="min-h-11 min-w-11 justify-center" :disabled="!linked" :loading="sending" />
						</UTooltip>
					</template>
				</UInput>
				<p v-if="linked?.kind === 'band' || !isHost" id="radio-link-hint" class="mt-1.5 text-xs text-muted">
					<template v-if="linked?.kind === 'band'">A playlist: it plays as a band, track after track (up to 200), then the shelf carries on. </template>
					<template v-if="!isHost">{{ suggestionsLeft > 0 ? `${suggestionsLeft} of ${SUGGESTION_LIMIT} suggestions left.` : `You have ${SUGGESTION_LIMIT} suggestions waiting. Withdraw one, or wait for one to play.` }}</template>
				</p>
			</form>
		</div>

		<RadioShelf />
	</section>
</template>

<style scoped>
/*
 * The radio's look. A theme pack (step 12) overrides these and nothing else: it changes the look
 * (boombox, TV, jukebox), never the layout or the controls. Defaults are Nuxt UI tokens, so light
 * and dark both work.
 */
.radio {
	--radio-body: var(--ui-bg-elevated);
	--radio-trim: var(--ui-border-accented);
	--radio-key: var(--ui-bg);
	--radio-lcd-bg: color-mix(in oklab, var(--ui-primary) 12%, var(--ui-bg));
	/* Primary's 700 in light mode: the default primary (500) on the pale LCD is too faint to read. */
	--radio-lcd-fg: var(--ui-color-primary-700);
	--radio-grille: var(--ui-border-accented);
	--radio-needle: var(--ui-error);
	--radio-radius: calc(var(--ui-radius) * 3);
}
:global(.dark) .radio {
	--radio-lcd-fg: var(--ui-primary);
}
.grille > span {
	transform: scaleY(0.25);
	transition: transform 0.4s;
}
.grille-on > span {
	animation: grille 0.9s ease-in-out infinite alternate;
}
@keyframes grille {
	from {
		transform: scaleY(0.25);
	}
	to {
		transform: scaleY(1);
	}
}
@media (prefers-reduced-motion: reduce) {
	.grille-on > span {
		animation: none;
		transform: scaleY(0.6);
	}
}
</style>
