import { ConfigService } from '@nestjs/config';
import { statfsSync } from 'fs';
import { Repository } from 'typeorm';
import { AppEnv } from '../../config/env-validation';
import { ScanAdmissionService } from '../scan-admission.service';
import { Sheet } from '../sheet.entity';

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  statfsSync: jest.fn(),
}));

const statfs = statfsSync as jest.MockedFunction<typeof statfsSync>;

function build(overrides: Partial<Record<keyof AppEnv, unknown>> = {}, pending = 0) {
  return buildHarness(overrides, pending).service;
}

function buildHarness(overrides: Partial<Record<keyof AppEnv, unknown>> = {}, pending = 0) {
  const values: Partial<Record<keyof AppEnv, unknown>> = {
    SCAN_RATE_LIMIT_PER_MINUTE: 60,
    SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 2,
    SCAN_MAX_PENDING: 500,
    SCAN_STORAGE_HIGH_WATERMARK: 0.9,
    SCAN_STORAGE_DIR: '/synthetic/scans',
    ...overrides,
  };
  const repo = { count: jest.fn().mockResolvedValue(pending) };
  const config = { get: jest.fn((key: keyof AppEnv) => values[key]) };
  statfs.mockReturnValue({ blocks: 100n, bavail: 50n } as ReturnType<typeof statfsSync>);
  const service = new ScanAdmissionService(
    repo as unknown as Repository<Sheet>,
    config as unknown as ConfigService<AppEnv, true>,
  );
  return { service, repo };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ScanAdmissionService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rate-limits each credential independently', async () => {
    const service = build({ SCAN_RATE_LIMIT_PER_MINUTE: 1 });
    (await service.enter('operator:a'))();

    await expect(service.enter('operator:a')).rejects.toMatchObject({
      status: 429,
      response: { code: 'SCAN.RATE_LIMITED' },
    });
    await expect(service.enter('operator:b')).resolves.toEqual(expect.any(Function));
  });

  it('atomically admits exactly one simultaneous upload at per-credential concurrency one', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 10,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
    });
    const countStarted = deferred<void>();
    const countGate = deferred<number>();
    repo.count.mockImplementation(() => {
      countStarted.resolve();
      return countGate.promise;
    });

    const attempts = [service.enter('hardware-agent'), service.enter('hardware-agent')];
    await countStarted.promise;
    countGate.resolve(0);
    const results = await Promise.allSettled(attempts);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      status: 429,
      response: { code: 'SCAN.CONCURRENCY_LIMITED' },
    });
    const admitted = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<() => void>;
    admitted.value();
  });

  it('atomically records exactly one simultaneous rate admission for the same credential', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 1,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 10,
    });
    const countStarted = deferred<void>();
    const countGate = deferred<number>();
    repo.count.mockImplementation(() => {
      countStarted.resolve();
      return countGate.promise;
    });

    const attempts = [service.enter('operator:a'), service.enter('operator:a')];
    await countStarted.promise;
    countGate.resolve(0);
    const results = await Promise.allSettled(attempts);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      status: 429,
      response: { code: 'SCAN.RATE_LIMITED' },
    });
    const admitted = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<() => void>;
    admitted.value();
  });

  it('does not serialize or share limits across distinct credentials', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 1,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
    });
    const countStarted = deferred<void>();
    const countGate = deferred<number>();
    repo.count.mockImplementation(() => {
      if (repo.count.mock.calls.length === 2) countStarted.resolve();
      return countGate.promise;
    });

    const attempts = [service.enter('operator:a'), service.enter('operator:b')];
    await countStarted.promise;
    countGate.resolve(0);
    const results = await Promise.allSettled(attempts);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    for (const result of results as Array<PromiseFulfilledResult<() => void>>) result.value();
  });

  it('atomically reserves the final pending slot across distinct credentials', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 10,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
      SCAN_MAX_PENDING: 2,
    });
    const countStarted = deferred<void>();
    const countGate = deferred<number>();
    repo.count.mockImplementation(() => {
      if (repo.count.mock.calls.length === 2) countStarted.resolve();
      return countGate.promise;
    });

    const attempts = [service.enter('operator:a'), service.enter('operator:b')];
    await countStarted.promise;
    countGate.resolve(1);
    const results = await Promise.allSettled(attempts);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      status: 503,
      response: { code: 'SCAN.QUEUE_FULL' },
    });
    const admitted = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<() => void>;
    admitted.value();
  });

  it('keeps a released reservation visible to an overlapping stale pending count', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 10,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
      SCAN_MAX_PENDING: 2,
    });
    repo.count.mockResolvedValue(0);
    const leaveA = await service.enter('operator:a');
    const leaveB = await service.enter('operator:b');

    const staleCountStarted = deferred<void>();
    const staleCountGate = deferred<number>();
    repo.count.mockImplementationOnce(() => {
      staleCountStarted.resolve();
      return staleCountGate.promise;
    });
    const thirdAttempt = service.enter('operator:c');
    await staleCountStarted.promise;

    // A has persisted and releases, but C's count snapshot predates that persisted row.
    leaveA();
    staleCountGate.resolve(0);
    await expect(thirdAttempt).rejects.toMatchObject({
      status: 503,
      response: { code: 'SCAN.QUEUE_FULL' },
    });
    leaveB();
  });

  it('releases the per-credential concurrency slot after request completion', async () => {
    const service = build({
      SCAN_RATE_LIMIT_PER_MINUTE: 10,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
    });
    const leave = await service.enter('hardware-agent');
    await expect(service.enter('hardware-agent')).rejects.toMatchObject({
      status: 429,
      response: { code: 'SCAN.CONCURRENCY_LIMITED' },
    });

    leave();
    await expect(service.enter('hardware-agent')).resolves.toEqual(expect.any(Function));
  });

  it('rejects admission when the persisted pending queue reaches its ceiling', async () => {
    const service = build({ SCAN_MAX_PENDING: 500 }, 500);

    await expect(service.enter('operator:a')).rejects.toMatchObject({
      status: 503,
      response: { code: 'SCAN.QUEUE_FULL' },
    });
  });

  it('does not consume rate or concurrency when the queue check rejects admission', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 1,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
      SCAN_MAX_PENDING: 1,
    });
    repo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.enter('operator:a')).rejects.toMatchObject({
      status: 503,
      response: { code: 'SCAN.QUEUE_FULL' },
    });
    const leave = await service.enter('operator:a');
    leave();
  });

  it('releases the credential lock when the queue check throws', async () => {
    const { service, repo } = buildHarness({
      SCAN_RATE_LIMIT_PER_MINUTE: 1,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
    });
    repo.count.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(0);

    await expect(service.enter('operator:a')).rejects.toThrow('database unavailable');
    const leave = await service.enter('operator:a');
    leave();
  });

  it('rejects admission at the configured storage high-watermark', async () => {
    const service = build({ SCAN_STORAGE_HIGH_WATERMARK: 0.9 });
    statfs.mockReturnValue({ blocks: 100n, bavail: 10n } as ReturnType<typeof statfsSync>);

    await expect(service.enter('operator:a')).rejects.toMatchObject({
      status: 503,
      response: { code: 'SCAN.STORAGE_HIGH_WATERMARK' },
    });
  });

  it('does not consume rate or concurrency when the disk check rejects admission', async () => {
    const service = build({
      SCAN_RATE_LIMIT_PER_MINUTE: 1,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
      SCAN_STORAGE_HIGH_WATERMARK: 0.9,
    });
    statfs
      .mockReturnValueOnce({ blocks: 100n, bavail: 10n } as ReturnType<typeof statfsSync>)
      .mockReturnValueOnce({ blocks: 100n, bavail: 50n } as ReturnType<typeof statfsSync>);

    await expect(service.enter('operator:a')).rejects.toMatchObject({
      status: 503,
      response: { code: 'SCAN.STORAGE_HIGH_WATERMARK' },
    });
    const leave = await service.enter('operator:a');
    leave();
  });

  it('releases the credential lock when the disk check throws', async () => {
    const service = build({
      SCAN_RATE_LIMIT_PER_MINUTE: 1,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
    });
    statfs
      .mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      })
      .mockReturnValueOnce({ blocks: 100n, bavail: 50n } as ReturnType<typeof statfsSync>);

    await expect(service.enter('operator:a')).rejects.toThrow('storage unavailable');
    const leave = await service.enter('operator:a');
    leave();
  });

  it('returns an idempotent release that cannot drive active slots negative', async () => {
    const service = build({
      SCAN_RATE_LIMIT_PER_MINUTE: 10,
      SCAN_MAX_CONCURRENT_PER_CREDENTIAL: 1,
    });
    const firstLeave = await service.enter('operator:a');
    firstLeave();

    const secondLeave = await service.enter('operator:a');
    // A stale duplicate release must not decrement this newer admission.
    firstLeave();
    await expect(service.enter('operator:a')).rejects.toMatchObject({
      status: 429,
      response: { code: 'SCAN.CONCURRENCY_LIMITED' },
    });
    secondLeave();
  });
});
