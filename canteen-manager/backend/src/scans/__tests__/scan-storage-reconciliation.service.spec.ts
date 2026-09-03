import { Repository } from 'typeorm';
import { Sheet } from '../sheet.entity';
import { ScanStorageService } from '../scan-storage.service';
import { ScanStorageReconciliationService } from '../scan-storage-reconciliation.service';
import { ScannerArtifactJob } from '../webhook/scanner-artifact-job.entity';

describe('ScanStorageReconciliationService', () => {
  it('runs reconciliation at startup using every DB-referenced original path', async () => {
    const repo = {
      find: jest.fn().mockResolvedValue([
        { imagePath: `${'a'.repeat(64)}.jpg` },
        { imagePath: `${'b'.repeat(64)}.png` },
      ]),
    };
    const artifactRepo = { find: jest.fn().mockResolvedValue([{ relativePath: 'scanner-artifacts/kept.bin' }]) };
    const storage = { reconcileOrphans: jest.fn().mockReturnValue(1) };
    const service = new ScanStorageReconciliationService(
      repo as unknown as Repository<Sheet>,
      artifactRepo as unknown as Repository<ScannerArtifactJob>,
      storage as unknown as ScanStorageService,
    );

    await service.onApplicationBootstrap();

    expect(repo.find).toHaveBeenCalledWith({ select: ['imagePath'] });
    expect(artifactRepo.find).toHaveBeenCalledWith({ select: ['relativePath'] });
    expect(storage.reconcileOrphans).toHaveBeenCalledWith(
      new Set([`${'a'.repeat(64)}.jpg`, `${'b'.repeat(64)}.png`, 'scanner-artifacts/kept.bin']),
    );
  });

  it('exposes the same bounded reconciliation pass for the periodic schedule', async () => {
    const repo = { find: jest.fn().mockResolvedValue([]) };
    const artifactRepo = { find: jest.fn().mockResolvedValue([]) };
    const storage = { reconcileOrphans: jest.fn().mockReturnValue(0) };
    const service = new ScanStorageReconciliationService(
      repo as unknown as Repository<Sheet>,
      artifactRepo as unknown as Repository<ScannerArtifactJob>,
      storage as unknown as ScanStorageService,
    );

    await expect(service.reconcile()).resolves.toBe(0);

    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(storage.reconcileOrphans).toHaveBeenCalledWith(new Set());
  });
});
