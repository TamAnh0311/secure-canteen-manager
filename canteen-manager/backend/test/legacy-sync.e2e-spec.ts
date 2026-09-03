/**
 * Integration tests for legacy-sync idempotency against a real Postgres DB.
 * Boots the full NestJS app (same pattern as auth.e2e-spec.ts).
 *
 * Requires DATABASE_URL to be set. The live-MSSQL describe block at the
 * bottom is skipped unless LEGACY_SQL_HOST is also set, so it never runs
 * locally and only executes in staging against a real SQL Server instance.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { LegacySyncService } from '../src/legacy-sync/legacy-sync.service';
import { LEGACY_EMPLOYEE_SOURCE, LegacyEmployee, LegacyEmployeeSource } from '../src/legacy-sync/legacy-employee-source';
import { SyncRunStatus } from '../src/legacy-sync/sync-run.entity';
import { CELL_NORMALIZATION_VERSION } from '../src/users/cell-normalization';

// ---------------------------------------------------------------------------
// Test double — stands in for the external SQL Server box.
// Legitimate use of a fake here: we are testing OUR sync logic + Postgres
// upsert behaviour, not the MSSQL driver.
// ---------------------------------------------------------------------------
class InMemoryEmployeeSource implements LegacyEmployeeSource {
  constructor(public employees: LegacyEmployee[] = []) {}
  async fetchEmployees(): Promise<LegacyEmployee[]> {
    return this.employees;
  }
}

// ---------------------------------------------------------------------------
// Idempotency integration test (always runs when DATABASE_URL is set)
// ---------------------------------------------------------------------------
describe('LegacySync idempotency (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let syncService: LegacySyncService;
  let testSource: InMemoryEmployeeSource;

  const seedEmployees: LegacyEmployee[] = [
    {
      legacyId: 'E001', name: 'Alice Nguyen', zone: 'Finance', cell: 'A', isActive: true,
      dateOfBirth: null, hometown: null, offense: null, arrestDate: null, detentionStatus: null,
    },
    {
      legacyId: 'E002', name: 'Bob Tran', zone: 'IT', cell: null, isActive: true,
      dateOfBirth: null, hometown: null, offense: null, arrestDate: null, detentionStatus: null,
    },
    {
      legacyId: 'E003', name: 'Carol Le', zone: null, cell: 'B', isActive: false,
      dateOfBirth: null, hometown: null, offense: null, arrestDate: null, detentionStatus: null,
    },
  ];

  beforeAll(async () => {
    testSource = new InMemoryEmployeeSource(seedEmployees);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LEGACY_EMPLOYEE_SOURCE)
      .useValue(testSource)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    syncService = moduleRef.get<LegacySyncService>(LegacySyncService);

    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');
    await app.close();
  });

  it('first sync inserts all employees', async () => {
    const result = await syncService.run('manual');
    expect('skipped' in result).toBe(false);
    const run = result as Awaited<ReturnType<LegacySyncService['run']>>;
    expect((run as { status: SyncRunStatus }).status).toBe(SyncRunStatus.SUCCESS);

    const count = await dataSource.query('SELECT COUNT(*) FROM users');
    expect(Number(count[0].count)).toBe(3);

    const normalized: Array<{
      legacy_id: string;
      normalized_cell: string | null;
      cell_normalization_version: number;
    }> = await dataSource.query(
      'SELECT legacy_id, normalized_cell, cell_normalization_version FROM users ORDER BY legacy_id',
    );
    expect(normalized).toEqual([
      { legacy_id: 'E001', normalized_cell: 'A', cell_normalization_version: CELL_NORMALIZATION_VERSION },
      { legacy_id: 'E002', normalized_cell: null, cell_normalization_version: CELL_NORMALIZATION_VERSION },
      { legacy_id: 'E003', normalized_cell: 'B', cell_normalization_version: CELL_NORMALIZATION_VERSION },
    ]);
  });

  it('second sync does not create duplicate rows (idempotent upsert by legacy_id)', async () => {
    const result = await syncService.run('manual');
    expect('skipped' in result).toBe(false);

    const count = await dataSource.query('SELECT COUNT(*) FROM users');
    expect(Number(count[0].count)).toBe(3);

    const legacyIds: Array<{ legacy_id: string }> = await dataSource.query(
      'SELECT legacy_id FROM users ORDER BY legacy_id',
    );
    const ids = legacyIds.map((r) => r.legacy_id);
    expect(ids).toEqual(['E001', 'E002', 'E003']);
  });

  it('updated employee name is reflected after re-sync (upsert overwrites)', async () => {
    testSource.employees = [
      ...seedEmployees.slice(1),
      { ...seedEmployees[0], name: 'Alice Nguyen-Updated', cell: ' A-01 ' },
    ];

    await syncService.run('manual');

    const rows: Array<{
      name: string;
      normalized_cell: string | null;
      cell_normalization_version: number;
    }> = await dataSource.query(
      "SELECT name, normalized_cell, cell_normalization_version FROM users WHERE legacy_id = 'E001'",
    );
    expect(rows[0]?.name).toBe('Alice Nguyen-Updated');
    expect(rows[0]?.normalized_cell).toBe('A01');
    expect(rows[0]?.cell_normalization_version).toBe(CELL_NORMALIZATION_VERSION);

    const count = await dataSource.query('SELECT COUNT(*) FROM users');
    expect(Number(count[0].count)).toBe(3);
  });

  it('source failure records a failed SyncRun but leaves existing users intact', async () => {
    testSource.employees = null as unknown as LegacyEmployee[];
    // fetchEmployees will throw because map() on null
    const result = await syncService.run('manual');
    expect('skipped' in result).toBe(false);
    const run = result as { status: SyncRunStatus; error: string | null };
    expect(run.status).toBe(SyncRunStatus.FAILED);
    expect(run.error).toBeTruthy();

    // Existing users must still be there
    const count = await dataSource.query('SELECT COUNT(*) FROM users');
    expect(Number(count[0].count)).toBe(3);

    // Restore for any future tests
    testSource.employees = seedEmployees;
  });
});

// ---------------------------------------------------------------------------
// Live MSSQL connection smoke test — ENV-GATED.
//
// Skipped unless LEGACY_SQL_HOST is set in the test process environment.
// Runs only in staging where a real SQL Server (or compatible) is reachable.
// We do NOT mock or fake anything here — the point is to exercise the real
// MssqlLegacyEmployeeSource driver round-trip.
// ---------------------------------------------------------------------------
const conditionalDescribe = process.env['LEGACY_SQL_HOST']
  ? describe
  : describe.skip;

conditionalDescribe('MssqlLegacyEmployeeSource live connection (staging only)', () => {
  // This block intentionally has no mocks. It requires:
  //   LEGACY_SQL_HOST, LEGACY_SQL_USER, LEGACY_SQL_PASS, LEGACY_SQL_DB
  // All other LEGACY_SQL_* vars are read from environment with defaults.
  //
  // If the remote box is unreachable the test fails with a connection error —
  // that is the correct and expected outcome for a live integration test.

  it('fetches at least one employee row and maps to canonical shape', async () => {
    // Dynamically require to avoid loading mssql driver in offline CI
    const { MssqlLegacyEmployeeSource } = await import(
      '../src/legacy-sync/mssql-legacy-employee-source'
    );
    const { ConfigService } = await import('@nestjs/config');

    const envValues: Record<string, unknown> = {
      LEGACY_SQL_HOST: process.env['LEGACY_SQL_HOST'],
      LEGACY_SQL_USER: process.env['LEGACY_SQL_USER'],
      LEGACY_SQL_PASS: process.env['LEGACY_SQL_PASS'],
      LEGACY_SQL_DB: process.env['LEGACY_SQL_DB'],
      LEGACY_SQL_PORT: Number(process.env['LEGACY_SQL_PORT'] ?? 1433),
      LEGACY_SQL_ENCRYPT: process.env['LEGACY_SQL_ENCRYPT'] === 'true',
      LEGACY_SQL_TRUST_CERT: process.env['LEGACY_SQL_TRUST_CERT'] !== 'false',
      LEGACY_SQL_TDS_VERSION: process.env['LEGACY_SQL_TDS_VERSION'] ?? '7_2',
      LEGACY_SQL_TLS_MIN_VERSION: process.env['LEGACY_SQL_TLS_MIN_VERSION'],
      LEGACY_SQL_POOL_SIZE: Number(process.env['LEGACY_SQL_POOL_SIZE'] ?? 5),
      LEGACY_SQL_QUERY_TIMEOUT_MS: Number(process.env['LEGACY_SQL_QUERY_TIMEOUT_MS'] ?? 60000),
      LEGACY_SQL_QUERY: process.env['LEGACY_SQL_QUERY'],
    };

    const configService = {
      get: (key: string) => envValues[key],
    } as unknown as InstanceType<typeof ConfigService>;

    const liveSource = new MssqlLegacyEmployeeSource(configService);
    const employees = await liveSource.fetchEmployees();

    expect(Array.isArray(employees)).toBe(true);
    expect(employees.length).toBeGreaterThan(0);

    const first = employees[0]!;
    expect(typeof first.legacyId).toBe('string');
    expect(first.legacyId.length).toBeGreaterThan(0);
    expect(typeof first.name).toBe('string');
    expect(typeof first.isActive).toBe('boolean');
  }, 30000);
});
