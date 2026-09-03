import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { Repository } from 'typeorm';
import { AppEnv } from '../config/env-validation';
import { User } from '../users/user.entity';
import { SyncRun, SyncRunStatus, SyncTrigger } from './sync-run.entity';
import { LEGACY_EMPLOYEE_SOURCE, LegacyEmployeeSource } from './legacy-employee-source';
import { normalizeCell } from '../users/cell-normalization';

const UPSERT_CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export interface SkippedResult {
  skipped: true;
  reason: string;
}

@Injectable()
export class LegacySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LegacySyncService.name);
  private running = false;

  constructor(
    @Inject(LEGACY_EMPLOYEE_SOURCE)
    private readonly source: LegacyEmployeeSource,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(SyncRun)
    private readonly syncRunsRepo: Repository<SyncRun>,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cronExpression = this.config.get('LEGACY_SYNC_CRON', { infer: true });
    try {
      const job = new CronJob(cronExpression, () => {
        void this.scheduledSync();
      });
      this.schedulerRegistry.addCronJob('legacy-sync', job);
      job.start();
      this.logger.log(`Legacy sync cron registered: "${cronExpression}"`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Invalid LEGACY_SYNC_CRON expression "${cronExpression}" — cron not started: ${message}`,
      );
      // Do not rethrow: an invalid cron expression must not crash app boot.
    }
  }

  // Stop and deregister the cron job so its timer is released on module teardown.
  // Without this, the CronJob's internal setInterval keeps the event loop alive after
  // app.close(), preventing Jest from exiting cleanly between spec files.
  onModuleDestroy(): void {
    try {
      const job = this.schedulerRegistry.getCronJob('legacy-sync');
      job.stop();
      this.schedulerRegistry.deleteCronJob('legacy-sync');
    } catch {
      // Job may not exist if onModuleInit() failed to register it (invalid cron expression).
      // Nothing to clean up in that case.
    }
  }

  async scheduledSync(): Promise<void> {
    const enabled = this.config.get('LEGACY_SYNC_ENABLED', { infer: true });
    if (!enabled) {
      return;
    }
    await this.run('cron');
  }

  async run(trigger: SyncTrigger): Promise<SyncRun | SkippedResult> {
    if (this.running) {
      return { skipped: true, reason: 'in-progress' };
    }
    this.running = true;

    const syncRun = this.syncRunsRepo.create({
      startedAt: new Date(),
      status: SyncRunStatus.RUNNING,
      trigger,
      rowCount: 0,
      finishedAt: null,
      error: null,
    });
    await this.syncRunsRepo.save(syncRun);

    try {
      const employees = await this.source.fetchEmployees();
      const now = new Date();

      const rows = employees.map((emp) => {
        const normalizedCell = normalizeCell(emp.cell);
        return {
          legacyId: emp.legacyId,
          name: emp.name,
          zone: emp.zone,
          cell: emp.cell,
          normalizedCell: normalizedCell.value,
          cellNormalizationVersion: normalizedCell.version,
          dateOfBirth: emp.dateOfBirth,
          hometown: emp.hometown,
          offense: emp.offense,
          arrestDate: emp.arrestDate,
          detentionStatus: emp.detentionStatus,
          isActive: emp.isActive,
          source: 'sql2005',
          syncedAt: now,
        };
      });

      // upsert MUST keep stamping synced_at on conflict (DO UPDATE SET runs
      // unconditionally in Postgres). The absent-row deactivation below relies
      // on every present prisoner having synced_at == now; switching to
      // orIgnore()/DO NOTHING or dropping syncedAt here would silently flip
      // every live prisoner inactive.
      for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
        await this.usersRepo.upsert(batch, ['legacyId']);
      }

      // Deactivate prisoners no longer returned by the source (released/transferred).
      // Each upsert stamps synced_at=now; rows untouched this run keep an older
      // synced_at and are flipped inactive — never hard-deleted, so their ledger and
      // order history survive. Guard on a non-empty fetch so a transient empty/garbage
      // result can't mass-deactivate the whole population.
      if (employees.length > 0) {
        await this.usersRepo
          .createQueryBuilder()
          .update(User)
          .set({ isActive: false })
          .where('source = :source', { source: 'sql2005' })
          .andWhere('synced_at < :now', { now })
          .andWhere('is_active = true')
          .execute();
      }

      syncRun.status = SyncRunStatus.SUCCESS;
      syncRun.rowCount = employees.length;
      syncRun.finishedAt = new Date();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      syncRun.status = SyncRunStatus.FAILED;
      syncRun.error = message;
      syncRun.finishedAt = new Date();
      this.logger.error(
        `Legacy sync failed (trigger=${trigger}): ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Do NOT rethrow — sync failure must not crash the app or primary DB operations.
    } finally {
      await this.syncRunsRepo.save(syncRun);
      this.running = false;
    }

    return syncRun;
  }

  async getStatus(): Promise<SyncRun | null> {
    return this.syncRunsRepo.findOne({
      where: {},
      order: { startedAt: 'DESC' },
    });
  }
}
