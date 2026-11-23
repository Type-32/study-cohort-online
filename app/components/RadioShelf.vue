<script setup lang="ts">
import { shelfOrder, youtubeThumbnail } from "#shared/utils/radio";
import type { Suggestion } from "#shared/utils/radio";
import { satisfies } from "#shared/utils/roles";
import { useAuthSession } from "~/composables/core/useAuthSession";

/**
 * The shelf beside the radio: one cassette per track, in the order they'll play. The host's queue
 * comes first, numbered; members' suggestions follow, oldest first. The host and moderators play,
 * order and remove anything; members withdraw their own.
 */
const { house } = storeToRefs(useHouseStore());
const { user } = useAuthSession();
const isHost = computed(() => !!user.value && satisfies(user.value, { minRole: "moderator" }));
const { mutate: sendIntent } = useHouseIntent();

const cassettes = computed(() => {
	const { queued, waiting } = shelfOrder(house.value.suggestions);
	return [...queued.map((s, i) => ({ s, label: `Next ${i + 1}`, queued: true, first: i === 0 })), ...waiting.map((s) => ({ s, label: "Suggested", queued: false, first: false }))];
});
const mine = (s: Suggestion) => s.userId === user.value?.id;
</script>

<template>
	<section class="flex flex-col gap-2" aria-label="The shelf: up next and suggestions">
		<p class="text-xs tracking-widest text-muted uppercase">
			Shelf<template v-if="cassettes.length"> · {{ cassettes.length }}</template>
		</p>
		<p v-if="!cassettes.length" class="text-sm text-muted">
			{{ isHost ? "Empty. Members' suggestions land here, and you can queue your own." : "Empty. Insert a link in the radio's slot to suggest a track." }}
		</p>
		<!-- Scrolls sideways; at 390 px about one and a half cassettes show, hinting there's more. -->
		<AnimatePresence v-else as="ul" class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
			<Motion
				v-for="c in cassettes"
				:key="c.s.id"
				as="li"
				layout
				class="flex w-52 shrink-0 snap-start flex-col gap-1.5 rounded-lg bg-(--radio-body) p-2 ring-1 ring-(--radio-trim)"
				:initial="{ opacity: 0, y: 8 }"
				:animate="{ opacity: 1, y: 0 }"
				:exit="{ opacity: 0, scale: 0.9 }"
				:transition="{ duration: 0.2 }"
			>
				<div class="relative">
					<!-- A band's cover is its first track; its badge says how many tracks it holds. -->
					<img v-if="c.s.videoId ?? c.s.band?.cover" :src="youtubeThumbnail((c.s.videoId ?? c.s.band?.cover)!)" alt="" loading="lazy" class="aspect-video w-full rounded-md bg-elevated object-cover" />
					<div v-else class="aspect-video w-full rounded-md bg-elevated" />
					<span
						class="absolute top-1 left-1 rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase"
						:class="c.queued ? 'bg-primary text-inverted' : 'bg-default text-muted'"
					>{{ c.label }}</span>
					<span v-if="c.s.band" class="absolute right-1 bottom-1 rounded bg-default px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-highlighted uppercase">
						Band{{ c.s.band.length ? ` · ${c.s.band.length}` : "" }}
					</span>
				</div>
				<p class="line-clamp-2 min-h-8 text-xs text-highlighted" :title="c.s.title ?? undefined">{{ c.s.title ?? (c.s.band ? "Untitled band" : "Untitled track") }}</p>
				<p class="truncate text-[11px] text-muted">
					{{ mine(c.s) ? "From you" : `From ${c.s.username}` }}<template v-if="!c.s.title && !c.s.band"> · may not play here</template>
				</p>
				<div v-if="isHost || mine(c.s)" class="flex items-center">
					<template v-if="isHost">
						<UTooltip text="Play now, for everyone">
							<UButton icon="i-pixelarticons-play" :aria-label="`Play ${c.s.title ?? 'this track'} now`" color="neutral" variant="ghost" class="min-h-11 min-w-11 justify-center" @click="sendIntent({ t: 'radio', action: 'playSuggestion', suggestionId: c.s.id })" />
						</UTooltip>
						<UTooltip v-if="!c.first" text="Play next">
							<UButton icon="i-pixelarticons-next" aria-label="Play next" color="neutral" variant="ghost" class="min-h-11 min-w-11 justify-center" @click="sendIntent({ t: 'queue', suggestionId: c.s.id, to: 'next' })" />
						</UTooltip>
						<UTooltip v-if="!c.queued" text="Add to the end of the queue">
							<UButton icon="i-pixelarticons-playlist" aria-label="Add to the end of the queue" color="neutral" variant="ghost" class="min-h-11 min-w-11 justify-center" @click="sendIntent({ t: 'queue', suggestionId: c.s.id, to: 'last' })" />
						</UTooltip>
						<UTooltip v-else text="Take out of the queue (back to suggestions)">
							<UButton icon="i-pixelarticons-undo" aria-label="Take out of the queue" color="neutral" variant="ghost" class="min-h-11 min-w-11 justify-center" @click="sendIntent({ t: 'queue', suggestionId: c.s.id, to: 'off' })" />
						</UTooltip>
					</template>
					<UTooltip :text="mine(c.s) ? 'Withdraw your suggestion' : `Remove ${c.s.username}'s suggestion`">
						<UButton
							icon="i-pixelarticons-trash"
							:aria-label="mine(c.s) ? 'Withdraw' : 'Remove'"
							color="neutral"
							variant="ghost"
							class="ml-auto min-h-11 min-w-11 justify-center"
							@click="sendIntent({ t: 'unsuggest', suggestionId: c.s.id })"
						/>
					</UTooltip>
				</div>
			</Motion>
		</AnimatePresence>
	</section>
</template>
