import { db, schema } from '@nuxthub/db'
import { publish } from '#server/utils/bus'
import { presentMembers } from '#server/utils/presence'
import type { HouseState, TimerState } from '#shared/utils/realtime'

const { houseState } = schema

async function readTimer(): Promise<TimerState> {
	const row = await db.query.houseState.findFirst()
	return row?.timerEndsAt && row.timerMinutes
		? { endsAtServerMs: row.timerEndsAt.getTime(), minutes: row.timerMinutes }
		: null
}

/** Starts (`minutes`) or stops (`null`) the shared focus timer. The server never ticks; it ends on its own. */
export async function setTimer(minutes: number | null) {
	const timer: TimerState = minutes ? { endsAtServerMs: Date.now() + minutes * 60_000, minutes } : null
	const values = { timerEndsAt: timer && new Date(timer.endsAtServerMs), timerMinutes: timer?.minutes ?? null }
	await db.insert(houseState).values({ id: 1, ...values }).onConflictDoUpdate({ target: houseState.id, set: values })
	await publish({ t: 'timer', timer })
}

export async function snapshot(): Promise<HouseState> {
	const [members, timer] = await Promise.all([presentMembers(), readTimer()])
	return { members, timer }
}
