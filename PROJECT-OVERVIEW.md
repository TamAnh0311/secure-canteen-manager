# Canteen System — Project Overview

> Comprehensive documentation covering all components of the prisoner commissary ordering and payment system.

---

## Table of Contents

1. [System Purpose](#1-system-purpose)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Component Breakdown](#4-component-breakdown)
   - [Canteen Manager Backend](#41-canteen-manager-backend)
   - [Canteen Manager Frontend](#42-canteen-manager-frontend)
   - [Order Scanner Service](#43-order-scanner-service)
   - [OMR Service](#44-omr-service)
   - [Scan Agent](#45-scan-agent)
5. [Data Flow & Integration](#5-data-flow--integration)
6. [Feature Matrix](#6-feature-matrix)
7. [Database & Migrations](#7-database--migrations)
8. [Authentication & Authorisation](#8-authentication--authorisation)
9. [Test Coverage](#9-test-coverage)
10. [Known Bugs & Issues](#10-known-bugs--issues)
11. [Missing Features & TODO](#11-missing-features--todo)
12. [Configuration Reference](#12-configuration-reference)
13. [Project Status Summary](#13-project-status-summary)

---

## 1. System Purpose

The Canteen System is a **prisoner commissary ordering and payment platform** built for correctional facilities in Vietnam. It manages the full lifecycle of food/household orders:

- **Order intake** through multiple channels (kiosk, staffed counter, scanned handwritten forms)
- **Optical recognition** of handwritten order sheets (OMR bubble detection + OCR digit/text recognition)
- **Payment processing** with ledger-based balance tracking (cash and bank transfers)
- **Delivery voucher generation** aggregated by collection date
- **Audit trail** for compliance and traceability

The system is designed for **air-gapped deployment** — the installation site has no internet access. All images are pre-built and loaded via verified offline bundles.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AIR-GAPPED SITE                              │
│                                                                     │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌───────────────┐  │
│  │ Frontend  │──▶│  Backend   │──▶│ Postgres │   │  OMR Service  │  │
│  │ (Nginx)   │   │ (NestJS)  │   │  16-alp  │   │  (Python)     │  │
│  │ :8080     │   │ :3000     │   │  :55433  │   │  :8000        │  │
│  └──────────┘   └─────┬─────┘   └──────────┘   └───────────────┘  │
│                        │                                            │
│                        │ webhooks                                   │
│                        ▼                                            │
│               ┌──────────────┐        ┌──────────────────┐         │
│               │  Scan Agent  │        │  Order Scanner   │         │
│               │  (file→API)  │        │  (Python/OCR)    │         │
│               └──────────────┘        │  Samba inbox     │         │
│                                       │  SQLite state    │         │
│                                       └──────────────────┘         │
│                                                                     │
│  Docker Compose (canteen-manager)    Systemd (scanner, bare metal) │
└─────────────────────────────────────────────────────────────────────┘
```

**Two deployment units:**

| Unit | Runs As | Components |
|------|---------|------------|
| **Canteen Manager** | Docker Compose | postgres, migrate, backend, omr-service, frontend, scan-agent |
| **Order Scanner** | Systemd service (bare metal) | order-scanner, Samba share |

The scanner runs on a separate machine with PaddleOCR (CPU-only). It watches a Samba file share for scanned PDFs/images, processes them, and delivers results to the backend via webhook callbacks.

---

## 3. Technology Stack

### Canteen Manager

| Layer | Technology |
|-------|-----------|
| Backend | NestJS 11, TypeORM, Node.js 22, TypeScript |
| Frontend | React 18, Vite, TailwindCSS, Radix UI, i18next (EN/VI) |
| Database | PostgreSQL 16 Alpine |
| OMR Service | Python, ONNX (digit recognition), OpenCV |
| Scan Agent | Python, file-based inbox polling |
| Auth | JWT (HS256), Passport, bcrypt |
| Validation | Zod (backend env), Zod/React Hook Form (frontend) |
| Containerisation | Docker multi-stage builds, Docker Compose |

### Order Scanner

| Layer | Technology |
|-------|-----------|
| Runtime | Python 3.11+, uv package manager |
| OCR | PaddleOCR 3.7 (PP-OCRv6, Vietnamese, CPU-only) |
| Image Processing | OpenCV, NumPy, Pillow, PyPdfium2 |
| Database | SQLite3 with schema migrations |
| File Intake | Samba SMB share, filesystem polling |
| Deployment | Ansible playbook, systemd, Ubuntu/Debian x86_64 |

---

## 4. Component Breakdown

### 4.1 Canteen Manager Backend

**Location:** `canteen-manager/backend/`

**Modules:**

| Module | Purpose |
|--------|---------|
| `accounts/` | Prisoner account balance ledger (debit/credit, audit trail) |
| `auth/` | JWT authentication, role guards, operator zone routing |
| `common/` | Utilities (timezone, validation, logging) |
| `config/` | Zod-based environment validation, threshold config |
| `counter/` | Staffed cashier interface (accept/reject orders, record payment) |
| `database/` | TypeORM data source, 34 migrations, seed scripts |
| `health/` | Health check endpoint (`/health` — DB connectivity probe) |
| `kiosk/` | Prisoner-facing menu browsing and order placement |
| `legacy-sync/` | Optional read-only sync from SQL Server 2005 |
| `menu/` | Menu item CRUD, catalog versioning |
| `omr/` | OMR service HTTP client |
| `omr-forms/` | Form template generation, issuance tracking |
| `operators/` | Staff user management (ADMIN/OPERATOR/CASHIER roles) |
| `orders/` | Order creation, payment settlement, delivery vouchers |
| `payment-config/` | Global payment method configuration (bank enable flag) |
| `purchase-limit-config/` | Per-prisoner spending limits (schema exists, not enforced) |
| `scans/` | OMR sheet ingestion pipeline, status machine, verification |
| `users/` | Prisoner profiles (legacy integration fields) |

**Key business rules:**
- Duplicate order detection (same prisoner + same date) returns 409 CONFLICT
- Order replacement with acknowledging operator recorded
- Payment settlement: PENDING → PAID (debit balance or external payment)
- Ledger-based balance: never UPDATE, always INSERT transaction
- Scan status machine: PENDING → PROCESSING → FLAGGED/APPROVED/REJECTED
- Three scan workflow modes: `legacy_omr`, `scanner_shadow`, `scanner_webhook`

### 4.2 Canteen Manager Frontend

**Location:** `canteen-manager/frontend/`

**Feature modules:**

| Feature | Path | Purpose |
|---------|------|---------|
| `auth/` | `/login` | Login page |
| `dashboard/` | `/` | Landing/summary page |
| `kiosk/` | `/kiosk` | Prisoner menu browsing + order placement |
| `counter/` | `/counter` | Cashier: top-ups, order approval queue |
| `orders/` | `/orders` | Operator: order list, delivery vouchers |
| `verify/` | `/verify` | Operator: review flagged scan sheets |
| `scan-monitor/` | `/scan-monitor` | Real-time scan queue status |
| `scan-upload/` | `/scan-upload` | Manual scan file upload |
| `menu-config/` | `/menu-config` | Admin: menu item CRUD |
| `operators/` | `/operators` | Admin: staff user management |
| `accounts/` | `/accounts` | Account audit trails |
| `form-print/` | `/form-print` | Admin: OMR form generation |
| `order-form/` | `/order-form` | Operator: manual order data entry |
| `payment-config/` | `/payment-config` | Admin: payment method settings |
| `kitchen-summary/` | `/kitchen-summary` | Kitchen: aggregate orders by collection day |
| `vouchers/` | `/vouchers` | Admin: delivery voucher management |

**Infrastructure:**
- Typed API client functions split by domain (`lib/api/`)
- Base fetch with JWT injection, 401 auto-logout (`lib/api-client.ts`)
- i18next translations: English and Vietnamese (`i18n/`)
- Shared UI components with Radix UI primitives (`ui/`)
- Vite dev proxy strips `/api` prefix → backend root
- Production Nginx reverse proxy does the same (`/api/` → `http://backend:3000/`)

### 4.3 Order Scanner Service

**Location:** `scanner/`

**Purpose:** Standalone CPU-only handwritten order scanner that runs on bare metal. Watches a Samba-mounted inbox for scanned PDF/image files, performs OCR recognition, validates data, and delivers results to the canteen backend via webhook.

**Core pipeline:**

```
Samba Inbox → File Stability Check → PDF Decomposition → Page Alignment
    → Crop Extraction → PaddleOCR Recognition → Catalogue Matching
    → Validation → Callback Delivery (webhook to backend)
```

**Key modules:**

| Module | Purpose |
|--------|---------|
| `cli.py` | Command-line interface, service startup |
| `config.py` | TOML configuration loading, `SecretValue` handling |
| `contracts.py` | Data contracts (`ResultSnapshot`, `CallbackEvent`, `Catalogue`) |
| `storage.py` | SQLite persistence, job queue, lease-based coordination |
| `pipeline.py` | Page processing orchestration |
| `ingestion.py` | File intake, stability tracking, source validation |
| `callbacks.py` | Webhook delivery with exponential backoff retry |
| `recognition.py` | OCR abstraction, confidence calibration, auto-accept logic |
| `catalogue.py` | Levenshtein-based item matching with accent normalisation |
| `validation.py` | Cross-field rules, quantity constraints, room code format |
| `imaging.py` | Alignment detection, page normalisation, crop extraction |
| `paddleocr_backend.py` | PaddleOCR wrapper for Vietnamese text recognition |
| `artifacts.py` | Content-addressed SHA256 immutable file store |
| `api.py` | Optional REST endpoint for artifact streaming + health/metrics |
| `runtime.py` | Disk pressure monitoring (pause intake at high watermark) |
| `template_v4.py` | Form geometry for ticket-v4 template |
| `template_skm.py` | Form geometry for ticket-skm-v1 template |

**Key features:**
- Multi-process worker pool with configurable parallelism
- Durable SQLite job queue with lease-based worker coordination
- Visual duplicate detection via hamming distance fingerprinting
- At-least-once callback delivery with idempotency keys
- Disk pressure controller (pauses intake at 90%, resumes at 80%)
- Graceful shutdown with bounded cleanup timeouts
- Bundle fingerprinting (SHA256 of config + model + recognition settings)

### 4.4 OMR Service

**Location:** `omr-service/` (source not present in workspace — referenced by docker-compose)

**Purpose:** Python-based optical mark recognition service. Processes scanned order form images:
- Bubble fill detection (OMR)
- Handwritten digit recognition (ONNX MNIST model)
- Handwriting text recognition

**Configuration via environment variables:**
- `OMR_EMPTY_MAX` / `OMR_TICKED_MIN` — bubble fill thresholds
- `ICR_CONFIDENCE_THRESHOLD` — digit recognition confidence
- `ONNX_MODEL_PATH` — path to MNIST digit model
- `HANDWRITING_MODEL_DIR` — handwriting recognition model directory

**Security:** Runs read-only, tmpfs for /tmp, all capabilities dropped, no-new-privileges.

### 4.5 Scan Agent

**Location:** `scan-agent/` (source not present in workspace — referenced by docker-compose)

**Purpose:** File-based bridge that polls a local inbox directory for scanned images and uploads them to the backend API. Runs as a Docker container in the compose stack.

**Flow:** `inbox/ → spool/pending → POST to backend → spool/archive (or quarantine)`

---

## 5. Data Flow & Integration

### Order Intake Paths

```
Path 1: KIOSK (prisoner-facing, unauthenticated)
  Prisoner → browses menu → places order → PENDING

Path 2: COUNTER (cashier-staffed)
  Cashier → views PENDING orders → accepts/rejects → records payment → PAID

Path 3: OMR (legacy_omr mode)
  Scanned sheet → scan-agent uploads → backend → OMR service processes
    → auto-approve OR flag for manual review

Path 4: SCANNER WEBHOOK (scanner_webhook mode)
  Scanned sheet → Samba inbox → Order Scanner processes → webhook callback
    → backend receives result → auto-create order OR flag for review

Path 5: ORDER FORM (operator manual entry)
  Operator → enters order details manually → creates order
```

### Scanner ↔ Backend Integration

**Direction:** Scanner → Backend (one-way webhook)

**Protocol:** HTTPS POST with Bearer token (`SCANNER_CALLBACK_TOKEN`) and `Idempotency-Key` header

**Callback payload structure:**
```json
{
  "event_id": "evt_...",
  "event_type": "order_scan.result",
  "schema_version": "1.0-draft",
  "result": {
    "document_id": "doc_...",
    "outcome": "accepted | needs_review",
    "service_date": "2026-08-04",
    "ma_luu_ky": "000001",
    "buong_giam": "A1",
    "items": [
      {
        "row_index": 0,
        "item": { "text": "Phở bò", "score": 0.97 },
        "quantity": { "value": 2, "score": 0.99 },
        "catalogue_item_id": "001"
      }
    ]
  }
}
```

**Catalogue synchronisation:**
- Manager provides `manager-catalogue.json` with `catalogueItemId` and `name`
- Scanner uses `scanner-catalogue.json` with `item_id`, `canonical_name`, and aliases
- Mapping: Manager codes (001-050) ↔ Scanner item IDs
- Catalogue version hash tracked in scanner config for drift detection

**No feedback loop yet:** The backend cannot send corrections or flags back to the scanner.

---

## 6. Feature Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| JWT authentication | Done | HS256, 12h expiry, auto-logout on 401 |
| Role-based access (ADMIN/OPERATOR/CASHIER) | Done | Guards on all endpoints |
| Zone-based operator scoping | Done | Queries filtered by assigned zone |
| Prisoner profile management | Done | Legacy sync from SQL Server 2005 (optional) |
| Account balance ledger | Done | Immutable insert-only transactions |
| Menu item CRUD | Done | Pricing, active/inactive, catalog versioning |
| Kiosk ordering | Done | Unauthenticated, PENDING status |
| Counter order approval | Done | Accept/reject with payment method |
| OMR form generation | Done | Template versioning, SHA-256 catalog hash |
| Scan upload + OMR processing | Done | legacy_omr mode fully working |
| Scan verification UI | Done | Review flagged sheets, identity + item confirmation |
| Delivery vouchers | Done | Aggregated by collection date with balance snapshot |
| Kitchen summary | Done | Aggregate orders for collection day |
| Payment config (bank toggle) | Done | Admin UI |
| Operator management | Done | CRUD with zone assignments |
| i18n (English + Vietnamese) | Done | Full translation coverage |
| Order Scanner (standalone) | Done | PaddleOCR, Samba intake, webhook delivery |
| Scanner webhook integration | Partial | Entities exist; event processing partially wired |
| Purchase limit enforcement | Not Done | Schema exists, not enforced in order flows |
| Scan retention auto-purge | Not Done | Config exists, no scheduled job |
| OMR service circuit-breaker | Not Done | No fallback if OMR service unavailable |
| Scanner → Backend feedback loop | Not Done | One-way only; no correction mechanism |
| API documentation (Swagger) | Not Done | No OpenAPI spec |
| README files | Not Done | Neither project has a README |

---

## 7. Database & Migrations

### Canteen Manager (PostgreSQL)

- **34 TypeORM migrations** (timestamp-versioned)
- `synchronize: false`, `migrationsRun: false` — explicit control only
- Migrations run via one-shot `migrate` container before backend starts
- Idempotent: already-applied migrations are skipped

**Key tables:** operators, users (prisoners), accounts, account_transactions, orders, order_items, menu_items, scans, scan_sheets, omr_forms, payment_config, purchase_limit_config, scanner_webhook_events, scanner_artifact_jobs

### Order Scanner (SQLite)

- **4 progressive migrations** (version-stamped)
- Schema: jobs (processing queue), outbox (callback delivery), artifacts (file store metadata)
- Lease-based coordination for multi-worker access
- `service_date` field added in migration 004 (NULL for pre-existing rows → permanent failure by design)

---

## 8. Authentication & Authorisation

### Backend API

| Mechanism | Details |
|-----------|---------|
| Algorithm | HS256 JWT |
| Secret | `JWT_SECRET` (min 32 chars) |
| Expiry | 12 hours (configurable) |
| Roles | `ADMIN`, `OPERATOR`, `CASHIER` |
| Zone scoping | Operators restricted to assigned zones |
| Kiosk | Unauthenticated (no JWT required) |
| Scanner webhook | Bearer token (`SCANNER_CALLBACK_TOKEN`, min 16 chars) |
| Artifact streaming | Bearer token (`SCANNER_ARTIFACT_TOKEN`) |

### Frontend

- JWT stored in browser (token-storage.ts)
- Auto-injected on every API request
- 401 response triggers automatic logout + notification
- Route guards enforce role-based page access

### Scanner Service

- Callback delivery uses Bearer token from `SCANNER_CALLBACK_TOKEN`
- Artifact API uses separate `SCANNER_ARTIFACT_TOKEN`
- Samba share uses dedicated `scanner-share` system user with password auth

---

## 9. Test Coverage

### Canteen Manager Backend — 70 test files (Jest)

| Area | Coverage | Notes |
|------|----------|-------|
| Orders (create, pay, reject, replace) | High | Transaction-critical paths well tested |
| Scans (pipeline, verify, status machine) | High | Extensive edge case coverage |
| Auth (JWT, guards, roles) | Good | |
| Accounts (ledger, balance) | Good | |
| Config (env validation) | Good | Zod schema edge cases |
| Menu, Operators, Users | Moderate | CRUD operations |
| Counter, Kiosk | Moderate | |
| Health | Basic | |
| Migrations | Sparse | |

**Commands:** `npm test` (unit/integration), `npm run test:e2e` (end-to-end)

### Canteen Manager Frontend — 56 test files (Vitest)

| Area | Coverage | Notes |
|------|----------|-------|
| Kiosk (menu, calculator, order) | Good | |
| Counter, Verify, Scan workflows | Good | |
| Accounts | Moderate | |
| Accessibility | Present | vitest-axe integration |

**Commands:** `npm test` (run once), `npm run test:watch` (watch mode)

### Order Scanner — 20 test files (pytest)

| Area | Coverage | Notes |
|------|----------|-------|
| Config validation | High | 341 lines |
| Storage/DB (jobs, leases, atomicity) | High | 515 lines |
| Imaging (alignment, normalisation, crops) | High | 518 lines |
| Ingestion (discovery, stability, validation) | High | 397 lines |
| Contracts (invariants, service date) | Good | 195 lines |
| Callbacks (delivery, retry, replay) | Good | 340 lines |
| Catalogue (matching, normalisation) | Good | 87 lines |
| PaddleOCR backend | Mocked | 111 lines; real inference not tested |
| Multi-worker contention | Not tested | |

**Commands:** `pytest` (from project root)

---

## 10. Known Bugs & Issues

### Critical

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| 1 | **Production API routing bug** | Frontend sends `/api/...`, backend serves at `/...`. Vite dev proxy masks this. Production Nginx config in `frontend/nginx.conf` DOES handle it (`/api/` → `backend:3000/`), but the earlier assessment flagged this — **verify nginx.conf is correctly bundled in the Docker image.** | `frontend/nginx.conf`, `frontend/Dockerfile` |

### High

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| 2 | **Purchase limits not enforced** | Orders can exceed per-prisoner spending limits silently. Schema and config exist but `counter.relativeOrder()` and `kiosk.placeOrder()` don't check them. | `backend/src/counter/`, `backend/src/kiosk/` |

### Medium

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| 3 | **Scan retention no auto-purge** | `SCAN_RETENTION_DAYS` configured but no scheduled cleanup job. Disk usage grows unbounded. | `backend/src/scans/` |
| 4 | **OMR service no fallback** | If OMR service is down, scan processing blocks indefinitely. No circuit-breaker or timeout. | `backend/src/omr/` |
| 5 | **Scanner callback schema draft** | Callback payload marked as `1.0-draft` — not finalised. | `scanner/src/order_scanner/contracts.py` |

### Low

| # | Issue | Impact | Location |
|---|-------|--------|----------|
| 6 | **Scanner webhook partial** | Entities exist but event ingestion flow may be incomplete. | `backend/src/scans/` |
| 7 | **Large service files** | `verify.service.ts` (1328 lines), `orders.service.ts` (637 lines) — harder to maintain. | `backend/src/scans/`, `backend/src/orders/` |
| 8 | **Magic strings** | Order error codes (`ORDER.ALREADY_PENDING`, etc.) hardcoded; no shared enum. | `backend/src/orders/` |
| 9 | **PaddleOCR platform lock** | Recognition only works on Linux x86_64 or macOS arm64. Windows falls back to `needs_review`. | `scanner/` |

---

## 11. Missing Features & TODO

### Must Have (Production Blockers)

- [ ] **Verify Nginx API routing works in prod** — confirm `frontend/nginx.conf` is correctly copied into Docker image and `/api/` rewrite functions end-to-end
- [ ] **Enforce purchase limits** in `counter.relativeOrder()` and `kiosk.placeOrder()`
- [ ] **Set `AGENT_TOKEN` and `SCAN_RETENTION_DAYS`** in production `.env` (backend refuses to start without them)

### Should Have

- [ ] **Scan retention auto-purge job** — scheduled task to delete expired scan images
- [ ] **OMR service circuit-breaker** — timeout and graceful degradation when OMR is down
- [ ] **Finalise callback schema** — move from `1.0-draft` to `1.0`
- [ ] **Complete scanner webhook mode** — wire up event ingestion in backend
- [ ] **Scanner → Backend feedback loop** — allow backend to send corrections back

### Nice to Have

- [ ] **Top-level README** for both projects
- [ ] **API documentation** (Swagger/OpenAPI)
- [ ] **Deployment runbook** — step-by-step guide (see companion doc: `DEPLOYMENT-GUIDE.md`)
- [ ] **ER diagram** for database schema
- [ ] **Architecture decision records** (ADRs)
- [ ] **Form print PDF preview** in admin UI
- [ ] **Refactor large services** — split `verify.service.ts` and `orders.service.ts`
- [ ] **Shared error code enum** — replace magic strings
- [ ] **Scanner web dashboard** — monitoring and manual review UI
- [ ] **Scanner data export** — bulk CSV/Parquet export of results
- [ ] **Scanner search/query API** — find historical results by criteria
- [ ] **Scanner database backups** — snapshot/replication strategy

---

## 12. Configuration Reference

### Canteen Manager Environment Variables

**Required (all environments):**

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_USER` | PostgreSQL username | `canteen` |
| `POSTGRES_PASSWORD` | PostgreSQL password | — |
| `POSTGRES_DB` | PostgreSQL database name | `canteen` |
| `DATABASE_URL` | Full PostgreSQL DSN | — |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | — |

**Required (production only):**

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_TOKEN` | Scanner hardware auth token (min 16 chars) | — |
| `SCAN_RETENTION_DAYS` | Scan image retention period (positive int) | — |

**Optional:**

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_PORT` | Backend API port | `3000` |
| `FRONTEND_PORT` | Frontend Nginx port | `8080` |
| `APP_TZ` | IANA timezone | `Asia/Saigon` |
| `SCAN_WORKFLOW_MODE` | `legacy_omr`, `scanner_shadow`, or `scanner_webhook` | `legacy_omr` |
| `SCANNER_CALLBACK_TOKEN` | Bearer token for scanner webhooks | — |
| `SCANNER_ARTIFACT_TOKEN` | Token for artifact API access | — |
| `SCANNER_ARTIFACT_ORIGIN` | Allowed origin for artifact requests | — |
| `OMR_OPERATIONAL_FORM_MODE` | `issued` or `generic` | `issued` |
| `SEED_ADMIN_USERNAME` | Demo seed admin username | `admin` |
| `SEED_ADMIN_PASSWORD` | Demo seed admin password | `admin12345` |
| `LEGACY_SQL_*` | SQL Server 2005 sync settings (all optional) | — |

**OMR thresholds:**

| Variable | Description | Default |
|----------|-------------|---------|
| `OMR_EMPTY_MAX` | Max fill ratio for empty bubble | `0.30` |
| `OMR_TICKED_MIN` | Min fill ratio for ticked bubble | `0.70` |
| `ICR_CONFIDENCE_THRESHOLD` | Digit recognition confidence threshold | `0.85` |
| `OMR_DPI` | Expected scan DPI | `300` |

### Order Scanner Configuration (TOML)

**Key sections in `config.toml`:**

| Section | Key Settings |
|---------|-------------|
| `[paths]` | `database`, `spool`, `artifacts`, `inbox` |
| `[service]` | `workers`, `sqlite_timeout_ms`, `lease_duration_s`, `poll_interval_s` |
| `[limits]` | `max_file_bytes` (52MB), `max_pages` (100), `max_quantity` (999) |
| `[scanner]` | `timezone`, `file_extensions`, `polling_interval_s`, `pdf_render_dpi` |
| `[recognition]` | `enabled`, `backend` (paddleocr), `model_name`, `auto_accept` |
| `[callback]` | `url`, `token_env`/`token_file`, `timeout_s`, `retry_base_s`, `retry_max_s` |
| `[api]` | `enabled`, `host`, `port`, `artifact_token_env` |
| `[retention]` | `artifacts_days` (30), `audit_days` (365) |

**Environment variables for scanner:**
- `SCANNER_CALLBACK_TOKEN` — Bearer token for webhook auth (required)
- `SCANNER_ARTIFACT_TOKEN` — Token for artifact API (optional)
- `PADDLE_PDX_CACHE_HOME` — PaddleOCR model cache directory

---

## 13. Project Status Summary

| Aspect | Canteen Manager | Order Scanner |
|--------|----------------|---------------|
| **Maturity** | Mature (34 migrations, full feature set) | Early (v0.1.0) but well-architected |
| **Production Ready** | Partial (routing + limit enforcement needed) | Ready (for intake + processing + delivery) |
| **Test Coverage** | Good (126 test files total) | Good (20 test files, 3754 lines) |
| **Documentation** | Sparse (no README, agent memory only) | Sparse (no README, Ansible docs only) |
| **Security** | Strong (JWT, RBAC, zone scoping, air-gap) | Strong (systemd hardening, Samba auth, token auth) |
| **Deployment** | Docker Compose with air-gap bundle | Ansible playbook with systemd |
| **Missing Source** | `omr-service/` and `scan-agent/` not in workspace | Complete |

**Overall verdict:** The system is feature-rich and well-tested. The main gaps are purchase limit enforcement, scan retention automation, and documentation. The production API routing should be verified but the Nginx config appears correct.
