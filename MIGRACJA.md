# Migracja SmartCRM na maszynę wirtualną (VM) – krok po kroku

Instrukcja dla osoby, która robi to pierwszy raz. Przenosimy działający SmartCRM, razem ze wszystkimi
danymi, z komputera z Docker Desktop (Windows) na maszynę wirtualną z Linuksem (Ubuntu) przygotowaną
przez administratora.

**Jak to zrobimy:** najpierw **próba generalna** – stawiamy SmartCRM na VM z kopią danych, podczas gdy
zespół normalnie pracuje na starym komputerze. Gdy wszystko działa, w umówionym terminie robimy
**właściwą migrację**: świeża kopia, przeniesienie, przełączenie zespołu. Przerwa w pracy: około 30 minut.

| Etap | Co | Kto | Ile trwa | Przerwa w pracy? |
|---|---|---|---|---|
| 0 | Przygotowanie VM | administrator | – | nie |
| 1 | Pierwsze połączenie z VM | Ty | 10 min | nie |
| 2 | Instalacja Dockera i test połączeń | Ty | 15 min | nie |
| 3 | Pobranie SmartCRM z GitHuba | Ty | 15 min | nie |
| 4 | Próba generalna (kopia danych na VM) | Ty | 30 min | nie |
| 5 | Właściwa migracja | Ty | 30 min | **tak, ok. 30 min** |
| 6 | Po migracji: kopie automatyczne, Kalendarz Google | Ty | 20 min | nie |

Na końcu: [ściąga poleceń](#ściąga-poleceń-na-vm) i [rozwiązywanie problemów](#rozwiązywanie-problemów).

---

## Etap 0. Co przekazać administratorowi

Skopiuj i wyślij adminowi poniższą listę.

> **Prośba o maszynę wirtualną dla SmartCRM**
>
> 1. **System:** Ubuntu Server 24.04 LTS (64-bit), instalacja minimalna, **z serwerem OpenSSH**.
> 2. **Zasoby:** 2 vCPU, 4 GB RAM, 40 GB dysku.
> 3. **Konto:** konto użytkownika z uprawnieniami **sudo** (administratora) – login i hasło dla mnie.
> 4. **Sieć:** **stały adres IP** w sieci firmowej (np. 192.168.1.60). Maszyna ma się uruchamiać
>    automatycznie po restarcie serwera.
> 5. **Dostęp z sieci firmowej i VPN do VM:** port **22** (SSH – tylko z mojego komputera / sieci IT)
>    i port **8090** (aplikacja – dla wszystkich użytkowników SmartCRM, także przez VPN).
> 6. **Dostęp VM do internetu:** HTTPS (443) i HTTP (80).
> 7. **FortiGate – inspekcja SSL:** proszę o **wyjątek od inspekcji SSL (deep inspection) dla adresu IP
>    tej VM**. Aplikacja łączy się z: `*.docker.io`, `*.docker.com`, `github.com`, `registry.npmjs.org`,
>    `*.googleapis.com`, `e-server.com.pl`, `*.smartmetering24.pl`, `tile.openstreetmap.org`.
>    Bez wyjątku połączenia z kontenerów kończą się błędem certyfikatu (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`).
>    Jeśli wyjątek nie jest możliwy – proszę o plik certyfikatu CA FortiGate (format PEM / Base-64).
> 8. **Kopie zapasowe (opcjonalnie, zalecane):** udział sieciowy (NAS / serwer plików) na kopie SmartCRM
>    (ok. 5 GB) – adres, login i hasło.

Od admina potrzebujesz: **adres IP VM, login, hasło** (i ewentualnie dane udziału na kopie).

> W całej instrukcji przykładowy adres VM to **192.168.1.60**, a login to **wiktor**.
> Wszędzie wstawiaj swoje wartości.

---

## Etap 1. Pierwsze połączenie z VM

Maszyną wirtualną steruje się **z Twojego komputera**, przez połączenie SSH (tekstowy terminal).
Niczego nie trzeba instalować – SSH jest wbudowany w Windows 10/11.

1. Otwórz **PowerShell** (menu Start → wpisz „PowerShell”).
2. Wpisz (z Twoim loginem i adresem):
   ```powershell
   ssh wiktor@192.168.1.60
   ```
3. Przy pierwszym połączeniu pojawi się pytanie `Are you sure you want to continue connecting (yes/no)?`
   – wpisz **`yes`** i Enter.
4. Wpisz hasło. **Podczas wpisywania hasła nic się nie wyświetla** (nawet gwiazdki) – to normalne.
   Enter.
5. Gdy zobaczysz znak zachęty w rodzaju `wiktor@smartcrm:~$` – jesteś na VM.

**Jak pracować w tym oknie:**
- **Wklejanie:** prawy przycisk myszy (albo Ctrl+V w nowszym terminalu Windows).
- Polecenia wklejaj **pojedynczo albo całymi blokami z instrukcji** i naciskaj Enter.
- Polecenia zaczynające się od `sudo` mogą zapytać o hasło – to samo hasło co przy logowaniu.
- **Wyjście z VM:** `exit`. Ponowne połączenie: znów `ssh wiktor@192.168.1.60`.
- Jeśli coś „wisi” i nie wraca znak zachęty – **Ctrl+C** przerywa polecenie.

---

## Etap 2. Instalacja Dockera i test połączeń

Na VM (po zalogowaniu przez SSH) wklej kolejno poniższe bloki.

**2.1. Aktualizacja systemu i podstawowe narzędzia** (kilka minut):
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git unattended-upgrades
sudo timedatectl set-timezone Europe/Warsaw
```

**2.2. Docker** (oficjalny instalator):
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```
Teraz **wyloguj się** (`exit`) i **zaloguj ponownie** (`ssh wiktor@192.168.1.60`) – dopiero wtedy
zaczną działać uprawnienia do Dockera.

**2.3. Zapora na VM** – otwarte tylko SSH i port aplikacji:
```bash
sudo ufw allow OpenSSH
sudo ufw allow 8090/tcp
sudo ufw --force enable
```

**2.4. Test – czy Docker działa i czy FortiGate nie blokuje połączeń:**
```bash
docker run --rm hello-world
```
Powinno wypisać m.in. **`Hello from Docker!`**. Potem:
```bash
docker run --rm node:22-alpine node -e "fetch('https://oauth2.googleapis.com/token',{method:'POST'}).then(r=>console.log('OK',r.status)).catch(e=>console.log('BLAD',e.cause&&e.cause.code))"
```

| Wynik | Co znaczy | Co dalej |
|---|---|---|
| `OK 400` | połączenia działają (400 jest tu prawidłowe) | przejdź do etapu 3 |
| `BLAD UNABLE_TO_VERIFY_LEAF_SIGNATURE` | FortiGate rozszywa HTTPS także na VM | poproś admina o wyjątek z punktu 7 etapu 0, potem powtórz test |
| `hello-world` kończy się błędem `x509` / `certificate` / `TLS handshake timeout` | to samo – Docker nie może pobierać obrazów | jak wyżej |

**Nie idź dalej, dopóki test nie da `OK 400`.** Jeśli admin nie może zrobić wyjątku i przekaże
certyfikat FortiGate – napisz do mnie, przygotuję obsługę tego certyfikatu w aplikacji i instrukcję.

---

## Etap 3. Pobranie SmartCRM z GitHuba

Kod aplikacji pobieramy prosto z GitHuba poleceniem `git`. Dzięki temu późniejsze aktualizacje to jedno
polecenie. Repozytorium jest prywatne, więc VM dostaje **klucz tylko do odczytu** („deploy key”) –
pozwala pobierać kod, ale niczego w nim nie zmieni.

**3.1. Utwórz klucz na VM:**
```bash
ssh-keygen -t ed25519 -N "" -C "smartcrm-vm" -f ~/.ssh/smartcrm_github
printf 'Host github.com\n  IdentityFile ~/.ssh/smartcrm_github\n  IdentitiesOnly yes\n' >> ~/.ssh/config
cat ~/.ssh/smartcrm_github.pub
```
Ostatnie polecenie wypisze jedną długą linię zaczynającą się od `ssh-ed25519`. **Zaznacz ją myszką
w całości i skopiuj** (w oknie PowerShell zaznaczenie + Enter albo prawy przycisk kopiuje).

**3.2. Dodaj klucz na GitHubie** (w przeglądarce, na swoim komputerze):
1. Otwórz https://github.com/wiktorkuziemko-dev/smartCRM i zaloguj się.
2. **Settings** (zakładka na górze repozytorium) → po lewej **Deploy keys** → **Add deploy key**.
3. **Title:** `VM SmartCRM`, **Key:** wklej skopiowaną linię.
4. **Nie zaznaczaj** „Allow write access”. Kliknij **Add key**.

**3.3. Pobierz kod na VM:**
```bash
sudo mkdir -p /opt/smartcrm /opt/smartcrm-kopie
sudo chown $USER: /opt/smartcrm /opt/smartcrm-kopie
git clone -b feature/tagi-widocznosc git@github.com:wiktorkuziemko-dev/smartCRM.git /opt/smartcrm
```
Na pytanie `Are you sure you want to continue connecting` odpowiedz **`yes`**. Sprawdzenie:
```bash
ls /opt/smartcrm
```
Powinny być m.in. `docker-compose.yml`, `backup.sh`, `przywroc.sh`, `aktualizuj.sh`.

> Gałąź `feature/tagi-widocznosc` zawiera aktualną wersję. Gdy zmiany zostaną scalone do `main`,
> przełączysz VM jednym poleceniem: `cd /opt/smartcrm && git fetch origin main && git checkout main`.

**Aplikacji jeszcze nie uruchamiaj** – zrobi to skrypt odtwarzający w etapie 4.

---

## Etap 4. Próba generalna

Stawiamy SmartCRM na VM z kopią obecnych danych. **Zespół w tym czasie normalnie pracuje na starym
komputerze** – to tylko sprawdzenie, że wszystko działa. Zmiany zrobione na VM podczas próby
zostaną nadpisane przy właściwej migracji.

**4.1. Kopia na Windows** (PowerShell na Twoim komputerze, nie na VM):
```powershell
powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1
```
Na końcu ma być zielone `OK: kopia gotowa (...)`. Kopia jest w folderze z datą, np.
`C:\claude_code\smartcrm-kopie\2026-11-03_180000` (nazwę zobaczysz w komunikacie).

**4.2. Przenieś kopię na VM** (PowerShell na Twoim komputerze – zamień nazwę folderu na swoją):
```powershell
scp -r C:\claude_code\smartcrm-kopie\2026-11-03_180000 wiktor@192.168.1.60:migracja
```
Poda hasło do VM. Na VM powstanie folder `migracja` z plikami kopii.

> Alternatywa z myszką: program **WinSCP** (darmowy). Połącz się z VM (protokół SFTP, adres, login,
> hasło), utwórz w katalogu domowym folder `migracja` i przeciągnij do niego **zawartość** folderu kopii
> (pliki `baza.dump`, `zalaczniki.tgz`, `.env`, `info.txt`).

**4.3. Odtwórz dane na VM** (w oknie SSH):
```bash
ls -a ~/migracja
cd /opt/smartcrm
cp ~/migracja/.env .env
sed -i 's/\r$//' .env
chmod 600 .env
./przywroc.sh ~/migracja
```
- `ls` powinien pokazać `baza.dump`, `zalaczniki.tgz`, `.env`, `info.txt`.
- `sed` usuwa windowsowe końce linii z pliku ustawień – to ważne.
- Skrypt zapyta o potwierdzenie – wpisz **`TAK`** (wielkimi literami).
- Pierwsze uruchomienie **buduje aplikację – kilka minut**, na ekranie przewija się dużo tekstu.
- Na końcu: `Gotowe. Klientów w bazie: …` i tabela, w której oba kontenery mają stan **healthy**.
  Liczba klientów ma się zgadzać z `cat ~/migracja/info.txt`.

**4.4. Sprawdź w przeglądarce** (na swoim komputerze): `http://192.168.1.60:8090` i zaloguj się
swoim kontem SmartCRM (te same loginy i hasła co dotąd).

- [ ] liczba klientów i kilka kart klientów (historia, osoby kontaktowe, zadania)
- [ ] otwieranie załącznika (zdjęcie lub PDF)
- [ ] zdjęcia profilowe
- [ ] pulpit: mapa i dane z E-SERVER
- [ ] zakładka Testy (dane ze SMART)
- [ ] Administracja → Logi – widać historię sprzed migracji
- [ ] logowanie z drugiego komputera w sieci i przez VPN

Jeśli coś nie działa – zapisz komunikat i napisz do mnie, **zanim** przejdziesz do etapu 5.

---

## Etap 5. Właściwa migracja

Umów termin (np. koniec dnia) i uprzedź zespół o ok. 30-minutowej przerwie.

**5.1. Uprzedź zespół:** „Od godz. X do Y nie pracujemy w SmartCRM”. Wszystko, co ktoś zapisze
po zrobieniu kopii, nie trafi na nowy serwer.

**5.2. Świeża kopia na Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1
```

**5.3. Zatrzymaj starą aplikację** – od teraz nikt już na niej nie pracuje:
```powershell
docker compose --project-directory C:\claude_code\smartcrm -f C:\claude_code\smartcrm\docker-compose.yml stop
```

**5.4. Przenieś świeżą kopię na VM** (nowa nazwa folderu kopii!). Najpierw na VM usuń kopię z próby:
```bash
rm -rf ~/migracja
```
potem na Windows:
```powershell
scp -r C:\claude_code\smartcrm-kopie\NAZWA_NOWEJ_KOPII wiktor@192.168.1.60:migracja
```

**5.5. Odtwórz dane na VM:**
```bash
cd /opt/smartcrm
./przywroc.sh ~/migracja
```
Wpisz `TAK`. Tym razem bez budowania – trwa ok. minuty. Skrypt najpierw sam zrobi kopię danych
z próby generalnej (na wszelki wypadek), potem wgra świeże dane.

**5.6. Sprawdź** jak w 4.4 (wystarczy liczba klientów, jedna karta klienta, logowanie).

**5.7. Przełącz zespół:** wyślij nowy adres **`http://192.168.1.60:8090`**. Każdy loguje się jak dotąd.
Warto poprosić, żeby każdy dodał nowy adres do zakładek przeglądarki.

**5.8. Usuń kopię z VM** (zawiera dane klientów i hasła; kopie robione na VM są w `/opt/smartcrm-kopie`):
```bash
rm -rf ~/migracja
```

**Stary komputer:** aplikację zostaw **zatrzymaną** przez 2–3 tygodnie (droga powrotu). Nie usuwaj danych.

> **Droga powrotu (gdyby coś poszło nie tak):** na VM `cd /opt/smartcrm && docker compose stop`,
> na Windows `docker compose --project-directory C:\claude_code\smartcrm -f C:\claude_code\smartcrm\docker-compose.yml start`.
> Zmiany zrobione w międzyczasie na VM trzeba wtedy przenieść z powrotem (`backup.sh` na VM →
> `przywroc.ps1` na Windows) – napisz do mnie.

---

## Etap 6. Po migracji

**6.1. Codzienna kopia zapasowa o 22:00** (na VM, jedno polecenie):
```bash
(crontab -l 2>/dev/null; echo "0 22 * * * /opt/smartcrm/backup.sh >> /opt/smartcrm-kopie/cron.log 2>&1") | crontab -
crontab -l
```
Drugie polecenie pokaże zapisany harmonogram. Następnego dnia sprawdź wynik:
```bash
tail /opt/smartcrm-kopie/backup.log
```
– ma być linia `OK: kopia gotowa`.

**Kopie poza VM (zalecane):** jeśli admin dał udział sieciowy (punkt 8 etapu 0), napisz do mnie –
podam polecenia podłączenia go i zapisu kopii na nim. Kopia trzymana tylko na tej samej VM nie chroni
przed awarią serwera.

**6.2. Kalendarz Google:** Administracja → Integracje → wgraj plik klucza JSON konta usługi
(ten z Google Cloud). Potem każdy użytkownik podłącza swój kalendarz w Ustawieniach.

**6.3. Sprawdzanie certyfikatów E-SERVER i SMART:** na starym komputerze wyłączyliśmy je przez
FortiGate. Jeśli test z punktu 2.4 dał `OK 400`, napisz do mnie – przywrócimy pełne sprawdzanie
(login i hasło do SMART przechodzą tym połączeniem).

**6.4. Aktualizacje aplikacji** – od teraz zamiast paczek `.tar.gz`, na VM:
```bash
/opt/smartcrm/aktualizuj.sh
```
Skrypt sprawdza, czy na GitHubie jest nowa wersja, **robi kopię**, buduje i uruchamia nową wersję,
a przy błędzie sam wraca do poprzedniej.

**6.5. Po 2–3 tygodniach** bezproblemowej pracy usuń starą instalację z Windows:
```powershell
docker compose --project-directory C:\claude_code\smartcrm -f C:\claude_code\smartcrm\docker-compose.yml down -v
```
(`-v` usuwa dane starej instalacji – rób to dopiero, gdy VM działa i ma kopie zapasowe.)

---

## Ściąga poleceń na VM

Najpierw `ssh wiktor@192.168.1.60`, potem `cd /opt/smartcrm`.

| Co | Polecenie |
|---|---|
| Stan aplikacji (oba kontenery **healthy**) | `docker compose ps` |
| Ostatnie logi aplikacji (błędy) | `docker compose logs app --tail 100` |
| Restart aplikacji | `docker compose restart app` |
| Zatrzymanie / uruchomienie | `docker compose stop` / `docker compose up -d` |
| Kopia zapasowa teraz | `./backup.sh` |
| Lista kopii | `ls /opt/smartcrm-kopie` |
| Odtworzenie z kopii | `./przywroc.sh /opt/smartcrm-kopie/NAZWA_KOPII` |
| Aktualizacja aplikacji | `./aktualizuj.sh` |
| Wolne miejsce na dysku | `df -h /` |
| Aktualizacja systemu (raz w miesiącu) | `sudo apt update && sudo apt -y upgrade`, potem ewentualnie `sudo reboot` |

Aplikacja uruchamia się sama po restarcie VM – nic nie trzeba robić.

---

## Rozwiązywanie problemów

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| `ssh: connect to host … Connection timed out` | VM wyłączona albo port 22 zablokowany – sprawdź adres i zapytaj admina. |
| `permission denied while trying to connect to the Docker daemon` | Nie wylogowano się po instalacji Dockera (2.2). `exit` i zaloguj ponownie. |
| `hello-world` / budowanie: `x509`, `certificate`, `TLS handshake timeout` | FortiGate rozszywa HTTPS dla VM – wyjątek od inspekcji SSL (etap 0, punkt 7). |
| `git clone`: `Permission denied (publickey)` | Klucz nie jest dodany w GitHub → Deploy keys (3.2). Test: `ssh -T git@github.com` (ma odpowiedzieć „Hi … You've successfully authenticated”). |
| `przywroc.sh`: „DB_PASSWORD … różni się od hasła z kopii” | `.env` nie pochodzi z tej kopii: `cp ~/migracja/.env .env && sed -i 's/\r$//' .env`. |
| `./przywroc.sh: Permission denied` | `chmod +x /opt/smartcrm/*.sh` |
| `/usr/bin/env: ‘bash\r’: No such file or directory` | Skrypt zapisany z windowsowymi końcami linii: `sed -i 's/\r$//' /opt/smartcrm/*.sh` |
| Strona nie otwiera się z innych komputerów | Na VM `sudo ufw status` (8090 musi być ALLOW); zapora firmowa / VPN – admin. |
| Mapa bez podkładu, brak danych GPS lub Testów | VM bez dostępu do tych serwisów w internecie – admin (etap 0, punkty 6–7). |
| Aplikacja nie wstaje po aktualizacji | `aktualizuj.sh` sam wraca do poprzedniej wersji; szczegóły: `docker compose logs app --tail 100`. |

W razie wątpliwości: skopiuj komunikat z terminala i wyślij mi go – zanim spróbujesz czegoś na własną rękę.
