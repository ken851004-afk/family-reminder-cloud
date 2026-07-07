@echo off
title Family Reminder - Push Notification Server
echo ============================================
echo   Family Reminder Push Notification Server
echo ============================================
echo.
echo This server runs in the background.
echo It sends web push notifications to your
echo phone/iPad when reminders are due.
echo.
echo Press Ctrl+C to stop.
echo ============================================
echo.

set NODE_PATH=%~dp0node_modules
"C:\Users\KEN85\.workbuddy\binaries\node\versions\22.12.0\node.exe" "%~dp0push-server.js"
pause
