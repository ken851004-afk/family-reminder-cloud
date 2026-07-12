# setup-watchdog.ps1
# 一次性設定：將 reminder-watchdog.ps1 註冊成 Windows 排程工作，
# 每 5 分鐘自檢一次，服務死咗自動重啟。
# 用法：以管理員身份開 PowerShell，執行呢個 script（或雙撃）。

$ErrorActionPreference = 'Stop'
$wd       = Split-Path $MyInvocation.MyCommand.Path
$watchdog = Join-Path $wd 'reminder-watchdog.ps1'

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument "-NoProfile -WindowStyle Hidden -File `"$watchdog`""
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date) `
              -RepetitionInterval (New-TimeSpan -Minutes 5) `
              -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName 'FamilyReminderWatchdog' `
    -Action $action -Trigger $trigger -Settings $settings -Force

Write-Host '✅ 已註冊 FamilyReminderWatchdog（每 5 分鐘自檢，自動重啟服務）'
Write-Host '   想檢查：Get-ScheduledTask -TaskName FamilyReminderWatchdog'
Write-Host '   想移除：Unregister-ScheduledTask -TaskName FamilyReminderWatchdog -Confirm:$false'
