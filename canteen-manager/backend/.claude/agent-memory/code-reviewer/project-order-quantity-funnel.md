---
name: project-order-quantity-funnel
description: Order capture funnel — createOrReplace items[] contract, qty trust boundary, kitchen-summary SUM FILTER, money-safety bounds
metadata:
  type: project
---

Order capture converged on ONE funnel: `OrdersService.createOrReplace({ items: Array<{menuItemId, quantity}> })`. Three surfaces (verify/omr, counter, kiosk) feed it. Counter/kiosk DTOs still expose `menuItemIds: string[]` and shim to `quantity:1` lines; verify builds items[] server-side from decoded checkbox positions.

Key money-safety facts (verified 2026-06-20):
- Qty trust boundary lives in `createOrReplace` (orders.service.ts), NOT the DTO: `Number.isInteger(q) && 1<=q<=99` BEFORE total math. Reason: verify/omr path bypasses class-validator DTO. Tests: orders.service.spec rejects 0/100/1.5 (no negative case, but <1 covers it).
- `totalAmount = Σ price×qty`. omr path debits via accountsService.debit which enforces `amount<=MAX_VND` (1e9) and rolls back on overflow. **Relative (counter/kiosk) orders are UNPAID → never debited → total_amount NOT MAX_VND-capped.** No ArrayMaxSize on item arrays. Non-corrupting (qty99×price1e9×menuSize stays << MAX_SAFE_INTEGER / BIGINT) but unbounded relative total is a pre-existing trait P1 amplified 99×.
- Kitchen `getSummary` (menu.service.ts): `COALESCE(SUM(oi.quantity) FILTER (WHERE o.id IS NOT NULL), 0)`. FILTER load-bearing: orders LEFT JOINed with active+service_date predicate IN THE ON CLAUSE, so superseded/other-date order_items survive with non-null qty but NULL o.id; bare SUM over-counts. SQL only proven by e2e (orders.e2e), NOT unit (menu.service.spec stubs getRawMany).
- Voucher merge (getDeliveryVouchers): `SUM(oi.quantity)` GROUP BY user+menu_item → merges intra-order qty AND cross-order rows. Proven by vouchers.e2e (menu[1] qty3 intra + menu[0] cross-order).

Migration 20260620170300-add-order-item-quantity: `ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1` — additive, existing rows backfill to 1, byte-identical pre-refactor output. down() is destructive once qty>1 exists (documented). demo-seed inserts OrderItem without quantity → relies on DEFAULT 1.

Frontend gap: `frontend/src/lib/types.ts` OrderItem interface lacks `quantity` (API now returns it). Latent — no UI consumes per-item qty until visitor-quantity phase.
