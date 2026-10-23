# SmartCRM

Prosty CRM dla zespołu handlowców: klienci, lejek sprzedaży, zadania z przypomnieniami i historia kontaktów w stylu Asany.
Działa w Dockerze na serwerze w sieci lokalnej.

## Funkcje

- **Logowanie i role**: Administrator, Kierownik, Handlowiec
  - *Handlowiec* ma pełny dostęp do swoich klientów (jest ich opiekunem). Do pozostałych klientów dostęp nadaje mu administrator: **brak**, **tylko podgląd** albo **pełna edycja**.
  - *Kierownik* widzi i edytuje wszystkich klientów i zadania, zmienia opiekunów i przypisuje zadania.
  - *Administrator* ma uprawnienia kierownika, a do tego zarządza użytkownikami, statusami, tagami, polami klienta i dostępem handlowców. **Tylko administrator może usuwać klientów.**
- **Lista klientów**: wyszukiwarka, sortowanie i filtrowanie po każdej kolumnie (także po polach dodatkowych), wybór widocznych kolumn i **eksport do XLSX** (eksportuje to, co widać po filtrach).
- **Karta klienta** w prawym panelu: osoba kontaktowa, krótki opis, status w lejku (klikalny pasek), szczegóły, zadania i historia kontaktów.
- **Historia kontaktów**: komentarze, telefony, spotkania, e-maile oraz załączniki (zdjęcia, PDF, Word, Excel). Pliki można przeciągnąć albo wkleić ze schowka. Zmiany statusu i opiekuna zapisują się automatycznie.
- **Statusy klienta (lejek)**: definiuje je administrator (nazwa, kolor, kolejność). Handlowiec wybiera wyłącznie z tej listy.
- **Tagi**: listą zarządza administrator (na start: `przetarg`), a handlowcy przypisują tagi klientom, które mogą edytować. Na liście klientów można filtrować po tagu.
- **Dostęp handlowców do klientów** (brak / podgląd / edycja), ustawiany przez administratora:
  - **na karcie klienta**, w sekcji „Dostęp handlowców”, osobno dla każdego handlowca,
  - **przez tag**, w *Administracja → Tagi*: dostęp do wszystkich klientów z danym tagiem.

  Zasady: opiekun ma zawsze pełną edycję. Ustawienie na karcie klienta ma pierwszeństwo przed tagami, także jawne „Brak”. Bez ustawienia na karcie liczy się najwyższy poziom spośród tagów klienta. Przy podglądzie handlowiec widzi dane, historię i zadania, ale nie może niczego zmieniać. Wyjątek: zadania przypisane do niego samego może edytować i odhaczać.
- **Pola dodatkowe**: administrator dodaje własne pola (tekst, liczba, data, lista wyboru, tak/nie).
- **Zadania i przypomnienia**: widok „Moje zadania” (zaległe / dziś / jutro / później), przypomnienie w aplikacji 15 minut przed terminem.
- **Kalendarz Google**: przycisk „Dodaj do Kalendarza Google” przy zadaniu działa bez konfiguracji. Opcjonalnie można włączyć pełną automatyczną synchronizację (opis niżej).
- Kontrola duplikatów po NIP.

## Uruchomienie (serwer z Dockerem)

```bash
git clone https://github.com/wiktorkuziemko-dev/smartCRM.git
cd smartCRM
cp .env.example .env
nano .env                  # ustaw DB_PASSWORD i ADMIN_PASSWORD
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem `http://<adres-serwera>:8080`. Zaloguj się kontem z `.env` (`ADMIN_LOGIN` / `ADMIN_PASSWORD`).
Hasło administratora z `.env` obowiązuje tylko przy pierwszym uruchomieniu. Później zmienisz je w profilu.

Pierwsze kroki po zalogowaniu:
1. **Administracja → Statusy klienta**: dostosuj etapy lejka (są domyślne, możesz je zmienić).
2. **Administracja → Tagi**: dostosuj tagi i widoczność.
3. **Administracja → Pola klienta**: dodaj własne pola.
4. **Administracja → Użytkownicy**: załóż konta kierownika i handlowców.

### Aktualizacja

```bash
git pull
docker compose up -d --build
```

Migracje bazy danych uruchamiają się automatycznie przy starcie.

### Kopia zapasowa

Dane są w dwóch wolumenach Dockera: `db-data` (baza) i `uploads` (załączniki).

```bash
# baza danych
docker compose exec db pg_dump -U smartcrm smartcrm > backup-$(date +%F).sql
# załączniki
docker run --rm -v smartcrm_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Odtworzenie bazy: `cat backup.sql | docker compose exec -T db psql -U smartcrm smartcrm`.

## Integracja z Kalendarzem Google (opcjonalnie)

Gdy integracja jest włączona, każdy użytkownik może w **Profilu** połączyć swój Kalendarz Google. Od tej chwili jego zadania same pojawiają się w kalendarzu, z przypomnieniem 15 minut przed terminem, i aktualizują się przy każdej zmianie. Wykonane lub usunięte zadanie znika z kalendarza.

Serwer łączy się z Google tylko w kierunku wychodzącym, więc integracja działa także w sieci lokalnej. Wymagania:

1. Aplikacja musi być otwierana pod **nazwą domenową**, np. `https://crm.firma.pl`. Wystarczy wpis w wewnętrznym DNS. Google nie przyjmuje adresów IP w adresie przekierowania.
2. W [Google Cloud Console](https://console.cloud.google.com/):
   - utwórz projekt i włącz **Google Calendar API**,
   - skonfiguruj **ekran zgody OAuth**: typ „Internal”, jeśli firma ma Google Workspace, w przeciwnym razie „External” i dodaj użytkowników testowych,
   - utwórz **Identyfikator klienta OAuth** typu *Aplikacja internetowa* z adresem przekierowania `https://crm.firma.pl/api/google/callback`.
3. W pliku `.env` ustaw `APP_URL`, `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET`, a następnie uruchom `docker compose up -d`.

## HTTPS (zalecane)

Aplikacja nasłuchuje po HTTP. Do HTTPS postaw przed nią reverse proxy (np. Caddy, nginx, Traefik) i ustaw `COOKIE_SECURE=true`.
Powiadomienia systemowe przeglądarki również działają tylko przez HTTPS. Bez HTTPS przypomnienia pokazują się wewnątrz aplikacji.

## Rozwój

Stos: **Node.js 22 + Fastify + Drizzle ORM + PostgreSQL** (backend) oraz **React + Vite + Tailwind CSS** (frontend), w całości w TypeScripcie.

```
server/            API (Fastify)
  src/db/schema.ts   schemat bazy danych
  src/routes/        endpointy REST
  drizzle/           migracje SQL (generowane)
web/               frontend (React)
  src/pages/         ekrany
  src/components/    komponenty (panel klienta, formularze, historia)
```

Uruchomienie lokalne (wymaga PostgreSQL):

```bash
npm install
export DATABASE_URL=postgres://smartcrm:smartcrm@localhost:5432/smartcrm
npm run dev -w server      # API na :3000
npm run dev -w web         # frontend na :5173 (proxy /api -> :3000)
```

Zmiana schematu bazy: edytuj `server/src/db/schema.ts`, a potem uruchom `npm run db:generate`. Nowa migracja trafi do `server/drizzle/` i wykona się przy starcie.
