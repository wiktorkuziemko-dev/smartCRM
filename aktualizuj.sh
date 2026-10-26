#!/usr/bin/env bash
# Aktualizuje SmartCRM (Linux) do najnowszej wersji z GitHuba.
#
#  1. Sprawdza, czy na GitHubie jest nowsza wersja (git fetch) – jeśli nie, kończy.
#  2. Robi kopię zapasową (backup.sh) – migracje bazy po aktualizacji są nieodwracalne.
#  3. Pobiera nową wersję, buduje i uruchamia; czeka, aż aplikacja odpowie.
#  4. Przy błędzie wraca do poprzedniej wersji kodu i podaje polecenie odtworzenia kopii.
#
# Użycie:  ./aktualizuj.sh
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP"
compose() { docker compose --project-directory "$APP" -f "$APP/docker-compose.yml" "$@"; }
krok() { echo -e "\n==> $*"; }
przerwij() { echo -e "\nBŁĄD: $*" >&2; exit 1; }

[ -d .git ] || przerwij "$APP nie jest klonem repozytorium git (zob. MIGRACJA.md, krok 2)."
[ -f .env ] || przerwij "brak pliku $APP/.env"
[ -z "$(git status --porcelain --untracked-files=no)" ] || przerwij "w folderze są lokalne zmiany plików aplikacji (git status) – nie aktualizuję."

GALAZ="$(git rev-parse --abbrev-ref HEAD)"
krok "Sprawdzam nową wersję (gałąź $GALAZ)"
git fetch --quiet origin "$GALAZ"
OBECNA="$(git rev-parse HEAD)"
NOWA="$(git rev-parse "origin/$GALAZ")"
if [ "$OBECNA" = "$NOWA" ]; then
  echo "    Masz najnowszą wersję ($(git log -1 --format='%h, %cd' --date=short))."
  exit 0
fi
echo "    Zmiany od obecnej wersji:"
git log --format='      - %s' "$OBECNA..$NOWA"

krok "Kopia zapasowa przed aktualizacją"
"$APP/backup.sh" || przerwij "kopia się nie udała – aktualizacja przerwana (nic nie zmieniono)."
KOPIA="$(ls -1d "$(dirname "$APP")/smartcrm-kopie"/*_* 2>/dev/null | sort | tail -1)"

czekaj() {
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null)" = "healthy" ] && return 0
    sleep 2
  done
  return 1
}

krok "Pobieram i uruchamiam nową wersję"
git merge --ff-only --quiet "origin/$GALAZ"
if compose up -d --build && czekaj; then
  echo -e "\nGotowe: $(git log -1 --format='%h – %s')"
  compose ps
  docker image prune -f > /dev/null   # usuwa stare, nieużywane obrazy
  exit 0
fi

echo -e "\nNowa wersja nie uruchomiła się. Ostatnie logi:" >&2
compose logs app --tail 40 >&2 || true
krok "Wracam do poprzedniej wersji kodu ($OBECNA)"
git reset --hard --quiet "$OBECNA"
compose up -d --build
if czekaj; then
  echo "Poprzednia wersja działa."
else
  echo "Poprzednia wersja nie startuje – baza mogła zostać już zmieniona przez nową wersję."
  echo "Odtwórz kopię sprzed aktualizacji:  $APP/przywroc.sh $KOPIA"
fi
exit 1
