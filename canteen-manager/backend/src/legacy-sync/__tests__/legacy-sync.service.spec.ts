import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { LegacySyncService } from '../legacy-sync.service';
import { LEGACY_EMPLOYEE_SOURCE, LegacyEmployee, LegacyEmployeeSource } from '../legacy-employee-source';
import { SyncRun, SyncRunStatus } from '../sync-run.entity';
import { User, DetentionStatus } from '../../users/user.entity';
import { CELL_NORMALIZATION_VERSION } from '../../users/cell-normalization';

// Stub SchedulerRegistry — onModuleInit calls addCronJob/start but no real
// cron fires in unit tests.  Tests call scheduledSync() / run() directly.
const makeSchedulerRegistry = () => ({
  addCronJob: jest.fn(),
  getCronJob: jest.fn(),
  deleteCronJob: jest.fn(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmployee(overrides: Partial<LegacyEmployee> = {}): LegacyEmployee {
  return {
    legacyId: 'EMP-001',
    name: 'Alice',
    zone: 'Finance',
    cell: null,
    dateOfBirth: null,
    hometown: null,
    offense: null,
    arrestDate: null,
    detentionStatus: null,
    isActive: true,
    ...overrides,
  };
}

function makeMockRepo<T>() {
  const saved: T[] = [];
  // Chainable query-builder stub for the absent-rows deactivation UPDATE.
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => ({ affected: 0 })),
  };
  return {
    create: jest.fn((data: Partial<T>) => ({ ...data } as T)),
    save: jest.fn(async (entity: T) => {
      saved.push(entity);
      return entity;
    }),
    upsert: jest.fn(async () => undefined),
    findOne: jest.fn(async () => null),
    createQueryBuilder: jest.fn(() => qb),
    _saved: saved,
    _qb: qb,
  };
}

function makeConfigService(extras: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    LEGACY_SYNC_ENABLED: false,
    LEGACY_SYNC_CRON: '0 */4 * * *',
    ...extras,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LegacySyncService', () => {
  let service: LegacySyncService;
  let usersRepo: ReturnType<typeof makeMockRepo<User>>;
  let syncRunsRepo: ReturnType<typeof makeMockRepo<SyncRun>>;
  let source: { fetchEmployees: jest.Mock };

  async function buildService(configOverrides: Record<string, unknown> = {}) {
    usersRepo = makeMockRepo<User>();
    syncRunsRepo = makeMockRepo<SyncRun>();
    source = { fetchEmployees: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegacySyncService,
        { provide: LEGACY_EMPLOYEE_SOURCE, useValue: source as LegacyEmployeeSource },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(SyncRun), useValue: syncRunsRepo },
        { provide: ConfigService, useValue: makeConfigService(configOverrides) },
        { provide: SchedulerRegistry, useValue: makeSchedulerRegistry() },
      ],
    }).compile();

    service = module.get(LegacySyncService);
  }

  beforeEach(async () => {
    await buildService();
  });

  // -------------------------------------------------------------------------
  // (a) Success path
  // -------------------------------------------------------------------------
  describe('run() — success', () => {
    it('upserts employees mapped to canonical columns and records status=success', async () => {
      const employees: LegacyEmployee[] = [
        makeEmployee({
          legacyId: 'E1', name: 'Alice', zone: 'HR', cell: 'A',
          dateOfBirth: '1990-05-12', hometown: 'Hà Nội', offense: 'Trộm cắp tài sản',
          arrestDate: '2022-01-03', detentionStatus: DetentionStatus.CONVICTED,
        }),
        makeEmployee({ legacyId: 'E2', name: 'Bob', zone: null, cell: null, isActive: false }),
      ];
      source.fetchEmployees.mockResolvedValueOnce(employees);

      const result = await service.run('manual');

      expect('skipped' in result).toBe(false);
      const run = result as SyncRun;

      expect(run.status).toBe(SyncRunStatus.SUCCESS);
      expect(run.rowCount).toBe(2);
      expect(run.finishedAt).toBeInstanceOf(Date);
      expect(run.error).toBeNull();

      // upsert called at least once with rows keyed by legacyId
      expect(usersRepo.upsert).toHaveBeenCalled();
      const rawCall = (usersRepo.upsert.mock.calls as unknown as Array<[Array<Partial<User>>, string[]]>)[0]!;
      const rows: Array<Partial<User>> = rawCall[0];
      const conflictKey: string[] = rawCall[1];

      expect(conflictKey).toEqual(['legacyId']);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        legacyId: 'E1', name: 'Alice', zone: 'HR', cell: 'A', isActive: true, source: 'sql2005',
        normalizedCell: 'A', cellNormalizationVersion: CELL_NORMALIZATION_VERSION,
        dateOfBirth: '1990-05-12', hometown: 'Hà Nội', offense: 'Trộm cắp tài sản',
        arrestDate: '2022-01-03', detentionStatus: DetentionStatus.CONVICTED,
      });
      expect(rows[1]).toMatchObject({
        legacyId: 'E2', name: 'Bob', zone: null, cell: null, isActive: false, source: 'sql2005',
        normalizedCell: null, cellNormalizationVersion: CELL_NORMALIZATION_VERSION,
        dateOfBirth: null, hometown: null, offense: null, arrestDate: null, detentionStatus: null,
      });
      expect(rows[0]!.syncedAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // (a2) Deactivation of absent rows
  // -------------------------------------------------------------------------
  describe('run() — deactivates rows absent from the source', () => {
    it('issues an UPDATE marking stale sql2005 rows inactive after a non-empty fetch', async () => {
      source.fetchEmployees.mockResolvedValueOnce([makeEmployee({ legacyId: 'E1' })]);

      await service.run('manual');

      expect(usersRepo.createQueryBuilder).toHaveBeenCalled();
      expect(usersRepo._qb.set).toHaveBeenCalledWith({ isActive: false });
      expect(usersRepo._qb.execute).toHaveBeenCalled();
    });

    it('does NOT deactivate anyone when the source returns an empty set (guards against a glitchy fetch)', async () => {
      source.fetchEmployees.mockResolvedValueOnce([]);

      await service.run('manual');

      expect(usersRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (b) Source throws — SyncRun records failure, run() does NOT throw
  // -------------------------------------------------------------------------
  describe('run() — source error', () => {
    it('records status=failed with error message and does not rethrow', async () => {
      source.fetchEmployees.mockRejectedValueOnce(new Error('connection refused'));

      // Must not throw
      const result = await service.run('manual');

      expect('skipped' in result).toBe(false);
      const run = result as SyncRun;

      expect(run.status).toBe(SyncRunStatus.FAILED);
      expect(run.error).toBe('connection refused');
      expect(run.finishedAt).toBeInstanceOf(Date);
      expect(run.rowCount).toBe(0);

      // upsert must NOT have been called
      expect(usersRepo.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (c) Overlap guard — second concurrent call returns skipped
  // -------------------------------------------------------------------------
  describe('run() — overlap guard', () => {
    it('returns skipped when a run is already in progress', async () => {
      // Hold the first run open until we resolve
      let resolveFirst!: (v: LegacyEmployee[]) => void;
      source.fetchEmployees.mockReturnValueOnce(
        new Promise<LegacyEmployee[]>((res) => { resolveFirst = res; }),
      );

      const firstRunPromise = service.run('manual');

      // Second call while first is in flight
      const secondResult = await service.run('manual');
      expect(secondResult).toEqual({ skipped: true, reason: 'in-progress' });

      // Let first run finish cleanly
      resolveFirst([]);
      await firstRunPromise;
    });
  });

  // -------------------------------------------------------------------------
  // (d) scheduledSync no-ops when LEGACY_SYNC_ENABLED=false
  // -------------------------------------------------------------------------
  describe('scheduledSync()', () => {
    it('does not create a SyncRun when LEGACY_SYNC_ENABLED is false', async () => {
      // Default config has LEGACY_SYNC_ENABLED=false
      await service.scheduledSync();

      expect(syncRunsRepo.save).not.toHaveBeenCalled();
      expect(source.fetchEmployees).not.toHaveBeenCalled();
    });

    it('runs sync when LEGACY_SYNC_ENABLED is true', async () => {
      await buildService({ LEGACY_SYNC_ENABLED: true });
      source.fetchEmployees.mockResolvedValueOnce([makeEmployee()]);

      await service.scheduledSync();

      expect(syncRunsRepo.save).toHaveBeenCalled();
    });
  });
});
