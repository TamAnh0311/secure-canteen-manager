---
name: project-detainee-profile-terminology
description: Detainee profile fields + VI "phạm nhân" terminology — overload risk and date-display TZ caveat
metadata:
  type: project
---

User entity carries 5 read-only detainee-profile cols (date_of_birth, hometown, offense, arrest_date, detention_status enum temporary_hold|pre_trial_detention|convicted), all nullable, sourced from legacy SQL2005 via NULL aliases (mirrors `cell` pattern). Surfaced to FE through `UsersService.withBalance` `{...entity}` spread — any new entity column auto-flows to GET /users list/search responses (no DTO whitelist). /audit `selectedUser` comes from that search, so profile renders there for free.

**Why:** VI term "tù nhân" retired → "phạm nhân" project-wide (sensitivity). Locked by `frontend/src/i18n/prison-terminology.test.ts` forbidding /tù nhân/i in all vi values.

**How to apply:**
- "phạm nhân" is now OVERLOADED: it's both the generic VI word for prisoner (nav, search labels) AND the specific `detentionConvicted` status label (`vi/common.ts` detentionConvicted: 'Phạm nhân'). Linguistically defensible (phạm nhân ≈ convicted) but the chip text equals the generic noun — if a future change wants to disambiguate the convicted chip, that's the spot. Not a bug.
- Date display caveat: `formatDate` does `new Date('YYYY-MM-DD')` (UTC midnight) then formats in BROWSER tz with no `timeZone` option. Drift-free only for non-negative offsets; air-gapped Vietnam terminals (UTC+7) are safe, so storage-layer "no UTC day-drift" comment holds in practice but the DISPLAY path is not intrinsically drift-proof. Flag if app ever runs in a negative-offset tz.
- Entity↔DB schema parity guard is `backend/src/database/__tests__/schema-shape.spec.ts` (replays full migration chain on empty canteen_test DB; needs SCHEMA_SHAPE_DATABASE_URL). It pins money-critical cols only — new profile cols are proven by migration replay booting, not by explicit asserts.
