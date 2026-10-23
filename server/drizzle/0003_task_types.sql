CREATE TYPE "public"."task_type" AS ENUM('task', 'call', 'meeting', 'email');--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "task_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "type" "task_type" DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;