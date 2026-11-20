CREATE TABLE "radio_suggestion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"videoId" text NOT NULL,
	"queuePosition" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radio_track" (
	"videoId" text PRIMARY KEY NOT NULL,
	"station" integer NOT NULL,
	"plays" integer DEFAULT 0 NOT NULL,
	"lastPlayedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"addedBy" text,
	"unplayableAt" timestamp with time zone,
	CONSTRAINT "radio_track_station_unique" UNIQUE("station")
);
--> statement-breakpoint
CREATE TABLE "youtube_video" (
	"videoId" text PRIMARY KEY NOT NULL,
	"title" text,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioTitle" text;--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioBy" text;--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioStation" integer;--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioEndedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioUnplayableBy" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioWhenEmpty" text DEFAULT 'stop' NOT NULL;--> statement-breakpoint
ALTER TABLE "radio_suggestion" ADD CONSTRAINT "radio_suggestion_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "radio_track" ADD CONSTRAINT "radio_track_addedBy_user_id_fk" FOREIGN KEY ("addedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "radio_suggestion_videoId_index" ON "radio_suggestion" USING btree ("videoId");--> statement-breakpoint
CREATE INDEX "radio_suggestion_userId_index" ON "radio_suggestion" USING btree ("userId");--> statement-breakpoint
-- The track on air when this ran is the first station.
INSERT INTO "radio_track" ("videoId", "station", "plays", "lastPlayedAt") SELECT "radioVideoId", 1, 1, coalesce("radioStartedAt", now()) FROM "house_state" WHERE "radioVideoId" IS NOT NULL;--> statement-breakpoint
UPDATE "house_state" SET "radioStation" = 1 WHERE "radioVideoId" IS NOT NULL;
