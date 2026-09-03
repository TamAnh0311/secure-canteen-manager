---
name: project-review-gates
description: Which checks actually gate this backend — typecheck + jest pass, no ESLint config present
metadata:
  type: project
---

Backend (`canteen-manager/backend`) review gates:
- `npm run typecheck` = `tsc --noEmit` — IS the gate, must be clean.
- `npm test` = jest (unit specs in `src/**/__tests__`); `npm run test:e2e` = `jest --config jest.e2e.config.js` (e2e in `test/`, needs DATABASE_URL on real Postgres).
- No `eslint.config.*` / `.eslintrc*` in repo. "No new lint errors" is vacuous here — do NOT run global eslint (installs eslint@10, errors on missing flat config). Don't flag lint.

**Why:** avoid wasting a tool call on global eslint and avoid false "lint passes" claims.
**How to apply:** verify typecheck + relevant jest specs; treat lint as not-applicable unless a config file appears later.

Stack: NestJS 11, TypeORM ^0.3.30, Postgres, zod env validation. Migrations in `src/database/migrations/` named `<timestamp>-<slug>.ts`, ordered by timestamp. Global guards via APP_GUARD: JwtAuthGuard + RolesGuard. `@Public()` opts out of auth; class-level `@Roles(OperatorRole.ADMIN)` is the admin-only pattern (see operators.controller, legacy-sync.controller).

Verified e2e run (2026-06-18): `DATABASE_URL='postgresql://canteen:change_me_in_production@localhost:55433/canteen_test' npx jest --config jest.e2e.config.js --runInBand --testPathPatterns "kiosk.e2e|counter.e2e"`. Jest 30 renamed the flag to `--testPathPatterns` (plural). A wrong/passwordless connection string surfaces as SASL "Cannot read properties of undefined (reading 'query')" in `afterAll` — that's env, not a code defect. See [[backend-e2e-db-recipe]].
