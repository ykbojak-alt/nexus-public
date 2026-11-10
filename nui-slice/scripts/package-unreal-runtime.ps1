#requires -Version 5.1
<#
.SYNOPSIS
  Упаковка локального Unreal Runtime Scene в версионный пакет клиента NEXUS.

.DESCRIPTION
  Собирает NexusRuntimeScene через RunUAT BuildCookRun в staging-каталог,
  затем генерирует manifest.json (schemaVersion 1): SHA-256 всех файлов,
  entrypoint, engine/app/build IDs. Пишет ТОЛЬКО внутрь -OutputRoot —
  ни одного артефакта за его пределами.

  Требует совместимый Editor/toolchain (W1-блокер: см.
  docs/verification/unreal-engine-build-2026-10-13.md). Не ставит Editor,
  не запускает Setup.bat и не трогает диск за пределами OutputRoot.

.EXAMPLE
  ./scripts/package-unreal-runtime.ps1 `
    -EngineRoot D:\UnrealEngine `
    -ProjectFile D:\nexus\integrations\unreal\NexusRuntimeScene\NexusRuntimeScene.uproject `
    -OutputRoot D:\nexus\dist\unreal\win64 `
    -Configuration Development -BuildId dev-20261013
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string]$EngineRoot,
  [Parameter(Mandatory)][string]$ProjectFile,
  [Parameter(Mandatory)][string]$OutputRoot,
  [ValidateSet('Development','Shipping','DebugGame')]
  [string]$Configuration = 'Development',
  [string]$Platform = 'Win64',
  [string]$BuildId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$AppVersion = '0.1.0',
  [int]$ProtocolVersion = 1,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$msg) { Write-Error $msg; exit 1 }

# --- входы ----------------------------------------------------------------
$resolved = Resolve-Path -LiteralPath $EngineRoot -ErrorAction SilentlyContinue
if ($resolved) { $EngineRoot = $resolved.Path } else { Fail "EngineRoot не существует" }
$runuat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
if (-not (Test-Path -LiteralPath $runuat)) { Fail "RunUAT.bat не найден: $runuat" }
if ($Platform -ne 'Win64') { Fail "Первая цель — только Win64, получено: $Platform" }
$resolved = Resolve-Path -LiteralPath $ProjectFile -ErrorAction SilentlyContinue
if ($resolved) { $ProjectFile = $resolved.Path } else { Fail "ProjectFile не существует" }
if ([IO.Path]::GetExtension($ProjectFile) -ne '.uproject') { Fail "ProjectFile должен быть .uproject" }
if ($BuildId -notmatch '^[A-Za-z0-9._-]+$') { Fail "BuildId содержит недопустимые символы: $BuildId" }

# engineVersion из Build.version — факт, не предположение
$engineVersion = '0.0.0'
$bv = Join-Path $EngineRoot 'Engine\Build\Build.version'
if (Test-Path -LiteralPath $bv) {
  try {
    $v = Get-Content -LiteralPath $bv -Raw | ConvertFrom-Json
    $engineVersion = "$($v.MajorVersion).$($v.MinorVersion).$($v.PatchVersion)"
  } catch { Write-Warning "Build.version не прочитан — engineVersion=$engineVersion" }
}

# --- выход: строго внутри OutputRoot/<BuildId> -------------------------------
$stage = Join-Path $OutputRoot $BuildId
$stageFull = [IO.Path]::GetFullPath($stage)
$outFull = [IO.Path]::GetFullPath($OutputRoot)
if (-not $stageFull.StartsWith($outFull + [IO.Path]::DirectorySeparatorChar)) {
  Fail "Stage-каталог выходит за OutputRoot: $stageFull"
}
if (Test-Path -LiteralPath $stageFull) { Fail "Stage-каталог уже существует: $stageFull" }

$uatArgs = @(
  'BuildCookRun',
  "-project=`"$ProjectFile`"",
  '-noP4','-utf8output','-build','-cook','-stage','-pak','-package',
  "-platform=$Platform",
  "-clientconfig=$Configuration",
  "-stagingdirectory=`"$stageFull`""
)

Write-Host "== План упаковки =="
Write-Host "Engine:     $EngineRoot (UE $engineVersion)"
Write-Host "Project:    $ProjectFile"
Write-Host "Stage:      $stageFull"
Write-Host "Config:     $Platform $Configuration"
Write-Host "BuildId:    $BuildId / app $AppVersion / proto v$ProtocolVersion"
Write-Host ("RunUAT:     RunUAT.bat " + ($uatArgs -join ' '))

if ($DryRun) {
  if (Test-Path -LiteralPath $stageFull) { Fail "dry-run: stage уже существует — внутрь писать нельзя" }
  Write-Host "DRY-RUN: build и manifest не выполняются."
  exit 0
}

if (-not $PSCmdlet.ShouldProcess($stageFull, "UE BuildCookRun + manifest")) { exit 0 }
New-Item -ItemType Directory -Path $stageFull -Force | Out-Null

# --- сборка -----------------------------------------------------------------
& $runuat @uatArgs
if ($LASTEXITCODE -ne 0) { Fail "RunUAT завершился с кодом $LASTEXITCODE" }

# --- manifest.json ------------------------------------------------------------
$exe = Get-ChildItem -Path $stageFull -Recurse -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch '^(UnrealPak|UnrealCEFSubProcess|CrashReportClient)' } |
  Sort-Object { $_.FullName.Length } |
  Select-Object -First 1
if (-not $exe) { Fail "Packaged executable не найден в $stageFull" }

$files = Get-ChildItem -Path $stageFull -Recurse -File |
  Where-Object { $_.Name -ne 'manifest.json' } |
  ForEach-Object {
    $rel = $_.FullName.Substring($stageFull.Length + 1) -replace '\\', '/'
    [pscustomobject]@{
      path   = $rel
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
$entrypoint = $exe.FullName.Substring($stageFull.Length + 1) -replace '\\', '/'
if (-not ($files | Where-Object { $_.path -eq $entrypoint })) {
  Fail "entrypoint отсутствует в files: $entrypoint"
}

$manifest = [ordered]@{
  schemaVersion   = 1
  engineVersion   = $engineVersion
  appVersion      = $AppVersion
  buildId         = $BuildId
  platform        = 'windows'
  architecture    = 'x64'
  protocolVersion = $ProtocolVersion
  entrypoint      = $entrypoint
  files           = @($files)
}
$manifestPath = Join-Path $stageFull 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "== Готово =="
Write-Host "Package root: $stageFull"
Write-Host "Entrypoint:   $entrypoint"
Write-Host "Files:        $($files.Count)"
Write-Host "Manifest:     $manifestPath"
