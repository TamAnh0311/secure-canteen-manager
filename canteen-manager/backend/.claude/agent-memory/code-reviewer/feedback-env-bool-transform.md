---
name: feedback-env-bool-transform
description: Project rejects z.coerce.boolean for env flags; uses explicit enum-string transform
metadata:
  type: project
---

Env boolean flags use `boolFromString` in `src/config/env-validation.ts`:
`z.enum(['true','false']).transform(v => v === 'true').default(...)`.

**Why:** `z.coerce.boolean()` treats the string `'false'` as truthy → silent misconfig (LEGACY_SQL_ENCRYPT='false' would enable encryption). The explicit enum transform parses `'false'`→false correctly.
**How to apply:** when reviewing any new boolean env var, confirm it goes through `boolFromString`, not `z.coerce.boolean`. Flag z.coerce.boolean as a defect.
