<script setup lang="ts">
import { formatFrequency } from "#shared/utils/radio";
import type { Station } from "#shared/utils/radio";

/**
 * Every station, searchable: the dial is for a glance, finding one track among two hundred needs
 * search. Choosing a row moves the needle there. The host and moderators can remove a station.
 */
const props = defineProps<{ stations: Station[]; onAirVideoId?: string; canRemove: boolean; keyClass: string }>();
const emit = defineEmits<{ choose: [station: number] }>();

const open = ref(false);
const search = ref("");
const shown = computed(() => {
	const q = search.value.trim().toLowerCase();
	return q ? props.stations.filter((s) => `${formatFrequency(s.station)} ${s.title ?? ""}`.toLowerCase().includes(q)) : props.stations;
});
function choose(station: number) {
	emit("choose", station);
	open.value = false;
	search.value = "";
}

// Optimistic: the row (and the dial's tick) disappears on click. If the server refuses, the list is reloaded.
const queryCache = useQueryCache();
const toast = useToast();
const { mutate: remove } = useMutation({
	mutation: (videoId: string) => $fetch<unknown>(`/api/v1/radio/stations/${encodeURIComponent(videoId)}` as string, { method: "DELETE" }),
	onMutate(videoId) {
		queryCache.cancelQueries({ key: ["radio-stations"] });
		queryCache.setQueryData<Station[]>(["radio-stations"], (list = []) => list.filter((s) => s.videoId !== videoId));
	},
	onError(error) {
		queryCache.invalidateQueries({ key: ["radio-stations"] });
		toast.add({ title: "Could not remove the station", description: fetchErrorMessage(error), color: "error", icon: "i-pixelarticons-alert" });
	},
});
</script>

<template>
	<UModal v-model:open="open" title="Stations" :description="`Every track the house has played (${stations.length}). Choose one to tune to it.`">
		<UTooltip text="Station list: search every track the house has played">
			<Motion as-child :while-press="{ scale: 0.94, y: 1 }">
				<UButton icon="i-pixelarticons-list" aria-label="Station list" color="neutral" variant="ghost" :class="keyClass" />
			</Motion>
		</UTooltip>
		<template #body>
			<UInput v-model="search" icon="i-pixelarticons-search" placeholder="Search by title or frequency" aria-label="Search stations" class="w-full" autofocus />
			<ul v-if="shown.length" class="mt-3 flex max-h-96 flex-col overflow-y-auto">
				<li v-for="s in shown" :key="s.videoId" class="flex items-center gap-1">
					<UButton color="neutral" variant="ghost" class="min-h-11 min-w-0 flex-1 gap-3" @click="choose(s.station)">
						<span class="w-18 shrink-0 font-mono text-xs text-muted">{{ formatFrequency(s.station) }}</span>
						<span class="min-w-0 flex-1 truncate text-left">{{ s.title ?? "Untitled track" }}</span>
						<UBadge v-if="s.videoId === onAirVideoId" label="On air" variant="soft" size="sm" />
						<UBadge v-else-if="s.unplayable" label="No signal" color="error" variant="soft" size="sm" />
						<span class="shrink-0 font-mono text-xs text-muted" :aria-label="`played ${s.plays} times`">{{ s.plays }}×</span>
					</UButton>
					<UTooltip v-if="canRemove" :text="s.videoId === onAirVideoId ? 'On air: skip it first' : 'Remove from the dial. If it plays again it gets a new station.'">
						<UButton
							icon="i-pixelarticons-trash"
							:aria-label="`Remove ${s.title ?? 'this station'}`"
							color="neutral"
							variant="ghost"
							class="min-h-11 min-w-11 justify-center"
							:disabled="s.videoId === onAirVideoId"
							@click="remove(s.videoId)"
						/>
					</UTooltip>
				</li>
			</ul>
			<p v-else class="mt-3 text-sm text-muted">{{ stations.length ? "No station matches." : "No stations yet. Every track that goes on air becomes one." }}</p>
		</template>
	</UModal>
</template>
