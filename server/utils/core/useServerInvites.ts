import { db, schema } from "@nuxthub/db"
import { H3Event } from "h3"
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { randomBytes, randomUUID } from "node:crypto"
import { inviteAbilities } from "#shared/abilities/inviteAbilities"
import { useServerAuth } from "#server/utils/core/useServerAuth"
import type { Invite, User } from "#shared/types/db"
import type { InviteInfo, InviteWithUser } from "#shared/types/fetch"

const REENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000

const usable = () => and(
	or(isNull(schema.invite.maxUses), lt(schema.invite.uses, schema.invite.maxUses)),
	or(isNull(schema.invite.expiresAt), gt(schema.invite.expiresAt, sql`now()`)),
)

const invalidInvite = () => createError({ statusCode: 404, statusMessage: "This invite link is invalid, used up, or expired." })

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
		if (!invite) throw invalidInvite()
		return invite.userId ? { kind: "reentry", username: invite.user?.username } : { kind: "signup" }
	}

	/** Uses one invite: a signup link creates an account, a re-entry link signs its member in. */
	async function joinHandler(event: H3Event, code: string, username?: string) {
		const user = await db.transaction(async (tx) => {
			// The conditional increment claims a use atomically; a throw below rolls it back.
			const [invite] = await tx.update(schema.invite)
				.set({ uses: sql`${schema.invite.uses} + 1` })
				.where(and(eq(schema.invite.code, code), usable()))
				.returning()
			if (!invite) throw invalidInvite()
			if (invite.userId) return tx.query.user.findFirst({ where: eq(schema.user.id, invite.userId) })
			if (!username) throw createError({ statusCode: 400, statusMessage: "Pick a display name." })
			const [created] = await tx.insert(schema.user).values({ id: randomUUID(), username }).returning()
			return created
		})
		if (!user) throw invalidInvite()
		return signIn(event, user)
	}

	async function listInvitesHandler(event: H3Event): Promise<InviteWithUser[]> {
		await authorize(event, inviteAbilities().manageInvites)
		return db.query.invite.findMany({
			with: { user: { columns: { username: true } } },
			orderBy: desc(schema.invite.createdAt),
		})
	}

	/**
	 * Without `userId`: a signup link (host only). With `userId`: a single-use re-entry link valid for 7 days
	 * (the host for anyone, a member for themselves).
	 */
	async function createInviteHandler(event: H3Event, opts: { userId?: string, maxUses?: number, expiresAt?: Date }): Promise<Invite> {
		if (opts.userId) await authorize(event, inviteAbilities().createReentryLink, opts.userId)
		else await authorize(event, inviteAbilities().manageInvites)
		const creator = await useServerAuth().requireUser(event)
		const reentry = opts.userId
			? { userId: opts.userId, maxUses: 1, expiresAt: new Date(Date.now() + REENTRY_TTL_MS) }
			: { maxUses: opts.maxUses, expiresAt: opts.expiresAt }
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
