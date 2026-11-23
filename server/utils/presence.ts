import { db, schema } from '@nuxthub/db'
import { and, eq, gt, lt, ne, sql } from 'drizzle-orm'
import { publish } from '#server/utils/bus'
import { HouseError } from '#server/utils/radioQueue'
import { resolveTheme } from '#server/utils/themes'
import { PING_INTERVAL_MS } from '#shared/utils/realtime'
import type { Door, MemberState } from '#shared/utils/realtime'

const { connection, memberState, user } = schema

type Member = { id: string; username: string }

// A connection counts as present while it pinged within the last 3 intervals.
const fresh = () => gt(connection.lastSeenAt, sql`now() - make_interval(secs => ${(PING_INTERVAL_MS * 3) / 1000})`)

async function stateOf(userId: string): Promise<{ door: Door; slot: string | null }> {
	const row = await db.query.memberState.findFirst({ columns: { door: true, slot: true }, where: eq(memberState.userId, userId) })
	return { door: row?.door ?? 'open', slot: row?.slot ?? null }
}

/** Registers a socket and announces its member. */
export async function connect(connectionId: string, member: Member) {
	// Sweep rows left behind by instances that died without running `close`.
	await db.delete(connection).where(lt(connection.lastSeenAt, sql`now() - interval '1 hour'`))
	await db.insert(connection).values({ id: connectionId, userId: member.id })
	await publish({ t: 'member', member: { userId: member.id, username: member.username, ...(await stateOf(member.id)) } })
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
		const [row] = await tx.insert(memberState).values({ userId: member.id, door })
			.onConflictDoUpdate({ target: memberState.userId, set: { door } })
			.returning({ slot: memberState.slot })
		await publish({ t: 'member', member: { userId: member.id, username: member.username, door, slot: row?.slot ?? null }, intent }, { tx })
	})
}

/**
 * Seats a member in the commons: one of the house theme's seats, and not one a member present is
 * in. The seat is kept while away (doors, visits); a theme change empties every seat.
 */
export async function sit(member: Member, slot: string, intent?: string) {
	const row = await db.query.houseState.findFirst({ columns: { theme: true } })
	const theme = await resolveTheme(row?.theme ?? 'living-room')
	if (!theme?.pack.seats.some((s) => s.id === slot)) throw new HouseError("That seat isn't in this room.")
	await db.transaction(async (tx) => {
		// One at a time, so two members can't take the same seat in the same instant.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('house-seats'))`)
		const [taken] = await tx.selectDistinct({ userId: memberState.userId })
			.from(memberState)
			.innerJoin(connection, eq(connection.userId, memberState.userId))
			.where(and(eq(memberState.slot, slot), ne(memberState.userId, member.id), fresh()))
		if (taken) throw new HouseError('Someone is sitting there.')
		const [state] = await tx.insert(memberState).values({ userId: member.id, slot })
			.onConflictDoUpdate({ target: memberState.userId, set: { slot } })
			.returning({ door: memberState.door })
		await publish({ t: 'member', member: { userId: member.id, username: member.username, door: state!.door, slot }, intent }, { tx })
	})
}

export async function presentMembers(): Promise<MemberState[]> {
	return db.selectDistinct({
		userId: user.id,
		username: user.username,
		door: sql<Door>`coalesce(${memberState.door}, 'open')`,
		slot: memberState.slot,
	})
		.from(connection)
		.innerJoin(user, eq(user.id, connection.userId))
		.leftJoin(memberState, eq(memberState.userId, user.id))
		.where(fresh())
}
