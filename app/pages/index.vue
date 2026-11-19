<script setup lang="ts">
useHead({ title: "Home" });

definePageMeta({
	middleware: ["signin-if-session-invalid"],
});

const { house, status, clockOffsetMs, sendIntent } = useHouse();
// The socket opens after hydration; until the first snapshot there is nothing true to show.
const connected = computed(() => status.value === "OPEN");
const now = useNow({ interval: 1000 });
const focusing = computed(() => !!house.value.timer && house.value.timer.endsAtServerMs > now.value.getTime() + clockOffsetMs.value);
const { enabled: keepAwake } = useKeepAwake();
</script>

<template>
	<UMain>
		<UContainer class="flex max-w-3xl flex-col gap-10 py-10">
			<FocusTimer
				:timer="house.timer"
				:clock-offset-ms="clockOffsetMs"
				@start="(minutes) => sendIntent({ t: 'timer', action: 'start', minutes })"
				@stop="sendIntent({ t: 'timer', action: 'stop' })"
			/>

			<HouseRadio
				:radio="house.radio"
				:clock-offset-ms="clockOffsetMs"
				@intent="(intent) => sendIntent({ t: 'radio', ...intent })"
			/>

			<section class="flex flex-col gap-4" aria-labelledby="in-the-house">
				<div class="flex items-center gap-2">
					<h2 id="in-the-house" class="text-lg font-semibold text-highlighted">In the house</h2>
					<UBadge v-if="connected" :label="String(house.members.length)" color="neutral" variant="subtle" size="sm" />
					<UBadge
						v-else
						label="Connecting"
						icon="i-pixelarticons-loader"
						color="warning"
						variant="subtle"
						size="sm"
						:ui="{ leadingIcon: 'animate-spin' }"
					/>
				</div>

				<div v-if="!connected && !house.members.length" class="grid gap-3 sm:grid-cols-2">
					<USkeleton v-for="n in 2" :key="n" class="h-12" />
				</div>
				<ul v-else class="grid gap-3 sm:grid-cols-2">
					<li v-for="member in house.members" :key="member.userId" class="rounded-lg border border-default p-3">
						<UUser
							:name="member.username"
							:description="focusing ? 'Focusing' : 'Here now'"
							:avatar="{ alt: member.username }"
							:chip="{ color: 'success', position: 'bottom-right' }"
						/>
					</li>
				</ul>
			</section>

			<USwitch
				v-model="keepAwake"
				label="Keep this tab awake"
				:description="keepAwake
					? 'Your browser won\'t put this tab to sleep, so you stay in the house and the radio keeps playing in the background.'
					: 'Saves a little battery, but your browser may put this tab to sleep: you\'ll drop out of the house and the radio will pause until you come back.'"
			/>
		</UContainer>
	</UMain>
</template>
