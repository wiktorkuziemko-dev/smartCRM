<#
.SYNOPSIS
  Aktualizuje SmartCRM do nowej wersji z paczki .tar.gz pobranej z GitHuba.

.DESCRIPTION
  1. Sprawdza folder aplikacji (musi zawierać .env i docker-compose.yml).
  2. Bierze najnowszą paczkę smartCRM*.tar.gz z folderu Pobrane (albo wskazaną w -Paczka)
     i sprawdza, czy zawiera inną wersję niż obecna.
  3. Zatrzymuje aplikację, podmienia folder (stara wersja trafia do "<nazwa>-poprzednia-wersja"),
     kopiuje .env, buduje i uruchamia nową wersję.
  4. Przy błędzie przywraca poprzednią wersję. Dane (baza, załączniki) są w Dockerze i nie są ruszane.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\claude_code\smartcrm\aktualizuj.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\aktualizuj.ps1 -Aplikacja C:\claude_code\smartcrm -Paczka D:\paczka.tar.gz
#>
param(
  [string]$Aplikacja = $PSScriptRoot,
  [string]$Paczka = ''
)

$ErrorActionPreference = 'Stop'

function Krok([string]$tekst) { Write-Host "`n==> $tekst" -ForegroundColor Cyan }
function Ok([string]$tekst) { Write-Host "    $tekst" -ForegroundColor Green }
function Przerwij([string]$tekst) { Write-Host "`nBŁĄD: $tekst" -ForegroundColor Red; exit 1 }

# Uruchamia docker/tar i przerywa, gdy polecenie zakończy się błędem.
# Komunikaty postępu dockera trafiają na stderr – w Windows PowerShell 5.1 nie mogą przerywać skryptu.
function Uruchom([string]$opis, [scriptblock]$polecenie) {
  $ErrorActionPreference = 'Continue'
  & $polecenie
  if ($LASTEXITCODE -ne 0) { throw "$opis – polecenie zakończyło się błędem (kod $LASTEXITCODE)" }
}

# Odcisk wersji: skrót zawartości plików kodu (bez .env), żeby wykryć starą paczkę.
function OdciskWersji([string]$folder) {
  $pliki = Get-ChildItem -Path $folder -Recurse -File |
    Where-Object { $_.Name -ne '.env' -and $_.FullName -notmatch '[\\/](node_modules|dist|\.git)[\\/]' -and $_.Extension -ne '.ps1' } |
    Sort-Object FullName
  $wpisy = foreach ($p in $pliki) {
    $wzgledna = $p.FullName.Substring($folder.Length).Replace('\', '/')
    "$wzgledna=$((Get-FileHash -Algorithm SHA256 -LiteralPath $p.FullName).Hash)"
  }
  $bajty = [System.Text.Encoding]::UTF8.GetBytes(($wpisy -join "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return [System.BitConverter]::ToString($sha.ComputeHash($bajty))
}

function PortAplikacji([string]$folder) {
  $linia = Get-Content -LiteralPath (Join-Path $folder '.env') | Where-Object { $_ -match '^\s*APP_PORT\s*=\s*(\d+)' } | Select-Object -First 1
  if ($linia -and $linia -match '(\d+)\s*$') { return $Matches[1] }
  return '8080'
}

# ---------------------------------------------------------------------------
Krok 'Sprawdzam folder aplikacji'
if (-not $Aplikacja) { Przerwij 'Podaj folder aplikacji: -Aplikacja C:\sciezka\smartcrm' }
$Aplikacja = (Resolve-Path -LiteralPath $Aplikacja).Path.TrimEnd('\', '/')
foreach ($plik in '.env', 'docker-compose.yml') {
  if (-not (Test-Path -LiteralPath (Join-Path $Aplikacja $plik))) {
    Przerwij "W folderze $Aplikacja brakuje pliku $plik. Wskaż folder działającej aplikacji parametrem -Aplikacja."
  }
}
$rodzic = Split-Path -Parent $Aplikacja
$nazwa = Split-Path -Leaf $Aplikacja
$kopia = Join-Path $rodzic "$nazwa-poprzednia-wersja"
$robocze = Join-Path $rodzic "$nazwa-aktualizacja"
Ok "Aplikacja: $Aplikacja"

# Nie można przenieść folderu, w którym "stoi" terminal – przejdź piętro wyżej.
$wTerminalu = (Get-Location).Path.TrimEnd('\', '/')
if ($wTerminalu -eq $Aplikacja -or $wTerminalu.StartsWith("$Aplikacja\") -or $wTerminalu.StartsWith("$Aplikacja/")) {
  Przerwij "Terminal jest otwarty w folderze aplikacji. Wpisz najpierw:  cd $rodzic  i uruchom skrypt ponownie."
}

Krok 'Szukam paczki z nową wersją'
if (-not $Paczka) {
  $pobrane = Join-Path $HOME 'Downloads'
  $znaleziona = Get-ChildItem -Path $pobrane -Filter 'smartCRM*.tar.gz' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $znaleziona) { Przerwij "Nie znalazłem paczki smartCRM*.tar.gz w $pobrane. Pobierz ją z GitHuba i uruchom skrypt ponownie." }
  $Paczka = $znaleziona.FullName
}
if (-not (Test-Path -LiteralPath $Paczka)) { Przerwij "Nie ma pliku $Paczka" }
Ok "Paczka: $Paczka (pobrana $((Get-Item -LiteralPath $Paczka).LastWriteTime))"

Krok 'Rozpakowuję paczkę'
if (Test-Path -LiteralPath $robocze) { Remove-Item -LiteralPath $robocze -Recurse -Force }
New-Item -ItemType Directory -Path $robocze | Out-Null
Uruchom 'Rozpakowanie paczki' { tar -xzf $Paczka -C $robocze }
$foldery = @(Get-ChildItem -LiteralPath $robocze -Directory)
if ($foldery.Count -ne 1 -or -not (Test-Path -LiteralPath (Join-Path $foldery[0].FullName 'docker-compose.yml'))) {
  Przerwij 'Paczka ma nieoczekiwaną zawartość – to chyba nie jest paczka SmartCRM.'
}
$nowa = $foldery[0].FullName
Ok 'Rozpakowano'

Krok 'Porównuję wersje'
if ((OdciskWersji $nowa) -eq (OdciskWersji $Aplikacja)) {
  Remove-Item -LiteralPath $robocze -Recurse -Force
  Przerwij "Paczka zawiera TĘ SAMĄ wersję, która już działa. Usuń stare paczki z folderu Pobrane, pobierz nową z GitHuba i uruchom skrypt ponownie."
}
Ok 'Paczka zawiera nową wersję'
Copy-Item -LiteralPath (Join-Path $Aplikacja '.env') -Destination (Join-Path $nowa '.env')

Krok 'Zatrzymuję obecną wersję'
Uruchom 'Zatrzymanie aplikacji' { docker compose --project-directory $Aplikacja -f (Join-Path $Aplikacja 'docker-compose.yml') down }
Ok 'Zatrzymano (dane w bazie zostają)'

Krok 'Podmieniam folder aplikacji'
$podmieniono = $false
try {
  if (Test-Path -LiteralPath $kopia) { Remove-Item -LiteralPath $kopia -Recurse -Force }
  Move-Item -LiteralPath $Aplikacja -Destination $kopia
  Move-Item -LiteralPath $nowa -Destination $Aplikacja
  $podmieniono = $true
  Remove-Item -LiteralPath $robocze -Recurse -Force
  Ok "Poprzednia wersja zapisana w $kopia"

  Krok 'Buduję i uruchamiam nową wersję (1-3 minuty)'
  Uruchom 'Budowanie i uruchomienie' { docker compose --project-directory $Aplikacja -f (Join-Path $Aplikacja 'docker-compose.yml') up -d --build }
}
catch {
  $ErrorActionPreference = 'Continue'
  Write-Host "`nBŁĄD: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Przywracam poprzednią wersję...' -ForegroundColor Yellow
  if ($podmieniono) {
    docker compose --project-directory $Aplikacja -f (Join-Path $Aplikacja 'docker-compose.yml') down
    if (Test-Path -LiteralPath $Aplikacja) { Move-Item -LiteralPath $Aplikacja -Destination $robocze }
    Move-Item -LiteralPath $kopia -Destination $Aplikacja
  } elseif (-not (Test-Path -LiteralPath $Aplikacja) -and (Test-Path -LiteralPath $kopia)) {
    Move-Item -LiteralPath $kopia -Destination $Aplikacja
  }
  docker compose --project-directory $Aplikacja -f (Join-Path $Aplikacja 'docker-compose.yml') up -d
  if (Test-Path -LiteralPath $robocze) { Remove-Item -LiteralPath $robocze -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host "Przywrócono poprzednią wersję w $Aplikacja." -ForegroundColor Yellow
  Write-Host 'Jeśli komunikat mówi, że folder jest używany: zamknij okna Eksploratora, edytory i terminale otwarte w folderze aplikacji i spróbuj ponownie.'
  exit 1
}

Krok 'Czekam, aż aplikacja wystartuje'
$port = PortAplikacji $Aplikacja
$adres = "http://localhost:$port"
$dziala = $false
for ($i = 0; $i -lt 30 -and -not $dziala; $i++) {
  Start-Sleep -Seconds 2
  try {
    $odp = Invoke-WebRequest -Uri "$adres/api/health" -UseBasicParsing -TimeoutSec 3
    $dziala = $odp.StatusCode -eq 200
  } catch { }
}
if (-not $dziala) {
  Write-Host "`nAplikacja nie odpowiada pod $adres. Sprawdź logi:  docker compose --project-directory $Aplikacja logs app --tail 50" -ForegroundColor Yellow
  Write-Host "Poprzednia wersja jest w $kopia."
  exit 1
}

Write-Host "`nGotowe! Nowa wersja działa pod adresem $adres" -ForegroundColor Green
Write-Host 'Odśwież stronę w przeglądarce klawiszami Ctrl+F5.'
Write-Host "Poprzednią wersję ($kopia) możesz usunąć, gdy upewnisz się, że wszystko działa."
