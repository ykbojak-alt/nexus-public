#requires -Version 5.1
<#
.SYNOPSIS
  ship.test.ps1 — тест ship.ps1 на подменных каталогах (wave-XV W1).

  Подмена: Ai2Target = временный каталог с ai2\server\static\index.html
  (фингерпринт цели для sync-ai2-static), Source = временный экспорт.
  Вместо HTTP /v1/integrity — локальная проверка manifest.json теми же
  правилами, что у маршрута хоста (sha256+bytes каждого файла,
  untracked = файлы бандла вне манифеста). Сеть и живой хост не нужны.

  Проверки:
    T1 happy path     — exit 0; бандл скопирован; manifest есть; бэкап создан
    T2 integrity fail — exit 40; прежний бандл восстановлен из бэкапа
    T3 нет экспорта   — exit 20; каталог цели не изменён
    T4 идемпотентность — повтор T1: exit 0, бэкап = бандл первого прогона
#>
[CmdletBinding()]
param([string]$WorkRoot = (Join-Path $env:TEMP "ship-test-$PID"))

$ErrorActionPreference = 'Stop'
$ship = Join-Path $PSScriptRoot 'ship.ps1'
$failed = 0

function Local-Integrity([string]$target) {
  $dir = Join-Path $target 'ai2\server\static\nexus'
  $node = Join-Path $dir 'manifest.json'
  if (-not (Test-Path $node)) { throw 'manifest.json не найден' }
  $manifest = Get-Content $node -Raw | ConvertFrom-Json
  $mismatch = @(); $missing = @(); $seen = @{}
  foreach ($row in $manifest.files) {
    $rel = [string]$row.path
    $seen[$rel] = $true
    $f = Join-Path $dir ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $f)) { $missing += $rel; continue }
    $bytes = [IO.File]::ReadAllBytes($f)
    $sha = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    $hex = ($sha | ForEach-Object { $_.ToString('x2') }) -join ''
    if ($bytes.Length -ne [int]$row.bytes -or $hex -ne $row.sha256) { $mismatch += $rel }
  }
  $untracked = 0
  Get-ChildItem $dir -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($dir.Length + 1) -replace '\\', '/'
    if ($rel -ne 'manifest.json' -and -not $seen.ContainsKey($rel)) { $untracked++ }
  }
  [pscustomobject]@{
    verify = [pscustomobject]@{
      ok = ($mismatch.Count -eq 0 -and $missing.Count -eq 0)
      checked = $seen.Count
      mismatch = $mismatch
      missing = $missing
      untracked = $untracked
    }
  }
}

$probe = { param($t) Local-Integrity $t }
$health = { param($t) [pscustomobject]@{ status = 'test' } }

function New-FakeTarget([string]$root, [string]$oldContent) {
  $static = Join-Path $root 'ai2\server\static'
  New-Item $static -ItemType Directory -Force | Out-Null
  Set-Content (Join-Path $static 'index.html') '<html>legacy</html>' -NoNewline
  $nexus = Join-Path $static 'nexus'
  New-Item $nexus -ItemType Directory -Force | Out-Null
  Set-Content (Join-Path $nexus 'old-file.txt') $oldContent -NoNewline
  Set-Content (Join-Path $nexus 'manifest.json') '{"version":1,"files":[]}' -NoNewline
}

function New-FakeExport([string]$root) {
  New-Item (Join-Path $root '_next') -ItemType Directory -Force | Out-Null
  Set-Content (Join-Path $root 'index.html') '<html>neu /_next/app.js</html>' -NoNewline
  Set-Content (Join-Path $root '_next\app.js') 'self.__x="/_next/app.js"' -NoNewline
}

function Check([string]$name, [bool]$cond, [string]$detail) {
  if ($cond) { Write-Host "[ok]   $name — $detail" -ForegroundColor Green }
  else { Write-Host "[FAIL] $name — $detail" -ForegroundColor Red; $script:failed++ }
}

Remove-Item $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item $WorkRoot -ItemType Directory -Force | Out-Null

# ---- T1: happy path ---------------------------------------------------------
$t1 = Join-Path $WorkRoot 't1'
New-FakeTarget $t1 'OLD-BUNDLE'
$src = Join-Path $WorkRoot 'src1'; New-FakeExport $src
& $ship -SkipBuild -SkipRestart -Ai2Target $t1 -Source $src `
  -IntegrityProbe $probe -HealthProbe $health | Out-Null
$code = $LASTEXITCODE
Check 'T1 exit' ($code -eq 0) "код $code (ожидали 0)"
Check 'T1 rebase' ((Get-Content (Join-Path $t1 'ai2\server\static\nexus\index.html') -Raw) -match '/_nexus/_next/') 'asset prefix переписан'
Check 'T1 manifest' (Test-Path (Join-Path $t1 'ai2\server\static\nexus\manifest.json')) 'manifest.json создан'
Check 'T1 backup' ((Get-Content (Join-Path $t1 'ai2\server\static\nexus.ship-backup\old-file.txt') -Raw) -eq 'OLD-BUNDLE') 'прежний бандл в бэкапе'
Check 'T1 old gone' (-not (Test-Path (Join-Path $t1 'ai2\server\static\nexus\old-file.txt'))) 'старые файлы вытеснены'

# ---- T2: integrity fail → откат ---------------------------------------------
$t2 = Join-Path $WorkRoot 't2'
New-FakeTarget $t2 'OLD-BUNDLE-T2'
$src2 = Join-Path $WorkRoot 'src2'; New-FakeExport $src2
# Проверка «битого» бандла: fail только пока стоит новый бандл
# (в нём есть index.html); восстановленный старый — ok.
$badProbe = { param($t)
  $hasNew = Test-Path (Join-Path $t 'ai2\server\static\nexus\index.html')
  [pscustomobject]@{ verify = [pscustomobject]@{
    ok = (-not $hasNew); checked = 2
    mismatch = $(if ($hasNew) { @('index.html') } else { @() })
    missing = @(); untracked = 0 } } }
& $ship -SkipBuild -SkipRestart -Ai2Target $t2 -Source $src2 `
  -IntegrityProbe $badProbe -HealthProbe $health | Out-Null
$code = $LASTEXITCODE
Check 'T2 exit' ($code -eq 40) "код $code (ожидали 40)"
Check 'T2 restored' ((Get-Content (Join-Path $t2 'ai2\server\static\nexus\old-file.txt') -Raw) -eq 'OLD-BUNDLE-T2') 'бэкап восстановлен'
Check 'T2 new gone' (-not (Test-Path (Join-Path $t2 'ai2\server\static\nexus\index.html'))) 'битый бандл убран'

# ---- T3: нет экспорта → код 20 ----------------------------------------------
$t3 = Join-Path $WorkRoot 't3'
New-FakeTarget $t3 'OLD-T3'
& $ship -SkipBuild -SkipRestart -Ai2Target $t3 -Source (Join-Path $WorkRoot 'no-such-out') `
  -IntegrityProbe $probe -HealthProbe $health | Out-Null
$code = $LASTEXITCODE
Check 'T3 exit' ($code -eq 20) "код $code (ожидали 20)"
Check 'T3 untouched' ((Get-Content (Join-Path $t3 'ai2\server\static\nexus\old-file.txt') -Raw) -eq 'OLD-T3') 'цель не тронута'

# ---- T4: идемпотентность ------------------------------------------------------
& $ship -SkipBuild -SkipRestart -Ai2Target $t1 -Source $src `
  -IntegrityProbe $probe -HealthProbe $health | Out-Null
$code = $LASTEXITCODE
Check 'T4 exit' ($code -eq 0) "код $code (повтор, ожидали 0)"
Check 'T4 backup rotated' ((Get-Content (Join-Path $t1 'ai2\server\static\nexus.ship-backup\index.html') -Raw) -match '/_nexus/_next/') 'бэкап = бандл первого прогона'

Write-Host ''
if ($script:failed -eq 0) { Write-Host 'ship.test: ВСЕ ПРОВЕРКИ ПРОШЛИ' -ForegroundColor Green; exit 0 }
Write-Host "ship.test: провалов $script:failed" -ForegroundColor Red
exit 1
