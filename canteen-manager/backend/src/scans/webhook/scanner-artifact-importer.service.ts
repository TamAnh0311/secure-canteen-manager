import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHash, randomUUID } from 'crypto';
import * as https from 'https';
import { DataSource } from 'typeorm';
import { AppEnv } from '../../config/env-validation';
import { ScanStorageCapacityError, ScanStorageService } from '../scan-storage.service';
import { Sheet } from '../sheet.entity';
import {
  ScannerArtifactJob,
  ScannerArtifactJobState,
} from './scanner-artifact-job.entity';
import { ScannerWebhookService } from './scanner-webhook.service';

const LEASE_MS = 60_000;

@Injectable()
export class ScannerArtifactImporterService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScannerArtifactImporterService.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly storage: ScanStorageService,
    private readonly webhook: ScannerWebhookService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('SCAN_WORKFLOW_MODE', { infer: true }) === 'legacy_omr') return;
    void this.processDue().catch((error: unknown) => {
      this.logger.error('Scanner artifact recovery sweep failed', error instanceof Error ? error.stack : String(error));
    });
  }

  @Cron('*/30 * * * * *')
  async processDue(limit = 10): Promise<number> {
    if (this.config.get('SCAN_WORKFLOW_MODE', { infer: true }) === 'legacy_omr') return 0;
    if (this.running) return 0;
    this.running = true;
    try {
      let processed = 0;
      while (processed < limit) {
        const [job] = await this.claimDue(1);
        if (!job) break;
        await this.processJob(job);
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private async claimDue(limit: number): Promise<ScannerArtifactJob[]> {
    return this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const jobs = await manager
        .getRepository(ScannerArtifactJob)
        .createQueryBuilder('job')
        .where(`(
          (job.state IN (:...waiting) AND job.next_attempt_at <= :now)
          OR
          (job.state = :processing AND job.lease_expires_at <= :now)
        )`, {
          waiting: [ScannerArtifactJobState.PENDING, ScannerArtifactJobState.RETRYING],
          now,
          processing: ScannerArtifactJobState.PROCESSING,
        })
        .orderBy('job.next_attempt_at', 'ASC')
        .take(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const job of jobs) {
        job.state = ScannerArtifactJobState.PROCESSING;
        job.attemptCount += 1;
        job.leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
        job.leaseToken = randomUUID();
        await manager.getRepository(ScannerArtifactJob).save(job);
      }
      return jobs;
    });
  }

  private async processJob(job: ScannerArtifactJob): Promise<void> {
    const policy = this.webhook.validateArtifactUrl(job.sourceUrl, job.artifactId);
    if (!policy.valid) {
      await this.finish(job, ScannerArtifactJobState.PERMANENT_FAILED, policy.code);
      return;
    }
    const token = this.config.get('SCANNER_ARTIFACT_TOKEN', { infer: true });
    if (!token) {
      await this.finish(job, ScannerArtifactJobState.PERMANENT_FAILED, 'ARTIFACT_TOKEN_NOT_CONFIGURED');
      return;
    }

    try {
      const response = await this.download(job.sourceUrl, token);
      if (response.status === 404) {
        if (this.retentionExpired(job)) {
          await this.finish(job, ScannerArtifactJobState.MISSING, 'ARTIFACT_RETENTION_EXPIRED');
        } else {
          await this.retry(job, 'ARTIFACT_NOT_YET_AVAILABLE');
        }
        return;
      }
      if (response.status === 401 || response.status === 403 || response.status >= 300 && response.status < 400) {
        await this.finish(job, ScannerArtifactJobState.PERMANENT_FAILED, 'ARTIFACT_ACCESS_DENIED');
        return;
      }
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        await this.retry(job, 'ARTIFACT_HTTP_RETRYABLE');
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        await this.finish(job, ScannerArtifactJobState.PERMANENT_FAILED, 'ARTIFACT_HTTP_REJECTED');
        return;
      }

      const bytes = response.bytes;
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== job.expectedSha256) {
        await this.finish(job, ScannerArtifactJobState.INTEGRITY_FAULT, 'ARTIFACT_HASH_MISMATCH');
        return;
      }
      const relativePath = this.storage.saveScannerArtifact(job.eventId, job.artifactId, bytes);
      await this.finish(job, ScannerArtifactJobState.AVAILABLE, null, relativePath);
    } catch (error) {
      if (error instanceof ArtifactIntegrityError) {
        await this.finish(job, ScannerArtifactJobState.INTEGRITY_FAULT, error.code);
        return;
      }
      if (error instanceof ScanStorageCapacityError) {
        await this.retry(job, 'ARTIFACT_STORAGE_HIGH_WATERMARK');
        return;
      }
      if (this.retentionExpired(job)) {
        await this.finish(job, ScannerArtifactJobState.PERMANENT_FAILED, 'ARTIFACT_RETENTION_EXPIRED');
        return;
      }
      await this.retry(job, 'ARTIFACT_NETWORK_RETRYABLE');
      this.logger.warn(`Scanner artifact import deferred after attempt ${job.attemptCount}`);
      void error;
    }
  }

  private async download(url: string, token: string): Promise<{ status: number; bytes: Buffer }> {
    const maxBytes = this.config.get('SCANNER_ARTIFACT_MAX_BYTES', { infer: true });
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.get('SCANNER_ARTIFACT_TIMEOUT_MS', { infer: true });
      const request = https.request(new URL(url), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        // agent:false prevents inherited proxy agents and keeps this direct to
        // the already origin-pinned scanner host. Redirects are never followed.
        agent: false,
        timeout: timeoutMs,
      }, (response) => {
        const declaredLength = Number(response.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.resume();
          reject(new ArtifactIntegrityError('ARTIFACT_TOO_LARGE'));
          return;
        }
        if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
          response.resume();
          resolve({ status: response.statusCode ?? 500, bytes: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            request.destroy(new ArtifactIntegrityError('ARTIFACT_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({
          status: response.statusCode ?? 500,
          bytes: Buffer.concat(chunks, total),
        }));
        response.on('error', reject);
      });
      const absoluteTimeout = setTimeout(
        () => request.destroy(new Error('ARTIFACT_TIMEOUT')),
        timeoutMs,
      );
      request.on('close', () => clearTimeout(absoluteTimeout));
      request.on('timeout', () => request.destroy(new Error('ARTIFACT_TIMEOUT')));
      request.on('error', reject);
      request.end();
    });
  }

  private async retry(job: ScannerArtifactJob, failureCode: string): Promise<void> {
    const delayMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(job.attemptCount - 1, 4));
    await this.finish(
      job,
      ScannerArtifactJobState.RETRYING,
      failureCode,
      null,
      new Date(Date.now() + delayMs),
    );
  }

  private retentionExpired(job: ScannerArtifactJob): boolean {
    const retentionDays = this.config.get('SCANNER_ARTIFACT_RETENTION_DAYS', { infer: true }) ?? 30;
    return Date.now() - job.sourceOccurredAt.getTime() >= retentionDays * 24 * 60 * 60 * 1000;
  }

  private async finish(
    claimed: ScannerArtifactJob,
    state: ScannerArtifactJobState,
    failureCode: string | null,
    relativePath: string | null = null,
    nextAttemptAt: Date | null = null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ScannerArtifactJob);
      if (!claimed.leaseToken) return;
      const completed = await repo.update({
        id: claimed.id,
        state: ScannerArtifactJobState.PROCESSING,
        leaseToken: claimed.leaseToken,
      }, {
        state,
        failureCode,
        ...(relativePath === null ? {} : { relativePath }),
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: nextAttemptAt ?? new Date(),
        availableAt: state === ScannerArtifactJobState.AVAILABLE ? new Date() : null,
      });
      if (completed.affected !== 1) return;
      if (state === ScannerArtifactJobState.AVAILABLE && relativePath && claimed.kind === 'source') {
        await manager.getRepository(Sheet).update(
          { scannerEventId: claimed.eventId },
          { imagePath: relativePath },
        );
      }
    });
  }
}

class ArtifactIntegrityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
