import { PING_INTERVAL_MS } from "#shared/utils/realtime";
import type { ClientMsg, HouseState, ServerMsg } from "#shared/utils/realtime";
import { nextRadio } from "#shared/utils/radio";
import { useAuthSession } from "~/composables/core/useAuthSession";

/**
 * The live house state, readable anywhere (the header dock shows the timer and members from it).
 * Only `useHouse` writes it.
 */
export function useHouseState() {
	return {
		house: useState<HouseState>("house", () => ({ members: [], timer: null, radio: null })),
		/** serverMs - clientMs, from the last ping/pong. Add to Date.now() to get server time. */
		clockOffsetMs: useState("house:clock-offset", () => 0),
	};
}

/**
 * Live house state over /api/ws. Opens one socket per call, so call it once (in the page);
 * other components read the state through `useHouseState`. Reconnects with backoff; every
 * connect starts from a fresh snapshot.
 */
export function useHouse() {
	const { house, clockOffsetMs } = useHouseState();
	/** True once this page has received its first snapshot. */
	const loaded = ref(false);
	const toast = useToast();
	const myId = computed(() => useAuthSession().user.value?.id);
	/** This member's door; open until the snapshot says otherwise. */
	const myDoor = computed(() => house.value.members.find((m) => m.userId === myId.value)?.door ?? "open");

	const ping = () => JSON.stringify({ t: "ping", clientMs: Date.now() });
	const url = import.meta.client ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws` : undefined;

	const { status, send } = useWebSocket(url, {
		// Vercel closes sockets at the function's max duration; reconnecting is routine, not an error.
		autoReconnect: { delay: (retries) => Math.min(1000 * 2 ** retries, 30_000) },
		heartbeat: { message: ping, interval: PING_INTERVAL_MS, pongTimeout: 10_000 },
		onConnected: () => send(ping()),
		onMessage(_, event) {
			const msg = JSON.parse(event.data) as ServerMsg;
			switch (msg.t) {
				case "snapshot":
					house.value = msg.house;
					loaded.value = true;
					break;
				case "member":
					house.value.members = [...house.value.members.filter((m) => m.userId !== msg.member.userId), msg.member];
					break;
				case "leave":
					house.value.members = house.value.members.filter((m) => m.userId !== msg.userId);
					break;
				case "pong": {
					const roundTrip = Date.now() - msg.clientMs;
					clockOffsetMs.value = msg.serverMs - (msg.clientMs + roundTrip / 2);
					break;
				}
				case "timer":
					house.value.timer = msg.timer;
					break;
				case "radio":
					house.value.radio = msg.radio;
					break;
				case "error":
					toast.add({ title: msg.message, color: "error", icon: "i-pixelarticons-alert" });
					break;
			}
		},
	});

	/**
	 * Sends an intent; the server validates it and broadcasts the result to everyone, sender included.
	 * Timer, radio and door intents also apply locally right away, so the click lands without waiting
	 * for the round trip; the broadcast then replaces the guess with the server's value.
	 */
	function sendIntent(msg: ClientMsg) {
		send(JSON.stringify(msg));
		if (msg.t === "timer") {
			house.value.timer = msg.action === "start" && msg.minutes
				? { endsAtServerMs: Date.now() + clockOffsetMs.value + msg.minutes * 60_000, minutes: msg.minutes }
				: null;
		}
		if (msg.t === "radio") {
			house.value.radio = nextRadio(house.value.radio, msg, Date.now() + clockOffsetMs.value);
		}
		if (msg.t === "door") {
			house.value.members = house.value.members.map((m) => (m.userId === myId.value ? { ...m, door: msg.state } : m));
		}
	}

	return { house, status, clockOffsetMs, loaded, myDoor, sendIntent };
}
