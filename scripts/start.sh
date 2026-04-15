#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/data/router.pid"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/server.log"

find_existing_pid() {
  pgrep -f "node $ROOT_DIR/src/server.js" | head -n 1 || true
}

mkdir -p "$ROOT_DIR/data" "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Service already running with PID $EXISTING_PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

FALLBACK_PID="$(find_existing_pid)"
if [[ -n "$FALLBACK_PID" ]] && kill -0 "$FALLBACK_PID" 2>/dev/null; then
  echo "$FALLBACK_PID" >"$PID_FILE"
  echo "Service already running with PID $FALLBACK_PID"
  exit 0
fi

cd "$ROOT_DIR"
nohup node src/server.js >>"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

sleep 1

if ! kill -0 "$NEW_PID" 2>/dev/null; then
  echo "Failed to start service. Check $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

echo "Service started with PID $NEW_PID"
