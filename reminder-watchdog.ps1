# reminder-watchdog.ps1
# 本地自癒守護：確保 local-reminder-service.js（WhatsApp 提醒服務）常駐運行。
# 服務死咗 → 自動重啟 + 經 wacli 通知 KEN + 寫日誌。
# 配合 setup-watchdog.ps1 排程每 5 分鐘自檢，你唔使再人手執。

$ErrorActionPreference = 'SilentlyContinue'

$svcName  = 'local-reminder-service.js'
$wacli    = 'C:\Users\KEN85\.workbuddy\binaries\wacli\wacli.exe'
$target   = '85262218999@s.whatsapp.net'
$nodeExe  = if (Test-Path 'C:\Users\KEN85\.workbuddy\binaries\node\versions\22.22.2\node.exe') {
              'C:\Users\KEN85\.workbuddy\binaries\node\versions\22.22.2\node.exe'
            } else { 'node' }

$logDir = "$env:USERPROFILE\WorkBuddy\family-reminder-cloud"
if (-not (Test-Path $logDir)) { $logDir = Split-Path $MyInvocation.MyCommand.Path }
$log = Join-Path $logDir 'watchdog-log.txt'

function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }

# 1) 已經跑緊？
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
$running = $procs | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($svcName) }
if ($running) {
    Log "OK 服務運行中 (PID $($running.ProcessId))"
    exit 0
}

# 2) 搵服務檔（避開 node_modules）
$candidate = Get-ChildItem -Path "$env:USERPROFILE\WorkBuddy" -Recurse -Filter $svcName -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -notlike '*\node_modules\*' } | Select-Object -First 1
if (-not $candidate) {
    Log "ERROR 搵唔到 $svcName"
    exit 1
}
$repo = $candidate.DirectoryName

# 3) 重啟
try {
    Start-Process -FilePath $nodeExe -ArgumentList $candidate.FullName -WindowStyle Hidden -WorkingDirectory $repo
    Log "RESTART 已重啟服務 ($repo)"
    & $wacli send text --to $target --message "🔧 家庭提醒服務剛自動重啟（$(Get-Date -Format 'HH:mm')），已恢復運作。" 2>$null
} catch {
    Log "ERROR 重啟失敗: $_"
    exit 1
}
