#!/usr/bin/env bash
# Stop the local scanner demo without deleting database volumes or generated evidence.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANAGER_DIR="$(cd "$HERE/.." && pwd)"
SCANNER_DIR="${ORDER_SCANNER_DIR:-$MANAGER_DIR/../canteen/order-scanner}"
PID_FILE="$SCANNER_DIR/var/demo/scanner.pid"

if [[ -f "$PID_FILE" ]]; then
  pid="$(<"$PID_FILE")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && \
    ps -p "$pid" -o command= | grep -Fq "order-scanner"; then
    kill "$pid"
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
  rm -f "$PID_FILE"
fi

export SCANNER_DEMO_CA_CERT="$SCANNER_DIR/var/demo/tls/ca.pem"
docker compose \
  -f "$HERE/docker-compose.yml" \
  -f "$HERE/docker-compose.scanner-demo.yml" \
  --env-file "$HERE/.env" \
  down

echo "Scanner demo stopped. Generated evidence remains under $SCANNER_DIR/var/demo."
