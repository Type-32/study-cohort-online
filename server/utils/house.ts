import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { publish } from '#server/utils/bus'
import { presentMembers } from '#server/utils/presence'
import { nextRadio } from '#shared/utils/radio'
import type { RadioIntent, RadioState } from '#shared/utils/radio'
import type { HouseState, TimerState } from '#shared/utils/realtime'

const { houseState } = schema
type HouseRow = typeof houseState.$inferSelect

const timerOf = (row: HouseRow | undefined): TimerState =>
	row?.timerEndsAt && row.timerMinutes ? { endsAtServerMs: row.timerEndsAt.getTime(), minutes: row.timerMinutes } : null

const radioOf = (row: HouseRow | undefined): RadioState =>
	row?.radioVideoId && row.radioStartedAt
		? { videoId: row.radioVideoId, startedAtServerMs: row.radioStartedAt.getTime(), pausedAtServerMs: row.radioPausedAt?.getTime() ?? null }
		: null

/** Starts (`minutes`) or stops (`null`) the shared focus timer. The server never ticks; it ends on its own. */
export async function setTimer(minutes: number | null) {
	const timer: TimerState = minutes ? { endsAtServerMs: Date.now() + minutes * 60_000, minutes } : null
	const values = { timerEndsAt: timer && new Date(timer.endsAtServerMs), timerMinutes: timer?.minutes ?? null }
	await db.insert(houseState).values({ id: 1, ...values }).onConflictDoUpdate({ target: houseState.id, set: values })
	await publish({ t: 'timer', timer })
}

/** Applies a radio intent under a row lock (pause and resume read the current state) and broadcasts the result. */
export async function applyRadio(intent: RadioIntent) {
	const radio = await db.transaction(async (tx) => {
		await tx.insert(houseState).values({ id: 1 }).onConflictDoNothing()
		const [row] = await tx.select().from(houseState).where(eq(houseState.id, 1)).for('update')
		const current = radioOf(row)
		const next = nextRadio(current, intent, Date.now())
		if (next === current) return undefined
		await tx.update(houseState).set({
			radioVideoId: next?.videoId ?? null,
			radioStartedAt: next && new Date(next.startedAtServerMs),
			radioPausedAt: next?.pausedAtServerMs ? new Date(next.pausedAtServerMs) : null,
		}).where(eq(houseState.id, 1))
		return next
	})
	if (radio !== undefined) await publish({ t: 'radio', radio })
}

export async function snapshot(): Promise<HouseState> {
	const [members, row] = await Promise.all([presentMembers(), db.query.houseState.findFirst()])
	return { members, timer: timerOf(row), radio: radioOf(row) }
}
