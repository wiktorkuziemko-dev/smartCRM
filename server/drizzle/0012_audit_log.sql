CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"user_name" varchar(128),
	"ip" varchar(64),
	"category" varchar(24) NOT NULL,
	"action" varchar(128) NOT NULL,
	"client_id" integer,
	"client_name" varchar(255),
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb,
	"status" integer
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_client_idx" ON "audit_log" USING btree ("client_id");