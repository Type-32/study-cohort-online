import { db, schema } from '@nuxthub/db'
import { desc, eq, gt, lt } from 'drizzle-orm'
import { publish } from '#server/utils/bus'
import { NOTES_IN_SNAPSHOT, NOTE_TTL_MS } from '#shared/utils/realtime'
import type { Note } from '#shared/utils/realtime'
import type { User } from '#shared/types/db'

// Notes left on the table (plans/online-gathering-v1.md, step 11). Deleted 24 hours after they were
// sent without a scheduler: each insert deletes the older rows, the snapshot skips them, and each
// client drops a note from its list when it turns 24 hours old.

const { note, user } = schema

/** The newest notes younger than 24 hours, oldest first. */
export async function recentNotes(): Promise<Note[]> {
	const rows = await db.select({ id: note.id, userId: note.userId, username: user.username, text: note.text, createdAt: note.createdAt })
		.from(note)
		.innerJoin(user, eq(user.id, note.userId))
		.where(gt(note.createdAt, new Date(Date.now() - NOTE_TTL_MS)))
		.orderBy(desc(note.createdAt))
		.limit(NOTES_IN_SNAPSHOT)
	return rows.reverse().map(({ createdAt, ...rest }) => ({ ...rest, createdAtServerMs: createdAt.getTime() }))
}

export async function sendNote(member: User, n: { noteId: string; text: string }, intent?: string) {
	await db.transaction(async (tx) => {
		await tx.delete(note).where(lt(note.createdAt, new Date(Date.now() - NOTE_TTL_MS)))
		const [row] = await tx.insert(note).values({ id: n.noteId, userId: member.id, text: n.text }).returning()
		await publish({ t: 'note', note: { id: row!.id, userId: member.id, username: member.username, text: row!.text, createdAtServerMs: row!.createdAt.getTime() }, intent }, { tx })
	})
}
