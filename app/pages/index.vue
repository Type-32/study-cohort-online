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

/** Sections rise in one after another on first paint. */
const enter = (index: number) => ({
	initial: { opacity: 0, y: 12 },
	animate: { opacity: 1, y: 0 },
	transition: { duration: 0.45, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] as const },
});
</script>

<template>
	<UMain>
		<UContainer class="flex max-w-2xl flex-col gap-20 pt-10 pb-16 sm:pt-16">
			<Motion v-bind="enter(0)">
				<FocusTimer
					:timer="house.timer"
					:clock-offset-ms="clockOffsetMs"
					@start="(minutes) => sendIntent({ t: 'timer', action: 'start', minutes })"
					@stop="sendIntent({ t: 'timer', action: 'stop' })"
				/>
			</Motion>

			<Motion v-bind="enter(1)" as="section" class="flex flex-col gap-4" aria-labelledby="in-the-house">
				<p id="in-the-house" class="flex items-center gap-2 text-xs tracking-widest text-muted uppercase">
					In the house
					<span v-if="connected">· {{ house.members.length }}</span>
					<UIcon v-else name="i-pixelarticons-loader" class="size-3.5 animate-spin" aria-label="Connecting" />
				</p>

				<div v-if="!connected && !house.members.length" class="flex gap-6">
					<USkeleton v-for="n in 2" :key="n" class="h-10 w-32" />
				</div>
				<AnimatePresence v-else as="ul" class="flex flex-wrap gap-x-8 gap-y-4">
					<Motion
						v-for="member in house.members"
						:key="member.userId"
						as="li"
						layout
						:initial="{ opacity: 0, scale: 0.9 }"
						:animate="{ opacity: 1, scale: 1 }"
						:exit="{ opacity: 0, scale: 0.9 }"
						:transition="{ duration: 0.25 }"
					>
						<UUser
							:name="member.username"
							:description="focusing ? 'Focusing' : 'Here now'"
							:avatar="{ alt: member.username }"
							:chip="{ color: 'success', position: 'bottom-right' }"
						/>
					</Motion>
				</AnimatePresence>
			</Motion>

			<Motion v-bind="enter(2)">
				<HouseRadio
					:radio="house.radio"
					:clock-offset-ms="clockOffsetMs"
					@intent="(intent) => sendIntent({ t: 'radio', ...intent })"
				/>
			</Motion>

			<Motion v-bind="enter(3)">
				<USwitch
					v-model="keepAwake"
					size="sm"
					label="Keep this tab awake"
					:description="keepAwake
						? 'Your browser won\'t put this tab to sleep, so you stay in the house and the radio keeps playing in the background.'
						: 'Saves a little battery, but your browser may put this tab to sleep: you\'ll drop out of the house and the radio will pause until you come back.'"
					:ui="{ label: 'text-muted', description: 'text-dimmed' }"
				/>
			</Motion>
		</UContainer>
	</UMain>
</template>
