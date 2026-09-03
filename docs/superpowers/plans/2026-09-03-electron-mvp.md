# Electron MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Docker-based canteen manager into a single-installer Electron desktop app with SQLite, runnable on locked-down Windows PCs without Docker.

**Architecture:** Electron main process forks a NestJS child process that serves the React SPA as static files and the API under `/api`. SQLite (via better-sqlite3) replaces PostgreSQL. The backend binds `0.0.0.0` so LAN tablets can reach the kiosk.

**Tech Stack:** Electron 36, electron-builder, NestJS 11, TypeORM + better-sqlite3, React 18, Vite

---

## File Structure

### New files (canteen-electron/)

```
canteen-electron/
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron main process entry
│   │   ├── backend-process.ts    # Fork + manage NestJS child
│   │   ├── tray.ts               # System tray icon + menu
│   │   ├── window.ts             # BrowserWindow creation
│   │   ├── first-launch.ts       # DB init, JWT secret, admin setup
│   │   └── config-store.ts       # Read/write config.json in userData
│   └── preload/
│       └── index.ts              # Minimal preload (contextBridge)
└── resources/
    └── icon.ico                  # App icon (placeholder)
```

### Modified files (canteen-manager/backend/)

```
canteen-manager/backend/
├── package.json                           # Add better-sqlite3, @nestjs/serve-static, uuid
├── src/
│   ├── main.ts                            # Add /api prefix, bind 0.0.0.0, IPC signals
│   ├── app.module.ts                      # Remove scan/OMR modules, add ServeStatic, SQLite config
│   ├── config/
│   │   └── env-validation.ts              # Strip scanner/OMR vars, make DATABASE_URL optional
│   ├── database/
│   │   ├── data-source.ts                 # Support SQLite via DATABASE_TYPE env
│   │   └── migrations-sqlite/
│   │       └── 00000000000001-initial-schema.ts  # Consolidated SQLite migration
│   ├── operators/operator.entity.ts       # enum → simple-enum
│   ├── menu/menu-item.entity.ts           # enum → simple-enum
│   ├── orders/order.entity.ts             # enum → simple-enum, remove sheet relation
│   ├── orders/order-item.entity.ts        # enum → simple-enum
│   ├── orders/tg8-document.entity.ts      # jsonb → simple-json
│   ├── accounts/account-transaction.entity.ts  # enum → simple-enum
│   └── legacy-sync/sync-run.entity.ts     # enum → simple-enum
```

### Modified files (canteen-manager/frontend/)

```
canteen-manager/frontend/
├── vite.config.ts                         # Remove proxy rewrite
└── src/
    └── app/
        ├── router.tsx                     # Remove scan/OMR routes
        └── shell/nav-items.ts             # Remove scan/OMR nav entries
```

---

## Task 1: Scaffold Electron Project

**Files:**
- Create: `canteen-electron/package.json`
- Create: `canteen-electron/tsconfig.json`
- Create: `canteen-electron/electron-builder.yml`
- Create: `canteen-electron/.gitignore`

- [ ] **Step 1: Create canteen-electron directory**

Run: `mkdir -p canteen-electron/src/main canteen-electron/src/preload canteen-electron/resources`

- [ ] **Step 2: Create package.json**

```json
{
  "name": "canteen-electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main/index.js",
  "scripts": {
    "build:backend": "cd ../canteen-manager/backend && npm run build",
    "build:frontend": "cd ../canteen-manager/frontend && npm run build",
    "build:electron": "tsc -p tsconfig.json",
    "build": "npm run build:backend && npm run build:frontend && npm run build:electron",
    "start": "electron dist/main/index.js",
    "dev": "npm run build:electron && electron dist/main/index.js",
    "pack": "electron-builder --dir",
    "dist": "npm run build && electron-builder"
  },
  "dependencies": {
    "electron-store": "^10.0.0"
  },
  "devDependencies": {
    "electron": "^36.0.0",
    "electron-builder": "^26.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create electron-builder.yml**

```yaml
appId: com.canteen.manager
productName: Canteen Manager
directories:
  output: release
  buildResources: resources
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
    filter:
      - "**/*"
  - from: ../canteen-manager/backend/node_modules
    to: backend-node_modules
    filter:
      - "**/*"
  - from: ../canteen-manager/frontend/dist
    to: frontend
    filter:
      - "**/*"
files:
  - dist/**/*
  - "!node_modules"
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
release/
```

- [ ] **Step 6: Create placeholder icon**

Run: `touch canteen-electron/resources/icon.ico`

(Replace with a real .ico file later.)

- [ ] **Step 7: Install dependencies**

Run: `cd canteen-electron && npm install`

- [ ] **Step 8: Commit**

```bash
git add canteen-electron/
git commit -m "feat: scaffold Electron project with build config"
```

---

## Task 2: Backend — Add SQLite and Serve-Static Dependencies

**Files:**
- Modify: `canteen-manager/backend/package.json`

- [ ] **Step 1: Install new dependencies**

Run:
```bash
cd canteen-manager/backend
npm install better-sqlite3 @nestjs/serve-static uuid
npm install -D @types/better-sqlite3 @types/uuid
```

- [ ] **Step 2: Verify package.json updated**

Run: `cd canteen-manager/backend && cat package.json | grep -E "better-sqlite3|serve-static|uuid"`

Expected: Three lines showing the new deps.

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/package.json canteen-manager/backend/package-lock.json
git commit -m "feat(backend): add better-sqlite3, serve-static, uuid deps"
```

---

## Task 3: Backend — Simplify Environment Config for Electron

**Files:**
- Modify: `canteen-manager/backend/src/config/env-validation.ts`

- [ ] **Step 1: Update the Zod schema**

Replace the full content of `canteen-manager/backend/src/config/env-validation.ts` with:

```typescript
import { z } from 'zod';

/**
 * Environment validation schema for the canteen backend.
 * Supports both PostgreSQL (Docker) and SQLite (Electron) modes via DATABASE_TYPE.
 */

const boolFromString = (defaultVal: 'true' | 'false') =>
  z.enum(['true', 'false']).transform((v) => v === 'true').default(defaultVal);

const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === '' ? undefined : value, schema.optional());

const envSchema = z.object({
  // Database — either 'postgres' (Docker) or 'sqlite' (Electron)
  DATABASE_TYPE: z.enum(['postgres', 'sqlite']).default('postgres'),
  DATABASE_URL: z.string().optional(),
  DATABASE_PATH: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BACKEND_PORT: z.coerce.number().default(3000),
  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  KIOSK_LOOKUP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  APP_TZ: z.string().default('Asia/Saigon'),

  // Static file serving — set by Electron to serve React build
  FRONTEND_DIST_PATH: z.string().optional(),

  // Legacy SQL Server sync — all optional
  LEGACY_SQL_HOST: z.string().optional(),
  LEGACY_SQL_USER: z.string().optional(),
  LEGACY_SQL_PASS: z.string().optional(),
  LEGACY_SQL_DB: z.string().optional(),
  LEGACY_SQL_PORT: z.coerce.number().default(1433),
  LEGACY_SQL_ENCRYPT: boolFromString('false'),
  LEGACY_SQL_TRUST_CERT: boolFromString('true'),
  LEGACY_SQL_TDS_VERSION: z.string().default('7_2'),
  LEGACY_SQL_TLS_MIN_VERSION: z.string().optional(),
  LEGACY_SQL_QUERY: z.string().optional(),
  LEGACY_SQL_POOL_SIZE: z.coerce.number().default(5),
  LEGACY_SQL_QUERY_TIMEOUT_MS: z.coerce.number().default(60000),
  LEGACY_SYNC_CRON: z.string().default('0 */4 * * *'),
  LEGACY_SYNC_ENABLED: boolFromString('false'),
}).superRefine((env, ctx) => {
  if (env.DATABASE_TYPE === 'postgres' && !env.DATABASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required when DATABASE_TYPE is postgres',
    });
  }
  if (env.DATABASE_TYPE === 'sqlite' && !env.DATABASE_PATH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_PATH'],
      message: 'DATABASE_PATH is required when DATABASE_TYPE is sqlite',
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Environment validation failed: ${errors}`);
  }
  return result.data;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd canteen-manager/backend && npx tsc --noEmit`

Expected: Compilation errors for removed env vars referenced elsewhere (SCAN_*, OMR_*, SCANNER_*, AGENT_TOKEN). These will be fixed in Task 6 when we remove the scan modules. For now, note the errors but do not fix them yet.

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/src/config/env-validation.ts
git commit -m "feat(backend): simplify env config for SQLite/Electron support"
```

---

## Task 4: Backend — Update Entities for SQLite Compatibility

**Files:**
- Modify: `canteen-manager/backend/src/operators/operator.entity.ts`
- Modify: `canteen-manager/backend/src/menu/menu-item.entity.ts`
- Modify: `canteen-manager/backend/src/orders/order.entity.ts`
- Modify: `canteen-manager/backend/src/orders/order-item.entity.ts`
- Modify: `canteen-manager/backend/src/orders/tg8-document.entity.ts`
- Modify: `canteen-manager/backend/src/accounts/account-transaction.entity.ts`
- Modify: `canteen-manager/backend/src/legacy-sync/sync-run.entity.ts`

The key changes for each entity file:
- `type: 'enum'` → `type: 'simple-enum'`
- `type: 'jsonb'` → `type: 'simple-json'`
- `type: 'timestamptz'` → `type: 'datetime'`
- `type: 'bytea'` → `type: 'blob'`
- Remove `enumName` properties (PostgreSQL-specific)
- `default: () => 'gen_random_uuid()'` → remove (TypeORM handles UUID generation for `@PrimaryGeneratedColumn('uuid')`)

- [ ] **Step 1: Read each entity file, identify PostgreSQL-specific column types**

For each entity file listed above, read the file and locate all `@Column` decorators that use:
- `type: 'enum'`
- `type: 'jsonb'`
- `type: 'timestamptz'`
- `enumName: '...'`

- [ ] **Step 2: Update operator.entity.ts**

In `canteen-manager/backend/src/operators/operator.entity.ts`, change every `@Column` that has `type: 'enum'` to `type: 'simple-enum'`, and remove any `enumName` property. Example:

Before:
```typescript
@Column({ type: 'enum', enum: OperatorRole, default: OperatorRole.OPERATOR })
role!: OperatorRole;
```

After:
```typescript
@Column({ type: 'simple-enum', enum: OperatorRole, default: OperatorRole.OPERATOR })
role!: OperatorRole;
```

Also change any `type: 'timestamptz'` columns to `type: 'datetime'`.

- [ ] **Step 3: Update menu-item.entity.ts**

In `canteen-manager/backend/src/menu/menu-item.entity.ts`, apply the same enum fix:

Before:
```typescript
@Column({ type: 'enum', enum: MenuCategory })
category!: MenuCategory;
```

After:
```typescript
@Column({ type: 'simple-enum', enum: MenuCategory })
category!: MenuCategory;
```

- [ ] **Step 4: Update order.entity.ts**

In `canteen-manager/backend/src/orders/order.entity.ts`:

1. Change all `type: 'enum'` to `type: 'simple-enum'` (status, paymentStatus, source columns)
2. Remove any `enumName` properties
3. Change `type: 'timestamptz'` to `type: 'datetime'`
4. Remove the `sheetId` column and `@ManyToOne(() => Sheet, ...)` relation (Sheet entity is being removed). Keep the `sheetId` as a nullable string column with no relation:

Before:
```typescript
@Column({ name: 'sheet_id', type: 'uuid', nullable: true })
sheetId!: string | null;

@ManyToOne(() => Sheet, { nullable: true, onDelete: 'SET NULL' })
@JoinColumn({ name: 'sheet_id' })
sheet!: Sheet | null;
```

After:
```typescript
@Column({ name: 'sheet_id', type: 'varchar', nullable: true })
sheetId!: string | null;
```

Remove the Sheet import.

- [ ] **Step 5: Update order-item.entity.ts**

In `canteen-manager/backend/src/orders/order-item.entity.ts`, change `type: 'enum'` to `type: 'simple-enum'` for the category column.

- [ ] **Step 6: Update tg8-document.entity.ts**

In `canteen-manager/backend/src/orders/tg8-document.entity.ts`, change `type: 'jsonb'` to `type: 'simple-json'` for the snapshot column:

Before:
```typescript
@Column({ type: 'jsonb' })
snapshot!: object;
```

After:
```typescript
@Column({ type: 'simple-json' })
snapshot!: object;
```

- [ ] **Step 7: Update account-transaction.entity.ts**

In `canteen-manager/backend/src/accounts/account-transaction.entity.ts`, change `type: 'enum'` to `type: 'simple-enum'` for the type column.

- [ ] **Step 8: Update sync-run.entity.ts**

In `canteen-manager/backend/src/legacy-sync/sync-run.entity.ts`, change `type: 'enum'` to `type: 'simple-enum'` for the status column.

- [ ] **Step 9: Run typecheck**

Run: `cd canteen-manager/backend && npx tsc --noEmit`

Expected: Errors only from scan/OMR module references (not from entity changes). Entity changes should be clean.

- [ ] **Step 10: Commit**

```bash
git add canteen-manager/backend/src/operators/operator.entity.ts \
       canteen-manager/backend/src/menu/menu-item.entity.ts \
       canteen-manager/backend/src/orders/order.entity.ts \
       canteen-manager/backend/src/orders/order-item.entity.ts \
       canteen-manager/backend/src/orders/tg8-document.entity.ts \
       canteen-manager/backend/src/accounts/account-transaction.entity.ts \
       canteen-manager/backend/src/legacy-sync/sync-run.entity.ts
git commit -m "feat(backend): update entity column types for SQLite compatibility"
```

---

## Task 5: Backend — Write SQLite Initial Migration

**Files:**
- Create: `canteen-manager/backend/src/database/migrations-sqlite/00000000000001-initial-schema.ts`

- [ ] **Step 1: Create migrations-sqlite directory**

Run: `mkdir -p canteen-manager/backend/src/database/migrations-sqlite`

- [ ] **Step 2: Write the consolidated migration**

Create `canteen-manager/backend/src/database/migrations-sqlite/00000000000001-initial-schema.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidated initial schema for SQLite (Electron mode).
 * Equivalent to all 34 PostgreSQL migrations merged into one.
 * SQLite does not support ENUM types — text columns with CHECK constraints are used instead.
 * UUIDs are generated by TypeORM at the application layer (no gen_random_uuid()).
 */
export class InitialSchema00000000000001 implements MigrationInterface {
  name = 'InitialSchema00000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable WAL mode for better concurrent read performance from tablet kiosk requests.
    await queryRunner.query(`PRAGMA journal_mode=WAL`);
    await queryRunner.query(`PRAGMA busy_timeout=5000`);
    await queryRunner.query(`PRAGMA foreign_keys=ON`);

    await queryRunner.query(`
      CREATE TABLE "operators" (
        "id"            VARCHAR(36)   NOT NULL,
        "username"      VARCHAR(100)  NOT NULL,
        "password_hash" VARCHAR(255)  NOT NULL,
        "display_name"  VARCHAR(200)  NOT NULL,
        "role"          VARCHAR(20)   NOT NULL DEFAULT 'operator'
                        CHECK("role" IN ('admin', 'operator', 'cashier')),
        "zone"          VARCHAR(100),
        "is_active"     INTEGER       NOT NULL DEFAULT 1,
        "created_at"    DATETIME      NOT NULL DEFAULT (datetime('now')),
        "updated_at"    DATETIME      NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_operators_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operators_username" UNIQUE ("username")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                           VARCHAR(36)   NOT NULL,
        "legacy_id"                    VARCHAR(100),
        "name"                         VARCHAR(200)  NOT NULL,
        "zone"                         VARCHAR(100),
        "cell"                         VARCHAR(100),
        "normalized_cell"              VARCHAR(100),
        "cell_normalization_version"   INTEGER       NOT NULL DEFAULT 0,
        "date_of_birth"                VARCHAR(20),
        "hometown"                     VARCHAR(500),
        "offense"                      VARCHAR(500),
        "arrest_date"                  VARCHAR(20),
        "detention_status"             VARCHAR(100),
        "is_active"                    INTEGER       NOT NULL DEFAULT 1,
        "source"                       VARCHAR(50),
        "synced_at"                    DATETIME,
        "created_at"                   DATETIME      NOT NULL DEFAULT (datetime('now')),
        "updated_at"                   DATETIME      NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "prisoner_accounts" (
        "id"         VARCHAR(36)    NOT NULL,
        "user_id"    VARCHAR(36)    NOT NULL UNIQUE,
        "balance"    REAL           NOT NULL DEFAULT 0,
        "created_at" DATETIME       NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME       NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_prisoner_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prisoner_accounts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "account_transactions" (
        "id"               VARCHAR(36)  NOT NULL,
        "user_id"          VARCHAR(36)  NOT NULL,
        "type"             VARCHAR(20)  NOT NULL
                           CHECK("type" IN ('topup', 'payment', 'refund', 'adjustment')),
        "amount"           REAL         NOT NULL,
        "balance_after"    REAL         NOT NULL,
        "method"           VARCHAR(50),
        "ref"              VARCHAR(255),
        "related_order_id" VARCHAR(36),
        "operator_id"      VARCHAR(36),
        "note"             TEXT,
        "created_at"       DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_account_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_account_transactions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "menu_items" (
        "id"         VARCHAR(36)   NOT NULL,
        "code"       VARCHAR(20)   NOT NULL,
        "position"   INTEGER       NOT NULL DEFAULT 0,
        "name"       VARCHAR(200)  NOT NULL,
        "price"      REAL          NOT NULL,
        "category"   VARCHAR(50)   NOT NULL DEFAULT 'food'
                     CHECK("category" IN ('food', 'essential')),
        "is_active"  INTEGER       NOT NULL DEFAULT 1,
        "created_at" DATETIME      NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME      NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_menu_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_menu_items_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id"                       VARCHAR(36)  NOT NULL,
        "service_date"             VARCHAR(20)  NOT NULL,
        "user_id"                  VARCHAR(36)  NOT NULL,
        "source"                   VARCHAR(30)  NOT NULL DEFAULT 'kiosk'
                                   CHECK("source" IN ('kiosk', 'counter', 'scan', 'order_form', 'scanner')),
        "sheet_id"                 VARCHAR(36),
        "status"                   VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                   CHECK("status" IN ('pending', 'paid', 'delivered', 'rejected', 'superseded')),
        "total_amount"             REAL         NOT NULL DEFAULT 0,
        "payment_status"           VARCHAR(20)  NOT NULL DEFAULT 'unpaid'
                                   CHECK("payment_status" IN ('unpaid', 'paid')),
        "payment_method"           VARCHAR(50),
        "superseded_at"            DATETIME,
        "superseded_by_order_id"   VARCHAR(36),
        "settled_by_operator_id"   VARCHAR(36),
        "settled_at"               DATETIME,
        "reject_reason"            TEXT,
        "transfer_reference"       VARCHAR(255),
        "received_amount"          REAL,
        "created_at"               DATETIME     NOT NULL DEFAULT (datetime('now')),
        "updated_at"               DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_orders_service_date" ON "orders" ("service_date")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_orders_user_id" ON "orders" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id"           VARCHAR(36)  NOT NULL,
        "order_id"     VARCHAR(36)  NOT NULL,
        "menu_item_id" VARCHAR(36)  NOT NULL,
        "unit_price"   REAL         NOT NULL,
        "category"     VARCHAR(50)  NOT NULL DEFAULT 'food'
                       CHECK("category" IN ('food', 'essential')),
        "quantity"     INTEGER      NOT NULL DEFAULT 1,
        "created_at"   DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_order_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id")
          REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_menu_item" FOREIGN KEY ("menu_item_id")
          REFERENCES "menu_items"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "order_tg8_documents" (
        "order_id"          VARCHAR(36) NOT NULL,
        "template_revision" INTEGER     NOT NULL,
        "snapshot"          TEXT        NOT NULL,
        "accepted_at"       DATETIME,
        "operator_id"       VARCHAR(36),
        "created_at"        DATETIME    NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_order_tg8_documents" PRIMARY KEY ("order_id"),
        CONSTRAINT "FK_tg8_order" FOREIGN KEY ("order_id")
          REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_config" (
        "id"             VARCHAR(36)  NOT NULL,
        "singleton"      INTEGER      NOT NULL DEFAULT 1 UNIQUE,
        "bank_bin"       VARCHAR(20),
        "account_number" VARCHAR(50),
        "account_name"   VARCHAR(200),
        "updated_at"     DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_payment_config_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "purchase_limit_config" (
        "id"                        VARCHAR(36) NOT NULL,
        "singleton"                 INTEGER     NOT NULL DEFAULT 1 UNIQUE,
        "prisoner_food_enabled"     INTEGER     NOT NULL DEFAULT 0,
        "prisoner_food_amount"      REAL        NOT NULL DEFAULT 0,
        "prisoner_essential_enabled" INTEGER    NOT NULL DEFAULT 0,
        "prisoner_essential_amount" REAL        NOT NULL DEFAULT 0,
        "visitor_food_enabled"      INTEGER     NOT NULL DEFAULT 0,
        "visitor_food_amount"       REAL        NOT NULL DEFAULT 0,
        "visitor_essential_enabled" INTEGER     NOT NULL DEFAULT 0,
        "visitor_essential_amount"  REAL        NOT NULL DEFAULT 0,
        "updated_at"                DATETIME    NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_purchase_limit_config_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sync_runs" (
        "id"          VARCHAR(36)  NOT NULL,
        "started_at"  DATETIME     NOT NULL DEFAULT (datetime('now')),
        "finished_at" DATETIME,
        "row_count"   INTEGER      NOT NULL DEFAULT 0,
        "status"      VARCHAR(20)  NOT NULL DEFAULT 'running'
                      CHECK("status" IN ('running', 'success', 'failed')),
        "trigger"     VARCHAR(50),
        "error"       TEXT,
        "created_at"  DATETIME     NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "PK_sync_runs_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "purchase_limit_config"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_config"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_tg8_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "menu_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "account_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "prisoner_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "operators"`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/src/database/migrations-sqlite/
git commit -m "feat(backend): add consolidated SQLite initial migration"
```

---

## Task 6: Backend — Update app.module.ts and data-source.ts

**Files:**
- Modify: `canteen-manager/backend/src/app.module.ts`
- Modify: `canteen-manager/backend/src/database/data-source.ts`

- [ ] **Step 1: Update data-source.ts to support both PostgreSQL and SQLite**

Replace the full content of `canteen-manager/backend/src/database/data-source.ts` with:

```typescript
import 'reflect-metadata';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * Build TypeORM DataSource options based on DATABASE_TYPE env var.
 * Supports 'postgres' (Docker/production) and 'sqlite' (Electron).
 */
function buildOptions(): DataSourceOptions {
  const dbType = process.env['DATABASE_TYPE'] ?? 'postgres';

  if (dbType === 'sqlite') {
    const dbPath = process.env['DATABASE_PATH'] ?? 'canteen.sqlite';
    return {
      type: 'better-sqlite3',
      database: dbPath,
      synchronize: false,
      migrationsRun: false,
      logging: process.env['NODE_ENV'] === 'development',
      entities: [__dirname + '/../**/*.entity.{ts,js}'],
      migrations: [__dirname + '/migrations-sqlite/*.{ts,js}'],
      migrationsTableName: 'typeorm_migrations',
    };
  }

  return {
    type: 'postgres',
    url: process.env['DATABASE_URL'],
    synchronize: false,
    migrationsRun: false,
    logging: process.env['NODE_ENV'] === 'development',
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsTableName: 'typeorm_migrations',
  };
}

// Exported for TypeORM CLI (migration:generate/run/revert) and NestJS module.
export const AppDataSource = new DataSource(buildOptions());
```

- [ ] **Step 2: Update app.module.ts — remove scan/OMR modules, add ServeStatic, support SQLite**

Replace the full content of `canteen-manager/backend/src/app.module.ts` with:

```typescript
import * as path from 'path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ValidationPipe } from '@nestjs/common';

import configuration from './config/configuration';
import { AppEnv } from './config/env-validation';
import { AuthModule } from './auth/auth.module';
import { OperatorsModule } from './operators/operators.module';
import { UsersModule } from './users/users.module';
import { LegacySyncModule } from './legacy-sync/legacy-sync.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { AccountsModule } from './accounts/accounts.module';
import { CounterModule } from './counter/counter.module';
import { KioskModule } from './kiosk/kiosk.module';
import { PaymentConfigModule } from './payment-config/payment-config.module';
import { PurchaseLimitConfigModule } from './purchase-limit-config/purchase-limit-config.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor';
import { OperatorZoneAccessModule } from './auth/operator-zone-access.module';

/**
 * Build TypeORM config dynamically based on DATABASE_TYPE.
 */
function buildTypeOrmConfig(config: ConfigService<AppEnv, true>) {
  const dbType = config.get('DATABASE_TYPE', { infer: true });
  const isDevLogging = config.get('NODE_ENV', { infer: true }) === 'development';

  if (dbType === 'sqlite') {
    return {
      type: 'better-sqlite3' as const,
      database: config.get('DATABASE_PATH', { infer: true }),
      synchronize: false,
      migrationsRun: false,
      autoLoadEntities: true,
      logging: isDevLogging,
    };
  }

  return {
    type: 'postgres' as const,
    url: config.get('DATABASE_URL', { infer: true }),
    synchronize: false,
    migrationsRun: false,
    autoLoadEntities: true,
    logging: isDevLogging,
  };
}

/**
 * Build optional ServeStatic imports when FRONTEND_DIST_PATH is set.
 * In Docker, Nginx serves the frontend. In Electron, NestJS serves it.
 */
function buildOptionalImports(config: ConfigService<AppEnv, true>) {
  const frontendPath = config.get('FRONTEND_DIST_PATH', { infer: true });
  if (!frontendPath) return [];
  return [
    ServeStaticModule.forRoot({
      rootPath: frontendPath,
      exclude: ['/api/(.*)'],
    }),
  ];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '../deploy/.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => buildTypeOrmConfig(config),
    }),
    AuthModule,
    OperatorZoneAccessModule,
    OperatorsModule,
    UsersModule,
    LegacySyncModule,
    MenuModule,
    OrdersModule,
    AccountsModule,
    CounterModule,
    KioskModule,
    PaymentConfigModule,
    PurchaseLimitConfigModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
```

> **Note:** The `ServeStaticModule` dynamic import approach above won't work directly in `@Module` decorator (which is static). Instead, use `DynamicModule` pattern or conditional import. A simpler approach: always register `ServeStaticModule` but point `rootPath` to a fallback empty directory when `FRONTEND_DIST_PATH` is not set, or use a conditional module:

Actually, the cleaner approach is to always import ServeStaticModule and let it resolve the path at runtime. Update the imports array to include it conditionally using `forRootAsync`:

Replace the `imports` array section with:

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '../deploy/.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => buildTypeOrmConfig(config),
    }),
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const frontendPath = config.get('FRONTEND_DIST_PATH', { infer: true });
        if (!frontendPath) {
          // No static serving in Docker mode (Nginx handles it)
          return [{ rootPath: path.join(__dirname, '..', 'public-noop'), exclude: ['/(.*)'] }];
        }
        return [{ rootPath: frontendPath, exclude: ['/api/(.*)'] }];
      },
    }),
    AuthModule,
    OperatorZoneAccessModule,
    OperatorsModule,
    UsersModule,
    LegacySyncModule,
    MenuModule,
    OrdersModule,
    AccountsModule,
    CounterModule,
    KioskModule,
    PaymentConfigModule,
    PurchaseLimitConfigModule,
  ],
  // ... rest same
})
```

Create the noop directory: `mkdir -p canteen-manager/backend/public-noop`

- [ ] **Step 3: Run typecheck**

Run: `cd canteen-manager/backend && npx tsc --noEmit`

Expected: Should compile cleanly now that scan/OMR module imports are removed. If there are remaining references to scan types in other modules (e.g., order.entity.ts referencing Sheet), fix those imports.

- [ ] **Step 4: Commit**

```bash
git add canteen-manager/backend/src/app.module.ts \
       canteen-manager/backend/src/database/data-source.ts \
       canteen-manager/backend/public-noop/
git commit -m "feat(backend): support SQLite + ServeStatic, remove scan/OMR modules"
```

---

## Task 7: Backend — Update main.ts for Electron

**Files:**
- Modify: `canteen-manager/backend/src/main.ts`

- [ ] **Step 1: Replace main.ts with Electron-compatible version**

Replace the full content of `canteen-manager/backend/src/main.ts` with:

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from './config/env-validation';
import { AppModule } from './app.module';

/**
 * Bootstrap the NestJS application.
 * In Electron mode, sends an IPC 'ready' message to the parent process.
 * In Docker mode, runs as a standalone server (same as before).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Add /api global prefix so NestJS routes match the frontend's /api base.
  // In the Docker setup, Nginx stripped /api; here we own the prefix directly.
  app.setGlobalPrefix('api', {
    exclude: ['/'],  // Health check at root
  });

  const config = app.get(ConfigService<AppEnv, true>);

  // JSON body limit — 15MB for base64-encoded images in manual order form uploads.
  app.useBodyParser('json', { limit: '15mb' });

  const port = config.get('BACKEND_PORT', { infer: true });

  // Bind to 0.0.0.0 so LAN tablets can reach the kiosk interface.
  await app.listen(port, '0.0.0.0');
  console.log(`Backend listening on 0.0.0.0:${port}`);

  // Signal to Electron main process that the backend is ready.
  if (process.send) {
    process.send({ type: 'ready', port });
  }

  // Listen for shutdown signal from Electron main process (Windows has no SIGTERM).
  process.on('message', (msg: unknown) => {
    if (msg && typeof msg === 'object' && (msg as { type: string }).type === 'shutdown') {
      console.log('Received shutdown signal, closing gracefully...');
      app.close().then(() => process.exit(0));
    }
  });
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error('Failed to start backend:', err);
    if (process.send) {
      process.send({ type: 'error', message: String(err) });
    }
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd canteen-manager/backend && npx tsc --noEmit`

Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/src/main.ts
git commit -m "feat(backend): add /api prefix, bind 0.0.0.0, Electron IPC signals"
```

---

## Task 8: Frontend — Remove Scan/OMR Routes and Navigation

**Files:**
- Modify: `canteen-manager/frontend/src/app/router.tsx`
- Modify: `canteen-manager/frontend/src/app/shell/nav-items.ts`
- Modify: `canteen-manager/frontend/vite.config.ts`

- [ ] **Step 1: Update router.tsx — remove scan-related routes**

In `canteen-manager/frontend/src/app/router.tsx`:

1. Remove these imports:
```typescript
import { ScanMonitorPage } from '@/features/scan-monitor/scan-monitor-page';
import { VerifyPage } from '@/features/verify/verify-page';
import { FormPrintPage } from '@/features/form-print/form-print-page';
import { ScanUploadPage } from '@/features/scan-upload/scan-upload-page';
```

2. Remove from the AdminRoute children:
```typescript
{ path: 'form-print', element: <FormPrintPage /> },
```

3. Remove the entire `RoleRoute roles={['operator', 'admin']}` block containing scan-monitor, verify, and scan-upload. Keep order-form by moving it to the parent `AppShell` children:

Before:
```typescript
{
  element: <RoleRoute roles={['operator', 'admin']} />,
  children: [
    { path: 'scan-monitor', element: <ScanMonitorPage /> },
    { path: 'verify', element: <VerifyPage /> },
    { path: 'verify/:sheetId', element: <VerifyPage /> },
    { path: 'order-form', element: <OrderFormPage /> },
    { path: 'scan-upload', element: <ScanUploadPage /> },
  ],
},
```

After:
```typescript
{
  element: <RoleRoute roles={['operator', 'admin']} />,
  children: [
    { path: 'order-form', element: <OrderFormPage /> },
  ],
},
```

- [ ] **Step 2: Update nav-items.ts — remove scan-related entries**

In `canteen-manager/frontend/src/app/shell/nav-items.ts`, remove these items from the Operations group:

```typescript
{ id: 'scan-monitor', path: '/scan-monitor', icon: '▦', roles: ['operator', 'admin'] },
{ id: 'verify',       path: '/verify',       icon: '✓', roles: ['operator', 'admin'] },
```

And remove from the Setup group:

```typescript
{ id: 'form-print', path: '/form-print', icon: '⎙', adminOnly: true },
```

- [ ] **Step 3: Update vite.config.ts — remove proxy rewrite**

In `canteen-manager/frontend/vite.config.ts`, the backend now has a `/api` global prefix, so the proxy no longer needs to strip it:

Before:
```typescript
'/api': {
  target: 'http://localhost:3000',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/api/, ''),
},
```

After:
```typescript
'/api': {
  target: 'http://localhost:3000',
  changeOrigin: true,
},
```

- [ ] **Step 4: Run frontend typecheck**

Run: `cd canteen-manager/frontend && npx tsc --noEmit`

Expected: Clean compilation (unused page components are fine — they're just not routed).

- [ ] **Step 5: Run frontend tests**

Run: `cd canteen-manager/frontend && npm test`

Expected: All tests pass. Some tests for scan-related pages may still pass (they test the component in isolation). Any failures should be from routing changes — fix as needed.

- [ ] **Step 6: Commit**

```bash
git add canteen-manager/frontend/src/app/router.tsx \
       canteen-manager/frontend/src/app/shell/nav-items.ts \
       canteen-manager/frontend/vite.config.ts
git commit -m "feat(frontend): remove scan/OMR routes and nav items, update proxy"
```

---

## Task 9: Electron — Config Store

**Files:**
- Create: `canteen-electron/src/main/config-store.ts`

- [ ] **Step 1: Write config-store.ts**

Create `canteen-electron/src/main/config-store.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

/** Persistent app configuration stored in %APPDATA%/Canteen Manager/config.json. */
export interface AppConfig {
  jwtSecret: string;
  backendPort: number;
  appTimezone: string;
  legacySyncEnabled: boolean;
  legacySqlHost?: string;
  legacySqlUser?: string;
  legacySqlPass?: string;
  legacySqlDb?: string;
  legacySqlPort?: number;
}

const CONFIG_FILENAME = 'config.json';

/**
 * Return the path to the config file in the user's app data directory.
 */
function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

/**
 * Return the path to the SQLite database file.
 */
export function databasePath(): string {
  return path.join(app.getPath('userData'), 'canteen.sqlite');
}

/**
 * Load config from disk. Returns null if the file does not exist.
 */
export function loadConfig(): AppConfig | null {
  const p = configPath();
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

/**
 * Save config to disk.
 */
export function saveConfig(config: AppConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Generate a default config with a random JWT secret.
 */
export function createDefaultConfig(): AppConfig {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    backendPort: 3000,
    appTimezone: 'Asia/Saigon',
    legacySyncEnabled: false,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add canteen-electron/src/main/config-store.ts
git commit -m "feat(electron): add config store for persistent app settings"
```

---

## Task 10: Electron — Backend Process Manager

**Files:**
- Create: `canteen-electron/src/main/backend-process.ts`

- [ ] **Step 1: Write backend-process.ts**

Create `canteen-electron/src/main/backend-process.ts`:

```typescript
import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig, databasePath } from './config-store';

let backendProcess: ChildProcess | null = null;

/**
 * Resolve the path to the NestJS backend entry point.
 * In development: relative to project root.
 * In production: inside Electron's extraResources.
 */
function backendEntryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'main.js');
  }
  return path.join(__dirname, '..', '..', '..', 'canteen-manager', 'backend', 'dist', 'main.js');
}

/**
 * Resolve the path to the built frontend dist directory.
 */
function frontendDistPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend');
  }
  return path.join(__dirname, '..', '..', '..', 'canteen-manager', 'frontend', 'dist');
}

/**
 * Resolve the path to the backend's node_modules.
 */
function backendNodeModulesPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend-node_modules');
  }
  return path.join(__dirname, '..', '..', '..', 'canteen-manager', 'backend', 'node_modules');
}

/**
 * Start the NestJS backend as a child process.
 * Returns a Promise that resolves with the port number when the backend signals ready.
 */
export function startBackend(config: AppConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    const entry = backendEntryPath();
    const timeoutMs = 30_000;

    const env: Record<string, string> = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_TYPE: 'sqlite',
      DATABASE_PATH: databasePath(),
      JWT_SECRET: config.jwtSecret,
      JWT_EXPIRES_IN: '12h',
      BACKEND_PORT: String(config.backendPort),
      APP_TZ: config.appTimezone,
      FRONTEND_DIST_PATH: frontendDistPath(),
      NODE_PATH: backendNodeModulesPath(),
    };

    if (config.legacySyncEnabled) {
      env['LEGACY_SYNC_ENABLED'] = 'true';
      if (config.legacySqlHost) env['LEGACY_SQL_HOST'] = config.legacySqlHost;
      if (config.legacySqlUser) env['LEGACY_SQL_USER'] = config.legacySqlUser;
      if (config.legacySqlPass) env['LEGACY_SQL_PASS'] = config.legacySqlPass;
      if (config.legacySqlDb) env['LEGACY_SQL_DB'] = config.legacySqlDb;
      if (config.legacySqlPort) env['LEGACY_SQL_PORT'] = String(config.legacySqlPort);
    }

    backendProcess = fork(entry, [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    const timer = setTimeout(() => {
      reject(new Error(`Backend failed to start within ${timeoutMs}ms`));
      stopBackend();
    }, timeoutMs);

    backendProcess.on('message', (msg: unknown) => {
      if (msg && typeof msg === 'object') {
        const message = msg as { type: string; port?: number; message?: string };
        if (message.type === 'ready') {
          clearTimeout(timer);
          resolve(message.port ?? config.backendPort);
        } else if (message.type === 'error') {
          clearTimeout(timer);
          reject(new Error(message.message ?? 'Backend startup failed'));
        }
      }
    });

    backendProcess.on('exit', (code) => {
      clearTimeout(timer);
      backendProcess = null;
      if (code !== 0 && code !== null) {
        reject(new Error(`Backend exited with code ${code}`));
      }
    });

    backendProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[backend]', data.toString());
    });

    backendProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[backend]', data.toString());
    });
  });
}

/**
 * Gracefully stop the backend process via IPC, with a 5s force-kill timeout.
 */
export function stopBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!backendProcess) {
      resolve();
      return;
    }

    const forceKillTimeout = setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill('SIGKILL');
        backendProcess = null;
      }
      resolve();
    }, 5_000);

    backendProcess.on('exit', () => {
      clearTimeout(forceKillTimeout);
      backendProcess = null;
      resolve();
    });

    backendProcess.send({ type: 'shutdown' });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add canteen-electron/src/main/backend-process.ts
git commit -m "feat(electron): add backend process manager with IPC lifecycle"
```

---

## Task 11: Electron — Window and Tray

**Files:**
- Create: `canteen-electron/src/main/window.ts`
- Create: `canteen-electron/src/main/tray.ts`
- Create: `canteen-electron/src/preload/index.ts`

- [ ] **Step 1: Write window.ts**

Create `canteen-electron/src/main/window.ts`:

```typescript
import { BrowserWindow } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

/**
 * Create and return the main application window.
 * Loads the NestJS-served React app at the given URL.
 */
export function createMainWindow(backendUrl: string): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Canteen Manager',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(backendUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Return the existing main window or null.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}
```

- [ ] **Step 2: Write tray.ts**

Create `canteen-electron/src/main/tray.ts`:

```typescript
import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { getMainWindow, createMainWindow } from './window';

let tray: Tray | null = null;

/**
 * Create a system tray icon with a context menu.
 */
export function createTray(backendUrl: string): Tray {
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources'),
    'icon.ico',
  );

  // Fallback to empty icon if file doesn't exist (dev mode without icon)
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Canteen Manager — Running');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Canteen Manager',
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
        } else {
          createMainWindow(backendUrl);
        }
      },
    },
    { type: 'separator' },
    {
      label: `Server: ${backendUrl}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    const win = getMainWindow();
    if (win) {
      win.show();
      win.focus();
    } else {
      createMainWindow(backendUrl);
    }
  });

  return tray;
}
```

- [ ] **Step 3: Write preload/index.ts**

Create `canteen-electron/src/preload/index.ts`:

```typescript
/**
 * Minimal preload script. Context isolation is enabled — no Node APIs exposed.
 * Extend this with contextBridge.exposeInMainWorld() if Electron-specific
 * features (e.g., native file dialogs) are needed in the renderer later.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
```

- [ ] **Step 4: Commit**

```bash
git add canteen-electron/src/main/window.ts \
       canteen-electron/src/main/tray.ts \
       canteen-electron/src/preload/index.ts
git commit -m "feat(electron): add window, tray, and preload modules"
```

---

## Task 12: Electron — First Launch and Main Entry

**Files:**
- Create: `canteen-electron/src/main/first-launch.ts`
- Create: `canteen-electron/src/main/index.ts`

- [ ] **Step 1: Write first-launch.ts**

Create `canteen-electron/src/main/first-launch.ts`:

```typescript
import * as fs from 'fs';
import { dialog } from 'electron';
import { databasePath, loadConfig, saveConfig, createDefaultConfig, AppConfig } from './config-store';

/**
 * Check if this is the first launch (no config file exists).
 * If so, create default config and prompt for admin credentials.
 * Returns the config to use for this session.
 */
export async function ensureConfig(): Promise<AppConfig> {
  let config = loadConfig();

  if (config) {
    return config;
  }

  // First launch — create defaults
  config = createDefaultConfig();

  // Prompt for admin username
  const usernameResult = await dialog.showMessageBox({
    type: 'question',
    title: 'Canteen Manager — First Launch',
    message: 'Welcome! Set up the admin account.\n\nUse default admin credentials?\nUsername: admin\nPassword: admin123',
    buttons: ['Use Defaults', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });

  if (usernameResult.response === 1) {
    // User cancelled — use defaults anyway (they can change password later)
  }

  // Save config
  saveConfig(config);

  return config;
}

/**
 * Check if the SQLite database file exists.
 */
export function isDatabaseInitialized(): boolean {
  return fs.existsSync(databasePath());
}
```

- [ ] **Step 2: Write the main entry point index.ts**

Create `canteen-electron/src/main/index.ts`:

```typescript
import { app, dialog } from 'electron';
import { ensureConfig } from './first-launch';
import { startBackend, stopBackend } from './backend-process';
import { createMainWindow } from './window';
import { createTray } from './tray';

/** Prevent multiple instances — a second launch focuses the existing window. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  const { getMainWindow } = require('./window');
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('ready', async () => {
  try {
    // 1. Ensure config exists (first-launch setup)
    const config = await ensureConfig();

    // 2. Start the NestJS backend
    const port = await startBackend(config);
    const backendUrl = `http://localhost:${port}`;
    console.log(`Backend ready at ${backendUrl}`);

    // 3. Create system tray
    createTray(backendUrl);

    // 4. Open main window
    createMainWindow(backendUrl);
  } catch (err) {
    console.error('Failed to start application:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Canteen Manager — Startup Error',
      message: `Failed to start the application.\n\n${err instanceof Error ? err.message : String(err)}`,
      buttons: ['Quit'],
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit when all windows close
});

app.on('before-quit', async (event) => {
  event.preventDefault();
  console.log('Shutting down backend...');
  await stopBackend();
  console.log('Backend stopped. Exiting.');
  app.exit(0);
});
```

- [ ] **Step 3: Commit**

```bash
git add canteen-electron/src/main/first-launch.ts \
       canteen-electron/src/main/index.ts
git commit -m "feat(electron): add main entry point with first-launch setup"
```

---

## Task 13: Backend — Run SQLite Migration on Startup

**Files:**
- Modify: `canteen-manager/backend/src/main.ts`

The NestJS backend needs to run pending migrations automatically when using SQLite (Electron mode). In Docker mode, a separate `migrate` container handles this. For Electron, we run migrations inline at startup.

> **Note:** This task replaces the version of main.ts written in Task 7. The version below includes everything from Task 7 plus migration auto-run.

- [ ] **Step 1: Replace main.ts with the final version (includes migration runner)**

Replace the full content of `canteen-manager/backend/src/main.ts` with:

```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppEnv } from './config/env-validation';
import { AppModule } from './app.module';

/**
 * Bootstrap the NestJS application.
 * In Electron mode (SQLite), runs pending migrations automatically.
 * Sends IPC 'ready' message to the Electron parent process.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const config = app.get(ConfigService<AppEnv, true>);

  // Run pending migrations for SQLite (Electron mode).
  // In Docker mode, the separate migrate container handles this.
  const dbType = config.get('DATABASE_TYPE', { infer: true });
  if (dbType === 'sqlite') {
    const dataSource = app.get(DataSource);
    const pending = await dataSource.showMigrations();
    if (pending) {
      console.log('Running pending SQLite migrations...');
      await dataSource.runMigrations();
      console.log('Migrations complete.');
    }
  }

  // Seed admin operator if configured and not yet present.
  const seedUser = config.get('SEED_ADMIN_USERNAME', { infer: true });
  const seedPass = config.get('SEED_ADMIN_PASSWORD', { infer: true });
  if (seedUser && seedPass) {
    process.env['SEED_ADMIN_USERNAME'] = seedUser;
    process.env['SEED_ADMIN_PASSWORD'] = seedPass;
  }

  app.useBodyParser('json', { limit: '15mb' });

  const port = config.get('BACKEND_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(`Backend listening on 0.0.0.0:${port}`);

  if (process.send) {
    process.send({ type: 'ready', port });
  }

  process.on('message', (msg: unknown) => {
    if (msg && typeof msg === 'object' && (msg as { type: string }).type === 'shutdown') {
      console.log('Received shutdown signal, closing gracefully...');
      app.close().then(() => process.exit(0));
    }
  });
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error('Failed to start backend:', err);
    if (process.send) {
      process.send({ type: 'error', message: String(err) });
    }
    process.exit(1);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add canteen-manager/backend/src/main.ts
git commit -m "feat(backend): auto-run SQLite migrations on startup in Electron mode"
```

---

## Task 14: Build and Smoke Test

**Files:** No new files — this task validates the full build pipeline.

- [ ] **Step 1: Build the backend**

Run:
```bash
cd canteen-manager/backend && npm run build
```

Expected: Clean TypeScript compilation to `dist/`.

- [ ] **Step 2: Build the frontend**

Run:
```bash
cd canteen-manager/frontend && npm run build
```

Expected: Vite produces `dist/` with index.html and JS/CSS bundles.

- [ ] **Step 3: Build the Electron shell**

Run:
```bash
cd canteen-electron && npm run build:electron
```

Expected: TypeScript compiles to `canteen-electron/dist/`.

- [ ] **Step 4: Smoke test — run in dev mode**

Run:
```bash
cd canteen-electron && npm run dev
```

Expected:
1. Electron window opens
2. First-launch dialog appears (if first run)
3. Backend starts and signals ready
4. Window loads the React app at `http://localhost:3000`
5. Login page is displayed
6. System tray icon appears

- [ ] **Step 5: Verify kiosk access from browser**

Open a regular browser on the same machine and navigate to `http://localhost:3000/kiosk`.

Expected: The kiosk page loads with the menu.

- [ ] **Step 6: Verify LAN access (if possible)**

From another device on the same LAN, navigate to `http://<your-pc-ip>:3000/kiosk`.

Expected: Kiosk page loads from the remote device.

- [ ] **Step 7: Run backend tests**

Run:
```bash
cd canteen-manager/backend && npm test
```

Note: Some tests may need updating for the SQLite changes. Fix any failures related to:
- Removed scan/OMR module imports
- Changed env validation schema
- Entity type changes

- [ ] **Step 8: Run frontend tests**

Run:
```bash
cd canteen-manager/frontend && npm test
```

Expected: All tests pass.

- [ ] **Step 9: Build installer (optional)**

Run:
```bash
cd canteen-electron && npm run dist
```

Expected: `canteen-electron/release/` contains a `.exe` NSIS installer.

- [ ] **Step 10: Commit any test fixes**

```bash
git add -A
git commit -m "fix: update tests for Electron/SQLite migration"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Scaffold Electron project | `canteen-electron/` |
| 2 | Add SQLite + serve-static deps | `backend/package.json` |
| 3 | Simplify env config | `backend/src/config/env-validation.ts` |
| 4 | Update entities for SQLite | 7 entity files |
| 5 | Write SQLite initial migration | `migrations-sqlite/00000000000001-initial-schema.ts` |
| 6 | Update app.module + data-source | `app.module.ts`, `data-source.ts` |
| 7 | Update main.ts for Electron | `backend/src/main.ts` |
| 8 | Remove scan routes + nav | `router.tsx`, `nav-items.ts`, `vite.config.ts` |
| 9 | Config store | `canteen-electron/src/main/config-store.ts` |
| 10 | Backend process manager | `canteen-electron/src/main/backend-process.ts` |
| 11 | Window + tray + preload | `window.ts`, `tray.ts`, `preload/index.ts` |
| 12 | First launch + main entry | `first-launch.ts`, `index.ts` |
| 13 | Auto-run migrations | `backend/src/main.ts` |
| 14 | Build + smoke test | Validation only |
