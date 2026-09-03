import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ScannerArtifactJob } from './scanner-artifact-job.entity';
import { ScannerWebhookEvent, ScannerWebhookEventState } from './scanner-webhook-event.entity';
import { ScannerWebhookService } from './scanner-webhook.service';
import { Sheet } from '../sheet.entity';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';
import { todayInDeployTz } from '../../common/today-in-tz';

function callback(serviceDate: string): Buffer {
  return Buffer.from(JSON.stringify({
    event_id: 'evt_test',
    event_type: 'order_scan.result',
    idempotency_key: 'order-scanner/v1/doc_test/1',
    occurred_at: '2026-08-06T00:00:00Z',
    schema_version: '1.0-draft',
    result: {
      result_id: 'res_test', document_id: 'doc_test', page_index: 0, revision: 1,
      service_date: serviceDate, outcome: 'needs_review', artifacts: [], items: [], versions: {},
    },
  }));
}

describe('ScannerWebhookService', () => {
  const inWindowServiceDate = todayInDeployTz();
  const config = {
    get: jest.fn((key: string) => ({
      SCANNER_WEBHOOK_MAX_PAYLOAD_BYTES: 512 * 1024,
      SCANNER_SERVICE_DATE_MAX_PAST_DAYS: 2,
      SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: 2,
      SCANNER_ARTIFACT_ORIGIN: 'https://scanner.example.test',
    })[key]),
  } as unknown as ConfigService<any, true>;

  function build(existing?: ScannerWebhookEvent, scannerReviewEnabled = true) {
    const savedEvents: ScannerWebhookEvent[] = [];
    const savedJobs: ScannerArtifactJob[] = [];
    const savedSheets: Sheet[] = [];
    const eventRepo = {
      findOne: jest.fn().mockResolvedValue(existing ?? null),
      create: jest.fn((value: Partial<ScannerWebhookEvent>) => value as ScannerWebhookEvent),
      save: jest.fn(async (value: ScannerWebhookEvent) => {
        const saved = { ...value, id: value.id ?? 'event-1' } as ScannerWebhookEvent;
        savedEvents.push(saved);
        return saved;
      }),
    };
    const jobRepo = {
      create: jest.fn((value: Partial<ScannerArtifactJob>) => value as ScannerArtifactJob),
      save: jest.fn(async (value: ScannerArtifactJob) => {
        savedJobs.push(value);
        return value;
      }),
    };
    const sheetRepo = {
      create: jest.fn((value: Partial<Sheet>) => value as Sheet),
      save: jest.fn(async (value: Sheet) => {
        savedSheets.push(value);
        return value;
      }),
    };
    const manager = {
      getRepository: (entity: unknown) => entity === ScannerWebhookEvent
        ? eventRepo
        : entity === ScannerArtifactJob ? jobRepo : sheetRepo,
      query: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) => work(manager)),
    } as unknown as DataSource;
    const workflowMode = { scannerReviewEnabled } as ScanWorkflowModeService;
    return { service: new ScannerWebhookService(dataSource, config, workflowMode), eventRepo, jobRepo, savedEvents, savedJobs, savedSheets };
  }

  it('stores a receipt and creates artifact jobs in one transaction', async () => {
    const { service, eventRepo, savedEvents, savedSheets } = build();
    const result = await service.ingest(callback(inWindowServiceDate), 'order-scanner/v1/doc_test/1');
    expect(result).toMatchObject({ eventId: 'evt_test', duplicate: false, quarantined: false });
    expect(eventRepo.save).toHaveBeenCalledTimes(1);
    expect(savedEvents[0].rawPayload).toBeInstanceOf(Buffer);
    expect(savedSheets).toHaveLength(1);
    expect(savedSheets[0].status).toBe('flagged');
  });

  it('returns success for identical retries and quarantines changed bytes', async () => {
    const first = build();
    await first.service.ingest(callback(inWindowServiceDate), 'order-scanner/v1/doc_test/1');
    const existing = first.savedEvents[0];
    const retry = build(existing);
    await expect(retry.service.ingest(callback(inWindowServiceDate), 'order-scanner/v1/doc_test/1')).resolves.toMatchObject({ duplicate: true });

    const changed = build(existing);
    await expect(changed.service.ingest(callback('2026-08-07'), 'order-scanner/v1/doc_test/1')).rejects.toThrow(ConflictException);
    expect(existing.state).toBe(ScannerWebhookEventState.INTEGRITY_FAULT);
  });

  it('rechecks the event ID after waiting for the business lock', async () => {
    const first = build();
    await first.service.ingest(callback(inWindowServiceDate), 'order-scanner/v1/doc_test/1');
    const existing = first.savedEvents[0];
    const waiting = build();
    waiting.eventRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    await expect(waiting.service.ingest(callback(inWindowServiceDate), 'order-scanner/v1/doc_test/1'))
      .resolves.toMatchObject({ duplicate: true });
    expect(waiting.eventRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a header/body idempotency mismatch before persistence', async () => {
    const { service, eventRepo } = build();
    await expect(service.ingest(callback(inWindowServiceDate), 'wrong-key')).rejects.toThrow(ConflictException);
    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('stores out-of-window evidence without creating a review sheet or artifact jobs', async () => {
    const { service, savedSheets, savedJobs } = build();
    const result = await service.ingest(callback('2020-01-01'), 'order-scanner/v1/doc_test/1');
    expect(result.quarantined).toBe(true);
    expect(savedSheets).toHaveLength(0);
    expect(savedJobs).toHaveLength(0);
  });

  it('stores legacy-mode receipts without creating scanner review or artifact work', async () => {
    const { service, savedEvents, savedSheets, savedJobs } = build(undefined, false);
    await expect(service.ingest(callback(inWindowServiceDate), 'order-scanner/v1/doc_test/1'))
      .resolves.toMatchObject({ duplicate: false, quarantined: false });
    expect(savedEvents).toHaveLength(1);
    expect(savedSheets).toHaveLength(0);
    expect(savedJobs).toHaveLength(0);
  });

  it('rejects artifact URLs outside the configured origin and exact path', () => {
    const { service } = build();
    expect(service.validateArtifactUrl('https://scanner.example.test/artifacts/a', 'a')).toEqual({ valid: true });
    expect(service.validateArtifactUrl('https://evil.example.test/artifacts/a', 'a')).toMatchObject({ valid: false });
    expect(service.validateArtifactUrl('https://scanner.example.test/artifacts/a?token=secret', 'a')).toMatchObject({ valid: false });
    expect(service.validateArtifactUrl('https://scanner.example.test/artifacts/a/extra', 'a')).toMatchObject({ valid: false });
  });
});
