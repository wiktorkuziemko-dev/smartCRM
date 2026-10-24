ALTER TABLE "users" ADD COLUMN "google_calendar_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;