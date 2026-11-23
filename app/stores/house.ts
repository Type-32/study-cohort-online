import { skipHydrate } from "pinia";
import { NOTE_TTL_MS, PING_INTERVAL_MS } from "#shared/utils/realtime";
import type { HouseState, Intent, PlayerReport, ServerMsg } from "#shared/utils/realtime";
import { nextRadio, nextUp, queuePositionFor } from "#shared/utils/radio";
import { DEFAULT_THEME } from "#shared/utils/theme";
import type { Suggestion } from "#shared/utils/radio";
import { useAuthSession } from "~/composables/core/useAuthSession";

/** How long a click may wait for the house to answer before it is given up. */
const INTENT_TIMEOUT_MS = 10_000;

type Pending = { id: string; intent: Intent; atServerMs: number; settle: (error?: Error) => void };
type Me = { id: string; username: string } | undefined;

/** A random UUID (v4) for things this client creates, such as a suggestion. Works on plain http too, unlike `crypto.randomUUID`. */
export function newId() {
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[6] = (b[6]! & 0x0f) | 0x40;
	b[8] = (b[8]! & 0x3f) | 0x80;
	const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A shelf item goes on air and leaves the shelf. A band's first track is the server's to name: until
 * it answers, the radio stays as it is.
 */
function playFromShelf(house: HouseState, suggestion: Suggestion, atServerMs: number): HouseState {
	const suggestions = house.suggestions.filter((s) => s.id !== suggestion.id);
	if (!suggestion.videoId) return { ...house, suggestions };
	return { ...house, suggestions, radio: nextRadio(null, { action: "play", videoId: suggestion.videoId, title: suggestion.title, by: suggestion.username }, atServerMs) };
}

/** Skip and leave: what follows on the shelf, or nothing (a shuffle pick is the server's to make). */
function skipTo(house: HouseState, atServerMs: number): HouseState {
	const next = nextUp(house.suggestions);
	if (next) return playFromShelf(house, next, atServerMs);
	return house.radioWhenEmpty === "stop" ? { ...house, radio: null } : house;
}

/**
 * What an intent does to the house, as the sender guesses it before the server answers. Where the
 * server knows more (a shuffle pick, a station number, a title), the guess leaves it out and the
 * broadcast fills it in.
 */
function applyIntent(house: HouseState, { intent, atServerMs }: Pending, me: Me): HouseState {
	switch (intent.t) {
		case "door":
			return { ...house, members: house.members.map((m) => (m.userId === me?.id ? { ...m, door: intent.state } : m)) };
		case "timer":
			return {
				...house,
				timer: intent.action === "start" && intent.minutes ? { endsAtServerMs: atServerMs + intent.minutes * 60_000, minutes: intent.minutes } : null,
			};
		case "suggest": {
			if (!me) return house;
			const queuePosition = intent.queue ? queuePositionFor(house.suggestions, intent.suggestionId, "last") : null;
			const band = intent.playlistId ? { id: intent.playlistId, length: 0, cover: null } : null;
			const suggestion = { id: intent.suggestionId, videoId: intent.videoId ?? null, band, title: null, userId: me.id, username: me.username, queuePosition, createdAtServerMs: atServerMs };
			return { ...house, suggestions: [...house.suggestions, suggestion] };
		}
		case "unsuggest":
			return { ...house, suggestions: house.suggestions.filter((s) => s.id !== intent.suggestionId) };
		case "queue":
			return {
				...house,
				suggestions: house.suggestions.map((s) =>
					s.id === intent.suggestionId ? { ...s, queuePosition: queuePositionFor(house.suggestions, s.id, intent.to) } : s,
				),
			};
		case "radioWhenEmpty":
			return { ...house, radioWhenEmpty: intent.mode };
		case "note":
			if (!me) return house;
			return { ...house, notes: [...house.notes, { id: intent.noteId, userId: me.id, username: me.username, text: intent.text, createdAtServerMs: atServerMs }] };
		case "sit":
			return { ...house, members: house.members.map((m) => (m.userId === me?.id ? { ...m, slot: intent.slot } : m)) };
		case "theme":
			// A new theme's version is the server's to name; everyone stands up at once.
			return { ...house, theme: { id: intent.themeId, version: house.theme.id === intent.themeId ? house.theme.version : 0 }, members: house.members.map((m) => ({ ...m, slot: null })) };
		case "radio":
			switch (intent.action) {
				case "play": {
					const shelved = house.suggestions.find((s) => s.videoId === intent.videoId);
					if (shelved) return playFromShelf(house, { ...shelved, username: me?.username ?? shelved.username }, atServerMs);
					return { ...house, radio: nextRadio(null, { action: "play", videoId: intent.videoId, by: me?.username }, atServerMs) };
				}
				case "playBand": {
					// Its track and station are the server's to name; the band only leaves the shelf now.
					return { ...house, suggestions: house.suggestions.filter((s) => s.band?.id !== intent.playlistId) };
				}
				case "playSuggestion": {
					const suggestion = house.suggestions.find((s) => s.id === intent.suggestionId);
					return suggestion ? playFromShelf(house, suggestion, atServerMs) : house;
				}
				case "skip":
					// Within a band the next track is the server's to name.
					return house.radio?.band && house.radio.band.index + 1 < house.radio.band.length ? house : skipTo(house, atServerMs);
				case "leaveBand":
					return skipTo(house, atServerMs);
				default:
					return { ...house, radio: nextRadio(house.radio, intent, atServerMs) };
			}
	}
}

/**
 * The live house over /api/ws. The home page opens the socket (`connect`) and closes it when left;
 * anything else (the header's status pill) just reads. Reconnects with backoff, and every connect
 * starts from a fresh snapshot.
 */
export const useHouseStore = defineStore("house", () => {
	/** The house as the server last said it is. */
	const confirmed = ref<HouseState>({ members: [], timer: null, radio: null, suggestions: [], radioWhenEmpty: "stop", notes: [], theme: { id: DEFAULT_THEME, version: 0 } });
	/** serverMs - clientMs, from the last ping/pong. Add to Date.now() to get server time. */
	const clockOffsetMs = ref(0);
	/** True once the first snapshot since `connect` arrived. */
	const loaded = ref(false);
	/** This member's intents that the house hasn't broadcast back yet, oldest first. */
	const pending = shallowRef<Pending[]>([]);
	const { user } = useAuthSession();
	const myId = computed(() => user.value?.id);
	const me = computed<Me>(() => (user.value ? { id: user.value.id, username: user.value.username } : undefined));
	const toast = useToast();

	/**
	 * The house as this member sees it: the server's state with their own unanswered clicks on top.
	 * Whatever arrives in between (someone else's change, the snapshot after a reconnect) updates the
	 * base underneath, so it can't flip a click back while it's on its way. Members are sorted, so a
	 * snapshot or rejoin doesn't reshuffle the list.
	 */
	const house = computed<HouseState>(() => {
		const view = pending.value.reduce((state, entry) => applyIntent(state, entry, me.value), confirmed.value);
		return { ...view, members: view.members.toSorted((a, b) => a.username.localeCompare(b.username)) };
	});
	/** This member's door; open until the snapshot says otherwise. */
	const myDoor = computed(() => house.value.members.find((m) => m.userId === myId.value)?.door ?? "open");

	/**
	 * The server handles a socket's messages in order and broadcasts in commit order, so when one
	 * intent comes back, every intent sent before it has come back too, or was lost to a reconnect
	 * (the snapshot already covers it). Drop them together.
	 */
	function confirm(id: string | undefined) {
		const index = pending.value.findIndex((entry) => entry.id === id);
		if (index < 0) return;
		const done = pending.value.slice(0, index + 1);
		pending.value = pending.value.slice(index + 1);
		for (const entry of done) entry.settle();
	}

	function fail(id: string, error: Error) {
		const entry = pending.value.find((p) => p.id === id);
		if (!entry) return;
		pending.value = pending.value.filter((p) => p !== entry);
		entry.settle(error);
	}

	const ping = () => JSON.stringify({ t: "ping", clientMs: Date.now() });
	const url = import.meta.client ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws` : undefined;

	const { status, send, open, close } = useWebSocket(url, {
		immediate: false,
		// Vercel closes sockets at the function's max duration; reconnecting is routine, not an error.
		autoReconnect: { delay: (retries) => Math.min(1000 * 2 ** retries, 30_000) },
		heartbeat: { message: ping, interval: PING_INTERVAL_MS, pongTimeout: 10_000 },
		onConnected: () => send(ping()),
		onMessage(_, event) {
			const msg = JSON.parse(event.data) as ServerMsg;
			switch (msg.t) {
				case "snapshot":
					confirmed.value = msg.house;
					loaded.value = true;
					break;
				case "member":
					confirmed.value.members = [...confirmed.value.members.filter((m) => m.userId !== msg.member.userId), msg.member];
					confirm(msg.intent);
					break;
				case "leave":
					// While this socket is open we're here, whatever a closing socket of ours reports late.
					if (msg.userId !== myId.value) confirmed.value.members = confirmed.value.members.filter((m) => m.userId !== msg.userId);
					break;
				case "pong": {
					const roundTrip = Date.now() - msg.clientMs;
					clockOffsetMs.value = msg.serverMs - (msg.clientMs + roundTrip / 2);
					break;
				}
				case "timer":
					confirmed.value.timer = msg.timer;
					confirm(msg.intent);
					break;
				case "radio":
					confirmed.value.radio = msg.radio;
					confirm(msg.intent);
					break;
				case "suggestion":
					confirmed.value.suggestions = [...confirmed.value.suggestions.filter((s) => s.id !== msg.suggestion.id), msg.suggestion];
					confirm(msg.intent);
					break;
				case "unsuggest":
					confirmed.value.suggestions = confirmed.value.suggestions.filter((s) => s.id !== msg.suggestionId);
					confirm(msg.intent);
					break;
				case "radioWhenEmpty":
					confirmed.value.radioWhenEmpty = msg.mode;
					confirm(msg.intent);
					break;
				case "note":
					confirmed.value.notes = [...confirmed.value.notes.filter((n) => n.id !== msg.note.id), msg.note];
					confirm(msg.intent);
					break;
				case "theme":
					confirmed.value.theme = msg.theme;
					if (!msg.keepSeats) confirmed.value.members = confirmed.value.members.map((m) => ({ ...m, slot: null }));
					confirm(msg.intent);
					break;
				case "error":
					if (msg.intent) fail(msg.intent, new Error(msg.message));
					else toast.add({ title: msg.message, color: "error", icon: "i-pixelarticons-alert" });
					break;
			}
		},
	});

	// A note leaves every open list when it turns 24 hours old, on time even if nobody writes for
	// days (the server deletes the row at the next note). Notes are oldest first: one timer, for the first.
	if (import.meta.client) {
		watchEffect((onCleanup) => {
			const first = confirmed.value.notes[0];
			if (!first) return;
			const timeout = setTimeout(() => {
				const cutoff = Date.now() + clockOffsetMs.value - NOTE_TTL_MS;
				confirmed.value.notes = confirmed.value.notes.filter((n) => n.createdAtServerMs > cutoff);
			}, Math.max(0, first.createdAtServerMs + NOTE_TTL_MS - (Date.now() + clockOffsetMs.value)) + 50);
			onCleanup(() => clearTimeout(timeout));
		});
	}

	/**
	 * Sends an intent and shows its effect right away. Resolves when the house broadcasts it back
	 * (the base state now has it), rejects if the server refused it or never answered.
	 */
	function sendIntent(intent: Intent) {
		const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => fail(id, new Error("The house didn't answer. Check your connection and try again.")), INTENT_TIMEOUT_MS);
			const settle = (error?: Error) => {
				clearTimeout(timeout);
				if (error) reject(error);
				else resolve();
			};
			pending.value = [...pending.value, { id, intent, atServerMs: Date.now() + clockOffsetMs.value, settle }];
			// Buffered while reconnecting; sent once the socket is open.
			send(JSON.stringify({ ...intent, id }));
		});
	}

	/** A player's report (track over, or refused by YouTube). Not an intent: nothing waits for an answer. */
	function report(msg: PlayerReport) {
		if (status.value === "OPEN") send(JSON.stringify(msg), false);
	}

	function connect() {
		loaded.value = false;
		open();
	}

	return { confirmed, clockOffsetMs, loaded, status: skipHydrate(status), house, myDoor, sendIntent, report, connect, disconnect: close };
});

/**
 * Sends house intents as a Pinia Colada mutation: `isLoading` until the house broadcasts the change
 * back, and a toast if it refuses. The change itself shows at once (see `house` in the store).
 */
export function useHouseIntent() {
	const store = useHouseStore();
	const toast = useToast();
	return useMutation({
		mutation: (intent: Intent) => store.sendIntent(intent),
		onError: (error) => toast.add({ title: error.message, color: "error", icon: "i-pixelarticons-alert" }),
	});
}
