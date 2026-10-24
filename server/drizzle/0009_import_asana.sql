ALTER TABLE "activities" ADD COLUMN "author_label" varchar(128);--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "source" varchar(16);--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "external_id" varchar(64);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "external_id" varchar(64);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_external_id_unique" UNIQUE("external_id");