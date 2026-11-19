export default defineEventHandler(async (event) => {
	// No redirect: the browser's fetch failed on the 302, so sign-out never reached its reload.
	await clearUserSession(event);
	return { ok: true };
});
