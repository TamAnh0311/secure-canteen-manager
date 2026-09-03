import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sheet } from './sheet.entity';
import { ScanStorageService } from './scan-storage.service';
import { ScannerArtifactJob } from './webhook/scanner-artifact-job.entity';

@Injectable()
export class ScanStorageReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScanStorageReconciliationService.name);

  constructor(
    @InjectRepository(Sheet)
    private readonly sheetRepo: Repository<Sheet>,
    @InjectRepository(ScannerArtifactJob)
    private readonly artifactJobRepo: Repository<ScannerArtifactJob>,
    private readonly storage: ScanStorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reconcile();
  }

  @Cron('0 */15 * * * *')
  async reconcile(): Promise<number> {
    const sheets = await this.sheetRepo.find({ select: ['imagePath'] });
    const referencedPaths = new Set(
      sheets.map((sheet) => sheet.imagePath).filter((path): path is string => Boolean(path)),
    );
    const artifactJobs = await this.artifactJobRepo.find({ select: ['relativePath'] });
    for (const job of artifactJobs) {
      if (job.relativePath) referencedPaths.add(job.relativePath);
    }
    const removed = this.storage.reconcileOrphans(referencedPaths);
    if (removed > 0) this.logger.log(`Removed ${removed} stale scan storage orphan(s)`);
    return removed;
  }
}
