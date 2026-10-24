ALTER TABLE "tag_access" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "tag_access" CASCADE;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "created_by_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Bez dostępu przez tagi wpisy 'none' dla osób niebędących opiekunem nic nie znaczą.
DELETE FROM "client_access" ca USING "clients" c WHERE ca."client_id" = c."id" AND ca."level" = 'none' AND (c."owner_id" IS NULL OR c."owner_id" <> ca."user_id");--> statement-breakpoint
-- Autor klienta z wpisu "Utworzono klienta" w historii (dla klientów sprzed tej zmiany).
UPDATE "clients" c SET "created_by_id" = a."author_id" FROM "activities" a WHERE a."client_id" = c."id" AND a."type" = 'system' AND a."content" = 'Utworzono klienta' AND c."created_by_id" IS NULL;
