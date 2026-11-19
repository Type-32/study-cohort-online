CREATE TABLE "member_state" (
	"userId" text PRIMARY KEY NOT NULL,
	"door" text DEFAULT 'open' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_state" ADD CONSTRAINT "member_state_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;