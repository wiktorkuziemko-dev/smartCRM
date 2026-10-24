CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "google_refresh_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "google_calendar_email";