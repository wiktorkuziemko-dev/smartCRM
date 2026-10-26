# Migracja SmartCRM z Docker Desktop (Windows) na maszynę wirtualną z Linuksem

Instrukcja przeniesienia działającej aplikacji, razem z danymi, z komputera z Docker Desktop na maszynę
wirtualną (VM) z Ubuntu Server i Docker Engine. Na końcu jest opis utrzymania na nowej maszynie:
kopie zapasowe, aktualizacje, odtwarzanie.

**Czas:** około 1–2 godzin, z czego przerwa w pracy zespołu trwa około 30 minut (kroki 5–7).

## Spis treści

1. [Co się przenosi](#1-co-się-przenosi)
2. [Maszyna wirtualna – wymagania](#2-maszyna-wirtualna--wymagania)
3. [Przygotowanie VM](#3-przygotowanie-vm)
4. [Kod aplikacji na VM (git)](#4-kod-aplikacji-na-vm-git)
5. [Ostatnia kopia na Windows](#5-ostatnia-kopia-na-windows)
6. [Przeniesienie kopii na VM](#6-przeniesienie-kopii-na-vm)
7. [Odtworzenie danych na VM](#7-odtworzenie-danych-na-vm)
8. [Sprawdzenie i przełączenie zespołu](#8-sprawdzenie-i-przełączenie-zespołu)
9. [Utrzymanie na VM](#9-utrzymanie-na-vm)
10. [Rozwiązywanie problemów](#10-rozwiązywanie-problemów)

---

## 1. Co się przenosi

| Co | Gdzie jest teraz (Windows) | Jak trafia na VM |
|---|---|---|
| Kod aplikacji | `C:\claude_code\smartcrm` | Pobierany z GitHuba (`git clone`) – **nie kopiujemy** folderu z Windows |
| Baza danych (klienci, historia, zadania, użytkownicy i hasła, zdjęcia profilowe, logi, ustawienia integracji E-SERVER i Google) | wolumen Dockera `smartcrm_db-data` | `baza.dump` z kopii zapasowej |
| Załączniki (zdjęcia, PDF) | wolumen Dockera `smartcrm_uploads` | `zalaczniki.tgz` z kopii zapasowej |
| Ustawienia (hasło bazy, port) | `C:\claude_code\smartcrm\.env` | `.env` z kopii zapasowej |

Wszystko, co trzeba przenieść, jest w jednej kopii zrobionej skryptem `backup.ps1`. Użytkownicy logują się
na VM tymi samymi loginami i hasłami. Integracji nie trzeba konfigurować od nowa.

## 2. Maszyna wirtualna – wymagania

| | Minimum | Uwagi |
|---|---|---|
| System | **Ubuntu Server 24.04 LTS** (64-bit) | wsparcie do 2029 r.; bez interfejsu graficznego |
| Procesor | 2 vCPU | |
| Pamięć | 4 GB RAM | |
| Dysk | 40 GB | baza to dziesiątki MB, najwięcej zajmą załączniki i kopie |
| Sieć | **stały adres IP** w sieci firmowej | ustawiony w VM albo przez rezerwację DHCP na routerze |
| Internet | wyjście na HTTPS (443) i HTTP (80) | GitHub, aktualizacje systemu, Docker, E-SERVER, Google, mapy |

Platforma wirtualizacji (Hyper-V, VMware, Proxmox, VirtualBox, chmura) nie ma znaczenia. W ustawieniach
VM włącz automatyczne uruchamianie maszyny po starcie hosta.

> **Dlaczego Linux, a nie Windows z Docker Desktop?** Docker Engine na Linuksie działa jako usługa:
> aplikacja wstaje po restarcie maszyny bez logowania się kogokolwiek. Jest darmowy także w firmach
> (Docker Desktop wymaga płatnej licencji w firmach od 250 pracowników lub 10 mln USD przychodu)
> i zużywa mniej zasobów.

## 3. Przygotowanie VM

Podczas instalacji Ubuntu zaznacz **„Install OpenSSH server”**. Po instalacji połącz się z Windows
(PowerShell; zamień `admin` i adres na swoje):

```powershell
ssh admin@192.168.1.60
```

Na VM wykonaj kolejno:

```bash
# Aktualizacja systemu i automatyczne poprawki bezpieczeństwa
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades git
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# Strefa czasowa
sudo timedatectl set-timezone Europe/Warsaw

# Docker Engine + Docker Compose (oficjalny instalator Dockera)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# wyloguj się (exit) i zaloguj ponownie przez ssh, żeby uprawnienia zaczęły działać

# Zapora: tylko SSH i port aplikacji
sudo ufw allow OpenSSH
sudo ufw allow 8090/tcp
sudo ufw --force enable
```

Sprawdzenie po ponownym zalogowaniu:

```bash
docker run --rm hello-world     # powinno wypisać "Hello from Docker!"
docker compose version
```

> Zaporę możesz dodatkowo zawęzić do sieci firmowej, np. `sudo ufw allow from 192.168.1.0/24 to any port 8090`
> zamiast `sudo ufw allow 8090/tcp`.

## 4. Kod aplikacji na VM (git)

Kod pobieramy z GitHuba przez `git`. Dzięki temu aktualizacja to jedno polecenie `./aktualizuj.sh`,
bez ręcznego pobierania paczek. Repozytorium jest prywatne, więc VM potrzebuje **klucza tylko do odczytu**
(*deploy key*): pozwala pobierać kod, ale nie pozwala niczego w nim zmienić.

**4.1. Klucz na VM:**

```bash
ssh-keygen -t ed25519 -N "" -C "smartcrm-vm" -f ~/.ssh/smartcrm_github
cat ~/.ssh/smartcrm_github.pub      # skopiuj całą wypisaną linię
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/smartcrm_github
  IdentitiesOnly yes
EOF
```

**4.2. Klucz na GitHubie:** repozytorium `wiktorkuziemko-dev/smartCRM` → **Settings → Deploy keys →
Add deploy key** → tytuł `VM SmartCRM`, wklej linię z poprzedniego kroku, **nie** zaznaczaj „Allow write
access” → **Add key**.

**4.3. Pobranie kodu:**

```bash
sudo mkdir -p /opt/smartcrm /opt/smartcrm-kopie
sudo chown $USER: /opt/smartcrm /opt/smartcrm-kopie
git clone -b main git@github.com:wiktorkuziemko-dev/smartCRM.git /opt/smartcrm
cd /opt/smartcrm && ls
```

Przy pierwszym połączeniu potwierdź `yes`. W folderze powinny być m.in. `docker-compose.yml`, `backup.sh`,
`przywroc.sh`, `aktualizuj.sh`.

> Gałąź `main` jest właściwa po scaleniu zmian do `main`. Dopóki zmiany są na gałęzi
> `feature/tagi-widocznosc`, użyj w poleceniu `-b feature/tagi-widocznosc`. Późniejsza zmiana na `main`:
> `git fetch origin main && git checkout main`.

**Na tym etapie nie uruchamiaj jeszcze aplikacji.**

## 5. Ostatnia kopia na Windows

1. **Uprzedź zespół**, że od tej chwili do przełączenia nie wolno nic zmieniać w SmartCRM. Wszystko,
   co ktoś zapisze po zrobieniu kopii, nie trafi na VM.
2. Zrób kopię (PowerShell):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1
   ```
   Na końcu musi być zielone `OK: kopia gotowa (...)`. Zapamiętaj liczbę klientów.
3. Zatrzymaj starą instancję, żeby nikt przez pomyłkę nie pracował dalej na Windows:
   ```powershell
   docker compose --project-directory C:\claude_code\smartcrm stop
   ```

## 6. Przeniesienie kopii na VM

Kopia jest w folderze z datą, np. `C:\claude_code\smartcrm-kopie\2026-10-27_180000`. Skopiuj go na VM
poleceniem `scp` (wbudowane w Windows 10/11; zamień nazwę folderu, użytkownika i adres). Na VM powstanie
folder `migracja` w katalogu domowym z plikami kopii:

```powershell
scp -r C:\claude_code\smartcrm-kopie\2026-10-27_180000 admin@192.168.1.60:migracja
```

Zamiast `scp` możesz użyć programu **WinSCP**: przeciągnij zawartość folderu kopii (pliki `baza.dump`,
`zalaczniki.tgz`, `.env`, `info.txt`) do nowego folderu `migracja` w katalogu domowym.
Sprawdzenie na VM: `ls -a ~/migracja`.

> Kopia zawiera dane wszystkich klientów i hasła z `.env`. Po udanej migracji usuń ją z miejsc
> pośrednich (pendrive) i na VM: `rm -rf ~/migracja`.

## 7. Odtworzenie danych na VM

```bash
cd /opt/smartcrm

# Ustawienia z kopii – to samo hasło do bazy co w kopii (warunek odtworzenia).
# sed usuwa windowsowe końce linii (CRLF) z pliku przeniesionego z Windows.
cp ~/migracja/.env .env
sed -i 's/\r$//' .env
chmod 600 .env
grep APP_PORT .env              # powinno być APP_PORT=8090

# Odtworzenie: buduje i uruchamia aplikację, wgrywa bazę i załączniki z kopii.
./przywroc.sh ~/migracja
```

Skrypt poprosi o potwierdzenie (wpisz `TAK`). Pierwsze uruchomienie buduje aplikację, co trwa kilka
minut. Na końcu wypisze `Gotowe. Klientów w bazie: …` – liczba musi się zgadzać z kopią
(`cat ~/migracja/info.txt`) – oraz oba kontenery ze stanem **healthy**.

## 8. Sprawdzenie i przełączenie zespołu

1. Z komputera w sieci otwórz `http://192.168.1.60:8090` (adres VM) i zaloguj się swoim kontem.
2. Sprawdź:
   - [ ] liczbę klientów i kilka kart klientów (historia, osoby kontaktowe, zadania),
   - [ ] otwieranie załączników,
   - [ ] zdjęcia profilowe, mapę GPS i statystyki jazdy (E-SERVER),
   - [ ] Administracja → Logi (powinna być widoczna historia sprzed migracji),
   - [ ] jeśli używacie Kalendarza Google – dodanie zadania typu telefon.
3. Podaj zespołowi nowy adres. Jeśli łączycie się przez VPN, sprawdź, czy VPN obejmuje adres VM.
4. Starą instancję na Windows **zostaw zatrzymaną przez 2–3 tygodnie** (droga powrotu), potem możesz ją usunąć:
   ```powershell
   docker compose --project-directory C:\claude_code\smartcrm down
   ```
   (`down` bez `-v` zostawia dane w Dockerze; `down -v` usuwa je bezpowrotnie.)

**Powrót do Windows, gdyby coś poszło nie tak:** zatrzymaj VM (`docker compose stop` w `/opt/smartcrm`)
i uruchom ponownie starą instancję (`docker compose --project-directory C:\claude_code\smartcrm start`).
Zmiany wprowadzone w międzyczasie na VM trzeba wtedy przenieść tą samą drogą w odwrotną stronę
(`backup.sh` na VM → `przywroc.ps1` na Windows).

## 9. Utrzymanie na VM

### 9.1. Codzienna kopia zapasowa

`backup.sh` robi to samo co `backup.ps1` na Windows: zrzut bazy (sprawdzany), załączniki, `.env`
i `info.txt` w folderze `/opt/smartcrm-kopie/<data_godzina>`. Zostawia 14 ostatnich kopii,
a wynik dopisuje do `/opt/smartcrm-kopie/backup.log`.

Ręcznie:

```bash
/opt/smartcrm/backup.sh                         # domyślnie /opt/smartcrm-kopie, 14 kopii
/opt/smartcrm/backup.sh -c /mnt/nas/smartcrm -z 30   # inny folder i liczba kopii
```

Automatycznie codziennie o 22:00 – `crontab -e` i dopisz linię:

```cron
0 22 * * * /opt/smartcrm/backup.sh >> /opt/smartcrm-kopie/cron.log 2>&1
```

**Kopie poza VM.** Kopia na dysku tej samej VM nie chroni przed awarią maszyny ani hosta. Przykład:
zasób sieciowy NAS lub Windows (`\\nas\kopie`) zamontowany na stałe:

```bash
sudo apt -y install cifs-utils
sudo mkdir -p /mnt/nas
# dane logowania do zasobu – plik czytelny tylko dla roota
sudo sh -c 'printf "username=kopie\npassword=HASLO\n" > /root/.nas && chmod 600 /root/.nas'
echo "//192.168.1.10/kopie /mnt/nas cifs credentials=/root/.nas,uid=$(id -u),gid=$(id -g),_netdev 0 0" | sudo tee -a /etc/fstab
sudo mount -a
```

i w `crontab -e` zamiast poprzedniej linii:

```cron
0 22 * * * /opt/smartcrm/backup.sh -c /mnt/nas/smartcrm -z 30 >> /opt/smartcrm-kopie/cron.log 2>&1
```

Dodatkowo możesz włączyć migawki (snapshoty) całej VM w platformie wirtualizacji, np. raz w tygodniu.
Nie zastępują one `backup.sh`, bo migawka działającej bazy nie zawsze jest spójna.

**Kontrola:** raz w tygodniu `tail /opt/smartcrm-kopie/backup.log` (same `OK`), raz na kwartał próbne
odtworzenie na osobnej VM (rozdział 9.3).

### 9.2. Aktualizacja aplikacji

```bash
/opt/smartcrm/aktualizuj.sh
```

Skrypt:
1. sprawdza na GitHubie, czy jest nowa wersja (jeśli nie – kończy i nic nie zmienia),
2. pokazuje listę zmian,
3. **robi kopię zapasową** (zmiany w strukturze bazy po aktualizacji są nieodwracalne),
4. pobiera nową wersję, buduje ją i uruchamia, czekając, aż aplikacja odpowie,
5. jeśli nowa wersja się nie uruchomi – sam wraca do poprzedniej i wypisuje polecenie odtworzenia
   kopii sprzed aktualizacji, gdyby było potrzebne.

Na końcu usuwa stare, nieużywane obrazy Dockera, żeby nie zapełniały dysku.

### 9.3. Odtworzenie z kopii

```bash
/opt/smartcrm/przywroc.sh /opt/smartcrm-kopie/2026-11-03_220000
```

Przed nadpisaniem danych skrypt robi kopię obecnego stanu, więc odtworzenie da się cofnąć. Odtwarza
także kopie z Windows (`backup.ps1`) – na tym opiera się migracja.

**Próbne odtworzenie (zalecane raz na kwartał):** na osobnej, tymczasowej VM wykonaj kroki 3, 4 i 7
z najnowszą kopią. Sprawdź, czy dane są kompletne, potem usuń tymczasową VM.

### 9.4. Codzienna obsługa – ściąga

| Co | Polecenie (w `/opt/smartcrm`) |
|---|---|
| Stan aplikacji | `docker compose ps` (oba kontenery **healthy**) |
| Logi aplikacji (błędy) | `docker compose logs app --tail 100` |
| Restart aplikacji | `docker compose restart app` |
| Zatrzymanie / uruchomienie | `docker compose stop` / `docker compose up -d` |
| Miejsce na dysku | `df -h /` oraz `docker system df` |
| Rozmiar bazy | `docker compose exec db psql -U smartcrm -c "select pg_size_pretty(pg_database_size('smartcrm'))"` |
| Aktualizacje systemu | automatyczne (unattended-upgrades); raz w miesiącu `sudo apt update && sudo apt -y upgrade` i ewentualnie `sudo reboot` |

Aplikacja uruchamia się sama po restarcie VM (`restart: unless-stopped` + usługa Docker).

### 9.5. Bezpieczeństwo

- Aplikacja działa po HTTP – udostępniaj ją **tylko w sieci firmowej i przez VPN**. Nie przekierowuj
  portu 8090 z internetu.
- Logowanie do VM przez SSH najlepiej kluczem zamiast hasła: na Windows `ssh-keygen`, potem
  `type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh admin@192.168.1.60 "cat >> ~/.ssh/authorized_keys"`.
- Pliki `.env` i folder kopii zawierają hasła i dane klientów – dostęp tylko dla administratora VM.
- Konta odchodzących pracowników w SmartCRM **blokuj** (nie usuwaj) – historia i logi zostają.

## 10. Rozwiązywanie problemów

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| `permission denied ... docker.sock` | Nie wylogowano się po `usermod -aG docker`. Wyloguj się (`exit`) i zaloguj ponownie. |
| `git clone`: `Permission denied (publickey)` | Klucz z kroku 4.1 nie jest dodany w Deploy keys albo brakuje wpisu w `~/.ssh/config`. Sprawdź: `ssh -T git@github.com`. |
| `przywroc.sh`: „DB_PASSWORD … różni się od hasła z kopii” | `.env` nie pochodzi z tej kopii. Powtórz `cp ~/migracja/.env .env && sed -i 's/\r$//' .env`. |
| Nie otwiera się z innych komputerów | `sudo ufw status` (port 8090 musi być ALLOW), adres VM (`ip -4 addr`), trasa przez VPN. |
| `./backup.sh: Permission denied` | Brak uprawnienia do uruchamiania: `chmod +x /opt/smartcrm/*.sh`. |
| `/usr/bin/env: ‘bash\r’: No such file or directory` | Skrypt edytowany na Windows (CRLF): `sed -i 's/\r$//' /opt/smartcrm/*.sh`. |
| Mapa bez podkładu / brak danych GPS | VM bez dostępu do internetu: `curl -I https://tile.openstreetmap.org` i `curl -I https://e-server.com.pl`. |
| Aplikacja nie wstaje po aktualizacji | `aktualizuj.sh` sam wraca do poprzedniej wersji; szczegóły w `docker compose logs app --tail 100`. |
