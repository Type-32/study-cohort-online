CREATE TABLE "connection" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "connection_userId_lastSeenAt_index" ON "connection" USING btree ("userId","lastSeenAt");