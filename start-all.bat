@echo off
REM One-click start ALL Family Reminder local services
REM Double-click this file (or run in CMD) to launch the full local stack
set DIR=C:\Users\KEN85\WorkBuddy\2026-06-22-18-47-16\family-reminder-cloud
set NODE=C:\Users\KEN85\.workbuddy\binaries\node\versions\22.12.0\node.exe

echo ============================================
echo  Family Reminder - Start ALL local services
echo ============================================
echo.

echo [1/3] cloud-server  (QR auth,  port 3000) ...
start "FRC-cloud" "%NODE%" "%DIR%\cloud-server.js"

echo [2/3] server.js     (API,       port 3747) ...
start "FRC-api" "%NODE%" "%DIR%\server.js"

echo [3/3] local-reminder-service.js (WhatsApp push) ...
start "FRC-reminder" "%NODE%" "%DIR%\local-reminder-service.js"

echo.
echo All 3 services started in separate windows.
echo Keep them open; close a window to stop that service.
echo Press any key to close this launcher (services keep running).
pause >nul
