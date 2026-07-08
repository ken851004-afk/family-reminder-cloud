# 設定 Family Reminder 服務開機自動啟動
# 用法：喺 PowerShell 執行 .\setup-autostart.ps1

$ErrorActionPreference = "Stop"

$WACLI_PATH = "$env:USERPROFILE\.workbuddy\binaries\wacli\wacli.exe"
$NODE_PATH = "$env:USERPROFILE\.workbuddy\binaries\node\versions\22.12.0\node.exe"
$REPO_DIR = $PSScriptRoot
$SVC_JS = "$REPO_DIR\local-reminder-service.js"
$TASK_NAME = "FamilyReminderService"

Write-Host "=== Family Reminder 自動啟動設定 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 檢查 wacli 認證
Write-Host "[1/4] 檢查 WhatsApp 認證..." -ForegroundColor Yellow
& $WACLI_PATH doctor 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ wacli 未認證，請先執行：wacli auth" -ForegroundColor Red
    exit 1
}
Write-Host "✅ wacli 已認證" -ForegroundColor Green

# 2. 建立 repo 目錄
Write-Host ""
Write-Host "[2/4] 準備目錄..." -ForegroundColor Yellow
if (-not (Test-Path $REPO_DIR)) {
    New-Item -ItemType Directory -Path $REPO_DIR -Force | Out-Null
}
Write-Host "✅ 目錄就緒：$REPO_DIR" -ForegroundColor Green

# 3. 下載最新檔案
Write-Host ""
Write-Host "[3/4] 下載最新檔案..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ken851004-afk/family-reminder-cloud/master/local-reminder-service.js" -OutFile $SVC_JS -ErrorAction Stop
Write-Host "✅ local-reminder-service.js 已下載" -ForegroundColor Green

# 4. 建立排程工作
Write-Host ""
Write-Host "[4/4] 建立開機自動啟動排程..." -ForegroundColor Yellow

# 移除舊工作
$oldTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if ($oldTask) {
    Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    Write-Host "   舊排程已移除" -ForegroundColor Gray
}

# 建立新排程
$action = New-ScheduledTaskAction -Execute $NODE_PATH -Argument $SVC_JS
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U

Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Family Reminder WhatsApp 自動提醒服務" -ErrorAction Stop

Write-Host "✅ 排程工作已建立：$TASK_NAME" -ForegroundColor Green
Write-Host ""
Write-Host "=== 設定完成 ===" -ForegroundColor Cyan
Write-Host "服務會喺下次開機時自動啟動" -ForegroundColor White
Write-Host ""
Write-Host "手動控制：" -ForegroundColor Yellow
Write-Host "  啟動：Start-ScheduledTask -TaskName $TASK_NAME" -ForegroundColor Gray
Write-Host "  停止：Stop-ScheduledTask -TaskName $TASK_NAME" -ForegroundColor Gray
Write-Host "  檢查：Get-ScheduledTask -TaskName $TASK_NAME" -ForegroundColor Gray
Write-Host ""
Write-Host "日誌位置：$REPO_DIR\reminder-log.txt" -ForegroundColor Gray
