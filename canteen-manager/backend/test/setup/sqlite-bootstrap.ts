/**
 * SQLite integration test bootstrap.
 * Creates a NestJS app backed by an in-file SQLite database, runs migrations,
 * and provides seed/teardown helpers for the test suite.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Operator, OperatorRole } from '../../src/operators/operator.entity';
import { BCRYPT_COST } from '../../src/operators/operator-public';
import { User, DetentionStatus } from '../../src/users/user.entity';
import { normalizeCell } from '../../src/users/cell-normalization';
import { MenuItem } from '../../src/menu/menu-item.entity';
import { MenuItemCategory } from '../../src/menu/menu-item-category.enum';
import { PrisonerAccount } from '../../src/accounts/prisoner-account.entity';
import { AccountTransaction, AccountTransactionType } from '../../src/accounts/account-transaction.entity';
import { PurchaseLimitConfig } from '../../src/purchase-limit-config/purchase-limit-config.entity';
import { todayInDeployTz, tomorrowInDeployTz } from '../../src/common/today-in-tz';
import request from 'supertest';

// ── App creation ──

export interface SqliteE2EContext {
  app: INestApplication;
  moduleRef: TestingModule;
  ds: DataSource;
}

/**
 * Builds, initialises, and migrates a NestJS app backed by the SQLite
 * database path set in process.env.DATABASE_PATH.
 */
export async function createSqliteApp(): Promise<SqliteE2EContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['/'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const ds = moduleRef.get<DataSource>(DataSource);

  // Run SQLite migrations (same as main.ts does in Electron mode).
  const pending = await ds.showMigrations();
  if (pending) {
    await ds.runMigrations();
  }

  return { app, moduleRef, ds };
}

// ── Seed helpers ──

export const TEST_PASSWORD = 'testpass1234';

/** Seeds an operator and returns it. */
export async function seedOperator(
  ds: DataSource,
  username: string,
  role: OperatorRole,
  opts?: { zone?: string; isActive?: boolean },
): Promise<Operator> {
  const repo = ds.getRepository(Operator);
  return repo.save(
    repo.create({
      username,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, BCRYPT_COST),
      displayName: username,
      role,
      zone: opts?.zone ?? null,
      isActive: opts?.isActive ?? true,
    }),
  );
}

/** Logs in via HTTP and returns the bearer token. */
export async function login(app: INestApplication, username: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ username, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

/** Seeds a prisoner user. */
export async function seedPrisoner(
  ds: DataSource,
  legacyId: string,
  name: string,
  opts?: { zone?: string; cell?: string; isActive?: boolean },
): Promise<User> {
  const repo = ds.getRepository(User);
  const nc = normalizeCell(opts?.cell ?? null);
  return repo.save(
    repo.create({
      legacyId,
      name,
      zone: opts?.zone ?? 'Khu A1',
      cell: opts?.cell ?? 'A1-01',
      normalizedCell: nc.value,
      cellNormalizationVersion: nc.version,
      isActive: opts?.isActive ?? true,
      source: 'test',
      syncedAt: new Date(),
    }),
  );
}

/** Seeds a menu item and returns it. */
export async function seedMenuItem(
  ds: DataSource,
  position: number,
  name: string,
  price: number,
  category: MenuItemCategory = MenuItemCategory.FOOD,
): Promise<MenuItem> {
  const repo = ds.getRepository(MenuItem);
  const code = String(position + 1).padStart(3, '0');
  return repo.save(
    repo.create({ code, name, price, category, position, isActive: true }),
  );
}

/** Seeds a prisoner account with a starting balance. */
export async function seedAccount(
  ds: DataSource,
  userId: string,
  balance: number,
  operatorId: string,
): Promise<PrisonerAccount> {
  const accountRepo = ds.getRepository(PrisonerAccount);
  const ledgerRepo = ds.getRepository(AccountTransaction);
  const account = await accountRepo.save(accountRepo.create({ userId, balance }));
  await ledgerRepo.save(
    ledgerRepo.create({
      userId,
      type: AccountTransactionType.TOPUP,
      amount: balance,
      balanceAfter: balance,
      method: 'cash',
      operatorId,
      note: 'Test topup',
    }),
  );
  return account;
}

/** Seeds purchase limit config (singleton). */
export async function seedPurchaseLimits(
  ds: DataSource,
  prisoner?: { food?: number; essential?: number },
  visitor?: { food?: number; essential?: number },
): Promise<void> {
  const repo = ds.getRepository(PurchaseLimitConfig);
  let limits = await repo.findOne({ where: { singleton: true } });
  if (!limits) limits = repo.create({ singleton: true });
  limits.prisonerFoodEnabled = !!prisoner?.food;
  limits.prisonerFoodAmount = prisoner?.food ?? 0;
  limits.prisonerEssentialEnabled = !!prisoner?.essential;
  limits.prisonerEssentialAmount = prisoner?.essential ?? 0;
  limits.visitorFoodEnabled = !!visitor?.food;
  limits.visitorFoodAmount = visitor?.food ?? 0;
  limits.visitorEssentialEnabled = !!visitor?.essential;
  limits.visitorEssentialAmount = visitor?.essential ?? 0;
  await repo.save(limits);
}

/** Today's service date. */
export function today(): string {
  return todayInDeployTz();
}

/** Tomorrow's service date. */
export function tomorrow(): string {
  return tomorrowInDeployTz();
}

/**
 * Truncates all mutable tables. SQLite doesn't support TRUNCATE CASCADE,
 * so we DELETE in FK-safe order.
 */
export async function truncateAll(ds: DataSource): Promise<void> {
  const tables = [
    'order_items',
    'orders',
    'account_transactions',
    'prisoner_accounts',
    'omr_form_template_rows',
    'omr_form_templates',
    'menu_items',
    'users',
    'operators',
    'threshold_config',
    'purchase_limit_config',
    'payment_config',
  ];
  // Check which tables exist before deleting.
  const existing: Array<{ name: string }> = await ds.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${tables.map(() => '?').join(',')})`,
    tables,
  );
  const existingNames = new Set(existing.map((t) => t.name));
  for (const table of tables) {
    if (existingNames.has(table)) {
      await ds.query(`DELETE FROM "${table}"`);
    }
  }
}
