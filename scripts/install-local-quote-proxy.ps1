# 고객화면 PC 부팅 시 한국금시세 로컬 프록시 자동 실행 (관리자 권한 불필요)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Write-Error "Node.js 가 필요합니다. https://nodejs.org"
}
$Script = Join-Path $Root "scripts\local-korean-gold-proxy.mjs"
$TaskName = "GoldLedgerKoreanGoldProxy"

$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Script`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Write-Host "등록 완료: $TaskName (로그인 시 자동 실행)"
Write-Host "지금 바로 실행: Start-ScheduledTask -TaskName $TaskName"
