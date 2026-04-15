#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/data/router.pid"

find_existing_pid() {
  pgrep -f "node $ROOT_DIR/src/server.js" | head -n 1 || true
}

if [[ ! -f "$PID_FILE" ]]; then
  PID="$(find_existing_pid)"
  if [[ -z "$PID" ]]; then
    echo "Service is not running"
    exit 0
  fi
else
  PID="$(cat "$PID_FILE")"
fi

if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  PID="$(find_existing_pid)"
  if [[ -z "$PID" ]]; then
    echo "Removed empty PID file"
    exit 0
  fi
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  PID="$(find_existing_pid)"
  if [[ -z "$PID" ]]; then
    echo "Removed stale PID file for $PID"
    exit 0
  fi
fi

kill "$PID"

for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Service stopped"
    exit 0
  fi
  sleep 0.5
done

kill -9 "$PID"
rm -f "$PID_FILE"
echo "Service force stopped"
