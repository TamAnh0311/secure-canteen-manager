---
name: airgap-deploy-contract
description: Air-gap deploy invariants for deploy/ scripts + compose — what site scripts may/may not do
metadata:
  type: project
---

Canteen Manager ships to air-gapped sites. Phase 10 deploy split: build box (internet) vs SITE (no network).

Invariants reviews must enforce:
- SITE scripts (`deploy/verify-and-load.sh`, `deploy/up.sh`) must contain ZERO network ops: no `docker pull/build/push`, no `npm/pip/yarn/pnpm`, no `compose build`. All build+pull confined to `deploy/build-offline-bundle.sh`.
- `up.sh` uses `docker compose up --pull never`. **Gap:** compose file still carries `build:` blocks for the 4 built services; `--pull never` does NOT suppress builds. Only the absent source context at-site prevents a build fallback. `--no-build` would make this explicit/fail-fast — recommended hardening.
- verify-and-load is fail-closed by `set -euo pipefail` + checksum verify happening BEFORE the `docker load` loop. Tampered/incomplete bundle → exit 1, nothing loaded (empirically confirmed).

**Why:** a SITE path that reaches npm/registry breaks the air-gap guarantee (compliance/physical isolation).
**How to apply:** when reviewing deploy changes, grep site scripts for network ops; check verify-before-load ordering; flag `build:` reachability under `up.sh`.

Related: [[project-review-gates]]
