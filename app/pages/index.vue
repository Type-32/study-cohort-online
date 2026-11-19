<script setup lang="ts">
import { useAuthSession } from "~/composables/core/useAuthSession";
import type { InviteWithUser } from "#shared/types/fetch";
import type { Invite, User } from "#shared/types/db";

useHead({ title: "Home" });

definePageMeta({
	middleware: ["signin-if-session-invalid"],
});

const $as = useAuthSession();
const isAdmin = computed(() => $as.user.value?.role === "admin");
const toast = useToast();
const { copy } = useClipboard({ legacy: true });
const { house, status } = useHouse();

// ponytail: host panel lives on the home page until there is a room to put it beside.
const { data: invites, refresh: refreshInvites } = await useFetch<InviteWithUser[]>("/api/v1/invites", { immediate: isAdmin.value });
const { data: members } = await useFetch<User[]>("/api/v1/users", { immediate: isAdmin.value });

const origin = useRequestURL().origin;

async function copyLink(code: string) {
	await copy(`${origin}/join/${code}`);
	toast.add({ title: "Link copied", color: "success" });
}

async function createInvite(userId?: string) {
	const invite = await $fetch<Invite>("/api/v1/invites", { method: "POST", body: { userId } });
	await refreshInvites();
	await copyLink(invite.code);
}

async function revokeInvite(code: string) {
	await $fetch(`/api/v1/invites/${code}`, { method: "DELETE" });
	await refreshInvites();
}
</script>

<template>
	<UMain>
		<UContainer class="flex flex-col gap-6 py-8">
			<div class="flex items-center justify-between">
				<p>Signed in as <strong>{{ $as.user.value?.username }}</strong></p>
				<UButton label="Sign out" color="neutral" variant="ghost" icon="i-lucide-log-out" @click="$as.clear()" />
			</div>

			<UPageCard title="In the house" :description="status === 'OPEN' ? undefined : 'Connecting…'">
				<ul class="flex flex-wrap gap-2">
					<li v-for="member in house.members" :key="member.userId">
						<UBadge :label="member.username" color="neutral" variant="subtle" icon="i-lucide-lamp-desk" />
					</li>
				</ul>
			</UPageCard>

			<template v-if="isAdmin">
				<UPageCard title="Invite links" description="Anyone with a signup link can join until you revoke it. Re-entry links work once, for 7 days.">
					<UButton label="New signup link" icon="i-lucide-link" class="w-fit" @click="createInvite()" />
					<ul class="divide-y divide-default">
						<li v-for="invite in invites" :key="invite.code" class="flex items-center gap-3 py-2">
							<span class="flex-1 truncate text-sm">
								{{ invite.user ? `Re-entry for ${invite.user.username}` : "Signup" }}
								· used {{ invite.uses }}{{ invite.maxUses ? ` of ${invite.maxUses}` : "" }}
								<template v-if="invite.expiresAt">· expires {{ new Date(invite.expiresAt).toLocaleDateString() }}</template>
							</span>
							<UButton icon="i-lucide-copy" color="neutral" variant="ghost" aria-label="Copy link" @click="copyLink(invite.code)" />
							<UButton icon="i-lucide-trash" color="error" variant="ghost" aria-label="Revoke link" @click="revokeInvite(invite.code)" />
						</li>
					</ul>
				</UPageCard>

				<UPageCard title="Members" description="A member on a new device, or who cleared their cookies, needs a re-entry link.">
					<ul class="divide-y divide-default">
						<li v-for="member in members" :key="member.id" class="flex items-center gap-3 py-2">
							<span class="flex-1">{{ member.username }} <UBadge v-if="member.role !== 'user'" :label="member.role" variant="subtle" /></span>
							<UButton v-if="member.id !== $as.user.value?.id" label="Re-entry link" color="neutral" variant="subtle" @click="createInvite(member.id)" />
						</li>
					</ul>
				</UPageCard>
			</template>
		</UContainer>
	</UMain>
</template>
