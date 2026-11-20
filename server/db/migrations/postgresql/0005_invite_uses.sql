-- Links without a limit become single-use; ones already used are closed by that.
UPDATE "invite" SET "maxUses" = greatest("uses", 1) WHERE "maxUses" IS NULL;--> statement-breakpoint
ALTER TABLE "invite" ALTER COLUMN "maxUses" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "invite" ALTER COLUMN "maxUses" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "usedUpAt" timestamp with time zone;--> statement-breakpoint
-- Links used up before this migration are removed a day after it.
UPDATE "invite" SET "usedUpAt" = now() WHERE "uses" >= "maxUses";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "inviteCode" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_inviteCode_invite_code_fk" FOREIGN KEY ("inviteCode") REFERENCES "public"."invite"("code") ON DELETE set null ON UPDATE cascade;
