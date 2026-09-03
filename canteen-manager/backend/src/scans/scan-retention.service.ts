import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager, In, LessThanOrEqual, Not } from 'typeorm';
import { AppEnv } from '../config/env-validation';
import { Sheet } from './sheet.entity';
import { SheetStatus } from './sheet-status.enum';
import { ScanStorageService } from './scan-storage.service';
import { ScannerArtifactJob, ScannerArtifactJobState } from './webhook/scanner-artifact-job.entity';

export const PURGED_IMAGE_PATH = '__purged__';
const RETENTION_BATCH_SIZE = 100;
const TERMINAL_STATUSES = [
  SheetStatus.AUTO_ACCEPTED,
  SheetStatus.FLAGGED,
  SheetStatus.VERIFIED,
  SheetStatus.REJECTED,
];

@Injectable()
export class ScanRetentionService {
  private readonly logger = new Logger(ScanRetentionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: ScanStorageService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  @Cron('0 30 2 * * *')
  async purgeDue(now = new Date()): Promise<number> {
    const retentionDays = this.config.get('SCAN_RETENTION_DAYS', { infer: true });
    if (!retentionDays) return 0;
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    let purged = 0;
    let batchSize: number;
    do {
      batchSize = await this.dataSource.transaction((manager) => this.purgeBatch(manager, cutoff));
      purged += batchSize;
    } while (batchSize === RETENTION_BATCH_SIZE);

    if (purged > 0) this.logger.log(`Purged sensitive scan artifacts for ${purged} sheet(s)`);
    return purged;
  }

  private async purgeBatch(manager: EntityManager, cutoff: Date): Promise<number> {
    const usesRepositoryQuery = typeof (manager as EntityManager & { getRepository?: unknown }).getRepository === 'function';
    const candidates = usesRepositoryQuery
      ? await manager
        .getRepository(Sheet)
        .createQueryBuilder('sheet')
        .where('sheet.status IN (:...terminalStatuses)', { terminalStatuses: TERMINAL_STATUSES })
        .andWhere('sheet.processedAt <= :cutoff', { cutoff })
        .andWhere('(sheet.imagePath IS NULL OR sheet.imagePath <> :purgedPath)', {
          purgedPath: PURGED_IMAGE_PATH,
        })
        // Scanner rows remain active while they are flagged or while any declared
        // artifact is still recoverable. Only a resolved scanner review can expire.
        .andWhere(`(
          sheet.scannerEventId IS NULL
          OR (
            sheet.status IN (:...scannerTerminalStatuses)
            AND NOT EXISTS (
              SELECT 1
              FROM scanner_artifact_jobs artifact_job
              WHERE artifact_job.event_id = sheet.scannerEventId
                AND artifact_job.state IN ('pending', 'processing', 'retrying')
            )
          )
        )`, {
          scannerTerminalStatuses: [SheetStatus.VERIFIED, SheetStatus.REJECTED],
        })
        .orderBy('sheet.processedAt', 'ASC')
        .take(RETENTION_BATCH_SIZE)
        .getMany()
      : await manager.find(Sheet, {
        where: {
          status: In(TERMINAL_STATUSES),
          processedAt: LessThanOrEqual(cutoff),
          imagePath: Not(PURGED_IMAGE_PATH),
        },
        order: { processedAt: 'ASC' },
        take: RETENTION_BATCH_SIZE,
        lock: { mode: 'pessimistic_write' },
      });

    let purged = 0;
    for (const candidate of candidates) {
      // Scanner confirmation and artifact promotion both lock artifact jobs
      // before touching the sheet. Match that order so retention cannot form a
      // sheet<->job deadlock with either path.
      const artifactJobs = usesRepositoryQuery && candidate.scannerEventId
        ? await manager.find(ScannerArtifactJob, {
          where: { eventId: candidate.scannerEventId },
          lock: { mode: 'pessimistic_write' },
        })
        : [];
      const sheet = usesRepositoryQuery
        ? await manager.findOne(Sheet, {
          where: { id: candidate.id },
          lock: { mode: 'pessimistic_write' },
        })
        : candidate;
      if (!sheet || !this.isPurgeEligible(sheet, cutoff, artifactJobs)) continue;

      // Filesystem and PostgreSQL cannot commit atomically. Delete files first so the DB
      // never claims data was purged while files remain. If save/commit then fails, the
      // row stays due; deletion is intentionally idempotent and the next run retries it.
      if (sheet.imagePath) this.storage.deleteImage(sheet.imagePath);
      this.storage.deleteWarpedImages(sheet.id);
      if (sheet.scannerEventId) {
        const lockedArtifactJobs = usesRepositoryQuery
          ? artifactJobs
          : await manager.find(ScannerArtifactJob, {
            where: { eventId: sheet.scannerEventId },
            lock: { mode: 'pessimistic_write' },
          });
        for (const job of lockedArtifactJobs) {
          if (job.relativePath) this.storage.deleteImage(job.relativePath);
          if (job.state === ScannerArtifactJobState.AVAILABLE || job.relativePath) {
            job.relativePath = null;
            job.state = ScannerArtifactJobState.PURGED;
            job.failureCode = 'MANAGER_RETENTION_PURGED';
            job.availableAt = null;
            await manager.save(ScannerArtifactJob, job);
          }
        }
      }
      const purgedSheet: Sheet = {
        ...sheet,
        status: sheet.status === SheetStatus.FLAGGED ? SheetStatus.REJECTED : sheet.status,
        rejectionCode:
          sheet.status === SheetStatus.FLAGGED
            ? sheet.rejectionCode ?? 'SCAN_RETENTION_EXPIRED'
            : sheet.rejectionCode,
        imagePath: PURGED_IMAGE_PATH,
        resultJson: null,
        identityEvidenceJson: null,
        rankedCandidatesJson: null,
        identityEvidencePurgedAt: new Date(),
        purgeGeneration: (sheet.purgeGeneration ?? 0) + 1,
        recognizedId: null,
        avgConfidence: null,
      };
      await manager.save(Sheet, purgedSheet);
      purged += 1;
    }
    return purged;
  }

  private isPurgeEligible(
    sheet: Sheet,
    cutoff: Date,
    artifactJobs: ScannerArtifactJob[],
  ): boolean {
    if (
      !TERMINAL_STATUSES.includes(sheet.status) ||
      !sheet.processedAt ||
      sheet.processedAt > cutoff ||
      sheet.imagePath === PURGED_IMAGE_PATH
    ) {
      return false;
    }
    if (!sheet.scannerEventId) return true;
    if (![SheetStatus.VERIFIED, SheetStatus.REJECTED].includes(sheet.status)) return false;
    return !artifactJobs.some((job) => [
      ScannerArtifactJobState.PENDING,
      ScannerArtifactJobState.PROCESSING,
      ScannerArtifactJobState.RETRYING,
    ].includes(job.state));
  }
}
