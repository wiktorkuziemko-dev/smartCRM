CREATE TYPE "public"."access_level" AS ENUM('none', 'view', 'edit');--> statement-breakpoint
ALTER TABLE "client_access" ADD COLUMN "level" "access_level" DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE "tag_access" ADD COLUMN "level" "access_level" DEFAULT 'edit' NOT NULL;