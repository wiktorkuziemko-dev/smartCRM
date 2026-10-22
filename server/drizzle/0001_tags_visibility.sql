CREATE TABLE "client_access" (
	"client_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "client_access_client_id_user_id_pk" PRIMARY KEY("client_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "client_tags" (
	"client_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "client_tags_client_id_tag_id_pk" PRIMARY KEY("client_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag_access" (
	"tag_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "tag_access_tag_id_user_id_pk" PRIMARY KEY("tag_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(16) DEFAULT '#64748b' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_access" ADD CONSTRAINT "tag_access_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_access" ADD CONSTRAINT "tag_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_access_user_idx" ON "client_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_tags_tag_idx" ON "client_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_access_user_idx" ON "tag_access" USING btree ("user_id");