<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { useAuthSession } from "~/composables/core/useAuthSession";

const $as = useAuthSession();
const $rc = useRuntimeConfig();
const { copyLink, createLink } = useInviteLinks();
const user = computed(() => $as.user.value);
const signingOut = ref(false);

const menu = computed<DropdownMenuItem[][]>(() => [
	[{ type: "label", label: user.value?.username, avatar: { alt: user.value?.username } }],
	[{
		label: "Sign in on another device",
		icon: "i-pixelarticons-smartphone",
		async onSelect() {
			const invite = await createLink(user.value!.id);
			await copyLink(invite.code, "Open it on your other device. It works once, for 7 days.");
		},
	}],
	[{
		label: "Sign out",
		icon: "i-pixelarticons-logout",
		color: "error",
		onSelect() {
			signingOut.value = true;
			$as.clear();
		},
	}],
]);
</script>

<template>
	<UHeader
		:toggle="false"
		to="/"
		:ui="{
			root: 'border-none bg-transparent backdrop-blur-none',
			container: 'max-w-2xl',
			title: 'text-lg font-semibold font-serif',
		}"
	>
		<template #title>
			<UIcon name="i-pixelarticons-lightbulb-on" class="size-5 text-primary" />
			{{ $rc.public.siteName || "Study House" }}
		</template>

		<template #right>
			<UColorModeButton color="neutral" variant="ghost" />
			<template v-if="user">
				<USlideover v-if="user.role === 'admin'" title="Manage house" description="Invite people in, and get members back in on a new device.">
					<UTooltip text="Manage house">
						<UButton icon="i-pixelarticons-sliders" aria-label="Manage house" color="neutral" variant="ghost" />
					</UTooltip>
					<template #body>
						<HostPanel />
					</template>
				</USlideover>

				<UDropdownMenu :items="menu" :content="{ align: 'end' }">
					<UButton
						:avatar="{ alt: user.username }"
						:loading="signingOut"
						:aria-label="`${user.username}'s menu`"
						color="neutral"
						variant="ghost"
						square
					/>
				</UDropdownMenu>
			</template>
		</template>
	</UHeader>
</template>
