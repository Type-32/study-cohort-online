CREATE TABLE "radio_band" (
	"playlistId" text PRIMARY KEY NOT NULL,
	"station" integer NOT NULL,
	"plays" integer DEFAULT 0 NOT NULL,
	"lastPlayedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"addedBy" text,
	CONSTRAINT "radio_band_station_unique" UNIQUE("station")
);
--> statement-breakpoint
CREATE TABLE "youtube_playlist" (
	"playlistId" text PRIMARY KEY NOT NULL,
	"title" text,
	"videoIds" text[] NOT NULL,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radio_suggestion" ALTER COLUMN "videoId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "radioBand" jsonb;--> statement-breakpoint
ALTER TABLE "radio_suggestion" ADD COLUMN "playlistId" text;--> statement-breakpoint
ALTER TABLE "radio_band" ADD CONSTRAINT "radio_band_playlistId_youtube_playlist_playlistId_fk" FOREIGN KEY ("playlistId") REFERENCES "public"."youtube_playlist"("playlistId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_band" ADD CONSTRAINT "radio_band_addedBy_user_id_fk" FOREIGN KEY ("addedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "radio_suggestion" ADD CONSTRAINT "radio_suggestion_playlistId_youtube_playlist_playlistId_fk" FOREIGN KEY ("playlistId") REFERENCES "public"."youtube_playlist"("playlistId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "radio_suggestion_playlistId_index" ON "radio_suggestion" USING btree ("playlistId");--> statement-breakpoint
ALTER TABLE "radio_suggestion" ADD CONSTRAINT "radio_suggestion_track_or_band" CHECK (("radio_suggestion"."videoId" is null) <> ("radio_suggestion"."playlistId" is null));