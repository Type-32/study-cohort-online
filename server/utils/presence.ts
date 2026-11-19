import { db, schema } from '@nuxthub/db'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { publish } from '#server/utils/bus'
import { PING_INTERVAL_MS } from '#shared/utils/realtime'
import type { Door, MemberState } from '#shared/utils/realtime'

const { connection, memberState, user } = schema

type Member = { id: string; username: string }

// A connection counts as present while it pinged within the last 3 intervals.
const fresh = () => gt(connection.lastSeenAt, sql`now() - make_interval(secs => ${(PING_INTERVAL_MS * 3) / 1000})`)

async function doorOf(userId: string): Promise<Door> {
	const row = await db.query.memberState.findFirst({ columns: { door: true }, where: eq(memberState.userId, userId) })
	return row?.door ?? 'open'
}

/** Registers a socket and announces its member. */
export async function connect(connectionId: string, member: Member) {
	// Sweep rows left behind by instances that died without running `close`.
	await db.delete(connection).where(lt(connection.lastSeenAt, sql`now() - interval '1 hour'`))
	await db.insert(connection).values({ id: connectionId, userId: member.id })
	await publish({ t: 'member', member: { userId: member.id, username: member.username, door: await doorOf(member.id) } })
}

export async function touch(connectionId: string) {
	await db.update(connection).set({ lastSeenAt: sql`now()` }).where(eq(connection.id, connectionId))
}

/**
 * Removes a socket; announces `leave` only when the member has no other live socket (another tab,
 * device, or the reconnect that replaces this one). The check and the notify are one statement: a
 * separate check could run before the new socket registers and send `leave` after it announced itself.
 */
export async function disconnect(connectionId: string, userId: string) {
	await db.delete(connection).where(eq(connection.id, connectionId))
	await publish({ t: 'leave', userId }, {
		unless: db.select({ id: connection.id }).from(connection).where(and(eq(connection.userId, userId), fresh())).getSQL(),
	})
}

/** Sets a member's door and announces it. The door is durable: it stays as left across visits. */
export async function setDoor(member: Member, door: Door, intent?: string) {
	await db.transaction(async (tx) => {
		await tx.insert(memberState).values({ userId: member.id, door }).onConflictDoUpdate({ target: memberState.userId, set: { door } })
		await publish({ t: 'member', member: { userId: member.id, username: member.username, door }, intent }, { tx })
	})
}

export async function presentMembers(): Promise<MemberState[]> {
	return db.selectDistinct({ userId: user.id, username: user.username, door: sql<Door>`coalesce(${memberState.door}, 'open')` })
		.from(connection)
		.innerJoin(user, eq(user.id, connection.userId))
		.leftJoin(memberState, eq(memberState.userId, user.id))
		.where(fresh())
}
