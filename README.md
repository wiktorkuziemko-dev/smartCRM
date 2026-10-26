# SmartCRM

Prosty CRM dla zespołu handlowców: klienci, lejek sprzedaży, zadania z przypomnieniami i historia kontaktów w stylu Asany.
Działa w Dockerze na serwerze w sieci lokalnej.

## Funkcje

- **Logowanie i role**: Administrator, Kierownik, Handlowiec
  - *Handlowiec* widzi i edytuje klientów, których jest opiekunem. Klient dodany przez handlowca automatycznie staje się jego. Innych klientów nie widzi, chyba że admin lub kierownik nada mu dostęp na karcie klienta.
  - *Kierownik* widzi i edytuje wszystkich klientów i zadania, zmienia opiekunów, przypisuje zadania i zarządza dostępem handlowców. Na pulpicie widzi tabelę aktywności handlowców.
  - *Administrator* ma uprawnienia kierownika, a do tego zarządza użytkownikami, statusami, tagami, polami klienta i dostępem handlowców. **Tylko administrator może usuwać (archiwizować) klientów.**
- **Lista klientów**: wyszukiwarka, sortowanie i filtrowanie po każdej kolumnie (także po polach dodatkowych), wybór widocznych kolumn i **eksport do XLSX** (eksportuje to, co widać po filtrach).
- **Karta klienta** w prawym panelu: osoba kontaktowa, krótki opis, status w lejku (klikalny pasek), szczegóły, zaplanowane kontakty i historia kontaktów.
- **Historia kontaktów**: komentarze oraz załączniki (zdjęcia, PDF, Word, Excel). Pliki można przeciągnąć albo wkleić ze schowka. Zmiany statusu i opiekuna zapisują się automatycznie.
  - **Telefon, spotkanie i e-mail** wybiera się z datą i godziną: wpis od razu tworzy zadanie, które widać w historii i na liście zadań, z możliwością odhaczenia. Opis jest opcjonalny. Nie da się zaplanować zadania z datą wsteczną, także w formularzu zadania.
  - Handlowiec planuje kontakty tylko dla siebie. Kierownik i administrator mogą wskazać inną osobę.
- **Statusy klienta (lejek)**: definiuje je administrator (nazwa, kolor, kolejność). Handlowiec wybiera wyłącznie z tej listy.
- **Tagi**: wyłącznie informacyjne, do opisywania i grupowania klientów (filtr na liście). Listą zarządza administrator, a handlowcy przypisują tagi klientom. Tagi nie wpływają na dostęp.
- **Dostęp do klientów** (jedno miejsce: karta klienta → „Dostęp handlowców”, tylko admin i kierownik): dla każdego handlowca **brak**, **podgląd** albo **edycja**. Domyślnie klienta widzi i edytuje tylko opiekun, a admin lub kierownik może to zmienić, także opiekunowi. Klient bez opiekuna (np. z importu) jest widoczny tylko dla admina i kierownika. Każda zmiana dostępu zapisuje się w historii klienta.
- **Pulpit handlowca**: kafelki „Moi klienci”, „Udostępnieni mi” (do edycji / do podglądu) i łączny potencjał własnych klientów; lejek sprzedaży (własni i udostępnieni do edycji, bez udostępnionych tylko do podglądu); duże okno zadań (dziś i najbliższe 7 dni, zaległe zwinięte); „Moja aktywność”: dziś / wczoraj / 7 dni, wykres działań z 14 dni i ostatnie działania.
- **Aktywność handlowców** (pulpit kierownika i admina): dziś, wczoraj i ostatnie 7 dni: wejścia do aplikacji (logowania i powroty po ≥ 30 min przerwy), spotkania, telefony, e-maile, komentarze, nowi klienci i ostatnia aktywność.
- **Archiwum klientów**: usunięcie klienta przenosi go do archiwum. Klient znika z listy, zadań i pulpitu wszystkich użytkowników, a jego zadania z Kalendarza Google. W *Administracja → Archiwum* administrator może go podejrzeć, **przywrócić** albo **usunąć trwale**. Trwałe usunięcie kasuje wszystkie dane klienta: osoby kontaktowe, historię, pliki załączników, zadania, tagi i ustawienia dostępu.
- **Import z Asany (JSON)** (Administracja → Import, tylko admin): taski → klienci, projekty → tagi (projekt o nazwie województwa ustawia też pole „Województwo”), komentarze → historia kontaktów z oryginalną datą i autorem. Opiekun i autorzy są rozpoznawani po e-mailu kont w SmartCRM. Osoby spoza SmartCRM są oznaczane jako „Poprzedni opiekun”, a klient bez rozpoznanego opiekuna jest widoczny tylko dla admina i kierownika. Najpierw próba z raportem, potem import. Ponowny import dodaje tylko nowych klientów i nowe komentarze. Wpisy z importu nie liczą się do statystyk aktywności.
- **Integracja GPS E-SERVER** (Administracja → Integracja E-SERVER): adres API, login i hasło (zapisywane tylko jako skrót MD5, jak wymaga API), przypisanie handlowców do nadajników z listy pojazdów konta. Na pulpicie kierownika i admina sekcja „Praca w terenie”:
  - mapa OpenStreetMap z bieżącymi lokalizacjami (w trasie / postój ze stacyjką / zaparkowany / brak danych > 2 h),
  - statystyki z 7 dni: dystans, czas jazdy, najdłuższa trasa (odcinek bez postoju), liczba tras, dni z jazdą, średnia prędkość.
  Serwer potrzebuje dostępu do `e-server.com.pl`, a przeglądarka do `tile.openstreetmap.org`. Do testów bez konta służy `node tools/eserver-mock.mjs`.
- **Pola dodatkowe**: administrator dodaje własne pola (tekst, liczba, data, lista wyboru, tak/nie).
- **Zadania i przypomnienia**: widok „Moje zadania” i pulpit (zaległe / dziś / najbliższe 7 dni, późniejsze zwinięte), przypomnienie w aplikacji 15 minut przed terminem.
- **Kalendarz Google**: przycisk „Dodaj do Kalendarza Google” przy zadaniu działa bez konfiguracji. Opcjonalnie można włączyć automatyczną synchronizację zadań z kalendarzami użytkowników (opis niżej).
- **Ustawienia użytkownika**: kolumny listy klientów widoczne domyślnie (na start: nazwa, tagi, opiekun, ostatnia zmiana), połączenie z Kalendarzem Google, zmiana hasła.
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

### Aktualizacja na Windows (paczka .tar.gz)

1. Pobierz paczkę gałęzi z GitHuba (Code → Download / link `archive/refs/heads/<gałąź>.tar.gz`) do folderu **Pobrane**.
2. W PowerShellu, będąc **poza** folderem aplikacji (np. w `C:\claude_code`), uruchom:

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\aktualizuj.ps1
   ```

Skrypt sam bierze najnowszą paczkę z folderu Pobrane, sprawdza, czy zawiera inną wersję niż działająca, kopiuje `.env`, podmienia folder (poprzednia wersja trafia do `smartcrm-poprzednia-wersja`), buduje i uruchamia aplikację. Przy błędzie przywraca poprzednią wersję. Dane w bazie nie są ruszane.

### Kopia zapasowa (Windows)

`backup.ps1` robi kopię bazy danych, załączników i pliku `.env` do folderu `smartcrm-kopie` obok folderu aplikacji. Każda kopia ma osobny podfolder z datą i godziną. Domyślnie zostaje 14 najnowszych kopii, a przebieg zapisuje się w `smartcrm-kopie\backup.log`.

```powershell
powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1
# inny folder i liczba kopii:
powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1 -Cel D:\Kopie\SmartCRM -Zachowaj 30
```

Codzienne uruchamianie (Harmonogram zadań Windows; jednorazowo w PowerShellu):

```powershell
$akcja = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1'
$kiedy = New-ScheduledTaskTrigger -Daily -At 12:30
$opcje = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'SmartCRM - kopia zapasowa' -Action $akcja -Trigger $kiedy -Settings $opcje
```

Odtworzenie z kopii (najpierw automatycznie robi kopię bieżącego stanu):

```powershell
powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\przywroc.ps1 -Kopia C:\claude_code\smartcrm-kopie\2026-10-24_123000
```

Plik `.env` w kopii zawiera hasła, więc kopie przechowuj w bezpiecznym miejscu. Trzymaj też co najmniej jedną kopię poza komputerem z aplikacją (dysk sieciowy, dysk zewnętrzny).

## Serwer z Linuksem (maszyna wirtualna)

Na Linuksie (Ubuntu + Docker Engine) do kopii, odtwarzania i aktualizacji służą `backup.sh`, `przywroc.sh`
i `aktualizuj.sh` (aktualizacja przez `git`, z automatyczną kopią przed zmianą i powrotem do poprzedniej
wersji przy błędzie). Pełna instrukcja przeniesienia z Docker Desktop i utrzymania: **[MIGRACJA.md](MIGRACJA.md)**.

## Integracja z Kalendarzem Google (opcjonalnie)

Zadania użytkowników (telefony, spotkania, e-maile) mogą same trafiać do ich Kalendarzy Google, z przypomnieniem 15 minut przed terminem. Wydarzenie aktualizuje się przy każdej zmianie zadania i znika, gdy zadanie jest wykonane lub usunięte. Aplikacja korzysta z jednego **konta usługi Google**, więc działa w sieci lokalnej, bez domeny i bez logowania użytkowników do Google.

**Administrator (raz):**
1. Na [console.cloud.google.com](https://console.cloud.google.com/) utwórz projekt i włącz **Google Calendar API**.
2. W *Administracja (IAM) → Konta usługi* utwórz konto usługi, a na nim *Klucze → Dodaj klucz → JSON*.
3. W SmartCRM: **Administracja → Integracje** → wgraj pobrany plik .json.

**Każdy użytkownik:**
1. W ustawieniach Kalendarza Google udostępnij swój kalendarz adresowi konta usługi (widać go w SmartCRM w **Ustawieniach**) z uprawnieniem **„Wprowadzanie zmian w wydarzeniach”**.
2. W SmartCRM: **Ustawienia → Kalendarz Google** → wklej identyfikator kalendarza (np. adres Gmail), jego adres iCal albo link i kliknij „Zapisz i sprawdź”.

Sam link do kalendarza nie wystarcza: daje tylko dostęp do odczytu. Dlatego potrzebne jest udostępnienie kalendarza kontu usługi. Serwer musi mieć dostęp do internetu (połączenia wychodzące do `googleapis.com`).

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
