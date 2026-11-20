let shared: AudioContext | undefined;

/**
 * The page's one AudioContext, shared by the keep-awake tone and the door's noise bed. Browsers only
 * let it start after a click or key press on the page (creating one earlier logs a warning and leaves
 * it suspended), so it doesn't exist until then. The returned `ready()` creates or resumes it and
 * calls `onReady`; it also runs on every click and key press, so `onReady` must be idempotent.
 */
export function useAudioContext(onReady: (context: AudioContext) => void) {
	function ready() {
		if (!navigator.userActivation?.hasBeenActive) return;
		shared ??= new AudioContext();
		if (shared.state === "suspended") void shared.resume();
		onReady(shared);
	}
	useEventListener("pointerdown", ready, { passive: true });
	useEventListener("keydown", ready, { passive: true });
	return ready;
}
