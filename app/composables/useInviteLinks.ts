import type { Invite } from "#shared/types/db";

/** The `statusMessage` an API route threw with `createError`, if `error` is such a fetch error. */
export function fetchErrorMessage(error: unknown): string | undefined {
	if (error instanceof Error && "data" in error && error.data && typeof error.data === "object"
		&& "statusMessage" in error.data && typeof error.data.statusMessage === "string") return error.data.statusMessage;
}

/** Creates invite links and copies them, with toasts for both outcomes. */
export function useInviteLinks() {
	const toast = useToast();
	const { copy } = useClipboard({ legacy: true });
	const origin = useRequestURL().origin;

	function toastError(error: unknown, title: string) {
		toast.add({ title, description: fetchErrorMessage(error), color: "error", icon: "i-lucide-circle-alert" });
	}

	async function copyLink(code: string, description?: string) {
		await copy(`${origin}/join/${code}`);
		toast.add({ title: "Link copied", description, color: "success", icon: "i-lucide-copy-check" });
	}

	/** Without `userId`: a signup link. With it: a re-entry link for that member. Throws after toasting. */
	async function createLink(userId?: string) {
		try {
			return await $fetch<Invite>("/api/v1/invites", { method: "POST", body: { userId } });
		} catch (error) {
			toastError(error, "Could not create the link");
			throw error;
		}
	}

	return { copyLink, createLink, toastError };
}
