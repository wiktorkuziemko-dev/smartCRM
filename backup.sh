#!/usr/bin/env bash
# Kopia zapasowa SmartCRM (Linux): baza danych, załączniki i plik .env.
#
# Tworzy folder <cel>/<data_godzina> z plikami:
#   baza.dump        – zrzut bazy PostgreSQL (pg_dump -Fc, sprawdzany po utworzeniu)
#   zalaczniki.tgz   – wszystkie załączniki
#   .env             – hasła i ustawienia potrzebne do odtworzenia
#   info.txt         – podsumowanie (liczba klientów, rozmiary)
# Zostawia tylko <zachowaj> najnowszych kopii. Wynik dopisuje do <cel>/backup.log.
# Aplikacja musi działać; w trakcie kopii działa normalnie.
#
# Użycie:  ./backup.sh [-c /opt/smartcrm-kopie] [-z 14]
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEL="$(dirname "$APP")/smartcrm-kopie"
ZACHOWAJ=14
while getopts "c:z:a:" opt; do
  case $opt in
    c) CEL="$OPTARG" ;;
    z) ZACHOWAJ="$OPTARG" ;;
    a) APP="$(cd "$OPTARG" && pwd)" ;;
    *) echo "Użycie: $0 [-c folder_kopii] [-z liczba_kopii] [-a folder_aplikacji]"; exit 2 ;;
  esac
done

mkdir -p "$CEL"
LOG="$CEL/backup.log"
zapisz() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG"; }
compose() { docker compose --project-directory "$APP" -f "$APP/docker-compose.yml" "$@"; }

# Nazwa z sekundami; nigdy nie nadpisujemy istniejącej kopii.
FOLDER="$CEL/$(date '+%Y-%m-%d_%H%M%S')"
while [ -e "$FOLDER" ]; do sleep 1; FOLDER="$CEL/$(date '+%Y-%m-%d_%H%M%S')"; done

blad() {
  zapisz "BŁĄD: ${1:-kopia przerwana (linia $BASH_LINENO)}"
  rm -rf "$FOLDER"
  exit 1
}
trap 'blad' ERR

zapisz "Start kopii: $FOLDER"
uslugi="$(compose ps --status running --services)"
for u in db app; do
  grep -qx "$u" <<<"$uslugi" || blad "kontener '$u' nie działa – uruchom aplikację: docker compose up -d"
done
mkdir -p "$FOLDER"
chmod 700 "$FOLDER"   # kopia zawiera dane klientów i hasła

# 1. Baza danych – zrzut w kontenerze, kontrola poprawności, skopiowanie na dysk.
compose exec -T db pg_dump -U smartcrm -d smartcrm -Fc -f /tmp/smartcrm.dump
compose exec -T db pg_restore -l /tmp/smartcrm.dump > /dev/null
compose cp db:/tmp/smartcrm.dump "$FOLDER/baza.dump" > /dev/null
compose exec -T db rm -f /tmp/smartcrm.dump
KLIENCI="$(compose exec -T db psql -U smartcrm -d smartcrm -tAc 'select count(*) from clients' | tr -d '[:space:]')"

# 2. Załączniki.
compose exec -T app tar czf /tmp/zalaczniki.tgz -C /data/uploads .
compose cp app:/tmp/zalaczniki.tgz "$FOLDER/zalaczniki.tgz" > /dev/null
compose exec -T app rm -f /tmp/zalaczniki.tgz

# 3. Ustawienia (hasła do bazy) – bez nich kopii nie da się odtworzyć.
cp "$APP/.env" "$FOLDER/.env"

rozmiar() { du -h "$FOLDER/$1" | cut -f1; }
cat > "$FOLDER/info.txt" <<EOF
Kopia SmartCRM z $(date '+%Y-%m-%d %H:%M')
Klientów w bazie: $KLIENCI
baza.dump: $(rozmiar baza.dump)
zalaczniki.tgz: $(rozmiar zalaczniki.tgz)
Odtworzenie: <folder aplikacji>/przywroc.sh $FOLDER
EOF

# 4. Rotacja – zostaw tylko najnowsze kopie.
trap - ERR
find "$CEL" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4,6}$' \
  | sort -r | tail -n +"$((ZACHOWAJ + 1))" | while read -r stara; do
    rm -rf "$stara"; zapisz "Usunięto starą kopię $(basename "$stara")"
  done

zapisz "OK: kopia gotowa (klientów: $KLIENCI; baza $(rozmiar baza.dump), załączniki $(rozmiar zalaczniki.tgz))"
