/// <reference types="youtube" />

declare global {
	interface Window {
		onYouTubeIframeAPIReady?: () => void;
	}
}

let api: Promise<typeof YT> | undefined;

/** Loads the YouTube IFrame Player API once per page; resolves with the global `YT`. Client only. */
export function loadYouTubeApi() {
	if (api) return api;
	const { promise, resolve } = Promise.withResolvers<typeof YT>();
	api = promise;
	if (window.YT?.Player) {
		resolve(window.YT);
		return api;
	}
	const previous = window.onYouTubeIframeAPIReady;
	window.onYouTubeIframeAPIReady = () => {
		previous?.();
		resolve(window.YT);
	};
	const script = document.createElement("script");
	script.src = "https://www.youtube.com/iframe_api";
	document.head.append(script);
	return api;
}
