<script setup lang="ts">
import type { Door } from "#shared/utils/realtime";

/** Your door: how far you sit from the commons. Changing it is never announced to the others. */
defineProps<{ door: Door }>();
const emit = defineEmits<{ change: [door: Door] }>();

const options: { door: Door; label: string; icon: string; tip: string }[] = [
	{ door: "open", label: "Open", icon: "i-pixelarticons-login", tip: "At your desk in the living room. You hear the radio." },
	{ door: "ajar", label: "Ajar", icon: "i-pixelarticons-lightbulb-on", tip: "Lamp on in your nook. The radio is faint." },
	{ door: "closed", label: "Closed", icon: "i-pixelarticons-door-closed", tip: "A light under your door. No radio. Others still see you're in." },
];
</script>

<template>
	<div class="flex flex-col items-start gap-2">
		<p class="text-xs tracking-widest text-muted uppercase">Your door</p>
		<UFieldGroup>
			<UTooltip v-for="option in options" :key="option.door" :text="option.tip">
				<UButton
					:label="option.label"
					:icon="option.icon"
					:color="door === option.door ? 'primary' : 'neutral'"
					:variant="door === option.door ? 'soft' : 'ghost'"
					:aria-pressed="door === option.door"
					@click="door !== option.door && emit('change', option.door)"
				/>
			</UTooltip>
		</UFieldGroup>
	</div>
</template>
