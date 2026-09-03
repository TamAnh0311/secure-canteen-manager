# Code Reviewer Memory — canteen-manager backend

- [Project lint/test gates](project-review-gates.md) — what actually gates: typecheck + jest; no ESLint config.
- [Env boolean convention](feedback-env-bool-transform.md) — never z.coerce.boolean; use boolFromString enum transform.
- [Air-gap deploy contract](project-airgap-deploy-contract.md) — site scripts no-network; verify-before-load fail-closed; up.sh build foot-gun.
- [Order quantity funnel](project-order-quantity-funnel.md) — createOrReplace items[] contract; qty trust boundary 1..99; kitchen SUM FILTER load-bearing; relative totals not MAX_VND-capped.
- [Detainee profile + terminology](project-detainee-profile-terminology.md) — 5 nullable profile cols auto-flow via withBalance spread; "phạm nhân" overloaded (generic+convicted); formatDate tz caveat.
