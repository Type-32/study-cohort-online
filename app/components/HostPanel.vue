<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui";
import type { InviteListItem } from "#shared/types/fetch";
import type { User } from "#shared/types/db";
import { useAuthSession } from "~/composables/core/useAuthSession";

const $as = useAuthSession();
const { copyLink, createLink, toastError } = useInviteLinks();
const queryCache = useQueryCache();

// Mounted only while the slideover is open; it opens at once and fills in.
const { data: invites, status: invitesStatus } = useQuery({ key: ["invites"], query: () => $fetch<InviteListItem[]>("/api/v1/invites") });
const { data: members, status: membersStatus } = useQuery({ key: ["users"], query: () => $fetch<User[]>("/api/v1/users") });

const tabs = [
	{ label: "Invite links", icon: "i-pixelarticons-link", slot: "invites" as const },
	{ label: "Members", icon: "i-pixelarticons-users", slot: "members" as const },
] satisfies TabsItem[];

const DAY_MS = 24 * 60 * 60 * 1000;
const now = useNow({ interval: 60_000 });
const names = new Intl.ListFormat("en", { type: "conjunction" });

const expired = (invite: InviteListItem) => !!invite.expiresAt && new Date(invite.expiresAt) <= now.value;
const inviteState = (invite: InviteListItem) => (invite.usedUpAt ? "Used" : expired(invite) ? "Expired" : undefined);

/** The server removes a link a day after it was used up or expired. */
function removal(invite: InviteListItem) {
	const since = invite.usedUpAt ?? (expired(invite) ? invite.expiresAt : null);
	if (!since) return;
	const hours = Math.ceil((new Date(since).getTime() + DAY_MS - now.value.getTime()) / 3_600_000);
	return hours <= 1 ? "removed within the hour" : `removed in ${hours} h`;
}

function details(invite: InviteListItem) {
	const parts: string[] = [];
	if (invite.user) {
		if (!inviteState(invite)) parts.push("Works once", `expires ${new Date(invite.expiresAt!).toLocaleDateString()}`);
	} else {
		parts.push(invite.joined.length ? `${names.format(invite.joined.map((m) => m.username))} joined` : "Nobody yet");
		if (invite.maxUses > 1) parts.push(`${invite.uses} of ${invite.maxUses} used`);
		if (invite.expiresAt && !inviteState(invite)) parts.push(`expires ${new Date(invite.expiresAt).toLocaleDateString()}`);
	}
	const removed = removal(invite);
	if (removed) parts.push(removed);
	return parts.join(" · ");
}

const addToList = (invite: InviteListItem) => queryCache.setQueryData<InviteListItem[]>(["invites"], (list = []) => [invite, ...list]);

/** How many people the next signup link lets in. */
const uses = ref(1);
const { mutate: newSignupLink, isLoading: creatingSignup } = useMutation({
	mutation: (maxUses: number) => createLink({ maxUses }),
	async onSuccess(invite) {
		addToList({ ...invite, user: null, joined: [] });
		await copyLink(invite.code, invite.maxUses === 1 ? "It works for one person." : `It works for ${invite.maxUses} people.`);
	},
});

const reentry = useMutation({
	mutation: (member: User) => createLink({ userId: member.id }),
	async onSuccess(invite, member) {
		addToList({ ...invite, user: { username: member.username }, joined: [] });
		await copyLink(invite.code, `Send it to ${member.username}. It works once, for 7 days.`);
	},
});

// Optimistic: the row disappears on click. If the server refuses, the list is reloaded.
const { mutate: revoke } = useMutation({
	mutation: (code: string) => $fetch<unknown>(`/api/v1/invites/${encodeURIComponent(code)}` as string, { method: "DELETE" }),
	onMutate(code) {
		queryCache.cancelQueries({ key: ["invites"] });
		queryCache.setQueryData<InviteListItem[]>(["invites"], (list = []) => list.filter((invite) => invite.code !== code));
	},
	onError(error) {
		queryCache.invalidateQueries({ key: ["invites"] });
		toastError(error, "Could not revoke the link");
	},
});
</script>

<template>
	<UTabs :items="tabs" variant="link" class="w-full">
		<template #invites>
			<div class="flex flex-col gap-4 pt-2">
				<form class="flex flex-wrap items-center gap-2" @submit.prevent="newSignupLink(uses || 1)">
					<UButton type="submit" label="New signup link" icon="i-pixelarticons-user-plus" :loading="creatingSignup" />
					<span class="text-sm text-muted">for</span>
					<UTooltip text="How many people can join with this link">
						<UInputNumber v-model="uses" :min="1" :max="50" variant="soft" class="w-28" aria-label="People who can join with this link" />
					</UTooltip>
					<span class="text-sm text-muted">{{ uses === 1 ? "person" : "people" }}</span>
				</form>

				<div v-if="invitesStatus === 'pending'" class="flex flex-col gap-3">
					<USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
				</div>
				<p v-else-if="!invites?.length" class="text-sm text-muted">No links yet.</p>
				<ul v-else class="divide-y divide-default">
					<li v-for="invite in invites" :key="invite.code" class="flex items-center gap-3 py-2.5">
						<UIcon :name="invite.user ? 'i-pixelarticons-key' : 'i-pixelarticons-user-plus'" class="size-4 shrink-0 text-muted" />
						<div class="min-w-0 flex-1" :class="inviteState(invite) && 'opacity-60'">
							<p class="truncate text-sm font-medium text-highlighted">
								{{ invite.user ? `Re-entry for ${invite.user.username}` : "Signup link" }}
							</p>
							<p class="text-xs text-muted">{{ details(invite) }}</p>
						</div>
						<UBadge v-if="inviteState(invite)" :label="inviteState(invite)" color="neutral" variant="subtle" size="sm" />
						<UTooltip v-else text="Copy link">
							<UButton icon="i-pixelarticons-copy" color="neutral" variant="ghost" aria-label="Copy link" @click="copyLink(invite.code)" />
						</UTooltip>
						<UTooltip :text="inviteState(invite) ? 'Remove now' : 'Revoke'">
							<UButton icon="i-pixelarticons-trash" color="error" variant="ghost" :aria-label="inviteState(invite) ? 'Remove link' : 'Revoke link'" @click="revoke(invite.code)" />
						</UTooltip>
					</li>
				</ul>
			</div>
		</template>

		<template #members>
			<div class="flex flex-col gap-3 pt-2">
				<p class="text-sm text-muted">Someone on a new device, or who cleared their cookies, needs a re-entry link.</p>
				<div v-if="membersStatus === 'pending'" class="flex flex-col gap-3">
					<USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
				</div>
				<ul v-else class="divide-y divide-default">
					<li v-for="member in members" :key="member.id" class="flex items-center gap-3 py-2.5">
						<UUser :name="member.username" :description="member.role === 'user' ? undefined : member.role" :avatar="{ alt: member.username }" class="flex-1" />
						<UButton
							v-if="member.id !== $as.user.value?.id"
							label="Re-entry link"
							icon="i-pixelarticons-key"
							color="neutral"
							variant="subtle"
							size="sm"
							:loading="reentry.isLoading.value && reentry.variables.value?.id === member.id"
							@click="reentry.mutate(member)"
						/>
					</li>
				</ul>
			</div>
		</template>
	</UTabs>
</template>
