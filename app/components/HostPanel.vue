<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui";
import type { InviteWithUser } from "#shared/types/fetch";
import type { User } from "#shared/types/db";
import { useAuthSession } from "~/composables/core/useAuthSession";

const $as = useAuthSession();
const { copyLink, createLink, toastError } = useInviteLinks();

// Mounted only while the slideover is open; lazy so it opens instantly and fills in.
const { data: invites, status: invitesStatus } = useFetch<InviteWithUser[]>("/api/v1/invites", { lazy: true, default: () => [] });
const { data: members, status: membersStatus } = useFetch<User[]>("/api/v1/users", { lazy: true, default: () => [] });

const tabs = [
	{ label: "Invite links", icon: "i-pixelarticons-link", slot: "invites" as const },
	{ label: "Members", icon: "i-pixelarticons-users", slot: "members" as const },
] satisfies TabsItem[];

function inviteState(invite: InviteWithUser) {
	if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "Used";
	if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return "Expired";
}

async function newSignupLink() {
	const invite = await createLink();
	invites.value = [{ ...invite, user: null }, ...invites.value];
	await copyLink(invite.code, "Share it with the people you want in the house.");
}

async function reentryLink(member: User) {
	const invite = await createLink(member.id);
	invites.value = [{ ...invite, user: { username: member.username } }, ...invites.value];
	await copyLink(invite.code, `Send it to ${member.username}. It works once, for 7 days.`);
}

// Optimistic: the row disappears on click and comes back if the server refuses.
async function revoke(code: string) {
	const before = invites.value;
	invites.value = before.filter((invite) => invite.code !== code);
	try {
		await $fetch(`/api/v1/invites/${code}`, { method: "DELETE" });
	} catch (error) {
		invites.value = before;
		toastError(error, "Could not revoke the link");
	}
}
</script>

<template>
	<UTabs :items="tabs" variant="link" class="w-full">
		<template #invites>
			<div class="flex flex-col gap-4 pt-2">
				<UButton label="New signup link" icon="i-pixelarticons-user-plus" loading-auto class="self-start" @click="newSignupLink" />

				<div v-if="invitesStatus === 'pending' && !invites.length" class="flex flex-col gap-3">
					<USkeleton v-for="n in 3" :key="n" class="h-10 w-full" />
				</div>
				<p v-else-if="!invites.length" class="text-sm text-muted">No links yet.</p>
				<ul v-else class="divide-y divide-default">
					<li v-for="invite in invites" :key="invite.code" class="flex items-center gap-3 py-2.5">
						<UIcon :name="invite.user ? 'i-pixelarticons-key' : 'i-pixelarticons-user-plus'" class="size-4 shrink-0 text-muted" />
						<div class="min-w-0 flex-1" :class="inviteState(invite) && 'opacity-60'">
							<p class="truncate text-sm font-medium text-highlighted">
								{{ invite.user ? `Re-entry for ${invite.user.username}` : "Signup link" }}
							</p>
							<p class="text-xs text-muted">
								Used {{ invite.uses }}{{ invite.maxUses ? ` of ${invite.maxUses}` : "" }}
								<template v-if="invite.expiresAt">· expires {{ new Date(invite.expiresAt).toLocaleDateString() }}</template>
							</p>
						</div>
						<UBadge v-if="inviteState(invite)" :label="inviteState(invite)" color="neutral" variant="subtle" size="sm" />
						<UTooltip v-else text="Copy link">
							<UButton icon="i-pixelarticons-copy" color="neutral" variant="ghost" aria-label="Copy link" @click="copyLink(invite.code)" />
						</UTooltip>
						<UTooltip text="Revoke">
							<UButton icon="i-pixelarticons-trash" color="error" variant="ghost" aria-label="Revoke link" @click="revoke(invite.code)" />
						</UTooltip>
					</li>
				</ul>
			</div>
		</template>

		<template #members>
			<div class="flex flex-col gap-3 pt-2">
				<p class="text-sm text-muted">Someone on a new device, or who cleared their cookies, needs a re-entry link.</p>
				<div v-if="membersStatus === 'pending' && !members.length" class="flex flex-col gap-3">
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
							loading-auto
							@click="reentryLink(member)"
						/>
					</li>
				</ul>
			</div>
		</template>
	</UTabs>
</template>
