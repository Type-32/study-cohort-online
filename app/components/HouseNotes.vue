<script setup lang="ts">
import { NOTE_MAX_LENGTH } from "#shared/utils/realtime";
import type { Note } from "#shared/utils/realtime";
import { useAuthSession } from "~/composables/core/useAuthSession";

/**
 * Notes left on the table (step 11): the header's notes button and its slideover. Quiet by rule:
 * never a sound, a toast, or a panel that opens itself. A new note shows as a count on the button
 * in a break, a dot during focus, and nothing at all while your door is closed.
 */
const store = useHouseStore();
const { house, confirmed, clockOffsetMs, myDoor } = storeToRefs(store);
const { user } = useAuthSession();
const { running } = useTimerView(computed(() => house.value.timer), clockOffsetMs);
const { mutateAsync: send } = useHouseIntent();

const open = ref(false);
/** When the newest note you've seen was sent (server time). Per browser. */
const readUpTo = useLocalStorage("house:notes-read", 0, { initOnMounted: true });
const unread = computed(() => house.value.notes.filter((n) => n.userId !== user.value?.id && n.createdAtServerMs > readUpTo.value).length);
watchEffect(() => {
	const newest = house.value.notes.at(-1);
	if (open.value && newest && newest.createdAtServerMs > readUpTo.value) readUpTo.value = newest.createdAtServerMs;
});
const badge = computed(() => (!unread.value || myDoor.value === "closed" ? undefined : running.value ? "dot" : "count"));
const label = computed(() => (badge.value === "count" ? `Notes, ${unread.value} new` : badge.value === "dot" ? "Notes, new ones waiting" : "Notes"));

const mine = (note: Note) => note.userId === user.value?.id;
/** Still on its way: shown faded until the house confirms it. */
const sent = (note: Note) => confirmed.value.notes.some((n) => n.id === note.id);
const time = (note: Note) => new Date(note.createdAtServerMs - clockOffsetMs.value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const chat = useTemplateRef("chat");
/**
 * Instant, not smooth: a smooth scroll stops short when the list grows while it runs. Also once the
 * slideover has finished opening: the list's own scroll on mount runs mid-animation and stops short.
 */
const toNewest = () => nextTick(() => chat.value?.scrollToBottom(false));
// Someone else's note keeps the list at the bottom if you were there; your own always does.
watch(() => house.value.notes.length, (length, before) => {
	if (length > before && chat.value?.isAtBottom) toNewest();
});

const text = ref("");
const length = computed(() => text.value.trim().length);
function leave() {
	const note = text.value.trim();
	if (!note || note.length > NOTE_MAX_LENGTH) return;
	text.value = "";
	toNewest();
	// Refused (too fast, or the house didn't answer): the note comes back to the box to send again.
	send({ t: "note", noteId: newId(), text: note }).catch(() => (text.value ||= note));
}
</script>

<template>
	<USlideover
		v-model:open="open"
		title="Notes"
		:description="running ? 'Focus is on. Notes stay quiet for everyone: a dot, no count, no sound.' : 'Left on the table for 24 hours. Plain text.'"
		:ui="{ body: 'flex flex-col' }"
		@after:enter="toNewest"
	>
		<UTooltip :text="label">
			<UChip :show="!!badge" :text="badge === 'count' ? unread : undefined" :size="badge === 'count' ? '3xl' : 'md'" inset>
				<UButton icon="i-pixelarticons-message-text" :aria-label="label" color="neutral" variant="ghost" />
			</UChip>
		</UTooltip>

		<template #body>
			<p v-if="!house.notes.length" class="m-auto max-w-60 text-center text-sm text-muted">No notes on the table. Leave one; it stays for 24 hours.</p>
			<UChatMessages v-else ref="chat" :auto-scroll="{ color: 'neutral', variant: 'outline', label: 'Newest' }">
				<UChatMessage
					v-for="note in house.notes"
					:id="note.id"
					:key="note.id"
					:role="mine(note) ? 'user' : 'assistant'"
					:parts="[{ type: 'text', text: note.text }]"
					:side="mine(note) ? 'right' : 'left'"
					:variant="mine(note) ? 'soft' : 'outline'"
					:avatar="mine(note) ? undefined : { alt: note.username }"
					:class="!sent(note) && 'opacity-60'"
				>
					<template #header>
						<span class="text-xs text-muted" :class="mine(note) && 'ms-auto'">{{ mine(note) ? time(note) : `${note.username} · ${time(note)}` }}</span>
					</template>
				</UChatMessage>
			</UChatMessages>
		</template>

		<template #footer>
			<UChatPrompt
				v-model="text"
				:placeholder="running ? 'Leave a quiet note…' : 'Leave a note…'"
				variant="subtle"
				:maxrows="5"
				aria-label="Your note"
				class="w-full"
				@submit="leave"
			>
				<template #footer>
					<span class="text-xs tabular-nums" :class="length > NOTE_MAX_LENGTH ? 'text-error' : 'text-dimmed'">{{ length }}/{{ NOTE_MAX_LENGTH }}</span>
					<UTooltip :text="length > NOTE_MAX_LENGTH ? `Too long: ${NOTE_MAX_LENGTH} characters at most` : 'Leave the note (Enter)'">
						<UButton type="submit" icon="i-pixelarticons-mail-arrow-right" aria-label="Leave the note" class="ms-auto min-h-11 min-w-11 justify-center" :disabled="!length || length > NOTE_MAX_LENGTH" />
					</UTooltip>
				</template>
			</UChatPrompt>
		</template>
	</USlideover>
</template>
