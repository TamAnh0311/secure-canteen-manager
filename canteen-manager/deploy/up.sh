#!/usr/bin/env bash
#
# Bring the canteen stack up from loaded images (air-gapped site).
# Requires images already present (run ./verify-and-load.sh first) and a real
# .env next to the compose file (copy .env.example → .env and fill secrets).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found" >&2; exit 1; }

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing. Copy .env.example to .env and set real secrets." >&2
  exit 1
fi

# --pull never: never reach a registry; images must already be loaded locally.
# --no-build: never build at the site either — a missing image must fail fast
# (compose retains build: blocks; without this a missing image would trigger a
# build → npm/pip reach, breaking the air-gap). Images come only from `docker load`.
echo "==> Starting stack (no registry pulls, no builds)"
docker compose --env-file .env up -d --pull never --no-build

echo "==> Service status"
docker compose ps
echo "Watch health with: docker compose ps  |  logs: docker compose logs -f"
