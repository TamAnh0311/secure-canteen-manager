import { Repository } from 'typeorm';
import { ScansService } from '../scans.service';
import { Sheet } from '../sheet.entity';
import { SheetStatus } from '../sheet-status.enum';
import { projectedStorageUseRatio, ScanStorageService } from '../scan-storage.service';
import { ScanProcessorService } from '../scan-processor.service';
import { tomorrowInDeployTz } from '../../common/today-in-tz';
import { ScanImageValidatorService } from '../scan-image-validator.service';
import { createHash } from 'crypto';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import {
  OmrClientService,
  OmrPermanentError,
  OmrRetryableError,
} from '../../omr/omr-client.service';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../../config/env-validation';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';
import { OperatorZoneAccessService } from '../../auth/operator-zone-access.service';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';
import { MenuService } from '../../menu/menu.service';

const ACTOR = { id: 'operator-1', role: OperatorRole.ADMIN, zone: null } as OperatorPublic;

const REAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAAEAAQBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABgQAQEAAwAAAAAAAAAAAAAAAAECACEx/9oACAEBAAA/AFR1IEyAHM//2Q==',
  'base64',
);

const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function checksum(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Builds a ScansService with a thin repo mock that records what was created/saved, plus a
// query-builder spy that captures the andWhere clauses so date filtering can be asserted.
function buildService() {
  const created: Partial<Sheet>[] = [];
  const where: Array<{ clause: string; params: Record<string, unknown> }> = [];

  const qb = {
    orderBy: jest.fn(() => qb),
    take: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    where: jest.fn((clause: string, params: Record<string, unknown>) => {
      where.push({ clause, params });
      return qb;
    }),
    andWhere: jest.fn((clause: string, params: Record<string, unknown>) => {
      where.push({ clause, params });
      return qb;
    }),
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    leftJoin: jest.fn(() => qb),
    getMany: jest.fn(async () => []),
    getOne: jest.fn(async () => null),
    getRawMany: jest.fn(async () => []),
  } as Record<string, jest.Mock>;

  const repo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: Partial<Sheet>) => {
      created.push(data);
      return data as Sheet;
    }),
    save: jest.fn(async (s: Sheet) => ({ ...s, id: 'sheet-1' })),
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as Repository<Sheet>;

  const storage = {
    saveImage: jest.fn(async () => 'scans/abc.jpg'),
    deleteImage: jest.fn(),
  } as unknown as ScanStorageService;

  const processor = { enqueue: jest.fn() } as unknown as ScanProcessorService;

  const validator = {
    validate: jest.fn(() => ({
      bytes: REAL_JPEG,
      format: 'jpeg' as const,
      extension: '.jpg' as const,
      width: 4,
      height: 4,
    })),
  } as unknown as ScanImageValidatorService;

  const omrClient = {
    preflightImage: jest.fn().mockResolvedValue(undefined),
  } as unknown as OmrClientService;

  const zoneAccess = {
    requireOperatorZone: jest.fn((actor: OperatorPublic) =>
      actor.role === OperatorRole.OPERATOR ? actor.zone : null),
  } as unknown as OperatorZoneAccessService;
  const workflowMode = {
    assertOmrIntakeEnabled: jest.fn(),
  } as unknown as ScanWorkflowModeService;
  const menuService = { listAll: jest.fn().mockResolvedValue([]) } as unknown as MenuService;
  const svc = new ScansService(repo, storage, processor, validator, zoneAccess, workflowMode, menuService, omrClient);
  return { svc, repo, validator, storage, processor, omrClient, created, where, qb, zoneAccess, workflowMode };
}

describe('ScansService.submit', () => {
  it('blocks OMR intake before validation or storage when the workflow disables it', async () => {
    const { svc, workflowMode, validator, storage, processor } = buildService();
    (workflowMode.assertOmrIntakeEnabled as jest.Mock).mockImplementation(() => {
      throw new ConflictException({ code: 'SCAN_WORKFLOW.OMR_INTAKE_DISABLED' });
    });

    await expect(svc.submit({
      sheetId: 'FORM-001',
      checksum: checksum(REAL_JPEG),
      imageBase64: REAL_JPEG.toString('base64'),
    })).rejects.toMatchObject({ response: { code: 'SCAN_WORKFLOW.OMR_INTAKE_DISABLED' } });
    expect(validator.validate).not.toHaveBeenCalled();
    expect(storage.saveImage).not.toHaveBeenCalled();
    expect(processor.enqueue).not.toHaveBeenCalled();
  });

  it('accepts a submission with no sessionId and stamps the next collection day (deploy-TZ tomorrow)', async () => {
    const { svc, created, processor } = buildService();

    await svc.submit({
      sheetId: 'FORM-001',
      checksum: checksum(REAL_JPEG),
      imageBase64: REAL_JPEG.toString('base64'),
    });

    expect(created).toHaveLength(1);
    expect(created[0].serviceDate).toBe(tomorrowInDeployTz());
    // No session is carried on the sheet anymore.
    expect('sessionId' in created[0]).toBe(false);
    expect(processor.enqueue).toHaveBeenCalledWith('sheet-1');
  });

  it.each([
    ['jpeg', '.jpg', REAL_JPEG, 4, 4],
    ['png', '.png', REAL_PNG, 1, 1],
  ] as const)(
    'validates real %s bytes and hands the detected format to storage',
    async (format, extension, bytes, width, height) => {
      const { svc, validator, storage, omrClient, created } = buildService();
      (validator.validate as jest.Mock).mockReturnValue({ bytes, format, extension, width, height });
      (storage.saveImage as jest.Mock).mockResolvedValue(`scan${extension}`);
      const input = {
        sheetId: 'FORM-001',
        checksum: checksum(bytes),
        imageBase64: bytes.toString('base64'),
      };

      await svc.submit(input);

      expect(validator.validate).toHaveBeenCalledWith({
        imageBase64: input.imageBase64,
        checksum: input.checksum,
      });
      expect(omrClient.preflightImage).toHaveBeenCalledWith(input.imageBase64);
      expect(storage.saveImage).toHaveBeenCalledWith(input.checksum, bytes, format);
      expect(created[0].imagePath).toBe(`scan${extension}`);
    },
  );

  it('does not write a file, create a row, or enqueue when validation fails', async () => {
    const { svc, repo, validator, storage, processor, omrClient } = buildService();
    const invalid = new Error('invalid image');
    (validator.validate as jest.Mock).mockImplementation(() => {
      throw invalid;
    });

    await expect(
      svc.submit({
        sheetId: 'FORM-001',
        checksum: checksum(REAL_PNG),
        imageBase64: REAL_PNG.toString('base64'),
      }),
    ).rejects.toBe(invalid);

    expect(omrClient.preflightImage).not.toHaveBeenCalled();
    expect(storage.saveImage).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(processor.enqueue).not.toHaveBeenCalled();
  });

  it('turns deterministic decode-only preflight failure into terminal 400 before persistence', async () => {
    const { svc, repo, storage, processor, omrClient } = buildService();
    (omrClient.preflightImage as jest.Mock).mockRejectedValue(
      new OmrPermanentError('OMR.INVALID_IMAGE', 'truncated image'),
    );

    const error = await svc.submit({
      sheetId: 'FORM-TRUNCATED',
      checksum: checksum(REAL_JPEG),
      imageBase64: REAL_JPEG.toString('base64'),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'OMR.INVALID_IMAGE',
    });
    expect(storage.saveImage).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(processor.enqueue).not.toHaveBeenCalled();
  });

  it('returns retryable 503 on preflight outage without archiving or creating a sheet', async () => {
    const { svc, repo, storage, processor, omrClient } = buildService();
    (omrClient.preflightImage as jest.Mock).mockRejectedValue(
      new OmrRetryableError('OMR.SERVICE_UNAVAILABLE', 'upstream timeout'),
    );

    await expect(
      svc.submit({
        sheetId: 'FORM-OUTAGE',
        checksum: checksum(REAL_PNG),
        imageBase64: REAL_PNG.toString('base64'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(storage.saveImage).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(processor.enqueue).not.toHaveBeenCalled();
  });

  it('never deletes a shared checksum final file when DB save fails before a concurrent winner is visible', async () => {
    const { svc, repo, storage, processor } = buildService();
    (repo.save as jest.Mock).mockRejectedValueOnce(new Error('synthetic DB failure'));
    (repo.findOne as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(svc.submit({
      sheetId: 'FORM-RACE-LOSER',
      checksum: checksum(REAL_JPEG),
      imageBase64: REAL_JPEG.toString('base64'),
    })).rejects.toThrow('synthetic DB failure');

    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(processor.enqueue).not.toHaveBeenCalled();
  });
});

describe('ScanStorageService format-aware persistence', () => {
  let storageDir: string;
  let storage: ScanStorageService;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteen-scan-storage-'));
    const config = { get: jest.fn().mockReturnValue(storageDir) };
    storage = new ScanStorageService(config as unknown as ConfigService<AppEnv, true>);
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it.each([
    ['jpeg', '.jpg', REAL_JPEG],
    ['png', '.png', REAL_PNG],
  ] as const)('writes detected %s bytes under the matching extension with private permissions', async (format, extension, bytes) => {
    const digest = checksum(bytes);

    const relativePath = await storage.saveImage(digest, bytes, format);
    const fullPath = path.join(storageDir, relativePath);

    expect(relativePath).toBe(`${digest}${extension}`);
    expect(fs.readFileSync(fullPath)).toEqual(bytes);
    expect(fs.statSync(fullPath).mode & 0o777).toBe(0o600);
  });

  it('removes only stale staged and unreferenced raw files, preserving referenced, active, and warped files', () => {
    const digest = 'a'.repeat(64);
    const referenced = `${'b'.repeat(64)}.png`;
    const active = `${'c'.repeat(64)}.jpg`;
    const oldStage = `.${digest}.jpg.123.1000.stage`;
    const oldOrphan = `${digest}.jpg`;
    const oldUuidOrphan = '11111111-1111-4111-8111-111111111111.png';
    const warpedDir = path.join(storageDir, 'warped');
    const warped = path.join(warpedDir, 'sheet-1__v3.png');
    fs.mkdirSync(warpedDir);
    for (const relativePath of [oldStage, oldOrphan, oldUuidOrphan, referenced, active]) {
      fs.writeFileSync(path.join(storageDir, relativePath), REAL_JPEG);
    }
    fs.writeFileSync(warped, REAL_PNG);
    const now = new Date('2026-07-14T12:00:00.000Z');
    const old = new Date('2026-07-12T00:00:00.000Z');
    for (const relativePath of [oldStage, oldOrphan, oldUuidOrphan, referenced]) {
      fs.utimesSync(path.join(storageDir, relativePath), old, old);
    }
    fs.utimesSync(warped, old, old);
    fs.utimesSync(path.join(storageDir, active), now, now);

    const removed = storage.reconcileOrphans(new Set([referenced]), now);

    expect(removed).toBe(3);
    expect(fs.existsSync(path.join(storageDir, oldStage))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, oldOrphan))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, oldUuidOrphan))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, referenced))).toBe(true);
    expect(fs.existsSync(path.join(storageDir, active))).toBe(true);
    expect(fs.existsSync(warped)).toBe(true);
  });

  it('refreshes an existing checksum file as active so reconciliation cannot delete a concurrent winner', async () => {
    const digest = checksum(REAL_JPEG);
    const relativePath = await storage.saveImage(digest, REAL_JPEG, 'jpeg');
    const fullPath = path.join(storageDir, relativePath);
    const old = new Date('2026-07-12T00:00:00.000Z');
    fs.utimesSync(fullPath, old, old);

    await storage.saveImage(digest, REAL_JPEG, 'jpeg');
    const removed = storage.reconcileOrphans(new Set(), new Date());

    expect(removed).toBe(0);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.statSync(fullPath).mtimeMs).toBeGreaterThan(old.getTime());
  });

  it('hashes scanner identifiers before writing artifact filenames', () => {
    const relativePath = storage.saveScannerArtifact('evt/with/slashes', 'source/page-0', REAL_PNG);
    expect(relativePath).toMatch(/^scanner-artifacts\/[a-f0-9]{64}-[a-f0-9]{64}\.bin$/);
    expect(fs.readFileSync(path.join(storageDir, relativePath))).toEqual(REAL_PNG);
  });

  it('projects scanner artifact bytes into the configured storage watermark', () => {
    expect(projectedStorageUseRatio(100, 20, 10, 30)).toBeCloseTo(0.83);
  });

  it('reconciles stale scanner artifact finals and stages while preserving DB references', () => {
    const scannerDir = path.join(storageDir, 'scanner-artifacts');
    fs.mkdirSync(scannerDir);
    const referenced = `scanner-artifacts/${'a'.repeat(64)}-${'b'.repeat(64)}.bin`;
    const orphan = `scanner-artifacts/${'c'.repeat(64)}-${'d'.repeat(64)}.bin`;
    const stage = `scanner-artifacts/.${'e'.repeat(64)}-${'f'.repeat(64)}.bin.123.1000.stage`;
    for (const relativePath of [referenced, orphan, stage]) {
      fs.writeFileSync(path.join(storageDir, relativePath), REAL_PNG);
      fs.utimesSync(path.join(storageDir, relativePath), new Date('2026-07-12T00:00:00Z'), new Date('2026-07-12T00:00:00Z'));
    }

    expect(storage.reconcileOrphans(new Set([referenced]), new Date('2026-07-14T12:00:00Z'))).toBe(2);
    expect(fs.existsSync(path.join(storageDir, referenced))).toBe(true);
    expect(fs.existsSync(path.join(storageDir, orphan))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, stage))).toBe(false);
  });
});

describe('ScansService.findAll — date filtering', () => {
  it('keeps unresolved intake visible but scopes resolved owners before pagination', async () => {
    const { svc, where, qb } = buildService();
    const operator = { ...ACTOR, role: OperatorRole.OPERATOR, zone: 'Khu A' };

    await svc.findAll({ limit: 20, offset: 10 }, operator);

    expect(where).toContainEqual(expect.objectContaining({
      clause: expect.stringContaining("jsonb_array_elements"),
      params: { scanActorZone: 'Khu A' },
    }));
    expect(qb.orderBy).toHaveBeenCalledWith('s.createdAt', 'DESC');
    expect((qb.andWhere as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((qb.getMany as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('filters on the inclusive service_date range when bounds are supplied', async () => {
    const { svc, where } = buildService();

    await svc.findAll({ dateFrom: '2026-06-01', dateTo: '2026-06-18', limit: 50, offset: 0 }, ACTOR);

    const clauses = where.map((w) => w.clause);
    expect(clauses).toContain('s.service_date >= :dateFrom');
    expect(clauses).toContain('s.service_date <= :dateTo');
    expect(where.find((w) => w.clause.includes('dateFrom'))?.params).toEqual({ dateFrom: '2026-06-01' });
    expect(where.find((w) => w.clause.includes('dateTo'))?.params).toEqual({ dateTo: '2026-06-18' });
  });

  it('does not filter by session id', async () => {
    const { svc, where } = buildService();
    await svc.findAll({ limit: 50, offset: 0 }, ACTOR);
    expect(where.some((w) => w.clause.includes('session'))).toBe(false);
  });
});

describe('ScansService.getKpi — grouped by status across a date range', () => {
  it('groups by status filtered on the inclusive service_date range', async () => {
    const { svc, where, qb } = buildService();
    (qb.getRawMany as jest.Mock).mockResolvedValue([
      { status: SheetStatus.FLAGGED, cnt: '4' },
      { status: SheetStatus.VERIFIED, cnt: '2' },
    ]);

    const kpi = await svc.getKpi(ACTOR, '2026-06-01', '2026-06-18');

    const clauses = where.map((w) => w.clause);
    expect(clauses).toContain('s.service_date >= :dateFrom');
    expect(clauses).toContain('s.service_date <= :dateTo');
    expect(where.find((w) => w.clause.includes('dateFrom'))?.params).toEqual({ dateFrom: '2026-06-01' });
    expect(where.find((w) => w.clause.includes('dateTo'))?.params).toEqual({ dateTo: '2026-06-18' });
    expect(kpi.flagged).toBe(4);
    expect(kpi.verified).toBe(2);
  });

  it('collapses to a single day when only dateFrom is given', async () => {
    const { svc, where } = buildService();
    await svc.getKpi(ACTOR, '2026-06-18');
    expect(where.find((w) => w.clause.includes('dateFrom'))?.params).toEqual({ dateFrom: '2026-06-18' });
    expect(where.find((w) => w.clause.includes('dateTo'))?.params).toEqual({ dateTo: '2026-06-18' });
  });

  it('defaults both bounds to tomorrow in the deploy timezone when no date is given', async () => {
    const { svc, where } = buildService();
    await svc.getKpi(ACTOR);
    const tomorrow = tomorrowInDeployTz();
    expect(where.find((w) => w.clause.includes('dateFrom'))?.params).toEqual({ dateFrom: tomorrow });
    expect(where.find((w) => w.clause.includes('dateTo'))?.params).toEqual({ dateTo: tomorrow });
  });
});
