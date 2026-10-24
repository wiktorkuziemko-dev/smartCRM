<#
.SYNOPSIS
  Odtwarza SmartCRM z kopii utworzonej przez backup.ps1.

.DESCRIPTION
  UWAGA: zastępuje obecne dane (bazę i załączniki) danymi z kopii.
  Przed odtworzeniem automatycznie robi kopię bieżącego stanu (backup.ps1), żeby dało się cofnąć.
  Hasło do bazy musi być takie jak w kopii – skrypt porównuje DB_PASSWORD z plikiem .env z kopii.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\przywroc.ps1 -Kopia C:\claude_code\smartcrm-kopie\2026-10-24_1230
#>
param(
  [Parameter(Mandatory = $true)][string]$Kopia,
  [string]$Aplikacja = $PSScriptRoot,
  [switch]$BezPytania
)

$ErrorActionPreference = 'Stop'
$Aplikacja = (Resolve-Path -LiteralPath $Aplikacja).Path.TrimEnd('\', '/')
$Kopia = (Resolve-Path -LiteralPath $Kopia).Path.TrimEnd('\', '/')

function Compose {
  $ErrorActionPreference = 'Continue'
  & docker compose --project-directory $Aplikacja -f (Join-Path $Aplikacja 'docker-compose.yml') @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') – błąd (kod $LASTEXITCODE)" }
}
function HasloBazy([string]$plik) {
  $l = Get-Content -LiteralPath $plik | Where-Object { $_ -match '^\s*DB_PASSWORD\s*=' } | Select-Object -First 1
  if ($l) { return ($l -replace '^\s*DB_PASSWORD\s*=\s*', '').Trim() }
  return ''
}

try {
  foreach ($p in 'baza.dump', 'zalaczniki.tgz', '.env') {
    if (-not (Test-Path -LiteralPath (Join-Path $Kopia $p))) { throw "W kopii $Kopia brakuje pliku $p" }
  }
  if ((HasloBazy (Join-Path $Kopia '.env')) -ne (HasloBazy (Join-Path $Aplikacja '.env'))) {
    throw "DB_PASSWORD w $Aplikacja\.env różni się od tego w kopii. Jeśli odtwarzasz na nowym komputerze, skopiuj najpierw plik .env z kopii do folderu aplikacji i uruchom aplikację (docker compose up -d)."
  }
  Write-Host (Get-Content -LiteralPath (Join-Path $Kopia 'info.txt') -ErrorAction SilentlyContinue | Select-Object -First 2 | Out-String)
  if (-not $BezPytania) {
    $odp = Read-Host 'Obecne dane zostaną ZASTĄPIONE danymi z kopii. Aby kontynuować, wpisz PRZYWRÓĆ'
    if ($odp.Trim().ToUpper() -notin @('PRZYWRÓĆ', 'PRZYWROC')) { Write-Host 'Anulowano.'; exit 1 }
  }

  Write-Host "`n==> Kopia bieżącego stanu (na wszelki wypadek)" -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot 'backup.ps1') -Aplikacja $Aplikacja -Zachowaj 1000
  if ($LASTEXITCODE -ne 0) { throw 'Nie udało się zrobić kopii bieżącego stanu – przerywam.' }

  Write-Host "`n==> Odtwarzam bazę danych" -ForegroundColor Cyan
  Compose stop app
  Compose cp (Join-Path $Kopia 'baza.dump') db:/tmp/odtworz.dump
  Compose exec -T db pg_restore -U smartcrm -d smartcrm --clean --if-exists --no-owner --single-transaction /tmp/odtworz.dump
  Compose exec -T db rm -f /tmp/odtworz.dump

  Write-Host "`n==> Odtwarzam załączniki" -ForegroundColor Cyan
  Compose start app
  Compose cp (Join-Path $Kopia 'zalaczniki.tgz') app:/tmp/odtworz.tgz
  Compose exec -T app sh -c 'find /data/uploads -mindepth 1 -delete && tar xzf /tmp/odtworz.tgz -C /data/uploads'
  # Plik skopiowany przez "docker compose cp" należy do roota – usuwamy go jako root.
  Compose exec -T -u root app rm -f /tmp/odtworz.tgz

  Write-Host "`nGotowe – dane odtworzone z $Kopia. Odśwież aplikację w przeglądarce." -ForegroundColor Green
}
catch {
  Write-Host "`nBŁĄD: $($_.Exception.Message)" -ForegroundColor Red
  try { Compose start app | Out-Null } catch { }
  exit 1
}
