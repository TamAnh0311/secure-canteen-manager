import { EventEmitter } from 'events';
import * as https from 'https';
import { ClientRequest } from 'http';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppEnv } from '../../config/env-validation';
import { ScanStorageCapacityError, ScanStorageService } from '../scan-storage.service';
import { createHash } from 'crypto';
import { ScannerArtifactJob, ScannerArtifactJobState } from './scanner-artifact-job.entity';
import { ScannerArtifactImporterService } from './scanner-artifact-importer.service';
import { ScannerWebhookService } from './scanner-webhook.service';

jest.mock('https', () => ({ request: jest.fn() }));

function config(values: Record<string, unknown>): ConfigService<AppEnv, true> {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<AppEnv, true>;
}

function job(overrides: Partial<ScannerArtifactJob> = {}): ScannerArtifactJob {
  return {
    id: 'job-1',
    eventId: 'event-1',
    artifactId: 'source/page-0',
    kind: 'source',
    mediaType: 'image/png',
    sourceUrl: 'https://scanner.example.test/artifacts/source%2Fpage-0',
    expectedSha256: 'a'.repeat(64),
    sourceOccurredAt: new Date(),
    relativePath: null,
    state: ScannerArtifactJobState.PENDING,
    attemptCount: 0,
    nextAttemptAt: new Date(0),
    leaseExpiresAt: null,
    leaseToken: null,
    failureCode: null,
    availableAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ScannerArtifactJob;
}

describe('ScannerArtifactImporterService', () => {
  afterEach(() => {
    (https.request as unknown as jest.Mock).mockReset();
  });

  function build(values: Record<string, unknown> = {}) {
    const repo = {
      createQueryBuilder: jest.fn(),
      save: jest.fn(async (value: ScannerArtifactJob) => value),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repo) };
    const dataSource = {
      transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) => work(manager)),
    } as unknown as DataSource;
    const storage = {
      saveScannerArtifact: jest.fn().mockReturnValue('scanner-artifacts/path.bin'),
    } as unknown as ScanStorageService;
    const webhook = {
      validateArtifactUrl: jest.fn().mockReturnValue({ valid: true }),
    } as unknown as ScannerWebhookService;
    const service = new ScannerArtifactImporterService(
      dataSource,
      config({
        SCAN_WORKFLOW_MODE: 'scanner_webhook',
        SCANNER_ARTIFACT_TOKEN: 'artifact-token',
        SCANNER_ARTIFACT_MAX_BYTES: 32,
        SCANNER_ARTIFACT_TIMEOUT_MS: 25,
        SCANNER_ARTIFACT_RETENTION_DAYS: 30,
        ...values,
      }),
      storage,
      webhook,
    );
    return { service, dataSource, manager, repo, storage };
  }

  it('claims one due job immediately and reclaims only an expired lease', async () => {
    const { service, manager, repo } = build();
    const waiting = job({ state: ScannerArtifactJobState.PENDING });
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([waiting]),
    };
    repo.createQueryBuilder.mockReturnValue(queryBuilder);

    const claimed = await (service as unknown as { claimDue: (limit: number) => Promise<ScannerArtifactJob[]> }).claimDue(1);
    expect(claimed).toHaveLength(1);
    expect(waiting.state).toBe(ScannerArtifactJobState.PROCESSING);
    expect(waiting.leaseToken).toEqual(expect.any(String));
    expect(waiting.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(waiting.attemptCount).toBe(1);
    expect(manager.getRepository).toHaveBeenCalledWith(ScannerArtifactJob);

    const expired = job({
      state: ScannerArtifactJobState.PROCESSING,
      leaseExpiresAt: new Date(Date.now() - 1),
      leaseToken: 'old-token',
    });
    queryBuilder.getMany.mockResolvedValue([expired]);
    await (service as unknown as { claimDue: (limit: number) => Promise<ScannerArtifactJob[]> }).claimDue(1);
    expect(expired.leaseToken).not.toBe('old-token');
    expect(expired.attemptCount).toBe(1);
  });

  it('does not let a stale worker complete a reclaimed job', async () => {
    const { service, dataSource, repo } = build();
    const claimed = job({ state: ScannerArtifactJobState.PROCESSING, leaseToken: 'stale-token' });
    repo.update.mockResolvedValue({ affected: 0 });

    await (service as unknown as {
      finish: (job: ScannerArtifactJob, state: ScannerArtifactJobState, failure: string | null) => Promise<void>;
    }).finish(claimed, ScannerArtifactJobState.AVAILABLE, null);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith({
      id: claimed.id,
      state: ScannerArtifactJobState.PROCESSING,
      leaseToken: 'stale-token',
    }, expect.objectContaining({ state: ScannerArtifactJobState.AVAILABLE }));
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('uses direct HTTPS transport, sends the artifact token once, and never follows redirects', async () => {
    const { service } = build();
    class FakeRequest extends EventEmitter {
      destroyed = false;
      destroy(error?: Error): this {
        this.destroyed = true;
        if (error) this.emit('error', error);
        return this;
      }
      end(): void {}
    }
    class FakeResponse extends EventEmitter {
      statusCode = 302;
      headers: Record<string, string> = { location: 'https://evil.example.test/next' };
      resume = jest.fn();
    }
    const request = new FakeRequest();
    const response = new FakeResponse();
    const requestSpy = https.request as unknown as jest.Mock;
    requestSpy.mockImplementation(((url: URL, options: https.RequestOptions, callback: (response: FakeResponse) => void) => {
      expect(url.toString()).toContain('source%2Fpage-0');
      expect(options).toMatchObject({ method: 'GET', agent: false, headers: { Authorization: 'Bearer artifact-token' } });
      callback(response);
      return request as unknown as ClientRequest;
    }) as unknown as typeof https.request);

    await expect((service as unknown as { download: (url: string, token: string) => Promise<{ status: number; bytes: Buffer }> }).download(
      'https://scanner.example.test/artifacts/source%2Fpage-0',
      'artifact-token',
    )).resolves.toEqual({ status: 302, bytes: Buffer.alloc(0) });
    expect(response.resume).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a streamed response that exceeds the byte bound', async () => {
    const { service } = build({ SCANNER_ARTIFACT_MAX_BYTES: 4 });
    class FakeRequest extends EventEmitter {
      destroy(error?: Error): this {
        if (error) this.emit('error', error);
        return this;
      }
      end(): void {}
    }
    class FakeResponse extends EventEmitter {
      statusCode = 200;
      headers: Record<string, string> = {};
    }
    const request = new FakeRequest();
    const response = new FakeResponse();
    const requestSpy = https.request as unknown as jest.Mock;
    requestSpy.mockImplementation(((_url: URL, _options: https.RequestOptions, callback: (response: FakeResponse) => void) => {
      callback(response);
      process.nextTick(() => {
        response.emit('data', Buffer.from('12345'));
      });
      return request as unknown as ClientRequest;
    }) as unknown as typeof https.request);

    await expect((service as unknown as { download: (url: string, token: string) => Promise<unknown> }).download(
      'https://scanner.example.test/artifacts/source%2Fpage-0', 'artifact-token',
    )).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
  });

  it('uses an absolute timeout for a stalled response', async () => {
    const { service } = build({ SCANNER_ARTIFACT_TIMEOUT_MS: 1 });
    class FakeRequest extends EventEmitter {
      destroy(error?: Error): this {
        if (error) this.emit('error', error);
        return this;
      }
      end(): void {}
    }
    const request = new FakeRequest();
    const requestSpy = https.request as unknown as jest.Mock;
    requestSpy.mockImplementation(((options: https.RequestOptions, _callback: unknown) => request as unknown as ClientRequest) as unknown as typeof https.request);
    await expect((service as unknown as { download: (url: string, token: string) => Promise<unknown> }).download(
      'https://scanner.example.test/artifacts/source%2Fpage-0', 'artifact-token',
    )).rejects.toThrow('ARTIFACT_TIMEOUT');
  });

  it('retries a 404 before scanner retention and marks it missing after retention', async () => {
    const { service } = build({ SCANNER_ARTIFACT_RETENTION_DAYS: 30 });
    const retry = jest.spyOn(service as any, 'retry').mockResolvedValue(undefined);
    const finish = jest.spyOn(service as any, 'finish').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'download').mockResolvedValue({ status: 404, bytes: Buffer.alloc(0) });

    await (service as unknown as { processJob: (job: ScannerArtifactJob) => Promise<void> }).processJob(job({ sourceOccurredAt: new Date() }));
    expect(retry).toHaveBeenCalledWith(expect.anything(), 'ARTIFACT_NOT_YET_AVAILABLE');

    retry.mockClear();
    finish.mockClear();
    await (service as unknown as { processJob: (job: ScannerArtifactJob) => Promise<void> }).processJob(job({
      sourceOccurredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    }));
    expect(finish).toHaveBeenCalledWith(expect.anything(), ScannerArtifactJobState.MISSING, 'ARTIFACT_RETENTION_EXPIRED');
  });

  it('retries when the shared scan store reaches its high watermark', async () => {
    const { service, storage } = build();
    const bytes = Buffer.from('artifact');
    jest.spyOn(service as any, 'download').mockResolvedValue({ status: 200, bytes });
    (storage.saveScannerArtifact as jest.Mock).mockImplementation(() => {
      throw new ScanStorageCapacityError();
    });
    const retry = jest.spyOn(service as any, 'retry').mockResolvedValue(undefined);

    await (service as unknown as { processJob: (job: ScannerArtifactJob) => Promise<void> }).processJob(job({
      expectedSha256: createHash('sha256').update(bytes).digest('hex'),
    }));

    expect(retry).toHaveBeenCalledWith(expect.anything(), 'ARTIFACT_STORAGE_HIGH_WATERMARK');
  });
});
