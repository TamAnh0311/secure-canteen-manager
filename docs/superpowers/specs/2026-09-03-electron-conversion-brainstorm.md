# Canteen Manager — Electron Conversion Brainstorm

**Date:** 2026-09-03
**Status:** Brainstorming Complete — MVP Approved

---

## 1. Problem Statement

The current canteen manager system runs as a Docker Compose stack (PostgreSQL + NestJS + React/Nginx + OMR service + scan agent). Target deployment environments are **locked-down Windows desktops** in correctional facilities where:

- Docker cannot be installed (no admin access, no WSL)
- Non-technical staff need a **single-click installer** (.exe/.msi)
- The system must be **fully air-gapped** (no internet access)

---

## 2. Decided Architecture

### Approach: Electron + Embedded NestJS (Selected)

Electron wraps the React frontend as a native desktop window. The NestJS backend runs as a child process within the Electron app. SQLite replaces PostgreSQL as the embedded database.

**Why this approach:**
- Reuses ~90% of existing frontend and backend code
- Single `.exe` installer via `electron-builder`
- Native OS tray icon, auto-start, window management
- Proven pattern (VS Code, Slack, Discord)
- Larger binary size (~150-200MB) is acceptable for USB-based air-gapped delivery

**Rejected alternatives:**
- **Tauri + NestJS sidecar** — Smaller installer but Tauri's Node.js sidecar support is less mature; `mssql` driver compatibility untested
- **Standalone NestJS + system browser** — Simplest architecture but not a "real" desktop app; no tray icon; users might accidentally close the browser tab

---

## 3. Core Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | SQLite (replaces PostgreSQL) | Embedded, zero-install, single file. Perfect for single-machine deployment |
| OCR/Scanner | Dropped entirely | Handwriting recognition unreliable. Kiosk replaces paper forms |
| Order intake | Kiosk on tablets | Prisoners place orders via tablet browser. Replaces paper-based workflow |
| Legacy SQL Server sync | Kept | Facility still uses SQL Server 2005 for prisoner records |
| Kiosk authentication | Unauthenticated | Prisoners select their ID from a list. No PIN/badge/biometric |
| Tablet binding to cell | No | Any prisoner can use any tablet. General access |

---

## 4. Deployment Topology

```
┌─────────────────────────────────────────────────┐
│  Staff Office                                   │
│  ┌──────────────────┐    ┌──────────┐           │
│  │ Staff PC          │───│ Router/  │           │
│  │ (Electron App)    │   │ Switch   │           │
│  │ - NestJS backend  │   └────┬─────┘           │
│  │ - SQLite database │        │                 │
│  │ - React frontend  │        │                 │
│  └──────────────────┘        │                 │
└───────────────────────────────┼─────────────────┘
                                │
                    Ethernet / LAN
                                │
                  ┌─────────────┼─────────────┐
             ┌────┴────┐   ┌────┴────┐  ┌────┴────┐
             │ Tablet  │   │ Tablet  │  │ Tablet  │
             │ (Kiosk) │   │ (Kiosk) │  │ (Kiosk) │
             └─────────┘   └─────────┘  └─────────┘
```

- **Central PC:** Runs Electron app (staff UI + backend + database)
- **Tablets:** Browser-only thin clients, load `http://<staff-pc-ip>:3000/kiosk`
- **Network:** LAN only, no internet. **WiFi is NOT allowed** in cell areas — tablet connectivity method is still under discussion

### Tablet Connectivity (Unresolved)

WiFi is prohibited in cell areas. Options still being evaluated:

1. **Wired tablets in cells** — Ethernet cable to each cell, tablets use USB-to-Ethernet adapters. Most expensive but keeps cell-based ordering.
2. **Kiosks in common areas** — Wall-mounted tablets/PCs in supervised common areas (canteen, hallway). Wired Ethernet. No cell access needed.
3. **Mobile cart** — Staff brings a tablet cart to each cell block on a schedule. Tablets connect via Ethernet at the cart's docking station.

---

## 5. Relative (Family) Ordering

Relatives of prisoners can place orders by **visiting the facility in person**. A dedicated kiosk or counter interface allows them to:

- Place purchase orders for their family member
- Check order status

This keeps the system fully air-gapped — no external portal needed.

---

## 6. New Features Required

These features are mandated by the official requirements document but not yet implemented:

### 6.1 Purchase Limit Enforcement

- **Type:** Spending cap per period (maximum VND per week/month)
- **Behavior:** Auto-alert when a prisoner's order would exceed their limit
- **Note:** Database schema already exists (`purchase_limit_config` table) but is not enforced in order flows

### 6.2 Inventory Management

Full warehouse-level tracking with auto-deduction:

- **Product catalog:** Source/supplier, selling price, product code, import/export quantities, inventory levels, expiration dates
- **Stock-in/stock-out:** Track every inventory movement with timestamps
- **Batch tracking:** Track goods by batch with expiry dates
- **Auto-deduct:** Automatically reduce inventory when orders are fulfilled/delivered
- **Low stock alerts:** Warn staff when items fall below threshold

### 6.3 Printed Reports & Accounting Forms

Full reporting suite:

- **Delivery vouchers & receipts** — Individual order receipts and delivery vouchers (partially exists)
- **Daily/weekly summary reports** — Total sales, items sold, revenue by period, kitchen prep summaries
- **Accounting settlement forms** — Ledger statements, balance reconciliation, period close-out forms

### 6.4 Transaction Reconciliation & Audit

- **Internal cross-checks:** Orders vs. payments vs. deliveries. Flag mismatches (paid but not delivered, delivered but not paid, etc.)
- **Audit reports:** Formal reports showing all discrepancies found, with timestamps and responsible staff
- **Discrepancy detection:** Automatically flag mismatches in subjects, amounts, quantities, or goods

### 6.5 Enhanced Audit Trail

- Full logging of: access history, editing actions, approvals, goods delivery
- Per-staff-member action tracking by role/position
- Traceable to timestamps and responsible personnel

---

## 7. Features Carried Over (Already Implemented)

These features exist in the current system and will be preserved:

- Menu item management (CRUD, catalog)
- Order creation and status workflow (PENDING → PAID → DELIVERED)
- Account/balance ledger (insert-only transactions)
- Kiosk interface (unauthenticated prisoner ordering)
- Counter interface (cashier: top-ups, order approval, payment recording)
- Kitchen summary (orders aggregated by collection day)
- Voucher management
- Role-based access control (ADMIN, OPERATOR, CASHIER)
- Zone-based access scoping
- JWT authentication for staff
- Legacy SQL Server 2005 prisoner profile sync
- Internationalization (English + Vietnamese)

---

## 8. Features Removed

- OMR/OCR scanning pipeline (entire scanner service)
- Handwritten order form processing
- PaddleOCR integration
- Samba SMB share monitoring
- Scan verification UI
- Scanner webhook processing

---

## 9. Technical Migration Notes

### Database: PostgreSQL → SQLite

- TypeORM supports SQLite driver — migrations need dialect adaptation
- Insert-only ledger pattern is compatible with SQLite
- Foreign keys, transactions, and indexes all supported
- Key differences to handle: `SERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`, `timestamp with time zone` → `TEXT` (ISO 8601), no `ENUM` type
- 34 existing migrations need review/rewrite for SQLite dialect

### Electron Packaging

- `electron-builder` for .exe/.msi installer generation
- NestJS backend runs as child process (`fork`) within Electron
- Backend binds to `0.0.0.0` to serve both local Electron window and LAN tablets
- SQLite database file stored in `app.getPath('userData')`
- Auto-start on boot (optional, configurable)

### SQL Server Connectivity

- `mssql` package works in Node.js without special OS dependencies
- Connection to SQL Server 2005 on LAN for prisoner profile sync
- Feature-flagged via environment/config settings

---

## 10. Open Questions

1. **Tablet connectivity** — How to connect tablets to LAN without WiFi in cell areas? (Wired in cells / common area kiosks / mobile cart)
2. **Data backup** — How should SQLite database be backed up? (Manual USB export? Scheduled local backup?)
3. **Multi-user concurrency** — SQLite has write-locking limitations. With staff PC + multiple tablet kiosks making concurrent requests, need to confirm SQLite WAL mode handles the expected load.
4. **Update mechanism** — How to deliver app updates in an air-gapped environment? (USB stick with new installer?)
5. **Reporting templates** — What specific Vietnamese accounting form templates are required? (Need samples/examples)

---

## 11. Scope Summary

| Category | In Scope | Out of Scope |
|----------|----------|--------------|
| Desktop app | Electron + NestJS + SQLite | Tauri, PWA |
| Order intake | Kiosk (tablet browser) | Paper forms, OCR, handwriting |
| Database | SQLite (embedded) | PostgreSQL, cloud DB |
| Relatives | In-person at facility | External web portal |
| Reports | Receipts, summaries, accounting | BI/analytics dashboards |
| Inventory | Full warehouse + auto-deduct | Multi-warehouse, barcode scanning |
| Purchase limits | Spending cap per period | Per-item quantity limits, regime-based |
| Reconciliation | Internal + audit reports | External ledger import |
| Network | LAN only, air-gapped | Internet, cloud sync |
| Scanner/OCR | Removed entirely | — |
