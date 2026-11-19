import { db, schema } from '@nuxthub/db'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { publish } from '#server/utils/bus'
import { PING_INTERVAL_MS } from '#shared/utils/realtime'
import type { HouseState, MemberState } from '#shared/utils/realtime'

const { connection, user } = schema

// A connection counts as present while it pinged within the last 3 intervals.
const fresh = () => gt(connection.lastSeenAt, sql`now() - make_interval(secs => ${(PING_INTERVAL_MS * 3) / 1000})`)

/** Registers a socket and announces its member. */
export async function connect(connectionId: string, member: MemberState) {
	// Sweep rows left behind by instances that died without running `close`.
	await db.delete(connection).where(lt(connection.lastSeenAt, sql`now() - interval '1 hour'`))
	await db.insert(connection).values({ id: connectionId, userId: member.userId })
	await publish({ t: 'member', member })
}

export async function touch(connectionId: string) {
	await db.update(connection).set({ lastSeenAt: sql`now()` }).where(eq(connection.id, connectionId))
}

/** Removes a socket; announces `leave` only when the member has no other live socket (another tab, device). */
export async function disconnect(connectionId: string, userId: string) {
	await db.delete(connection).where(eq(connection.id, connectionId))
	const other = await db.query.connection.findFirst({
		columns: { id: true },
		where: and(eq(connection.userId, userId), fresh()),
	})
	if (!other) await publish({ t: 'leave', userId })
}

export async function snapshot(): Promise<HouseState> {
	const members = await db.selectDistinct({ userId: user.id, username: user.username })
		.from(connection)
		.innerJoin(user, eq(user.id, connection.userId))
		.where(fresh())
	return { members }
}
