#!/bin/bash
# One-click start ALL Family Reminder local services (macOS / Linux / Git Bash)
DIR="C:/Users/KEN85/WorkBuddy/2026-06-22-18-47-16/family-reminder-cloud"
NODE="C:/Users/KEN85/.workbuddy/binaries/node/versions/22.12.0/node.exe"

echo "Starting cloud-server (QR auth, port 3000)..."
"$NODE" "$DIR/cloud-server.js" &

echo "Starting server.js (API, port 3747)..."
"$NODE" "$DIR/server.js" &

echo "Starting local-reminder-service.js (WhatsApp push)..."
"$NODE" "$DIR/local-reminder-service.js" &

echo "All services started (PIDs: $!)"
echo "Press Ctrl+C to stop all."
wait
