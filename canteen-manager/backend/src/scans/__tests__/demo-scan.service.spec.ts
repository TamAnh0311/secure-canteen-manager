import { HttpException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ThresholdConfigService } from '../../config/threshold-config.service';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../../omr-forms/issued-omr-form.entity';
import { User } from '../../users/user.entity';
import { tomorrowInDeployTz } from '../../common/today-in-tz';
import { DEMO_ROI_TEMPLATE } from '../../database/seeds/demo-assets';
import { DemoScanService } from '../demo-scan.service';
import { ScanStorageService } from '../scan-storage.service';
import { Sheet } from '../sheet.entity';
import { SheetStatus } from '../sheet-status.enum';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from '../../omr-forms/omr-form-template.entity';
import { OperatorZoneAccessService } from '../../auth/operator-zone-access.service';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';

const OPERATOR_ID = '123e4567-e89b-42d3-a456-426614174001';
const ACTOR = { id: OPERATOR_ID, role: OperatorRole.OPERATOR, zone: 'A' } as OperatorPublic;
const DEMO_USER = {
  id: '123e4567-e89b-42d3-a456-426614174002',
  legacyId: '100001',
  isActive: true,
  source: 'demo',
} as User;
const TEMPLATE = {
  id: '33333333-3333-4333-8333-333333333333',
  revision: 'a4-code-v3',
  mode: OmrFormMode.CODE,
  orientation: OmrFormOrientation.PORTRAIT,
  geometryHash: 'a'.repeat(64),
  isActive: false,
} as OmrFormTemplate;

function buildService(activeUser: User | null = DEMO_USER) {
  const createdForms: Partial<IssuedOmrForm>[] = [];
  const createdSheets: Partial<Sheet>[] = [];
  const saveOrder: Array<typeof IssuedOmrForm | typeof Sheet> = [];

  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(activeUser),
  };
  const userRepo = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const manager = {
    getRepository: jest.fn((entity: typeof User) => {
      if (entity !== User) throw new Error('unexpected repository');
      return userRepo;
    }),
    query: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(async (entity: unknown) => entity === OmrFormTemplate ? TEMPLATE : null),
    create: jest.fn((entity: typeof IssuedOmrForm | typeof Sheet, data: object) => {
      if (entity === IssuedOmrForm) createdForms.push(data as Partial<IssuedOmrForm>);
      if (entity === Sheet) createdSheets.push(data as Partial<Sheet>);
      return data;
    }),
    save: jest.fn(async (entity: typeof IssuedOmrForm | typeof Sheet, row: object) => {
      saveOrder.push(entity);
      return row;
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<Sheet>) => work(manager)),
  } as unknown as DataSource;
  const storage = {
    saveImage: jest.fn(async () => 'scans/demo.png'),
    saveWarpedImage: jest.fn(async () => 'scans/warped/demo.png'),
  } as unknown as ScanStorageService;
  const thresholdConfig = {
    getRoi: jest.fn().mockResolvedValue({
      roiTemplate: { roi_version: 'v3' },
      roiVersion: 'v3',
      templateId: TEMPLATE.id,
      formMode: OmrFormMode.CODE,
      roiGeneratedAt: new Date(),
    }),
  } as unknown as ThresholdConfigService;
  const zoneAccess = {
    scopeByUser: jest.fn(),
    assertUserAccess: jest.fn().mockResolvedValue(activeUser),
  } as unknown as OperatorZoneAccessService;

  const workflowMode = {
    assertOmrIntakeEnabled: jest.fn(),
  } as unknown as ScanWorkflowModeService;
  const svc = new DemoScanService(storage, thresholdConfig, dataSource, zoneAccess, workflowMode);
  return {
    svc,
    dataSource,
    manager,
    queryBuilder,
    storage,
    thresholdConfig,
    createdForms,
    createdSheets,
    saveOrder,
    zoneAccess,
  };
}

describe('DemoScanService.createDemoRecord', () => {
  it('transactionally binds a synthetic FLAGGED sheet to an issued v3 form', async () => {
    const { svc, dataSource, createdForms, createdSheets, saveOrder, storage } = buildService();

    const sheet = await svc.createDemoRecord(ACTOR);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(createdForms).toHaveLength(1);
    expect(createdSheets).toHaveLength(1);
    const form = createdForms[0];
    const createdSheet = createdSheets[0];
    expect(form).toMatchObject({
      userId: DEMO_USER.id,
      serviceDate: tomorrowInDeployTz(),
      roiVersion: TEMPLATE.revision,
      issuedBy: OPERATOR_ID,
      status: IssuedOmrFormStatus.ISSUED,
      reservedSheetId: createdSheet.id,
      consumedSheetId: null,
    });
    expect(createdSheet).toMatchObject({
      serviceDate: form.serviceDate,
      status: SheetStatus.FLAGGED,
      matchedUserId: DEMO_USER.id,
      recognizedId: null,
      issuedFormId: form.token,
    });
    expect(createdSheet.flags).toContain('DEMO_SYNTHETIC_BYPASS');
    expect(saveOrder).toEqual([IssuedOmrForm, Sheet, IssuedOmrForm]);
    expect(sheet).toBe(createdSheet);
    expect(storage.saveWarpedImage).toHaveBeenCalledWith(
      createdSheet.id,
      expect.any(String),
      `${TEMPLATE.id}:${TEMPLATE.geometryHash}`,
    );
  });

  it('emits order_lines only and keeps exact numeric demo menu codes', async () => {
    const { svc, createdSheets } = buildService();
    await svc.createDemoRecord(ACTOR);

    const result = createdSheets[0].resultJson as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['order_lines']);
    const lines = result['order_lines'] as Array<{ code: string | null }>;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.code).toMatch(/^[0-9]{3}$/);
    }
  });

  it('restricts selection to active demo users that have no issued form for the service date', async () => {
    const { svc, manager, queryBuilder, zoneAccess } = buildService();
    await svc.createDemoRecord(ACTOR);

    expect(queryBuilder.where).toHaveBeenCalledWith('candidate.isActive = :active', { active: true });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('candidate.source = :source', { source: 'demo' });
    expect(zoneAccess.scopeByUser).toHaveBeenCalledWith(
      queryBuilder,
      ACTOR,
      'candidate.zone',
    );
    expect(zoneAccess.assertUserAccess).toHaveBeenCalledWith(ACTOR, DEMO_USER.id, manager);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('issued_omr_forms'),
      expect.objectContaining({
        serviceDate: tomorrowInDeployTz(),
        issuedStatus: IssuedOmrFormStatus.ISSUED,
      }),
    );
    expect((manager.query as jest.Mock)).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [`${DEMO_USER.id}:${tomorrowInDeployTz()}`],
    );
  });

  it('rejects a non-demo candidate defensively without creating authority or files', async () => {
    const nonDemoUser = { ...DEMO_USER, source: 'sql2005' } as User;
    const { svc, createdForms, createdSheets, storage } = buildService(nonDemoUser);

    await expect(svc.createDemoRecord(ACTOR)).rejects.toBeInstanceOf(HttpException);
    expect(createdForms).toHaveLength(0);
    expect(createdSheets).toHaveLength(0);
    expect(storage.saveImage).not.toHaveBeenCalled();
  });

  it('returns a controlled 4xx when no active available demo prisoner exists', async () => {
    const { svc, createdSheets, storage } = buildService(null);

    try {
      await svc.createDemoRecord(ACTOR);
      throw new Error('expected demo generation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBeGreaterThanOrEqual(400);
      expect((error as HttpException).getStatus()).toBeLessThan(500);
    }
    expect(createdSheets).toHaveLength(0);
    expect(storage.saveImage).not.toHaveBeenCalled();
  });

  it('returns a controlled conflict when authority appears concurrently', async () => {
    const { svc, manager, createdSheets, storage } = buildService();
    (manager.findOne as jest.Mock).mockImplementation(async (entity: unknown) =>
      entity === OmrFormTemplate ? TEMPLATE : { token: 'already-issued' });

    await expect(svc.createDemoRecord(ACTOR)).rejects.toMatchObject({ status: 409 });
    expect(createdSheets).toHaveLength(0);
    expect(storage.saveImage).not.toHaveBeenCalled();
  });

  it('refuses to mint form authority without a versioned template', async () => {
    const { svc, manager, dataSource } = buildService();
    (manager.findOne as jest.Mock).mockResolvedValue(null);
    await expect(svc.createDemoRecord(ACTOR)).rejects.toBeInstanceOf(HttpException);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('static demo ROI asset', () => {
  it('uses the form-authoritative v3 layout without handwritten identity boxes', () => {
    expect(DEMO_ROI_TEMPLATE.roi_version).toBe('v3');
    expect(DEMO_ROI_TEMPLATE.digit_boxes).toEqual([]);
    expect(DEMO_ROI_TEMPLATE.qr_roi).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });
});
