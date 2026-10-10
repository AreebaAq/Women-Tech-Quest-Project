# Builds submission.zip in the structure the guide asks for:
#   output/level1.csv, output/level2.csv, source/ (committed files only), demo/ (if present)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\make-submission.ps1 [-Demo path\to\demo.mp4]
param([string]$Demo = "")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# source/ is built from committed files, so uncommitted code changes would be left out.
$dirty = git status --porcelain -- . ':!output' ':!data' ':!submission.zip'
if ($dirty) { throw "Commit your changes first, otherwise they won't be in source/:`n$($dirty -join "`n")" }

$stage = Join-Path $env:TEMP "wtq-submission"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\output", "$stage\source" | Out-Null

foreach ($f in "level1.csv", "level2.csv") {
    if (-not (Test-Path "output\$f")) { throw "output\$f is missing. Run npm run decode first." }
    Copy-Item "output\$f" "$stage\output\$f"
}

# source/: only files tracked by git, so .env, node_modules and caches can never slip in.
# Bill images are left out to keep the ZIP small.
git ls-files | Where-Object { $_ -notmatch '^data/.*\.(png|jpe?g|webp)$' -and $_ -notmatch '^output/' } | ForEach-Object {
    $dest = Join-Path "$stage\source" $_
    New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
    Copy-Item $_ $dest
}

if ($Demo) {
    New-Item -ItemType Directory -Force "$stage\demo" | Out-Null
    Copy-Item $Demo "$stage\demo\demo$([IO.Path]::GetExtension($Demo))"
}

# Safety checks
$bad = Get-ChildItem $stage -Recurse -Force -File | Where-Object { $_.Name -eq ".env" -or $_.FullName -match "node_modules" }
if ($bad) { throw "Refusing to package: found $($bad.FullName -join ', ')" }

$l1 = Import-Csv "$stage\output\level1.csv"
$l2 = Import-Csv "$stage\output\level2.csv"
$emptyJson = @($l1 | Where-Object { -not $_.json }).Count
$emptyAns = @($l2 | Where-Object { -not $_.answer }).Count
Write-Host "level1.csv: $($l1.Count) rows, $emptyJson empty json cells"
Write-Host "level2.csv: $($l2.Count) rows, $emptyAns empty answer cells"

$zip = Join-Path $root "submission.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zip
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Created $zip ($mb MB)"
if ($mb -gt 15) { Write-Warning "ZIP is over the 15 MB limit!" }
