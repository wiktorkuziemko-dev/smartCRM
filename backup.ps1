<#
.SYNOPSIS
  Kopia zapasowa SmartCRM: baza danych, załączniki i plik .env.

.DESCRIPTION
  Tworzy folder <Cel>\<data_godzina> z plikami:
    baza.dump        – zrzut bazy PostgreSQL (format pg_dump -Fc, sprawdzany po utworzeniu)
    zalaczniki.tgz   – wszystkie załączniki (zdjęcia, PDF itd.)
    .env             – hasła i ustawienia potrzebne do odtworzenia
    info.txt         – podsumowanie (liczba klientów, rozmiary)
  Zostawia tylko <Zachowaj> najnowszych kopii. Wynik dopisuje do <Cel>\backup.log.
  Aplikacja musi działać (docker compose up). W trakcie kopii działa normalnie.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\backup.ps1 -Cel D:\Kopie\SmartCRM -Zachowaj 30
#>
param(
  [string]$Aplikacja = $PSScriptRoot,
  [string]$Cel = '',
  [int]$Zachowaj = 14
)

$ErrorActionPreference = 'Stop'
$Aplikacja = (Resolve-Path -LiteralPath $Aplikacja).Path.TrimEnd('\', '/')
if (-not $Cel) { $Cel = Join-Path (Split-Path -Parent $Aplikacja) 'smartcrm-kopie' }
New-Item -ItemType Directory -Force -Path $Cel | Out-Null
$log = Join-Path $Cel 'backup.log'

function Zapisz([string]$tekst, [string]$kolor = 'Gray') {
  $linia = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $tekst"
  Write-Host $linia -ForegroundColor $kolor
  Add-Content -LiteralPath $log -Value $linia -Encoding UTF8
}

# docker compose dla tej aplikacji; komunikaty postępu (stderr) nie przerywają skryptu w PowerShell 5.1.
function Compose {
  $ErrorActionPreference = 'Continue'
  & docker compose --project-directory $Aplikacja -f (Join-Path $Aplikacja 'docker-compose.yml') @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') – błąd (kod $LASTEXITCODE)" }
}

# Nazwa z sekundami; nigdy nie nadpisujemy istniejącej kopii.
$folder = Join-Path $Cel (Get-Date -Format 'yyyy-MM-dd_HHmmss')
while (Test-Path -LiteralPath $folder) { Start-Sleep -Seconds 1; $folder = Join-Path $Cel (Get-Date -Format 'yyyy-MM-dd_HHmmss') }
try {
  Zapisz "Start kopii: $folder"
  $uslugi = Compose ps --status running --services
  foreach ($u in 'db', 'app') {
    if ($uslugi -notcontains $u) { throw "Kontener '$u' nie działa – uruchom aplikację (docker compose up -d) i Docker Desktop." }
  }
  New-Item -ItemType Directory -Force -Path $folder | Out-Null

  # 1. Baza danych – zrzut wewnątrz kontenera, kontrola poprawności, skopiowanie na dysk.
  Compose exec -T db pg_dump -U smartcrm -d smartcrm -Fc -f /tmp/smartcrm.dump
  Compose exec -T db pg_restore -l /tmp/smartcrm.dump | Out-Null
  Compose cp db:/tmp/smartcrm.dump (Join-Path $folder 'baza.dump') | Out-Null
  Compose exec -T db rm -f /tmp/smartcrm.dump
  $klienci = (Compose exec -T db psql -U smartcrm -d smartcrm -tAc 'select count(*) from clients') -join ''

  # 2. Załączniki.
  Compose exec -T app tar czf /tmp/zalaczniki.tgz -C /data/uploads .
  Compose cp app:/tmp/zalaczniki.tgz (Join-Path $folder 'zalaczniki.tgz') | Out-Null
  Compose exec -T app rm -f /tmp/zalaczniki.tgz

  # 3. Ustawienia (hasła do bazy) – bez nich kopii nie da się odtworzyć.
  Copy-Item -LiteralPath (Join-Path $Aplikacja '.env') -Destination (Join-Path $folder '.env')

  $mb = {
    param($p)
    $b = (Get-Item -LiteralPath (Join-Path $folder $p)).Length
    if ($b -lt 1MB) { '{0:N0} KB' -f [math]::Max(1, $b / 1KB) } else { '{0:N1} MB' -f ($b / 1MB) }
  }
  $info = @(
    "Kopia SmartCRM z $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    "Klientów w bazie: $($klienci.Trim())",
    "baza.dump: $(& $mb 'baza.dump')",
    "zalaczniki.tgz: $(& $mb 'zalaczniki.tgz')",
    'Odtworzenie: powershell -ExecutionPolicy Bypass -File <folder aplikacji>\przywroc.ps1 -Kopia <ten folder>'
  )
  Set-Content -LiteralPath (Join-Path $folder 'info.txt') -Value $info -Encoding UTF8

  # 4. Rotacja – zostaw tylko najnowsze kopie.
  $stare = Get-ChildItem -LiteralPath $Cel -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4,6}$' } |
    Sort-Object Name -Descending | Select-Object -Skip $Zachowaj
  foreach ($s in $stare) { Remove-Item -LiteralPath $s.FullName -Recurse -Force; Zapisz "Usunięto starą kopię $($s.Name)" }

  Zapisz "OK: kopia gotowa ($($info[1]); baza $(& $mb 'baza.dump'), załączniki $(& $mb 'zalaczniki.tgz'))" 'Green'
}
catch {
  Zapisz "BŁĄD: $($_.Exception.Message)" 'Red'
  if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue }
  exit 1
}
