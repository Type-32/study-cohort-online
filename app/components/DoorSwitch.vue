<script setup lang="ts">
import type { Door } from "#shared/utils/realtime";

/** Your door: how far you sit from the commons. Changing it is never announced to the others. */
const { myDoor: door } = storeToRefs(useHouseStore());
const { mutate: sendIntent } = useHouseIntent();
const sound = useDoorSoundSettings();

const heard = {
	quieter: { ajar: "The radio is faint.", closed: "The radio is very faint." },
	muffled: { ajar: "The radio is muffled.", closed: "The radio is muffled." },
	silent: { ajar: "No radio.", closed: "No radio." },
};
const options = computed<{ door: Door; label: string; icon: string; tip: string }[]>(() => [
	{ door: "open", label: "Open", icon: "i-pixelarticons-login", tip: "At your desk in the living room. You hear the radio." },
	{ door: "ajar", label: "Ajar", icon: "i-pixelarticons-lightbulb-on", tip: `Lamp on in your nook. ${heard[sound.value.ajar].ajar}` },
	{ door: "closed", label: "Closed", icon: "i-pixelarticons-door-closed", tip: `A light under your door. ${heard[sound.value.closed].closed} Others still see you're in.` },
]);
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
					@click="door !== option.door && sendIntent({ t: 'door', state: option.door })"
				/>
			</UTooltip>
		</UFieldGroup>
	</div>
</template>
