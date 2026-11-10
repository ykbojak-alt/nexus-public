#requires -Version 5.1
<#
.SYNOPSIS
  ship.ps1 — NEU → AI-2 одной командой (wave-XV W1).

  Этапы: сборка NEU → sync static в ai2 → рестарт хоста →
  verify integrity на живом хосте → health. Идемпотентно:
  перед sync прежний бандл сохраняется в static\nexus.ship-backup;
  при провале integrity бандл откатывается и хост перезапускается ещё раз.

  Коды возврата:
    0   — все этапы зелёные (restart можно пропустить -SkipRestart)
    10  — сборка NEU failed
    20  — sync static failed
    30  — рестарт failed: слушатель не остановился или хост не поднялся
    40  — integrity на живом хосте failed (откат выполнен)
    41  — integrity failed И откат не удался / тоже не прошёл проверку
    50  — финальный health failed (HTTP != 200 или таймаут)

  Примеры:
    scripts\ship.ps1                                  # полный прогон на :8123
    scripts\ship.ps1 -SkipBuild                       # из готового apps\nexus\out
    scripts\ship.ps1 -HostUrl http://127.0.0.1:9000 -Ai2Target T:\fake-ai2
#>
[CmdletBinding()]
param(
  [string]$NexusRoot = '',
  [string]$Ai2Target = 'D:\ai2_pilot\ai2',
  [string]$Source = '',
  [string]$HostUrl = 'http://127.0.0.1:8123',
  [string]$BuildCommand = 'pnpm exec nx build nexus --skip-nx-cache',
  [switch]$SkipBuild,
  [switch]$SkipRestart,
  # Холодный старт хоста занимает минуты (create_app + lifespan): на этой
  # машине под нагрузкой наблюдали ~9 минут до bind — дефолт 720 с.
  [int]$HealthTimeoutSec = 720,
  # Первая verify сразу после sync читает 390 свежих файлов — AV-сканер их
  # впервые трогает, замерено 59 с. Повторная на том же бандле ~5 с. 120 с.
  [int]$IntegrityTimeoutSec = 120,
  # Тестовый крючок: своя проверка целостности вместо HTTP /v1/integrity.
  # Вызывается как & $IntegrityProbe $Ai2Target; должен вернуть объект
  # с .verify.ok/.checked/.mismatch[]/.missing[]/.untracked.
  [scriptblock]$IntegrityProbe,
  [scriptblock]$HealthProbe
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
if (-not $NexusRoot) {
  $NexusRoot = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')).Path
}
$script:rows = [System.Collections.Generic.List[object]]::new()

function Add-Stage([string]$Stage, [string]$Status, [string]$Detail) {
  $script:rows.Add([pscustomobject]@{ Stage = $Stage; Status = $Status; Detail = $Detail })
  $color = if ($Status -eq 'ok') { 'Green' } elseif ($Status -eq 'skip') { 'DarkGray' } else { 'Red' }
  Write-Host ("[{0,-8}] {1,-22} {2}" -f $Status, $Stage, $Detail) -ForegroundColor $color
}

function Show-Table([int]$Code) {
  Write-Host ''
  $script:rows | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host ("код возврата: {0}" -f $Code)
}

function Exit-With([int]$Code) { Show-Table $Code; exit $Code }

$uri = [Uri]$HostUrl
$port = $uri.Port
$staticNexus = Join-Path $Ai2Target 'ai2\server\static\nexus'
$backupDir = Join-Path $Ai2Target 'ai2\server\static\nexus.ship-backup'
$sourceDir = if ($Source) { $Source } else { Join-Path $NexusRoot 'apps\nexus\out' }

# ---- stage 1: сборка NEU --------------------------------------------------
if ($SkipBuild) {
  Add-Stage 'build' 'skip' "-SkipBuild; источник $sourceDir"
} else {
  Push-Location $NexusRoot
  try {
    & cmd /c "$BuildCommand 2>&1" | ForEach-Object { Write-Host "  $_" }
    $code = $LASTEXITCODE
  } finally { Pop-Location }
  if ($code -ne 0) { Add-Stage 'build' 'fail' "$BuildCommand → exit $code"; Exit-With 10 }
  Add-Stage 'build' 'ok' $BuildCommand
}

if (-not (Test-Path (Join-Path $sourceDir 'index.html'))) {
  Add-Stage 'sync' 'fail' "экспорт не найден: $sourceDir (нет index.html)"; Exit-With 20
}

# ---- stage 2: sync static -------------------------------------------------
# Бэкап прежнего бандла — один слот, идемпотентно.
try {
  if (Test-Path $backupDir) { Remove-Item $backupDir -Recurse -Force }
  if (Test-Path $staticNexus) {
    Move-Item $staticNexus $backupDir
  }
  Push-Location $NexusRoot
  try {
    & cmd /c "node scripts\sync-ai2-static.mjs --target `"$Ai2Target`" --source `"$sourceDir`" 2>&1" |
      ForEach-Object { Write-Host "  $_" }
    $code = $LASTEXITCODE
  } finally { Pop-Location }
  if ($code -ne 0) { throw "sync exit $code" }
  $synced = Get-ChildItem $staticNexus -Recurse -File | Measure-Object | Select-Object -ExpandProperty Count
  Add-Stage 'sync' 'ok' "$synced файлов → $staticNexus"
} catch {
  # sync сломался — вернуть прежний бандл, чтобы хост не остался без UI.
  if ((Test-Path $backupDir) -and -not (Test-Path $staticNexus)) {
    Move-Item $backupDir $staticNexus
  }
  Add-Stage 'sync' 'fail' "$($_.Exception.Message)"
  Exit-With 20
}

function Restart-Host {
  <# Рестарт слушателя $port: гасим процесс, перезапускаем той же
     командной строкой (exe + аргументы из CIM), рабочий каталог —
     Ai2Target (дефолт ai2 data_dir cwd-зависим). Ждём /healthz. #>
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  $exe = $null; $argLine = $null
  if ($conn) {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
    $exe = $cim.ExecutablePath
    $cmd = [string]$cim.CommandLine
    if ($cmd -match '^"([^"]+)"\s*(.*)$') { $argLine = $Matches[2] }
    elseif ($cmd -match '^(\S+)\s*(.*)$') { $argLine = $Matches[2] }
    if (-not $exe -and $Matches[1]) { $exe = $Matches[1] }
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 400
      $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    } while ($still -and (Get-Date) -lt $deadline)
    if ($still) { throw "порт $port всё ещё занят после остановки PID $($conn.OwningProcess)" }
  }
  if (-not $exe) {
    $exe = (Get-Command ai2.exe -ErrorAction SilentlyContinue).Source
    if (-not $exe) { $exe = 'ai2' }
    $argLine = "serve --host $($uri.Host) --port $port"
  }
  # Запуск вне дерева процессов вызывающей сессии: Start-Process наследует
  # job-объект агента, и хост умирает вместе с сессией (факт 17.10 — RC
  # Integrity красный по connection refused). Win32_Process.Create родит
  # процесс в WmiPrvSE — он переживает завершение ship.ps1. Логи — в файлы
  # рядом с Ai2Target, иначе у WMI-процесса нет консоли.
  $logOut = Join-Path $Ai2Target 'host-ship.log'
  $logErr = Join-Path $Ai2Target 'host-ship.err.log'
  $spawned = $false
  try {
    $cmdLine = "cmd /c `"`"$exe`" $argLine >> `"$logOut`" 2>> `"$logErr`"`""
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
      -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $Ai2Target }
    if ($res.ReturnValue -eq 0) { $spawned = $true }
  } catch { }
  if (-not $spawned) {
    Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $Ai2Target -WindowStyle Hidden
  }
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  do {
    Start-Sleep -Seconds 1
    try {
      $r = Invoke-WebRequest -Uri "$HostUrl/healthz" -TimeoutSec 5 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return }
    } catch { }
  } while ((Get-Date) -lt $deadline)
  throw "хост не ответил /healthz за ${HealthTimeoutSec}с"
}

# ---- stage 3: рестарт хоста -----------------------------------------------
if ($SkipRestart) {
  Add-Stage 'restart' 'skip' '-SkipRestart; хост не трогали'
} else {
  try {
    Restart-Host
    Add-Stage 'restart' 'ok' "слушатель :$port поднят заново"
  } catch {
    Add-Stage 'restart' 'fail' "$($_.Exception.Message)"
    Exit-With 30
  }
}

function Test-Integrity {
  if ($IntegrityProbe) { return (& $IntegrityProbe $Ai2Target) }
  $r = Invoke-WebRequest -Uri "$HostUrl/v1/integrity?verify=true" -TimeoutSec $IntegrityTimeoutSec -UseBasicParsing
  return ($r.Content | ConvertFrom-Json)
}

# ---- stage 4: verify integrity --------------------------------------------
try {
  $v = Test-Integrity
  $ok = ($v.PSObject.Properties['verify'] -and $v.verify.ok)
  if (-not $ok) {
    throw "checked $($v.verify.checked); mismatch $($v.verify.mismatch.Count); missing $($v.verify.missing.Count); untracked $($v.verify.untracked)"
  }
  Add-Stage 'integrity' 'ok' `
    "checked $($v.verify.checked); mismatch 0; missing 0; untracked $($v.verify.untracked)"
} catch {
  $why = $_.Exception.Message
  # Откат к предыдущему бандлу.
  if (Test-Path $backupDir) {
    if (Test-Path $staticNexus) { Remove-Item $staticNexus -Recurse -Force }
    Move-Item $backupDir $staticNexus
    if (-not $SkipRestart) {
      try { Restart-Host } catch { Add-Stage 'rollback' 'fail' "рестарт при откате: $($_.Exception.Message)"; Exit-With 41 }
    }
    try {
      $v2 = Test-Integrity
      if ($v2.verify.ok) {
        Add-Stage 'integrity' 'fail' "новый бандл не прошёл ($why); откат восстановлен: checked $($v2.verify.checked)"
        Exit-With 40
      }
      Add-Stage 'rollback' 'fail' 'откат тоже не прошёл integrity'
      Exit-With 41
    } catch {
      Add-Stage 'rollback' 'fail' "проверка отката: $($_.Exception.Message)"
      Exit-With 41
    }
  }
  Add-Stage 'integrity' 'fail' "$why; бэкапа для отката нет"
  Exit-With 40
}

# ---- stage 5: health -------------------------------------------------------
try {
  if ($HealthProbe) {
    $body = & $HealthProbe $Ai2Target
    Add-Stage 'health' 'ok' "probe; status=$($body.status)"
  } else {
    $h = Invoke-WebRequest -Uri "$HostUrl/v1/health" -TimeoutSec 15 -UseBasicParsing
    if ($h.StatusCode -ne 200) { throw "HTTP $($h.StatusCode)" }
    $body = $h.Content | ConvertFrom-Json
    Add-Stage 'health' 'ok' "HTTP 200; status=$($body.status); uptime=$($body.uptimeSeconds)s"
  }
} catch {
  Add-Stage 'health' 'fail' "$($_.Exception.Message)"
  Exit-With 50
}

Exit-With 0
