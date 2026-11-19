CREATE TABLE "house_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"timerEndsAt" timestamp with time zone,
	"timerMinutes" integer,
	CONSTRAINT "house_state_single_row" CHECK ("house_state"."id" = 1)
);
