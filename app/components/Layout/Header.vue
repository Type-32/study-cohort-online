<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { useAuthSession } from "~/composables/core/useAuthSession";

/**
 * The header, split into floating pills: the house name, a live status pill (home page only, while
 * the timer or the member list is scrolled away) and the controls. Each pill has a grip; drag it
 * toward any edge and it settles into the nearest of six anchors, animating into place. Placement
 * is remembered per browser.
 */

const ANCHORS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;
type Anchor = (typeof ANCHORS)[number];
type Pill = "brand" | "status" | "controls";

const zoneClass: Record<Anchor, string> = {
	"top-left": "top-3 left-3 justify-start",
	"top-center": "top-3 inset-x-0 justify-center",
	"top-right": "top-3 right-3 justify-end",
	"bottom-left": "bottom-3 left-3 justify-start",
	"bottom-center": "bottom-3 inset-x-0 justify-center",
	"bottom-right": "bottom-3 right-3 justify-end",
};

const placement = useLocalStorage<Record<Pill, Anchor>>(
	"house:dock",
	{ brand: "top-left", status: "top-center", controls: "top-right" },
	{ initOnMounted: true, mergeDefaults: true },
);

const $as = useAuthSession();
const $rc = useRuntimeConfig();
const { copyLink, createLink } = useInviteLinks();
const user = computed(() => $as.user.value);
const signingOut = ref(false);

// Live status, written by the home page.
const { house, clockOffsetMs } = useHouseState();
const offscreen = useState("house:offscreen", () => ({ timer: false, members: false }));
const { running, countdown, phase } = useTimerView(computed(() => house.value.timer), clockOffsetMs);

const visiblePills = computed<Pill[]>(() => [
	"brand",
	...(offscreen.value.timer || offscreen.value.members ? (["status"] as const) : []),
	"controls",
]);
const pillsAt = (anchor: Anchor) => visiblePills.value.filter((pill) => placement.value[pill] === anchor);

const drag: Record<Pill, ReturnType<typeof useDragControls>> = {
	brand: useDragControls(),
	status: useDragControls(),
	controls: useDragControls(),
};

/** Drops a pill on the anchor nearest to where the pointer let go: thirds across, halves down. */
function drop(pill: Pill, event: PointerEvent) {
	const column = event.clientX < innerWidth / 3 ? "left" : event.clientX > (innerWidth * 2) / 3 ? "right" : "center";
	const row = event.clientY < innerHeight / 2 ? "top" : "bottom";
	placement.value = { ...placement.value, [pill]: `${row}-${column}` as Anchor };
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

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
	<header>
		<LayoutGroup>
			<div v-for="anchor in ANCHORS" :key="anchor" class="pointer-events-none fixed z-50 flex gap-2" :class="zoneClass[anchor]">
				<AnimatePresence>
					<Motion
						v-for="pill in pillsAt(anchor)"
						:key="pill"
						:layout-id="`dock-${pill}`"
						layout
						drag
						:drag-controls="drag[pill]"
						:drag-listener="false"
						:drag-momentum="false"
						drag-snap-to-origin
						:while-drag="{ scale: 1.04 }"
						:initial="{ opacity: 0, scale: 0.9 }"
						:animate="{ opacity: 1, scale: 1 }"
						:exit="{ opacity: 0, scale: 0.9 }"
						:transition="{ type: 'spring', stiffness: 420, damping: 34 }"
						class="pointer-events-auto flex h-11 items-center gap-0.5 rounded-full bg-elevated/80 pr-1.5 pl-1 shadow-lg ring-1 ring-default/50 backdrop-blur-md"
						@drag-end="(event: PointerEvent) => drop(pill, event)"
					>
						<UTooltip text="Drag to move">
							<button
								type="button"
								class="flex h-8 w-4 cursor-grab touch-none items-center justify-center text-dimmed hover:text-muted active:cursor-grabbing"
								:aria-label="`Move the ${pill} pill`"
								@pointerdown="(event: PointerEvent) => drag[pill].start(event)"
							>
								<UIcon name="i-pixelarticons-more-vertical" class="size-4" />
							</button>
						</UTooltip>

						<NuxtLink v-if="pill === 'brand'" to="/" class="flex items-center gap-1.5 pr-2 font-serif text-base font-semibold text-highlighted">
							<UIcon name="i-pixelarticons-lightbulb-on" class="size-5 text-primary" />
							<span class="hidden sm:inline">{{ $rc.public.siteName || "Study House" }}</span>
						</NuxtLink>

						<template v-else-if="pill === 'status'">
							<UTooltip text="Back to the timer">
								<UButton
									:icon="phase.icon"
									:label="running ? countdown : phase.label"
									color="neutral"
									variant="ghost"
									class="font-mono tabular-nums"
									:class="phase.class"
									@click="scrollTo('focus-timer')"
								/>
							</UTooltip>
							<UTooltip v-if="offscreen.members && house.members.length" :text="house.members.map((m) => m.username).join(', ')">
								<button type="button" class="px-1.5" aria-label="Back to who's in the house" @click="scrollTo('in-the-house')">
									<UAvatarGroup size="xs" :max="4">
										<UAvatar v-for="member in house.members" :key="member.userId" :alt="member.username" />
									</UAvatarGroup>
								</button>
							</UTooltip>
						</template>

						<template v-else>
							<UTooltip text="Light or dark">
								<UColorModeButton color="neutral" variant="ghost" />
							</UTooltip>
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
					</Motion>
				</AnimatePresence>
			</div>
		</LayoutGroup>
	</header>
</template>
