/**
 * Keeps the house tab from being discarded (Memory Saver, sleeping tabs) or frozen in the background.
 *
 * Browsers exempt tabs that are playing audio, so while enabled this plays a 20 Hz tone at -60 dBFS:
 * loud enough for the browser's audibility check (Chromium counts anything above about -72 dBFS),
 * far below what speakers or ears pick up. The tab shows the "playing audio" indicator as a result.
 * Turning it off saves a little battery; the cost is the tab may sleep, dropping the member out of
 * the house and pausing the radio until they come back.
 */
export function useKeepAwake() {
	// Read after mount so the server render and the first client render agree.
	const enabled = useLocalStorage("house:keep-awake", true, { initOnMounted: true });
	const toast = useToast();
	let tone: OscillatorNode | undefined;

	const start = useAudioContext((context) => {
		if (!enabled.value || tone) return;
		tone = context.createOscillator();
		tone.frequency.value = 20;
		const gain = context.createGain();
		gain.gain.value = 0.001;
		tone.connect(gain).connect(context.destination);
		tone.start();
	});

	function stop() {
		tone?.stop();
		tone?.disconnect();
		tone = undefined;
	}

	onMounted(() => {
		// `wasDiscarded` is Chromium-only: true when this load restored a tab the browser discarded.
		if ("wasDiscarded" in document && document.wasDiscarded && !enabled.value) {
			toast.add({
				title: "Your browser put this tab to sleep",
				description: "Turn on \"Keep this tab awake\" to stay in the house while the tab is in the background.",
				icon: "i-pixelarticons-moon",
				color: "warning",
			});
		}
		watch(enabled, (on) => (on ? start() : stop()), { immediate: true });
	});

	onScopeDispose(stop);

	return { enabled };
}
