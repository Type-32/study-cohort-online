import {bigserial, boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar} from "drizzle-orm/pg-core";
import type {AnyPgColumn} from "drizzle-orm/pg-core";
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
	/** The signup link that created this account; cleared when the link is removed. */
	inviteCode: text().references((): AnyPgColumn => invite.code, { onDelete: "set null", onUpdate: "cascade" }),

	...createdUpdatedAtColumns
});

export const file = pgTable("file", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: text().references(() => user.id, { onDelete: "set null", onUpdate: "cascade" }),
	blobPath: text().notNull(),
	fileName: text(),

	...createdUpdatedAtColumns
});

// A signup link (`userId` null) creates up to `maxUses` accounts (default one), until `expiresAt`.
// A re-entry link (`userId` set) signs that member back in once, e.g. on a new device.
// `usedUpAt` is set when the last use is taken. Used-up links, and links past `expiresAt`, are
// deleted a day later (the next time the host's list is read).
export const invite = pgTable("invite", {
	code: text().primaryKey(),
	createdBy: text().references(() => user.id, { onDelete: "set null", onUpdate: "cascade" }),
	userId: text().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	maxUses: integer().default(1).notNull(),
	uses: integer().default(0).notNull(),
	usedUpAt: timestamp({ withTimezone: true }),
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
	/** The track's title when it went on air (from `youtube_video`), so clients show it before their player loads. */
	radioTitle: text(),
	/** Who picked the track on air (a username), or null for a shuffle pick. */
	radioBy: text(),
	radioStation: integer(),
	/** Set when the players reported the track over and nothing followed; a new suggestion then plays at once. */
	radioEndedAt: timestamp({ withTimezone: true }),
	/** Members whose player YouTube refused the track on air. It's skipped only once every member present is here. */
	radioUnplayableBy: text().array().default(sql`'{}'::text[]`).notNull(),
	/** What plays when the queue and the suggestions run out (host's choice). */
	radioWhenEmpty: text({ enum: ["shuffle", "stop"] }).default("stop").notNull(),
}, (t) => [check("house_state_single_row", sql`${t.id} = 1`)]);

// What the server knows about a YouTube video, fetched once (oEmbed) and shared by suggestions,
// the radio and the stations. `title` is null when YouTube gave none (often a video that won't embed).
export const youtubeVideo = pgTable("youtube_video", {
	videoId: text().primaryKey(),
	title: text(),
	fetchedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// The shelf: tracks members suggested. `queuePosition` set means the host queued it (lowest plays
// first); null means it waits as a suggestion (oldest plays first once the queue is empty). A row
// is deleted when it plays, is withdrawn, or is removed. A video can be on the shelf once.
export const radioSuggestion = pgTable("radio_suggestion", {
	id: uuid().primaryKey(),
	userId: text().notNull().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	videoId: text().notNull(),
	queuePosition: integer(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex().on(t.videoId), index().on(t.userId)]);

// The catalog: every track that has been on air, with its fixed station number (the tuner's dial,
// step 10) and the pool shuffle picks from.
export const radioTrack = pgTable("radio_track", {
	videoId: text().primaryKey(),
	station: integer().notNull().unique(),
	plays: integer().default(0).notNull(),
	lastPlayedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	addedBy: text().references(() => user.id, { onDelete: "set null", onUpdate: "cascade" }),
	/** YouTube refused it (removed, private, or embedding off); shuffle skips it until it's played by hand. */
	unplayableAt: timestamp({ withTimezone: true }),
});

// Durable per-member state. A member with no row has their door open.
export const memberState = pgTable("member_state", {
	userId: text().primaryKey().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	door: text({ enum: ["open", "ajar", "closed"] }).default("open").notNull(),
	updatedAt: timestamp({ withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Relations

export const userRelations = relations(user, ({ many, one }) => ({
	files: many(file),
	invite: one(invite, {
		fields: [user.inviteCode],
		references: [invite.code],
		relationName: "joinedThrough",
	}),
}))

export const fileRelations = relations(file, ({ one }) => ({
	owner: one(user, {
		fields: [file.ownerId],
		references: [user.id],
	})
}))

export const inviteRelations = relations(invite, ({ one, many }) => ({
	user: one(user, {
		fields: [invite.userId],
		references: [user.id],
	}),
	/** The accounts created through this signup link. */
	joined: many(user, { relationName: "joinedThrough" }),
}))
