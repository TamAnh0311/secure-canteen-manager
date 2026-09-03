import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppEnv } from '../../config/env-validation';
import { todayInDeployTz } from '../../common/today-in-tz';
import { OmrOperationalFormMode, ScanAdmissionSource, Sheet } from '../sheet.entity';
import { SheetStatus } from '../sheet-status.enum';
import {
  parseScannerCallback,
  ScannerArtifactReference,
  ScannerCallbackPayload,
} from './scanner-webhook.dto';
import {
  ScannerWebhookEvent,
  ScannerWebhookEventState,
} from './scanner-webhook-event.entity';
import {
  ScannerArtifactJob,
  ScannerArtifactJobState,
} from './scanner-artifact-job.entity';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';

export interface ScannerWebhookReceipt {
  eventId: string;
  state: ScannerWebhookEventState;
  duplicate: boolean;
  quarantined: boolean;
}

interface PersistedReceipt extends ScannerWebhookReceipt {
  integrityFault?: boolean;
}

@Injectable()
export class ScannerWebhookService {
  private readonly logger = new Logger(ScannerWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly workflowMode: ScanWorkflowModeService,
  ) {}

  async ingest(rawBody: Buffer, idempotencyHeader: string | undefined): Promise<ScannerWebhookReceipt> {
    const payload = parseScannerCallback(
      rawBody,
      this.config.get('SCANNER_WEBHOOK_MAX_PAYLOAD_BYTES', { infer: true }),
    );
    if (!idempotencyHeader || idempotencyHeader !== payload.idempotency_key) {
      throw new ConflictException({
        code: 'SCANNER.IDEMPOTENCY_MISMATCH',
        message: 'Idempotency-Key does not match the callback body',
      });
    }

    const payloadSha256 = createHash('sha256').update(rawBody).digest('hex');
    let receipt: PersistedReceipt;
    try {
      receipt = await this.dataSource.transaction((manager) =>
        this.persistReceipt(manager, payload, rawBody, payloadSha256),
      );
    } catch (error) {
      this.logger.error('Scanner callback receipt transaction failed', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException({
        code: 'SCANNER.RECEIPT_UNAVAILABLE',
        message: 'Scanner callback could not be durably recorded',
      });
    }
    if (receipt.integrityFault) {
      throw new ConflictException({
        code: 'SCANNER.INTEGRITY_FAULT',
        message: 'Event ID was received with different payload bytes',
      });
    }
    return receipt;
  }

  private async persistReceipt(
    manager: EntityManager,
    payload: ScannerCallbackPayload,
    rawBody: Buffer,
    payloadSha256: string,
  ): Promise<PersistedReceipt> {
    const events = manager.getRepository(ScannerWebhookEvent);
    const jobs = manager.getRepository(ScannerArtifactJob);
    const existing = await events.findOne({
      where: { eventId: payload.event_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) {
      if (existing.payloadSha256 === payloadSha256 && existing.rawPayload.equals(rawBody)) {
        return {
          eventId: existing.eventId,
          state: existing.state,
          duplicate: true,
          quarantined: existing.state === ScannerWebhookEventState.QUARANTINED,
        };
      }
      existing.state = ScannerWebhookEventState.INTEGRITY_FAULT;
      existing.faultCode = 'PAYLOAD_CHANGED_FOR_EVENT_ID';
      await events.save(existing);
      return {
        eventId: existing.eventId,
        state: existing.state,
        duplicate: false,
        quarantined: true,
        integrityFault: true,
      };
    }

    // Lock the delivery identity before the business key. This closes the race
    // where the same event ID is replayed with different document metadata.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `event:${payload.event_id}`,
    ]);
    const eventAfterEventLock = await events.findOne({
      where: { eventId: payload.event_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (eventAfterEventLock) {
      if (eventAfterEventLock.payloadSha256 === payloadSha256 && eventAfterEventLock.rawPayload.equals(rawBody)) {
        return {
          eventId: eventAfterEventLock.eventId,
          state: eventAfterEventLock.state,
          duplicate: true,
          quarantined: eventAfterEventLock.state === ScannerWebhookEventState.QUARANTINED,
        };
      }
      eventAfterEventLock.state = ScannerWebhookEventState.INTEGRITY_FAULT;
      eventAfterEventLock.faultCode = 'PAYLOAD_CHANGED_FOR_EVENT_ID';
      await events.save(eventAfterEventLock);
      return {
        eventId: eventAfterEventLock.eventId,
        state: eventAfterEventLock.state,
        duplicate: false,
        quarantined: true,
        integrityFault: true,
      };
    }

    // A scanner revision is a business identity independent of delivery IDs.
    // A second event for the same document/revision must not create another
    // review/evidence record. Serialize this key so two new event IDs cannot
    // both observe an empty result set and enqueue duplicate artifact jobs.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${payload.result.document_id}:${payload.result.revision}`,
    ]);
    // Another delivery with the same event ID may have committed while this
    // transaction waited for the business-key lock. Re-read the event before
    // inserting so the loser follows the same idempotent path instead of
    // surfacing a unique-constraint error as a retryable outage.
    const eventAfterBusinessLock = await events.findOne({
      where: { eventId: payload.event_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (eventAfterBusinessLock) {
      if (eventAfterBusinessLock.payloadSha256 === payloadSha256 && eventAfterBusinessLock.rawPayload.equals(rawBody)) {
        return {
          eventId: eventAfterBusinessLock.eventId,
          state: eventAfterBusinessLock.state,
          duplicate: true,
          quarantined: eventAfterBusinessLock.state === ScannerWebhookEventState.QUARANTINED,
        };
      }
      eventAfterBusinessLock.state = ScannerWebhookEventState.INTEGRITY_FAULT;
      eventAfterBusinessLock.faultCode = 'PAYLOAD_CHANGED_FOR_EVENT_ID';
      await events.save(eventAfterBusinessLock);
      return {
        eventId: eventAfterBusinessLock.eventId,
        state: eventAfterBusinessLock.state,
        duplicate: false,
        quarantined: true,
        integrityFault: true,
      };
    }
    const existingResult = await events.findOne({
      where: { documentId: payload.result.document_id, revision: payload.result.revision },
    });
    const serviceDateState = this.serviceDateState(payload.result.service_date);
    const duplicateBusinessResult = Boolean(existingResult);
    const event = events.create({
      eventId: payload.event_id,
      idempotencyKey: payload.idempotency_key,
      payloadSha256,
      payloadLength: rawBody.length,
      rawPayload: rawBody,
      payloadJson: payload,
      schemaVersion: payload.schema_version,
      eventType: payload.event_type,
      occurredAt: new Date(payload.occurred_at),
      documentId: payload.result.document_id,
      revision: payload.result.revision,
      serviceDate: payload.result.service_date,
      outcome: payload.result.outcome,
      state: serviceDateState.quarantined || duplicateBusinessResult
        ? ScannerWebhookEventState.QUARANTINED
        : ScannerWebhookEventState.RECEIVED,
      faultCode: duplicateBusinessResult
        ? 'DUPLICATE_BUSINESS_RESULT'
        : serviceDateState.faultCode,
    });
    const saved = await events.save(event);

    if (!serviceDateState.quarantined && !duplicateBusinessResult && this.workflowMode.scannerReviewEnabled) {
      const now = new Date();
      await manager.getRepository(Sheet).save(manager.getRepository(Sheet).create({
        sheetId: payload.result.result_id,
        batch: null,
        serviceDate: payload.result.service_date,
        checksum: payloadSha256,
        imagePath: null,
        scannerEventId: saved.id,
        status: SheetStatus.FLAGGED,
        resultJson: payload.result,
        avgConfidence: null,
        recognizedId: null,
        matchedUserId: null,
        issuedFormId: null,
        templateId: null,
        admittedAt: now,
        admissionSource: ScanAdmissionSource.SCANNER,
        admittedMode: OmrOperationalFormMode.SCANNER,
        admittedGeneration: payload.schema_version,
        admittedBy: null,
        identityRouteZone: null,
        identityEvidenceJson: null,
        rankedCandidatesJson: null,
        proposedUserId: null,
        identitySelectedBy: null,
        identitySelectedAt: null,
        identitySelectionSource: null,
        identitySelectionReason: null,
        identityEvidencePurgedAt: null,
        purgeGeneration: 0,
        rejectionCode: null,
        processingAttempts: 0,
        nextRetryAt: null,
        lastErrorCode: null,
        orderId: null,
        flags: [`SCANNER_${payload.result.outcome.toUpperCase()}`],
        processedAt: now,
      }));
      for (const artifact of payload.result.artifacts) {
        await jobs.save(jobs.create(this.toArtifactJob(saved, artifact)));
      }
    }

    return {
      eventId: saved.eventId,
      state: saved.state,
      duplicate: false,
      quarantined: saved.state === ScannerWebhookEventState.QUARANTINED,
    };
  }

  private toArtifactJob(
    event: ScannerWebhookEvent,
    artifact: ScannerArtifactReference,
  ): Partial<ScannerArtifactJob> {
    const urlPolicy = this.validateArtifactUrl(artifact.url, artifact.artifact_id);
    return {
      eventId: event.id,
      artifactId: artifact.artifact_id,
      kind: artifact.kind,
      mediaType: artifact.media_type,
      sourceUrl: artifact.url,
      expectedSha256: artifact.sha256,
      sourceOccurredAt: event.occurredAt,
      state: urlPolicy.valid
        ? ScannerArtifactJobState.PENDING
        : ScannerArtifactJobState.PERMANENT_FAILED,
      failureCode: urlPolicy.valid ? null : urlPolicy.code,
      nextAttemptAt: new Date(),
    };
  }

  validateArtifactUrl(url: string, artifactId: string): { valid: true } | { valid: false; code: string } {
    const configuredOrigin = this.config.get('SCANNER_ARTIFACT_ORIGIN', { infer: true });
    if (!configuredOrigin) return { valid: false, code: 'ARTIFACT_ORIGIN_NOT_CONFIGURED' };
    try {
      const parsed = new URL(url);
      const origin = new URL(configuredOrigin);
      const expectedPath = `/artifacts/${encodeURIComponent(artifactId)}`;
      if (
        parsed.protocol !== 'https:' ||
        parsed.origin !== origin.origin ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== expectedPath
      ) {
        return { valid: false, code: 'ARTIFACT_URL_REJECTED' };
      }
      return { valid: true };
    } catch {
      return { valid: false, code: 'ARTIFACT_URL_INVALID' };
    }
  }

  private serviceDateState(serviceDate: string): { quarantined: boolean; faultCode: string | null } {
    const today = todayInDeployTz();
    const difference = this.dateDifference(today, serviceDate);
    const maxPast = this.config.get('SCANNER_SERVICE_DATE_MAX_PAST_DAYS', { infer: true });
    const maxFuture = this.config.get('SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS', { infer: true });
    const outOfWindow =
      (maxPast !== undefined && difference < -maxPast) ||
      (maxFuture !== undefined && difference > maxFuture);
    return {
      quarantined: outOfWindow,
      faultCode: outOfWindow ? 'SERVICE_DATE_OUT_OF_WINDOW' : null,
    };
  }

  private dateDifference(from: string, to: string): number {
    const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
    const [toYear, toMonth, toDay] = to.split('-').map(Number);
    return Math.round(
      (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) /
        (24 * 60 * 60 * 1000),
    );
  }
}
