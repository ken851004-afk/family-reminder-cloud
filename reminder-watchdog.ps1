# reminder-watchdog.ps1
# 本地自癒守護：呼叫 monitor/health-check.js 做綜合監控 + 自癒 + WhatsApp 報警。
# 服務死咗 → health-check.js 自動重啟 + 經 wacli 通知 KEN + 寫日誌。
# 配合 setup-watchdog.ps1 排程每 5 分鐘自檢，你唔使再人手執。

$ErrorActionPreference = 'SilentlyContinue'

$nodeExe = if (Test-Path 'C:\Users\KEN85\.workbuddy\binaries\node\versions\22.22.2\node.exe') {
              'C:\Users\KEN85\.workbuddy\binaries\node\versions\22.22.2\node.exe'
            } else { 'node' }

$logDir = "$env:USERPROFILE\WorkBuddy\family-reminder-cloud"
if (-not (Test-Path $logDir)) { $logDir = Split-Path $MyInvocation.MyCommand.Path }
$log = Join-Path $logDir 'watchdog-log.txt'

function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }

# 1) 搵 repo（monitor/health-check.js 喺度就當 repo）
if (Test-Path (Join-Path $PSScriptRoot 'monitor/health-check.js')) {
  $repo = $PSScriptRoot
} else {
  $candidate = Get-ChildItem -Path "$env:USERPROFILE\WorkBuddy" -Recurse -Filter 'health-check.js' -ErrorAction SilentlyContinue |
               Where-Object { $_.FullName -notlike '*\node_modules\*' } | Select-Object -First 1
  if ($candidate) { $repo = $candidate.DirectoryName } else { $repo = $PSScriptRoot }
}

$healthCheck = Join-Path $repo 'monitor/health-check.js'

if (Test-Path $healthCheck) {
  # 主路徑：交畀 monitor/health-check.js 做綜合監控 + 自癒 + 報警
  Log "▶ 執行 health-check.js"
  & $nodeExe $healthCheck 2>&1 | ForEach-Object { Log $_ }
  Log "health-check 完畢 (exit $LASTEXITCODE)"
} else {
  # 備援：health-check.js 唔喺度，退回舊邏輯確保 local-reminder-service.js 常駐
  Log "ERROR 搵唔到 $healthCheck — fallback 到舊邏輯"
  $svcName = 'local-reminder-service.js'
  $wacli   = 'C:\Users\KEN85\.workbuddy\binaries\wacli\wacli.exe'
  $target  = '85262218999@s.whatsapp.net'

  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  $running = $procs | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($svcName) }
  if ($running) {
    Log "OK 服務運行中 (PID $($running.ProcessId))"
    exit 0
  }

  $cand = Get-ChildItem -Path "$env:USERPROFILE\WorkBuddy" -Recurse -Filter $svcName -ErrorAction SilentlyContinue |
          Where-Object { $_.FullName -notlike '*\node_modules\*' } | Select-Object -First 1
  if (-not $cand) {
    Log "ERROR 搵唔到 $svcName"
    exit 1
  }
  try {
    Start-Process -FilePath $nodeExe -ArgumentList $cand.FullName -WindowStyle Hidden -WorkingDirectory $cand.DirectoryName
    Log "RESTART 已重啟服務 ($($cand.DirectoryName))"
    & $wacli send text --to $target --message "🔧 家庭提醒服務剛自動重啟（$(Get-Date -Format 'HH:mm')），已恢復運作。" 2>$null
  } catch {
    Log "ERROR 重啟失敗: $_"
    exit 1
  }
}
