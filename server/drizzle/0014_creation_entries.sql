-- Każdy klient ma w historii wpis o założeniu („Klient założony przez X w dniu Y”).
-- Uzupełnienie dla klientów, którym go brakuje (np. po wyczyszczeniu historii testowej):
-- autor = osoba, która dodała klienta w aplikacji; dla klientów z importu bez autora – „Poprzedni opiekun”.
INSERT INTO "activities" ("client_id", "author_id", "author_label", "type", "content", "created_at")
SELECT c."id", c."created_by_id",
  CASE WHEN c."created_by_id" IS NULL THEN 'Poprzedni opiekun' END,
  'system', 'Utworzono klienta', c."created_at"
FROM "clients" c
WHERE NOT EXISTS (
  SELECT 1 FROM "activities" a WHERE a."client_id" = c."id" AND a."type" = 'system' AND a."content" LIKE 'Utworzono klienta%'
);
