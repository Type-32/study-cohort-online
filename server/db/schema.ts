import {bigserial, boolean, integer, pgTable, primaryKey, text, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
import {relations} from "drizzle-orm";

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
