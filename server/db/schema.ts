import {bigserial, boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";

const createdUpdatedAtColumns = {
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}

// Tables

export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	username: text().notNull(),
	avatarUrl: text(),
	role: text({ enum: ["user", "moderator", "admin"] })
		.default("user")
		.$defaultFn(() => "user")
		.notNull(),
	banned: boolean().notNull().default(false).$defaultFn(() => false),
	banReason: text(),
	banExpires: timestamp(),

	...createdUpdatedAtColumns
});

export const file = pgTable("file", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: text().references(() => user.id, { onDelete: "set null", onUpdate: "cascade" }),
	blobPath: text().notNull(),
	fileName: text(),

	...createdUpdatedAtColumns
});

// A signup link (`userId` null) creates accounts until `maxUses` or `expiresAt`.
// A re-entry link (`userId` set) signs that member back in once, e.g. on a new device.
export const invite = pgTable("invite", {
	code: text().primaryKey(),
	createdBy: text().references(() => user.id, { onDelete: "set null", onUpdate: "cascade" }),
	userId: text().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	maxUses: integer(),
	uses: integer().default(0).notNull(),
	expiresAt: timestamp({ withTimezone: true }),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// One row per open socket. A member is present while any of their rows was seen within the
// freshness window; rows of crashed instances simply go stale.
export const connection = pgTable("connection", {
	id: text().primaryKey(),
	userId: text().notNull().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [index().on(t.userId, t.lastSeenAt)]);

// The house's live shared state, one row (`id` = 1). Timestamps only: clients derive the rest.
export const houseState = pgTable("house_state", {
	id: integer().primaryKey().default(1),
	timerEndsAt: timestamp({ withTimezone: true }),
	timerMinutes: integer(),
	radioVideoId: text(),
	radioStartedAt: timestamp({ withTimezone: true }),
	radioPausedAt: timestamp({ withTimezone: true }),
}, (t) => [check("house_state_single_row", sql`${t.id} = 1`)]);

// Relations

export const userRelations = relations(user, ({ many }) => ({
	files: many(file),
}))

export const fileRelations = relations(file, ({ one }) => ({
	owner: one(user, {
		fields: [file.ownerId],
		references: [user.id],
	})
}))

export const inviteRelations = relations(invite, ({ one }) => ({
	user: one(user, {
		fields: [invite.userId],
		references: [user.id],
	})
}))
