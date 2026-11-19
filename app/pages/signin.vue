<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import { z } from "zod";
import { useAuthSession } from "~/composables/core/useAuthSession";
import { usernameSchema } from "#shared/utils/schemas";

useHead({ title: "Sign In" });

definePageMeta({
	middleware: ["home-if-session-valid"],
});

const schema = z.object({ username: usernameSchema });
const { data: setup } = await useFetch("/api/v1/auth/setup");
const toast = useToast();

async function onSubmit(event: FormSubmitEvent<z.output<typeof schema>>) {
	try {
		await $fetch("/api/v1/auth/setup", { method: "POST", body: event.data });
		await useAuthSession().refresh();
		await navigateTo("/");
	} catch (error) {
		toast.add({ title: fetchErrorMessage(error) ?? "Could not set up the house.", color: "error", icon: "i-pixelarticons-alert" });
	}
}
</script>

<template>
	<UMain class="flex flex-col items-center justify-center gap-4 p-4">
		<Motion class="w-full max-w-sm" :initial="{ opacity: 0, y: 12 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4 }">
			<UAuthForm
				v-if="setup?.needed"
				title="Set up this house"
				description="You're the first one here, so you'll be the host."
				icon="i-pixelarticons-home"
				:schema="schema"
				:fields="[{ name: 'username', type: 'text', label: 'Display name', required: true }]"
				:submit="{ label: 'Create house' }"
				loading-auto
				@submit="onSubmit"
			/>
			<UAuthForm
				v-else
				title="This house is invite-only"
				description="Ask the host for an invite link. If you've been here before on another device, ask for a re-entry link."
				icon="i-pixelarticons-door-closed"
			/>
		</Motion>
	</UMain>
</template>
