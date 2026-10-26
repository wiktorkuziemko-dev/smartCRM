#!/usr/bin/env bash
# Odtwarza SmartCRM z kopii utworzonej przez backup.sh lub backup.ps1 (Windows) – służy też do migracji.
#
# UWAGA: zastępuje obecne dane (bazę i załączniki) danymi z kopii.
# Jeśli aplikacja ma już dane, przed odtworzeniem robi kopię bieżącego stanu (backup.sh), żeby dało się cofnąć.
# Hasło do bazy (DB_PASSWORD w .env) musi być takie jak w kopii.
#
# Użycie:  ./przywroc.sh /opt/smartcrm-kopie/2026-10-27_180000 [-y]
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KOPIA="${1:-}"
TAK="${2:-}"
[ -n "$KOPIA" ] || { echo "Użycie: $0 <folder kopii> [-y]"; exit 2; }
KOPIA="$(cd "$KOPIA" && pwd)"
compose() { docker compose --project-directory "$APP" -f "$APP/docker-compose.yml" "$@"; }
przerwij() { echo -e "\nBŁĄD: $*" >&2; exit 1; }

for f in baza.dump zalaczniki.tgz .env; do
  [ -f "$KOPIA/$f" ] || przerwij "w kopii brakuje pliku $f"
done
[ -f "$APP/.env" ] || przerwij "brak pliku $APP/.env – skopiuj go z kopii: cp '$KOPIA/.env' '$APP/.env'"
haslo() { grep -E '^DB_PASSWORD=' "$1" | head -1 | cut -d= -f2- | tr -d '\r'; }
[ "$(haslo "$APP/.env")" = "$(haslo "$KOPIA/.env")" ] \
  || przerwij "DB_PASSWORD w $APP/.env różni się od hasła z kopii. Przy migracji skopiuj .env z kopii."

echo "Kopia: $KOPIA"
[ -f "$KOPIA/info.txt" ] && sed 's/^/  /' "$KOPIA/info.txt"
if [ "$TAK" != "-y" ]; then
  read -r -p "Zastąpić obecne dane SmartCRM danymi z tej kopii? Wpisz TAK: " odp
  [ "$odp" = "TAK" ] || { echo "Przerwano."; exit 1; }
fi

# Aplikacja musi działać (pierwsze uruchomienie tworzy pustą bazę).
echo "==> Uruchamiam aplikację"
compose up -d
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q db)")" = "healthy" ] && break; sleep 2
done

# Kopia bezpieczeństwa obecnego stanu – tylko jeśli są jakiekolwiek dane.
KLIENCI="$(compose exec -T db psql -U smartcrm -d smartcrm -tAc "select count(*) from clients" 2>/dev/null | tr -d '[:space:]' || echo 0)"
if [ "${KLIENCI:-0}" != "0" ]; then
  echo "==> Kopia obecnego stanu ($KLIENCI klientów) przed odtworzeniem"
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)")" = "healthy" ] && break; sleep 2
  done
  "$APP/backup.sh" -a "$APP" || przerwij "nie udało się zrobić kopii obecnego stanu – odtwarzanie przerwane"
fi

echo "==> Odtwarzam bazę danych"
compose stop app
compose cp "$KOPIA/baza.dump" db:/tmp/odtworz.dump > /dev/null
compose exec -T db pg_restore -U smartcrm -d smartcrm --clean --if-exists --no-owner --single-transaction /tmp/odtworz.dump
compose exec -T db rm -f /tmp/odtworz.dump

echo "==> Odtwarzam załączniki"
compose start app
compose cp "$KOPIA/zalaczniki.tgz" app:/tmp/odtworz.tgz > /dev/null
compose exec -T app sh -c 'find /data/uploads -mindepth 1 -delete && tar xzf /tmp/odtworz.tgz -C /data/uploads'
compose exec -T -u root app rm -f /tmp/odtworz.tgz

echo "==> Czekam na uruchomienie aplikacji"
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)")" = "healthy" ] && break; sleep 2
done
KLIENCI="$(compose exec -T db psql -U smartcrm -d smartcrm -tAc 'select count(*) from clients' | tr -d '[:space:]')"
echo -e "\nGotowe. Klientów w bazie: $KLIENCI. Stan kontenerów:"
compose ps
