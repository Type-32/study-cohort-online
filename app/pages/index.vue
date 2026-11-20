<script setup lang="ts">
useHead({ title: "Home" });

definePageMeta({
	middleware: ["signin-if-session-invalid"],
});

const houseStore = useHouseStore();
const { house, status, clockOffsetMs, loaded } = storeToRefs(houseStore);
// The socket is this page's: open while it's shown, closed when you leave it.
onMounted(houseStore.connect);
onBeforeUnmount(houseStore.disconnect);
const connected = computed(() => status.value === "OPEN");
const now = useNow({ interval: 1000 });
const focusing = computed(() => !!house.value.timer && house.value.timer.endsAtServerMs > now.value.getTime() + clockOffsetMs.value);

/** How each door reads from the hall. Nobody is ever invisible, only further away. */
const doorLook = computed(() => ({
	open: { opacity: 1, label: focusing.value ? "Focusing at their desk" : "At their desk", chip: "success" as const },
	ajar: { opacity: 0.7, label: "Lamp on", chip: "warning" as const },
	closed: { opacity: 0.45, label: "Light under the door", chip: "neutral" as const },
}));
const { enabled: keepAwake } = useKeepAwake();

// The page stays behind a loading screen until it shows the house as it is: the first snapshot
// (timer, members) and, if the radio is on, the player showing the real state. Capped at 8s so a
// slow YouTube never keeps anyone out.
const radioSettled = ref(false);
const { ready: waitedLongEnough } = useTimeout(8000, { controls: true });
const ready = computed(() => (loaded.value && (!house.value.radio || radioSettled.value)) || waitedLongEnough.value);

// The header's status pill appears when the timer or the member list is scrolled out of view.
const timerEl = useTemplateRef<HTMLElement>("timerEl");
const membersEl = useTemplateRef<HTMLElement>("membersEl");
const timerVisible = useElementVisibility(timerEl);
const membersVisible = useElementVisibility(membersEl);
const offscreen = useState("house:offscreen", () => ({ timer: false, members: false }));
watchEffect(() => {
	offscreen.value = { timer: ready.value && !timerVisible.value, members: ready.value && !membersVisible.value };
});
onBeforeUnmount(() => (offscreen.value = { timer: false, members: false }));

/** Sections rise in one after another once the loading screen lifts. */
const enter = (index: number) => ({
	initial: { opacity: 0, y: 12 },
	animate: ready.value ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 },
	transition: { duration: 0.45, delay: 0.1 + index * 0.08, ease: [0.22, 1, 0.36, 1] as const },
});
</script>

<template>
	<UMain>
		<AnimatePresence>
			<Motion
				v-if="!ready"
				key="loading"
				class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-default"
				role="status"
				:initial="false"
				:exit="{ opacity: 0 }"
				:transition="{ duration: 0.35 }"
			>
				<Motion
					:animate="{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }"
					:transition="{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }"
				>
					<UIcon name="i-pixelarticons-lightbulb-on" class="size-10 text-primary" />
				</Motion>
				<p class="text-sm text-muted">{{ loaded ? "Tuning in to the radio…" : "Opening the house…" }}</p>
			</Motion>
		</AnimatePresence>

		<UContainer class="flex max-w-2xl flex-col gap-20 pt-24 pb-24">
			<Motion v-bind="enter(0)">
				<div ref="timerEl">
					<FocusTimer />
				</div>
			</Motion>

			<Motion v-bind="enter(1)" as="section" class="flex flex-col gap-4" aria-labelledby="in-the-house">
				<div ref="membersEl" class="flex flex-col gap-4">
					<p id="in-the-house" class="flex scroll-mt-24 items-center gap-2 text-xs tracking-widest text-muted uppercase">
						In the house
						<span v-if="connected">· {{ house.members.length }}</span>
						<UIcon v-else name="i-pixelarticons-loader" class="size-3.5 animate-spin" aria-label="Reconnecting" />
					</p>

					<AnimatePresence as="ul" class="flex flex-wrap gap-x-8 gap-y-4">
						<Motion
							v-for="member in house.members"
							:key="member.userId"
							as="li"
							layout
							:initial="{ opacity: 0, scale: 0.9 }"
							:animate="{ opacity: doorLook[member.door].opacity, scale: 1 }"
							:exit="{ opacity: 0, scale: 0.9 }"
							:transition="{ duration: 0.25 }"
						>
							<UUser
								:name="member.username"
								:description="doorLook[member.door].label"
								:avatar="{ alt: member.username }"
								:chip="{ color: doorLook[member.door].chip, position: 'bottom-right' }"
							/>
						</Motion>
					</AnimatePresence>

					<DoorSwitch />
				</div>
			</Motion>

			<Motion v-bind="enter(2)">
				<HouseRadio @settled="radioSettled = true" />
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
