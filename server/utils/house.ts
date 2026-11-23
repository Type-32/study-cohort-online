import { db, schema } from '@nuxthub/db'
import { publish } from '#server/utils/bus'
import { presentMembers } from '#server/utils/presence'
import { recentNotes } from '#server/utils/notes'
import { loadShelf, radioOf } from '#server/utils/radioQueue'
import type { HouseState, TimerState } from '#shared/utils/realtime'

const { houseState } = schema
type HouseRow = typeof houseState.$inferSelect

const timerOf = (row: HouseRow | undefined): TimerState =>
	row?.timerEndsAt && row.timerMinutes ? { endsAtServerMs: row.timerEndsAt.getTime(), minutes: row.timerMinutes } : null

/** Starts (`minutes`) or stops (`null`) the shared focus timer. The server never ticks; it ends on its own. */
export async function setTimer(minutes: number | null, intent?: string) {
	const timer: TimerState = minutes ? { endsAtServerMs: Date.now() + minutes * 60_000, minutes } : null
	const values = { timerEndsAt: timer && new Date(timer.endsAtServerMs), timerMinutes: timer?.minutes ?? null }
	await db.transaction(async (tx) => {
		await tx.insert(houseState).values({ id: 1, ...values }).onConflictDoUpdate({ target: houseState.id, set: values })
		await publish({ t: 'timer', timer, intent }, { tx })
	})
}

export async function snapshot(): Promise<HouseState> {
	const [members, row, suggestions, notes] = await Promise.all([presentMembers(), db.query.houseState.findFirst(), loadShelf(), recentNotes()])
	return { members, timer: timerOf(row), radio: radioOf(row), suggestions, radioWhenEmpty: row?.radioWhenEmpty ?? 'stop', notes }
}
