CREATE TABLE "theme_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"pack" jsonb NOT NULL,
	"uploadedBy" text,
	"uploadedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "house_state" ADD COLUMN "theme" text DEFAULT 'living-room' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_state" ADD COLUMN "slot" text;--> statement-breakpoint
ALTER TABLE "theme_pack" ADD CONSTRAINT "theme_pack_uploadedBy_user_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;