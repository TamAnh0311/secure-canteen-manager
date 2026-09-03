import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { MenuItemCategory } from '../../../menu/menu-item-category.enum';
import { MenuItem } from '../../../menu/menu-item.entity';
import { OperatorRole } from '../../../operators/operator.entity';
import { OperatorPublic } from '../../../operators/operator-public';
import { Order } from '../../../orders/order.entity';
import { OrderWithItems } from '../../../orders/orders.service';
import { User } from '../../../users/user.entity';
import { ScannerArtifactJob, ScannerArtifactJobState } from '../../webhook/scanner-artifact-job.entity';
import { ScannerWebhookEvent, ScannerWebhookEventState } from '../../webhook/scanner-webhook-event.entity';
import { OmrOperationalFormMode, Sheet } from '../../sheet.entity';
import { SheetStatus } from '../../sheet-status.enum';
import { ConfirmScanDto } from '../dto/confirm-scan.dto';
import { VerifyService } from '../verify.service';

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const MENU_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR = { id: 'operator-1', role: OperatorRole.ADMIN, zone: null } as OperatorPublic;

const MENU_ITEM = {
  id: MENU_ITEM_ID,
  code: '001',
  name: 'Rice',
  isActive: true,
  category: MenuItemCategory.FOOD,
  price: 10_000,
  position: 0,
} as MenuItem;

function catalogueVersion(item = MENU_ITEM): string {
  return createHash('sha256').update(JSON.stringify([{
    catalogueItemId: item.code,
    name: item.name,
    active: item.isActive,
  }]), 'utf8').digest('hex');
}

function makeUser(): User {
  return {
    id: USER_ID,
    legacyId: '000001',
    name: 'Scanner Prisoner',
    zone: 'A',
    cell: 'A1',
    isActive: true,
  } as User;
}

function makeSheet(): Sheet {
  return {
    id: SHEET_ID,
    sheetId: 'result-1',
    serviceDate: '2026-08-06',
    status: SheetStatus.FLAGGED,
    scannerEventId: EVENT_ID,
    admittedMode: OmrOperationalFormMode.SCANNER,
    resultJson: {
      result_id: 'result-1',
      document_id: 'document-1',
      revision: 1,
      outcome: 'accepted',
      ma_luu_ky: { value: '000001' },
      buong_giam: { value: 'A1' },
      items: [{ catalogue_item_id: '001', quantity: { value: 2 } }],
      artifacts: [{ artifact_id: 'source-1' }],
      versions: { catalogue: catalogueVersion() },
    },
    matchedUserId: null,
    proposedUserId: null,
    orderId: null,
    flags: null,
  } as Sheet;
}

function buildHarness(overrides: {
  artifactState?: ScannerArtifactJobState;
  exactIdentity?: boolean;
  artifactPath?: string | null;
  artifactJobs?: ScannerArtifactJob[];
  user?: Partial<User>;
  scannerRoom?: string | null;
  catalogueVersion?: string;
  menuItem?: Partial<MenuItem>;
} = {}) {
  const sheet = makeSheet();
  const user = Object.assign(makeUser(), overrides.user);
  const result = sheet.resultJson as Record<string, unknown>;
  if (overrides.scannerRoom === null) delete result.buong_giam;
  else if (overrides.scannerRoom !== undefined) result.buong_giam = { value: overrides.scannerRoom };
  if (overrides.catalogueVersion !== undefined) {
    result.versions = { catalogue: overrides.catalogueVersion };
  }
  const menuItem = Object.assign({ ...MENU_ITEM }, overrides.menuItem) as MenuItem;
  const event = {
    id: EVENT_ID,
    state: ScannerWebhookEventState.RECEIVED,
    serviceDate: sheet.serviceDate,
  } as ScannerWebhookEvent;
  const createdOrder = { id: '55555555-5555-4555-8555-555555555555', items: [] } as unknown as OrderWithItems;
  const createOrReplaceWithOutcome = jest.fn().mockResolvedValue({ order: createdOrder, replaced: false });
  const retryJob = {
    eventId: EVENT_ID,
    artifactId: 'source-1',
    state: ScannerArtifactJobState.MISSING,
    sourceOccurredAt: new Date(),
    nextAttemptAt: new Date(0),
    leaseExpiresAt: null,
    leaseToken: null,
    failureCode: 'ARTIFACT_RETENTION_EXPIRED',
    availableAt: null,
    relativePath: null,
  } as ScannerArtifactJob;
  const artifactRepo = {
    findOne: jest.fn().mockResolvedValue(retryJob),
    save: jest.fn(async (value: ScannerArtifactJob) => value),
  };
  let em: Record<string, any>;
  em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Sheet) return sheet;
      if (entity === ScannerWebhookEvent) return event;
      if (entity === User) return overrides.exactIdentity === false ? null : user;
      if (entity === Order) return null;
      return null;
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === ScannerArtifactJob) {
        return overrides.artifactJobs ?? [{
          artifactId: 'source-1',
          state: overrides.artifactState ?? ScannerArtifactJobState.AVAILABLE,
          relativePath: overrides.artifactPath === undefined ? 'scanner/source-1.png' : overrides.artifactPath,
        }];
      }
      if (entity === MenuItem) return [menuItem];
      return [];
    }),
    query: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (_entity: unknown, value: Sheet) => value),
    getRepository: jest.fn((entity: unknown) => entity === ScannerArtifactJob ? artifactRepo : em),
  };
  const authorizedQuery = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(sheet),
  };
  const zoneAccess = {
    requireOperatorZone: jest.fn().mockReturnValue(null),
    assertUserAccess: jest.fn().mockResolvedValue(user),
  };
  const svc = Object.assign(Object.create(VerifyService.prototype), {
    sheetRepo: { createQueryBuilder: jest.fn().mockReturnValue(authorizedQuery) },
    dataSource: {
      transaction: jest.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(em as unknown as EntityManager)),
    } as unknown as DataSource,
    menuService: {},
    usersService: {},
    ordersService: { createOrReplaceWithOutcome },
    zoneAccess,
    workflowMode: { assertScannerConfirmationEnabled: jest.fn() },
    logger: { warn: jest.fn(), log: jest.fn() },
    config: { get: jest.fn().mockReturnValue(30) },
  }) as VerifyService;
  return { svc, sheet, createOrReplaceWithOutcome, em, artifactRepo, retryJob };
}

const dto = (overrides: Partial<ConfirmScanDto> = {}): ConfirmScanDto => ({
  userId: USER_ID,
  items: [{ menuItemId: MENU_ITEM_ID, quantity: 2 }],
  ...overrides,
});

describe('VerifyService.confirm — scanner results', () => {
  it('requires explicit identity confirmation', async () => {
    const { svc, createOrReplaceWithOutcome } = buildHarness();
    await expect(svc.confirm(SHEET_ID, dto({ userId: undefined }), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.IDENTITY_REQUIRED' },
    });
    expect(createOrReplaceWithOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ScannerArtifactJobState.PENDING,
    ScannerArtifactJobState.PROCESSING,
    ScannerArtifactJobState.RETRYING,
    ScannerArtifactJobState.MISSING,
    ScannerArtifactJobState.PERMANENT_FAILED,
    ScannerArtifactJobState.INTEGRITY_FAULT,
    ScannerArtifactJobState.PURGED,
  ])('does not require a declared artifact to be available before confirmation (%s)', async (artifactState) => {
    const { svc, sheet, createOrReplaceWithOutcome } = buildHarness({ artifactState });
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).resolves.toMatchObject({
      replaced: false,
      sheet: { status: SheetStatus.VERIFIED, matchedUserId: USER_ID },
    });
    expect(createOrReplaceWithOutcome).toHaveBeenCalledTimes(1);
    expect(sheet.status).toBe(SheetStatus.VERIFIED);
  });

  it('does not require a manager-owned artifact path before confirmation', async () => {
    const { svc, sheet, createOrReplaceWithOutcome } = buildHarness({ artifactPath: null });
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).resolves.toMatchObject({
      replaced: false,
      sheet: { status: SheetStatus.VERIFIED, matchedUserId: USER_ID },
    });
    expect(createOrReplaceWithOutcome).toHaveBeenCalledTimes(1);
    expect(sheet.status).toBe(SheetStatus.VERIFIED);
  });

  it('confirms an accepted scanner result only through the scanner order source', async () => {
    const { svc, sheet, createOrReplaceWithOutcome } = buildHarness();
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).resolves.toMatchObject({
      replaced: false,
      sheet: { status: SheetStatus.VERIFIED, matchedUserId: USER_ID },
    });
    expect(createOrReplaceWithOutcome).toHaveBeenCalledWith(expect.objectContaining({
      source: 'scanner',
      userId: USER_ID,
      sheetId: SHEET_ID,
    }), expect.anything());
    expect(sheet.status).toBe(SheetStatus.VERIFIED);
  });

  it('requeues a terminal artifact through an authorized, idempotent retry action', async () => {
    const { svc, artifactRepo, retryJob } = buildHarness();
    await expect(svc.retryScannerArtifact(SHEET_ID, 'source-1', ACTOR)).resolves.toEqual({
      state: ScannerArtifactJobState.RETRYING,
    });
    expect(artifactRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      state: ScannerArtifactJobState.RETRYING,
      failureCode: 'ARTIFACT_RETRY_REQUESTED',
      relativePath: null,
    }));
    expect(retryJob.nextAttemptAt.getTime()).toBeGreaterThan(0);
  });

  it('requires a reason when the operator overrides an unresolved identity', async () => {
    const { svc } = buildHarness({ exactIdentity: false });
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.IDENTITY_REASON_REQUIRED' },
    });
  });

  it.each([
    ['missing scanner room', { scannerRoom: null }],
    ['missing current room', { user: { cell: null } }],
    ['room mismatch', { scannerRoom: 'A2' }],
  ])('requires a reason for %s', async (_label, overrides) => {
    const { svc } = buildHarness(overrides);
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.IDENTITY_REASON_REQUIRED' },
    });
  });

  it('rejects an inactive selected prisoner', async () => {
    const { svc } = buildHarness({ user: { isActive: false } });
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'USER.INACTIVE' },
    });
  });

  it('requires an auditable reason when the scanner catalogue version is stale', async () => {
    const { svc } = buildHarness({ catalogueVersion: 'stale-catalogue' });
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.CATALOGUE_DRIFT' },
    });
  });

  it('allows reviewed catalogue drift with a reason and records a flag', async () => {
    const { svc, sheet } = buildHarness({ catalogueVersion: 'stale-catalogue' });
    await expect(svc.confirm(SHEET_ID, dto({ reason: 'Verified against the current menu catalogue.' }), ACTOR))
      .resolves.toMatchObject({ replaced: false });
    expect(sheet.flags).toContain('SCANNER_CATALOGUE_DRIFT');
  });

  it('rejects an inactive current catalogue mapping', async () => {
    const { svc } = buildHarness({ menuItem: { isActive: false } });
    await expect(svc.confirm(SHEET_ID, dto({ reason: 'Reviewed.' }), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.CATALOGUE_DRIFT' },
    });
  });

  it('rejects an item that is not in the scanner catalogue evidence', async () => {
    const { svc } = buildHarness();
    await expect(svc.confirm(SHEET_ID, dto({ items: [{ menuItemId: '66666666-6666-4666-8666-666666666666', quantity: 1 }] }), ACTOR))
      .rejects.toMatchObject({ response: { code: 'VERIFY.ITEM_NOT_SCANNED' } });
  });

  it('uses normalized room values for an exact scanner identity match', async () => {
    const { svc } = buildHarness({ user: { cell: 'a-01' }, scannerRoom: 'A 01' });
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).resolves.toMatchObject({
      replaced: false,
      sheet: { matchedUserId: USER_ID },
    });
  });

  it('does not allow direct confirmation to skip an ambiguous scanner item', async () => {
    const { svc, sheet, createOrReplaceWithOutcome } = buildHarness();
    const result = sheet.resultJson as Record<string, any>;
    result.items = [{
      row_index: 0,
      catalogue_item_id: null,
      item: { candidates: [{ catalogue_item_id: '001' }], warnings: [] },
      quantity: { value: 2, candidates: [], warnings: [] },
    }];
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.SCANNER_ITEM_REASON_REQUIRED' },
    });
    expect(createOrReplaceWithOutcome).not.toHaveBeenCalled();
  });

  it('requires an auditable reason for scanner item warnings', async () => {
    const { svc, sheet } = buildHarness();
    const result = sheet.resultJson as Record<string, any>;
    result.items = [{
      row_index: 0,
      catalogue_item_id: '001',
      item: { candidates: [], warnings: [{ code: 'recognition_uncertain' }] },
      quantity: { value: 2, candidates: [], warnings: [] },
    }];
    await expect(svc.confirm(SHEET_ID, dto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.SCANNER_ITEM_REASON_REQUIRED' },
    });
  });
});
