#!/usr/bin/env bash
#
# One-command demo bring-up for a laptop sales demo (no scanner hardware needed).
# Builds + starts the full stack, runs migrations, then loads the Vietnamese demo
# dataset (employees, menu, an OPEN lunch session, accepted orders, and 9 flagged
# sheets the operator verifies live). Re-runnable: the demo seed resets itself.
#
# Usage:  deploy/demo-up.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
COMPOSE="docker compose -f docker-compose.yml --env-file .env"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found" >&2; exit 1; }

if [[ ! -f .env ]]; then
  echo "==> .env missing — creating from .env.example (EDIT secrets for anything beyond a local demo)"
  cp .env.example .env
fi

echo "==> Building + starting stack (postgres, migrate, omr, backend, frontend)"
$COMPOSE up -d --build

echo "==> Waiting for backend to become healthy"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
    echo "    backend healthy"
    break
  fi
  [[ $i -eq 60 ]] && { echo "ERROR: backend did not become healthy in time" >&2; $COMPOSE ps; exit 1; }
  sleep 3
done

echo "==> Loading demo dataset (runs inside a one-off backend container)"
# The seed prints the exact login line (ĐĂNG NHẬP: <user> / <pass>) — defaults to
# admin/admin12345 when SEED_ADMIN_* are not set in .env.
$COMPOSE run --rm --no-deps backend npm run seed:demo

echo ""
echo "================  DEMO READY  ================"
echo "  Giao diện (UI):   http://localhost:8080"
echo "  Đăng nhập (login): see the 'ĐĂNG NHẬP' line printed by the seed above"
echo "  Backend health:   http://localhost:3000/health"
echo ""
echo "  Reset demo data:  $COMPOSE run --rm --no-deps backend npm run seed:demo"
echo "  Stop:             $COMPOSE down        (keep data)"
echo "  Wipe:             $COMPOSE down -v     (delete data)"
echo "  Wipe (full):      deploy/demo-down.sh  (down -v + orphans; prompts, -y to skip)"
echo "=============================================="
