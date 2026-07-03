# 고객화면 PC — 로그인 시 30초 시세 동기화 자동 실행 (창 없음, 사용자 조작 불필요)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
$Script = Join-Path $Root "scripts\korean-gold-background-sync.mjs"
$TaskName = "GoldLedgerKoreanGoldSync"

if (-not $Node) { Write-Error "Node.js 필요: https://nodejs.org" }
if (-not (Test-Path (Join-Path $Root ".env.local"))) {
  Write-Error ".env.local 필요 (KOREAN_GOLD_SYNC_SECRET)"
}

$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Script`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Write-Host "OK: $TaskName (로그인 시 30초 시세 동기화 자동 시작)"
