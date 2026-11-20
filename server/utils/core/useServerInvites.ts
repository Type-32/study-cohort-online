import { db, schema } from "@nuxthub/db"
import { H3Event } from "h3"
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { randomBytes, randomUUID } from "node:crypto"
import { inviteAbilities } from "#shared/abilities/inviteAbilities"
import { useServerAuth } from "#server/utils/core/useServerAuth"
import type { Invite, User } from "#shared/types/db"
import type { InviteInfo, InviteListItem } from "#shared/types/fetch"

const REENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000

const usable = () => and(
	lt(schema.invite.uses, schema.invite.maxUses),
	or(isNull(schema.invite.expiresAt), gt(schema.invite.expiresAt, sql`now()`)),
)

/** Why `code` can't be used: unknown or revoked (404), or used up or expired (410). */
async function refusal(code: string) {
	const invite = await db.query.invite.findFirst({ columns: { usedUpAt: true }, where: eq(schema.invite.code, code) })
	if (!invite) return createError({ statusCode: 404, statusMessage: "This invite link doesn't exist or was revoked. Ask the host for a new one." })
	if (invite.usedUpAt) return createError({ statusCode: 410, statusMessage: "This link has already been used. Ask the host for a new one." })
	return createError({ statusCode: 410, statusMessage: "This link has expired. Ask the host for a new one." })
}

async function signIn(event: H3Event, user: User) {
	if (user.banned) throw createError({ statusCode: 403, statusMessage: "Your account has been banned." })
	await setUserSession(event, { user: { id: user.id, role: user.role } })
	return user
}

export function useServerInvites() {
	/** True until the first account exists. */
	async function isSetupNeeded() {
		return !(await db.query.user.findFirst({ columns: { id: true } }))
	}

	/** Creates the first account as `admin`. Fails once any account exists. */
	async function setupHandler(event: H3Event, username: string) {
		const user = await db.transaction(async (tx) => {
			// Serializes concurrent setups so only one can see an empty table.
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext('house-setup'))`)
			if (await tx.query.user.findFirst({ columns: { id: true } })) return
			const [created] = await tx.insert(schema.user).values({ id: randomUUID(), username, role: "admin" }).returning()
			return created
		})
		if (!user) throw createError({ statusCode: 409, statusMessage: "This house is already set up." })
		return signIn(event, user)
	}

	async function getInviteInfo(code: string): Promise<InviteInfo> {
		const invite = await db.query.invite.findFirst({
			where: and(eq(schema.invite.code, code), usable()),
			with: { user: { columns: { username: true } } },
		})
		if (!invite) throw await refusal(code)
		return invite.userId ? { kind: "reentry", username: invite.user?.username } : { kind: "signup" }
	}

	/** Uses one invite: a signup link creates an account, a re-entry link signs its member in. */
	async function joinHandler(event: H3Event, code: string, username?: string) {
		const user = await db.transaction(async (tx) => {
			// The conditional increment claims a use atomically, and marks the link used up when it takes
			// the last one. A throw below rolls both back, so a failed join burns nothing.
			const [invite] = await tx.update(schema.invite)
				.set({
					uses: sql`${schema.invite.uses} + 1`,
					usedUpAt: sql`case when ${schema.invite.uses} + 1 >= ${schema.invite.maxUses} then now() end`,
				})
				.where(and(eq(schema.invite.code, code), usable()))
				.returning()
			if (!invite) throw await refusal(code)
			if (invite.userId) return tx.query.user.findFirst({ where: eq(schema.user.id, invite.userId) })
			if (!username) throw createError({ statusCode: 400, statusMessage: "Pick a display name." })
			const [created] = await tx.insert(schema.user).values({ id: randomUUID(), username, inviteCode: invite.code }).returning()
			return created
		})
		if (!user) throw await refusal(code)
		return signIn(event, user)
	}

	/**
	 * The host's list, newest first, with who joined through each signup link. Links used up or
	 * expired more than a day ago are deleted first: this list is the only place they show, so
	 * deleting on read looks the same as deleting on time, without a scheduler.
	 */
	async function listInvitesHandler(event: H3Event): Promise<InviteListItem[]> {
		await authorize(event, inviteAbilities().manageInvites)
		const dayAgo = sql`now() - interval '1 day'`
		await db.delete(schema.invite).where(or(lt(schema.invite.usedUpAt, dayAgo), lt(schema.invite.expiresAt, dayAgo)))
		return db.query.invite.findMany({
			with: {
				user: { columns: { username: true } },
				joined: { columns: { id: true, username: true }, orderBy: asc(schema.user.createdAt) },
			},
			orderBy: desc(schema.invite.createdAt),
		})
	}

	/**
	 * Without `userId`: a signup link (host only) for `maxUses` people, one by default. With `userId`:
	 * a single-use re-entry link valid for 7 days (the host for anyone, a member for themselves).
	 */
	async function createInviteHandler(event: H3Event, opts: { userId?: string, maxUses?: number, expiresAt?: Date }): Promise<Invite> {
		if (opts.userId) await authorize(event, inviteAbilities().createReentryLink, opts.userId)
		else await authorize(event, inviteAbilities().manageInvites)
		const creator = await useServerAuth().requireUser(event)
		const reentry = opts.userId
			? { userId: opts.userId, maxUses: 1, expiresAt: new Date(Date.now() + REENTRY_TTL_MS) }
			: { maxUses: opts.maxUses ?? 1, expiresAt: opts.expiresAt }
		const [invite] = await db.insert(schema.invite)
			.values({ code: randomBytes(16).toString("base64url"), createdBy: creator.id, ...reentry })
			.returning()
		return invite!
	}

	async function revokeInviteHandler(event: H3Event, code: string) {
		await authorize(event, inviteAbilities().manageInvites)
		const [invite] = await db.delete(schema.invite).where(eq(schema.invite.code, code)).returning()
		return invite
	}

	return {
		isSetupNeeded,
		setupHandler,
		getInviteInfo,
		joinHandler,
		listInvitesHandler,
		createInviteHandler,
		revokeInviteHandler,
	}
}
