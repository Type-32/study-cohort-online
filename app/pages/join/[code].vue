<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import { z } from "zod";
import { useAuthSession } from "~/composables/core/useAuthSession";
import { usernameSchema } from "#shared/utils/schemas";
import type { InviteInfo } from "#shared/types/fetch";

useHead({ title: "Join" });

definePageMeta({
	middleware: ["home-if-session-valid"],
});

const code = useRoute().params.code as string;
const { data: invite } = await useFetch<InviteInfo>(`/api/v1/invites/${encodeURIComponent(code)}`);
const schema = z.object({ username: usernameSchema });
const toast = useToast();

async function join(username?: string) {
	try {
		await $fetch("/api/v1/auth/join", { method: "POST", body: { code, username } });
		await useAuthSession().refresh();
		await navigateTo("/");
	} catch (error) {
		toast.add({ title: fetchErrorMessage(error) ?? "Could not join.", color: "error", icon: "i-lucide-circle-alert" });
	}
}
</script>

<template>
	<UMain class="flex flex-col items-center justify-center gap-4 p-4">
		<UPageCard class="w-full max-w-md">
			<!-- UAuthForm renders no form or submit button without fields, so re-entry gets its own button. -->
			<UAuthForm
				v-if="invite?.kind === 'reentry'"
				:title="`Welcome back, ${invite.username}`"
				description="This link signs you in on this device."
				icon="i-lucide-door-open"
			>
				<template #footer>
					<UButton label="Continue" block loading-auto @click="join()" />
				</template>
			</UAuthForm>
			<UAuthForm
				v-else-if="invite"
				title="Come on in"
				description="Pick the name the others will see."
				icon="i-lucide-door-open"
				:schema="schema"
				:fields="[{ name: 'username', type: 'text', label: 'Display name', required: true }]"
				:submit="{ label: 'Join' }"
				loading-auto
				@submit="(event: FormSubmitEvent<z.output<typeof schema>>) => join(event.data.username)"
			/>
			<UAuthForm
				v-else
				title="This invite link doesn't work"
				description="It may be used up, expired, or revoked. Ask the host for a new one."
				icon="i-lucide-door-closed"
			/>
		</UPageCard>
	</UMain>
</template>
