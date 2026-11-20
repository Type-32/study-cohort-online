<script setup lang="ts">
import type { RadioGroupItem } from "@nuxt/ui";
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

const ajarChoices: RadioGroupItem[] = [
	{ value: "quieter", label: "Quieter", description: "The music at a quarter of your volume." },
	{ value: "muffled", label: "Muffled", description: "Quieter still, with a low rumble over it, as if through a wall." },
];
const closedChoices: RadioGroupItem[] = [
	{ value: "silent", label: "Silent", description: "Nothing from the living room." },
	{ value: "quieter", label: "Quieter", description: "The music, very faint." },
	{ value: "muffled", label: "Muffled", description: "Very faint, with a low rumble over it." },
];
</script>

<template>
	<div class="flex flex-col items-start gap-2">
		<p class="text-xs tracking-widest text-muted uppercase">Your door</p>
		<div class="flex items-center gap-1">
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

			<UPopover :content="{ align: 'start' }">
				<UTooltip text="How the radio sounds through your door (just you)">
					<UButton icon="i-pixelarticons-headphone" aria-label="Door sound settings" color="neutral" variant="ghost" />
				</UTooltip>
				<template #content>
					<div class="flex w-72 flex-col gap-4 p-4">
						<URadioGroup v-model="sound.ajar" legend="When your door is ajar" :items="ajarChoices" size="sm" />
						<URadioGroup v-model="sound.closed" legend="When your door is closed" :items="closedChoices" size="sm" />
						<p class="text-xs text-dimmed">Only you hear this. Muffled can't filter YouTube's sound, so it lays a quiet rumble over the music instead.</p>
					</div>
				</template>
			</UPopover>
		</div>
	</div>
</template>
