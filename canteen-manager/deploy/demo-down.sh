#!/usr/bin/env bash
#
# Tear the demo stack down and DELETE ALL DATA.
# Inverse of demo-up.sh: stops every service and removes the named volumes
# (Postgres data, etc.) plus any orphaned containers, returning the laptop to a
# clean slate for the next demo. The next demo-up.sh re-creates and re-seeds.
#
# Usage:  deploy/demo-down.sh [-y|--yes]
#   -y, --yes   skip the confirmation prompt (for scripted / unattended use)
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown argument '$arg' (use -y to skip the prompt)" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found" >&2; exit 1; }

# down only needs .env for variable substitution in the compose file; if it is
# absent (e.g. already wiped) fall back to plain compose so teardown still works.
if [[ -f .env ]]; then
  COMPOSE="docker compose -f docker-compose.yml --env-file .env"
else
  COMPOSE="docker compose -f docker-compose.yml"
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "This DELETES all demo data (Postgres volume and uploaded files)."
  read -r -p "Wipe the demo stack? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted — nothing changed."; exit 0; }
fi

echo "==> Stopping stack and removing volumes + orphans"
$COMPOSE down -v --remove-orphans

echo "==> Demo stack down and data wiped. Run deploy/demo-up.sh for a fresh demo."
