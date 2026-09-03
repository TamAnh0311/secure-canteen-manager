# Canteen Manager — Electron MVP Spec (Phase 1)

**Date:** 2026-09-03
**Status:** Approved for Implementation

---

## Goal

Convert the existing Docker-based canteen manager (NestJS + React + PostgreSQL) into a single-installer Electron desktop app with SQLite, deployable on locked-down Windows PCs without Docker. The app also serves a kiosk web interface over LAN for tablet browsers.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Electron App (.exe)                    │
│                                         │
│  ┌─────────────┐   ┌────────────────┐  │
│  │ Main Process │   │ Renderer       │  │
│  │              │   │ (React app)    │  │
│  │ - Boots      │   │ - Staff UI     │  │
│  │   NestJS     │   │ - loads from   │  │
│  │ - Manages    │   │   localhost    │  │
│  │   lifecycle  │   └────────────────┘  │
│  │ - Tray icon  │                       │
│  └──────┬───────┘                       │
│         │ fork()                        │
│  ┌──────┴───────┐   ┌────────────────┐  │
│  │ NestJS       │   │ SQLite DB      │  │
│  │ Backend      │───│ (file in       │  │
│  │ (port 3000)  │   │  userData/)    │  │
│  │ binds 0.0.0.0│   └────────────────┘  │
│  └──────────────┘                       │
└─────────────────────────────────────────┘
         │
    LAN (HTTP)
         │
   ┌─────┴─────┐
   │  Tablets   │  → browser opens http://<ip>:3000/kiosk
   └───────────┘
```

### Process Model

1. **Electron main process** — Spawns NestJS as a child process via `fork()`. Manages app lifecycle (start, stop, tray icon, window).
2. **NestJS child process** — Runs the existing backend, binds to `0.0.0.0:3000`. Serves both the API and the built React frontend as static files.
3. **Electron renderer** — BrowserWindow loads `http://localhost:3000` (the React SPA served by NestJS).
4. **Tablets** — Any device on the LAN opens `http://<staff-pc-ip>:3000/kiosk` in a browser.

### Why NestJS serves static files

In the current setup, Nginx serves the React build and proxies `/api` to the backend. In Electron, we eliminate Nginx entirely. NestJS serves the React production build from a `public/` directory using `@nestjs/serve-static`. This means:

- One process handles everything (no Nginx, no reverse proxy)
- The `/api` prefix question is resolved by adding a global API prefix (`/api`) to NestJS routes
- Frontend `api-client.ts` already uses `/api` prefix — no changes needed

---

## Database Migration: PostgreSQL to SQLite

### TypeORM Config Changes

**Current** (`data-source.ts`):
```typescript
type: 'postgres',
url: process.env['DATABASE_URL'],
```

**New:**
```typescript
type: 'better-sqlite3',
database: path.join(app.getPath('userData'), 'canteen.sqlite'),
```

### Driver

Use `better-sqlite3` — synchronous, faster than `sqlite3` for Electron, well-supported by TypeORM.

### Migration Rewrite

All 34 existing PostgreSQL migrations must be consolidated into a single SQLite-compatible initial migration. Key dialect changes:

| PostgreSQL | SQLite |
|-----------|--------|
| `SERIAL PRIMARY KEY` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `timestamp with time zone` | `TEXT` (store ISO 8601 strings) |
| `ENUM type` | `TEXT` with CHECK constraint |
| `CREATE TYPE` | Not supported — remove |
| `ALTER TYPE ... ADD VALUE` | Not supported — use CHECK constraints |
| `uuid DEFAULT gen_random_uuid()` | `TEXT` with application-generated UUID |
| `ILIKE` | Custom collation or `LIKE` (SQLite is case-insensitive for ASCII by default) |
| `BOOLEAN` | `INTEGER` (0/1) |
| `JSONB` | `TEXT` (store JSON strings) |

### Approach

1. Write one new migration (`00000000000001-initial-schema.ts`) that creates all tables in SQLite-compatible DDL
2. Keep the same entity definitions — TypeORM abstracts most differences
3. Archive the 34 PostgreSQL migrations (don't delete — useful if multi-machine PostgreSQL version is needed later)
4. Enable WAL mode for better concurrent read performance from tablet kiosk requests:
   ```sql
   PRAGMA journal_mode=WAL;
   PRAGMA busy_timeout=5000;
   ```

---

## Electron Shell

### Structure

```
canteen-electron/
├── package.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron main process entry
│   │   ├── backend-process.ts # Fork + manage NestJS child
│   │   ├── tray.ts           # System tray icon + menu
│   │   └── window.ts         # BrowserWindow creation
│   └── preload/
│       └── index.ts          # Preload script (minimal)
├── resources/
│   └── icon.ico              # App icon
└── dist/                     # Built output
```

### Main Process Responsibilities

- **Boot sequence:** Start NestJS child process → wait for "ready" IPC message → open BrowserWindow to `http://localhost:3000`
- **Shutdown:** On window close / quit, send IPC `shutdown` message to NestJS child (Windows does not support SIGTERM), wait for graceful shutdown with 5s timeout before force-killing
- **Tray icon:** Minimize to tray, show status (running/stopped), quit option
- **Error handling:** If NestJS crashes, show error dialog, offer restart
- **Auto-start:** Optional Windows registry entry for boot-on-login

### Electron Builder Config

```yaml
appId: com.canteen.manager
productName: Canteen Manager
directories:
  output: release
win:
  target: nsis
  icon: resources/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
extraResources:
  - from: ../canteen-manager/backend/dist
    to: backend
  - from: ../canteen-manager/frontend/dist
    to: frontend
```

---

## Backend Modifications

### 1. Add global API prefix

```typescript
// main.ts
app.setGlobalPrefix('api');
```

This aligns with the frontend's `/api` prefix. Currently the backend has no prefix (Nginx stripped `/api`). Adding the prefix means all routes become `/api/auth/login`, `/api/orders`, etc.

### 2. Serve static React build

```typescript
// app.module.ts
import { ServeStaticModule } from '@nestjs/serve-static';

ServeStaticModule.forRoot({
  rootPath: process.env['FRONTEND_DIST_PATH']
    ?? path.join(__dirname, '..', 'frontend'),
  exclude: ['/api/(.*)'],
}),
// In Electron, FRONTEND_DIST_PATH is set to:
// path.join(process.resourcesPath, 'frontend')
```

### 3. Simplify environment config

For Electron, many env vars become unnecessary. The Zod schema needs a new profile:

**Keep:**
- `JWT_SECRET` — auto-generated on first launch, stored in `%APPDATA%/Canteen Manager/config.json`
- `JWT_EXPIRES_IN`
- `NODE_ENV`
- `BACKEND_PORT` (default 3000)
- `APP_TZ`
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`
- All `LEGACY_SQL_*` vars (optional, for SQL Server sync)

**Remove (scanner/OMR related):**
- All `SCAN_*` vars
- All `OMR_*` vars
- All `SCANNER_*` vars
- `AGENT_TOKEN`
- `DATABASE_URL` (replaced by SQLite file path)

### 4. Remove scanner/OMR modules

Remove from `app.module.ts` imports:
- `ScansModule`
- `OmrModule`
- `OmrFormsModule`

Keep the source files in the repo (archived) but exclude from the Electron build.

### 5. Bind to 0.0.0.0

```typescript
await app.listen(port, '0.0.0.0');
```

This allows LAN tablets to reach the backend. Currently defaults to `localhost` only.

---

## Frontend Modifications

### Minimal changes needed

The frontend already works with the `/api` prefix. Changes:

1. **Remove scan-related routes and features:**
   - `/verify` (scan verification)
   - `/scan-monitor` (scan queue status)
   - `/scan-upload` (manual scan upload)
   - `/form-print` (OMR form generation)

2. **Update navigation/sidebar:** Remove links to scan-related pages

3. **No build tooling changes:** Vite builds the React app to `dist/`. This gets bundled as static files in the Electron package.

---

## First Launch Flow

1. User double-clicks `Canteen Manager.exe`
2. Electron main process starts
3. Checks if `canteen.sqlite` exists in `%APPDATA%/Canteen Manager/`
4. If first launch:
   - Creates SQLite database
   - Runs initial migration
   - Generates random `JWT_SECRET` (64-char hex via `crypto.randomBytes(32)`), saves to `%APPDATA%/Canteen Manager/config.json`
   - Prompts for admin username/password (simple Electron dialog)
   - Seeds admin operator
5. Forks NestJS process with config pointing to SQLite file
6. NestJS boots, runs any pending migrations
7. Main process opens BrowserWindow to `http://localhost:3000`
8. App is ready

---

## Installer Deliverable

- Single `.exe` installer (~150-200MB) built by `electron-builder`
- Installs to `C:\Program Files\Canteen Manager\` (or user-chosen path)
- Creates desktop shortcut and start menu entry
- Database stored in `%APPDATA%\Canteen Manager\canteen.sqlite`
- Transferable via USB drive for air-gapped deployment

---

## What's NOT in MVP

- Purchase limit enforcement
- Inventory management
- Relative ordering
- Printed reports / accounting forms
- Transaction reconciliation / audit reports
- Enhanced audit trail
- Auto-update mechanism
- Data backup/restore UI

These are Phase 2 and Phase 3.

---

## Testing Strategy

1. **Unit tests:** Existing Jest tests adapted for SQLite (mock data source)
2. **E2E tests:** Backend E2E tests run against SQLite instead of PostgreSQL
3. **Frontend tests:** Existing Vitest tests — no changes needed (they mock API calls)
4. **Manual testing:** Verify Electron app launches, creates DB, serves frontend, and tablets can reach kiosk
5. **Installer testing:** Build .exe, install on clean Windows machine, verify full flow
