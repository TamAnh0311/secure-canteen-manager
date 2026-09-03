import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, FindOperator } from 'typeorm';
import { AppEnv, validateEnv } from '../../config/env-validation';
import { ScanRetentionService, PURGED_IMAGE_PATH } from '../scan-retention.service';
import { ScanStorageService } from '../scan-storage.service';
import { Sheet } from '../sheet.entity';
import { SheetStatus } from '../sheet-status.enum';
import { ScannerArtifactJobState } from '../webhook/scanner-artifact-job.entity';

const NOW = new Date('2026-07-14T12:00:00.000Z');
const RETENTION_DAYS = 30;

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sheetId: 'SYNTHETIC-RETENTION-001',
    batch: null,
    serviceDate: '2026-06-13',
    checksum: 'a'.repeat(64),
    imagePath: `${'a'.repeat(64)}.png`,
    status: SheetStatus.VERIFIED,
    resultJson: { order_lines: [], sensitive_notes: 'synthetic-result' },
    avgConfidence: 0.96,
    recognizedId: 'SYNTHETIC-ID',
    matchedUserId: '22222222-2222-4222-8222-222222222222',
    matchedUser: null,
    issuedFormId: '33333333-3333-4333-8333-333333333333',
    issuedForm: null,
    rejectionCode: null,
    processingAttempts: 1,
    nextRetryAt: null,
    lastErrorCode: null,
    orderId: '44444444-4444-4444-8444-444444444444',
    flags: ['QR_BOUND'],
    createdAt: new Date('2026-06-13T12:00:00.000Z'),
    updatedAt: new Date('2026-06-13T12:05:00.000Z'),
    processedAt: new Date('2026-06-13T12:05:00.000Z'),
    ...overrides,
  } as Sheet;
}

function buildService(options: { retentionDays?: number } = {}) {
  const manager = {
    find: jest.fn<Promise<Sheet[]>, unknown[]>().mockResolvedValue([]),
    save: jest.fn(async (_entity: typeof Sheet, sheet: Sheet) => sheet),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<number>) =>
      work(manager as unknown as EntityManager)),
  };
  const storage = {
    deleteImage: jest.fn(),
    deleteWarpedImages: jest.fn(),
  };
  const config = {
    get: jest.fn().mockReturnValue(options.retentionDays),
  };

  const service = new ScanRetentionService(
    dataSource as unknown as DataSource,
    storage as unknown as ScanStorageService,
    config as unknown as ConfigService<AppEnv, true>,
  );

  return { service, dataSource, manager, storage, config };
}

function findOperatorValue<T>(operator: FindOperator<T>): T {
  return (operator as unknown as { _value: T })._value;
}

describe('ScanRetentionService', () => {
  it('does nothing when retention is intentionally unset outside production', async () => {
    const { service, dataSource } = buildService();

    await expect(service.purgeDue(NOW)).resolves.toBe(0);

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('selects one locked terminal batch at the exact configured processed-at cutoff', async () => {
    const { service, manager } = buildService({ retentionDays: RETENTION_DAYS });

    await service.purgeDue(NOW);

    expect(manager.find).toHaveBeenCalledTimes(1);
    const options = manager.find.mock.calls[0][1] as {
      where: {
        status: FindOperator<SheetStatus[]>;
        processedAt: FindOperator<Date>;
        imagePath: FindOperator<string>;
      };
      order: Record<string, string>;
      take: number;
      lock: { mode: string };
    };
    expect(findOperatorValue(options.where.status)).toEqual([
      SheetStatus.AUTO_ACCEPTED,
      SheetStatus.FLAGGED,
      SheetStatus.VERIFIED,
      SheetStatus.REJECTED,
    ]);
    expect(findOperatorValue(options.where.processedAt)).toEqual(
      new Date('2026-06-14T12:00:00.000Z'),
    );
    expect(findOperatorValue(options.where.imagePath)).toBe(PURGED_IMAGE_PATH);
    expect(options.order).toEqual({ processedAt: 'ASC' });
    expect(options.take).toBe(100);
    expect(options.lock).toEqual({ mode: 'pessimistic_write' });
  });

  it('deletes raw and every warped artifact, scrubs sensitive fields, and retains audit links', async () => {
    const { service, manager, storage } = buildService({ retentionDays: RETENTION_DAYS });
    const sheet = makeSheet();
    manager.find.mockResolvedValue([sheet]);

    await expect(service.purgeDue(NOW)).resolves.toBe(1);

    expect(storage.deleteImage).toHaveBeenCalledWith(`${'a'.repeat(64)}.png`);
    expect(storage.deleteWarpedImages).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(manager.save).toHaveBeenCalledWith(Sheet, expect.objectContaining({ id: sheet.id }));
    const saved = manager.save.mock.calls[0][1] as Sheet;
    expect(saved).toMatchObject({
      imagePath: PURGED_IMAGE_PATH,
      resultJson: null,
      recognizedId: null,
      avgConfidence: null,
      status: SheetStatus.VERIFIED,
      matchedUserId: '22222222-2222-4222-8222-222222222222',
      issuedFormId: '33333333-3333-4333-8333-333333333333',
      orderId: '44444444-4444-4444-8444-444444444444',
      flags: ['QR_BOUND'],
      processingAttempts: 1,
    });
  });

  it('serializes concurrent runs so a sentinel-marked sheet is deleted only once', async () => {
    const sheet = makeSheet();
    const storage = {
      deleteImage: jest.fn(),
      deleteWarpedImages: jest.fn(),
    };
    let transactionTail = Promise.resolve();
    const manager = {
      find: jest.fn(async () => (sheet.imagePath === PURGED_IMAGE_PATH ? [] : [sheet])),
      save: jest.fn(async (_entity: typeof Sheet, saved: Sheet) => {
        Object.assign(sheet, saved);
        return saved;
      }),
    };
    const dataSource = {
      transaction: jest.fn((work: (manager: EntityManager) => Promise<number>) => {
        const run = transactionTail.then(() => work(manager as unknown as EntityManager));
        transactionTail = run.then(() => undefined, () => undefined);
        return run;
      }),
    };
    const config = { get: jest.fn().mockReturnValue(RETENTION_DAYS) };
    const service = new ScanRetentionService(
      dataSource as unknown as DataSource,
      storage as unknown as ScanStorageService,
      config as unknown as ConfigService<AppEnv, true>,
    );

    await expect(Promise.all([service.purgeDue(NOW), service.purgeDue(NOW)])).resolves.toEqual([1, 0]);

    expect(storage.deleteImage).toHaveBeenCalledTimes(1);
    expect(storage.deleteWarpedImages).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('surfaces a storage failure without marking the row purged and succeeds on retry', async () => {
    const { service, manager, storage } = buildService({ retentionDays: RETENTION_DAYS });
    const sheet = makeSheet();
    manager.find.mockImplementation(async () =>
      sheet.imagePath === PURGED_IMAGE_PATH ? [] : [sheet],
    );
    storage.deleteWarpedImages.mockImplementationOnce(() => {
      throw new Error('synthetic storage unavailable');
    });

    await expect(service.purgeDue(NOW)).rejects.toThrow('synthetic storage unavailable');
    expect(sheet.imagePath).not.toBe(PURGED_IMAGE_PATH);
    expect(sheet.resultJson).not.toBeNull();
    expect(manager.save).not.toHaveBeenCalled();

    await expect(service.purgeDue(NOW)).resolves.toBe(1);
    expect((manager.save.mock.calls[0][1] as Sheet).imagePath).toBe(PURGED_IMAGE_PATH);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('drains every due row across bounded 100-row transactions in one scheduled run', async () => {
    const { service, dataSource, manager } = buildService({ retentionDays: RETENTION_DAYS });
    const firstBatch = Array.from({ length: 100 }, (_, index) =>
      makeSheet({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        imagePath: `${String(index).padStart(64, 'a')}.png`,
      }),
    );
    const finalSheet = makeSheet({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    manager.find
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([finalSheet]);

    await expect(service.purgeDue(NOW)).resolves.toBe(101);

    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(manager.find).toHaveBeenCalledTimes(2);
    expect(manager.save).toHaveBeenCalledTimes(101);
  });

  it('keeps a DB-save failure due and safely retries after idempotent filesystem deletion', async () => {
    const { service, manager, storage } = buildService({ retentionDays: RETENTION_DAYS });
    const sheet = makeSheet();
    manager.find.mockImplementation(async () =>
      sheet.imagePath === PURGED_IMAGE_PATH ? [] : [sheet],
    );
    manager.save.mockRejectedValueOnce(new Error('synthetic DB save failure'));

    await expect(service.purgeDue(NOW)).rejects.toThrow('synthetic DB save failure');
    expect(sheet.imagePath).not.toBe(PURGED_IMAGE_PATH);
    expect(sheet.resultJson).not.toBeNull();

    await expect(service.purgeDue(NOW)).resolves.toBe(1);
    expect(storage.deleteImage).toHaveBeenCalledTimes(2);
    expect(storage.deleteWarpedImages).toHaveBeenCalledTimes(2);
  });

  it('keeps a DB-commit failure due and safely retries without a false purged marker', async () => {
    const sheet = makeSheet();
    let committed = sheet;
    let pendingSave: Sheet | null = null;
    let transactionAttempt = 0;
    const manager = {
      find: jest.fn(async () =>
        committed.imagePath === PURGED_IMAGE_PATH ? [] : [committed],
      ),
      save: jest.fn(async (_entity: typeof Sheet, saved: Sheet) => {
        pendingSave = saved;
        return saved;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (manager: EntityManager) => Promise<number>) => {
        pendingSave = null;
        const result = await work(manager as unknown as EntityManager);
        transactionAttempt += 1;
        if (transactionAttempt === 1) throw new Error('synthetic DB commit failure');
        if (pendingSave) committed = pendingSave;
        return result;
      }),
    };
    const storage = { deleteImage: jest.fn(), deleteWarpedImages: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(RETENTION_DAYS) };
    const service = new ScanRetentionService(
      dataSource as unknown as DataSource,
      storage as unknown as ScanStorageService,
      config as unknown as ConfigService<AppEnv, true>,
    );

    await expect(service.purgeDue(NOW)).rejects.toThrow('synthetic DB commit failure');
    expect(committed.imagePath).not.toBe(PURGED_IMAGE_PATH);
    expect(committed.resultJson).not.toBeNull();

    await expect(service.purgeDue(NOW)).resolves.toBe(1);
    expect(committed.imagePath).toBe(PURGED_IMAGE_PATH);
    expect(storage.deleteImage).toHaveBeenCalledTimes(2);
    expect(storage.deleteWarpedImages).toHaveBeenCalledTimes(2);
  });

  it('does not select an active scanner review while an artifact job is recoverable', async () => {
    const scannerSheet = makeSheet({
      scannerEventId: 'scanner-event-1',
      status: SheetStatus.FLAGGED,
      imagePath: null,
    });
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const sheetRepo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
    const manager = {
      getRepository: jest.fn().mockReturnValue(sheetRepo),
      find: jest.fn(),
      save: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (manager: EntityManager) => Promise<number>) => work(manager as unknown as EntityManager)),
    };
    const storage = { deleteImage: jest.fn(), deleteWarpedImages: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(RETENTION_DAYS) };
    const service = new ScanRetentionService(
      dataSource as unknown as DataSource,
      storage as unknown as ScanStorageService,
      config as unknown as ConfigService<AppEnv, true>,
    );

    await expect(service.purgeDue(NOW)).resolves.toBe(0);
    expect(queryBuilder.andWhere.mock.calls.some(([sql]) => String(sql).includes('scanner_artifact_jobs'))).toBe(true);
    expect(storage.deleteImage).not.toHaveBeenCalled();
    void scannerSheet;
  });

  it('purges manager-owned scanner artifact files only after a resolved review', async () => {
    const scannerSheet = makeSheet({
      scannerEventId: 'scanner-event-1',
      status: SheetStatus.VERIFIED,
      imagePath: 'scanner-artifacts/source.bin',
    });
    const artifactJob = {
      eventId: 'scanner-event-1',
      state: ScannerArtifactJobState.AVAILABLE,
      relativePath: 'scanner-artifacts/source.bin',
    };
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([scannerSheet]),
    };
    const sheetRepo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
    const manager = {
      getRepository: jest.fn().mockReturnValue(sheetRepo),
      find: jest.fn().mockResolvedValue([artifactJob]),
      findOne: jest.fn().mockResolvedValue(scannerSheet),
      save: jest.fn(async (_entity: unknown, value: unknown) => value),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (manager: EntityManager) => Promise<number>) => work(manager as unknown as EntityManager)),
    };
    const storage = { deleteImage: jest.fn(), deleteWarpedImages: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(RETENTION_DAYS) };
    const service = new ScanRetentionService(
      dataSource as unknown as DataSource,
      storage as unknown as ScanStorageService,
      config as unknown as ConfigService<AppEnv, true>,
    );

    await expect(service.purgeDue(NOW)).resolves.toBe(1);
    expect(manager.find.mock.invocationCallOrder[0]).toBeLessThan(manager.findOne.mock.invocationCallOrder[0]);
    expect(storage.deleteImage).toHaveBeenCalledWith('scanner-artifacts/source.bin');
    expect(artifactJob.state).toBe(ScannerArtifactJobState.PURGED);
    expect(artifactJob.relativePath).toBeNull();
  });

  it('rechecks scanner eligibility after locking jobs and the current sheet row', async () => {
    const selected = makeSheet({
      scannerEventId: 'scanner-event-2',
      status: SheetStatus.VERIFIED,
      imagePath: 'scanner-artifacts/stale-source.bin',
    });
    const current = makeSheet({
      ...selected,
      status: SheetStatus.FLAGGED,
    });
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([selected]),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue({ createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(current),
      save: jest.fn(),
    };
    const storage = { deleteImage: jest.fn(), deleteWarpedImages: jest.fn() };
    const service = new ScanRetentionService(
      { transaction: jest.fn(async (work: (manager: EntityManager) => Promise<number>) => work(manager as unknown as EntityManager)) } as unknown as DataSource,
      storage as unknown as ScanStorageService,
      { get: jest.fn().mockReturnValue(RETENTION_DAYS) } as unknown as ConfigService<AppEnv, true>,
    );

    await expect(service.purgeDue(NOW)).resolves.toBe(0);
    expect(manager.find.mock.invocationCallOrder[0]).toBeLessThan(manager.findOne.mock.invocationCallOrder[0]);
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('scan retention environment contract', () => {
  const required = {
    DATABASE_URL: 'postgresql://example.invalid/canteen',
    JWT_SECRET: 'synthetic-test-secret-that-is-at-least-32-characters',
    AGENT_TOKEN: 'synthetic-agent-token',
    SCANNER_CALLBACK_TOKEN: 'synthetic-callback-token',
    SCANNER_ARTIFACT_TOKEN: 'synthetic-artifact-token',
    SCANNER_ARTIFACT_ORIGIN: 'https://scanner.example.test',
    SCANNER_ARTIFACT_RETENTION_DAYS: '30',
  };

  it('rejects production startup without an owner-approved retention duration', () => {
    expect(() => validateEnv({ ...required, NODE_ENV: 'production' })).toThrow(
      /SCAN_RETENTION_DAYS is required in production/,
    );
  });

  it('accepts an explicit positive production duration and rejects zero', () => {
    expect(validateEnv({
      ...required,
      NODE_ENV: 'production',
      SCAN_RETENTION_DAYS: '30',
    }).SCAN_RETENTION_DAYS).toBe(30);

    expect(() => validateEnv({
      ...required,
      NODE_ENV: 'production',
      SCAN_RETENTION_DAYS: '0',
    })).toThrow(/SCAN_RETENTION_DAYS/);
  });

  it('requires explicit service-date bounds only when scanner workflow is enabled', () => {
    expect(() => validateEnv({
      ...required,
      NODE_ENV: 'production',
      SCAN_RETENTION_DAYS: '30',
      SCAN_WORKFLOW_MODE: 'scanner_shadow',
    })).toThrow(/SCANNER_SERVICE_DATE_MAX_PAST_DAYS/);

    expect(validateEnv({
      ...required,
      NODE_ENV: 'production',
      SCAN_RETENTION_DAYS: '30',
      SCAN_WORKFLOW_MODE: 'scanner_webhook',
      SCANNER_SERVICE_DATE_MAX_PAST_DAYS: '2',
      SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: '1',
    }).SCAN_WORKFLOW_MODE).toBe('scanner_webhook');
  });

  it('requires distinct scanner trust-boundary tokens and an HTTPS origin', () => {
    expect(() => validateEnv({
      ...required,
      NODE_ENV: 'production',
      SCAN_RETENTION_DAYS: '30',
      SCAN_WORKFLOW_MODE: 'scanner_webhook',
      SCANNER_SERVICE_DATE_MAX_PAST_DAYS: '2',
      SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: '1',
      SCANNER_CALLBACK_TOKEN: 'same-scanner-token-value',
      SCANNER_ARTIFACT_TOKEN: 'same-scanner-token-value',
      SCANNER_ARTIFACT_ORIGIN: 'https://scanner.example.test',
    })).toThrow(/must differ/);

    expect(() => validateEnv({
      ...required,
      NODE_ENV: 'production',
      SCAN_RETENTION_DAYS: '30',
      SCAN_WORKFLOW_MODE: 'scanner_webhook',
      SCANNER_SERVICE_DATE_MAX_PAST_DAYS: '2',
      SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: '1',
      SCANNER_CALLBACK_TOKEN: 'scanner-callback-token-value',
      SCANNER_ARTIFACT_TOKEN: 'scanner-artifact-token-value',
      SCANNER_ARTIFACT_ORIGIN: 'http://scanner.example.test',
    })).toThrow(/HTTPS origin/);
  });
});
