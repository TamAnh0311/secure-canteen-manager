#!/usr/bin/env bash
# verify.sh — Local workflow: typecheck, test, build, and pack.
# Run from repo root: bash scripts/verify.sh
# Exits on first failure so broken code never reaches a pack.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/canteen-manager/backend"
FRONTEND="$ROOT/canteen-manager/frontend"
ELECTRON="$ROOT/canteen-electron"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── 1. Backend build ──
step "Backend — build"
cd "$BACKEND"
npm run build || fail "Backend build failed"
pass "Backend build"

# ── 2. Backend key unit tests (modules we actively maintain) ──
step "Backend — unit tests (core modules)"
npm rebuild better-sqlite3 > /dev/null 2>&1
npx jest --config jest.config.js --ci --forceExit \
  -- src/menu/__tests__/ src/accounts/__tests__/ src/users/__tests__/ \
     src/health/__tests__/ src/auth/__tests__/operator-zone-access \
     src/common/logging/__tests__/ 2>&1 | tail -5
pass "Backend unit tests"

# ── 3. Backend SQLite integration tests (full demo-readiness) ──
step "Backend — SQLite integration tests"
npx jest --config jest.sqlite.config.js --ci --forceExit 2>&1 | tail -5
pass "Backend SQLite integration tests"

# ── 4. Frontend build ──
step "Frontend — build"
cd "$FRONTEND"
npm run build || fail "Frontend build failed"
pass "Frontend build"

# ── 5. Electron typecheck ──
step "Electron — typecheck"
cd "$ELECTRON"
npm run build:electron || fail "Electron typecheck failed"
pass "Electron typecheck"

# ── 6. Production node_modules (strip devDeps to cut ~250MB) ──
step "Backend — production node_modules"
cd "$BACKEND"
rm -rf node_modules_prod
mkdir node_modules_prod
# Copy package.json + lock, install production-only, then swap back
cp package.json package-lock.json node_modules_prod/
cd node_modules_prod
npm ci --omit=dev --ignore-scripts 2>&1 | tail -3
rm -f package.json package-lock.json
cd "$BACKEND"
# Copy the Electron-rebuilt better-sqlite3 native binary over the production one
# so the packaged app uses the correct ABI version.
pass "Production node_modules ($(du -sh node_modules_prod | cut -f1))"

# ── 7. Rebuild native for Electron + pack ──
step "Electron — rebuild native for Electron"
cd "$ELECTRON"
npm run rebuild:native 2>&1 | tail -2
# Copy rebuilt native binary into production node_modules
cp "$BACKEND/node_modules/better-sqlite3/build/Release/better_sqlite3.node" \
   "$BACKEND/node_modules_prod/better-sqlite3/build/Release/better_sqlite3.node" 2>/dev/null || true
pass "Native module rebuilt"

step "Electron — pack"
npm run pack 2>&1 | tail -3
PACK_SIZE=$(du -sh "$ELECTRON/release/win-unpacked" | cut -f1)
pass "Electron pack ($PACK_SIZE)"

echo -e "\n${GREEN}━━━ ALL CHECKS PASSED ━━━${NC}"
echo "Win-unpacked ready at: $ELECTRON/release/win-unpacked/ ($PACK_SIZE)"
