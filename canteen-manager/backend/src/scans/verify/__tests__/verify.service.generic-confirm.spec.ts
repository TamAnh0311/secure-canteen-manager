import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from '../../../omr-forms/omr-form-template.entity';
import { OmrFormTemplateRow } from '../../../omr-forms/omr-form-template-row.entity';
import { Order, OrderStatus } from '../../../orders/order.entity';
import { CreateOrReplaceInput, OrderWithItems } from '../../../orders/orders.service';
import { OperatorRole } from '../../../operators/operator.entity';
import { OperatorPublic } from '../../../operators/operator-public';
import { User } from '../../../users/user.entity';
import { IdentitySelectionSource, OmrOperationalFormMode, Sheet } from '../../sheet.entity';
import { SheetStatus } from '../../sheet-status.enum';
import { ConfirmScanDto } from '../dto/confirm-scan.dto';
import { VerifyService } from '../verify.service';

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';
const MENU_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR = { id: 'operator-1', role: OperatorRole.ADMIN, zone: null } as OperatorPublic;

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: SHEET_ID,
    serviceDate: '2026-07-29',
    status: SheetStatus.FLAGGED,
    issuedFormId: null,
    templateId: TEMPLATE_ID,
    admittedMode: OmrOperationalFormMode.GENERIC,
    proposedUserId: null,
    matchedUserId: null,
    orderId: null,
    resultJson: {
      order_lines: [{ line_index: 0, code: '001', qty: 2, menu_item_id: MENU_ITEM_ID }],
    },
    rankedCandidatesJson: {
      candidates: [{ userId: USER_ID, score: 140, reasons: ['CELL_EXACT', 'NAME_EXACT'] }],
    },
    flags: null,
    ...overrides,
  } as Sheet;
}

function makeTemplate(overrides: Partial<OmrFormTemplate> = {}): OmrFormTemplate {
  return {
    id: TEMPLATE_ID,
    revision: 'generic-r1',
    mode: OmrFormMode.CODE,
    orientation: OmrFormOrientation.PORTRAIT,
    geometryHash: 'a'.repeat(64),
    catalogHash: null,
    isActive: true,
    retiredAt: null,
    rows: [],
    ...overrides,
  } as OmrFormTemplate;
}

function makeUser(id = USER_ID): User {
  return {
    id,
    legacyId: id === USER_ID ? 'P-001' : 'P-002',
    name: id === USER_ID ? 'Nguyễn Văn An' : 'Trần Văn Bình',
    zone: 'Khu A',
    cell: 'A-01',
    isActive: true,
  } as User;
}

function makeDto(overrides: Partial<ConfirmScanDto> = {}): ConfirmScanDto {
  return {
    userId: USER_ID,
    items: [{ menuItemId: MENU_ITEM_ID, quantity: 2 }],
    ...overrides,
  } as ConfirmScanDto;
}

function buildHarness(options: {
  sheet?: Sheet;
  template?: OmrFormTemplate | null;
  user?: User;
  existingOrder?: Order | null;
  rows?: OmrFormTemplateRow[];
} = {}) {
  const sheet = options.sheet ?? makeSheet();
  const template = options.template === undefined ? makeTemplate() : options.template;
  const user = options.user ?? makeUser();
  const existingOrder = options.existingOrder ?? null;
  const rows = options.rows ?? [];
  const createdOrder = {
    id: '66666666-6666-4666-8666-666666666666',
    userId: user.id,
    serviceDate: sheet.serviceDate,
    items: [],
  } as unknown as OrderWithItems;
  const createOrReplace = jest.fn(async (input: CreateOrReplaceInput) => {
    if (existingOrder && input.replacementAcknowledged === false) {
      throw new ConflictException({ code: 'VERIFY.REPLACEMENT_ACK_REQUIRED' });
    }
    return { order: createdOrder, replaced: existingOrder !== null };
  });
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Sheet) return sheet;
      if (entity === OmrFormTemplate) return template;
      if (entity === Order) return existingOrder;
      return null;
    }),
    find: jest.fn(async (entity: unknown) => entity === OmrFormTemplateRow ? rows : []),
    save: jest.fn(async (_entity: unknown, value: Sheet) => value),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<unknown>) =>
      work(em as unknown as EntityManager)),
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
    dataSource: dataSource as unknown as DataSource,
    menuService: {
      listAll: jest.fn().mockResolvedValue([{ id: MENU_ITEM_ID, code: '001', name: 'Rice' }]),
    },
    ordersService: { createOrReplaceWithOutcome: createOrReplace },
    zoneAccess,
    workflowMode: { assertOmrConfirmationEnabled: jest.fn() },
    logger: { warn: jest.fn() },
  }) as VerifyService;
  return { svc, sheet, template, user, em, dataSource, createOrReplace, zoneAccess };
}

describe('VerifyService.confirm — generic identity resolution', () => {
  it('requires explicit selection and does not enter the transaction without userId', async () => {
    const { svc, dataSource, createOrReplace } = buildHarness();
    await expect(svc.confirm(SHEET_ID, makeDto({ userId: undefined }), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.IDENTITY_REQUIRED' },
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(createOrReplace).not.toHaveBeenCalled();
  });

  it('commits top-ranked explicit selection, order, debit funnel, and identity audit atomically', async () => {
    const { svc, sheet, createOrReplace } = buildHarness();
    const result = await svc.confirm(SHEET_ID, makeDto(), ACTOR);

    expect(createOrReplace).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      serviceDate: sheet.serviceDate,
      sheetId: SHEET_ID,
      source: 'omr',
      operatorId: ACTOR.id,
      replacementAcknowledged: false,
      items: [{ menuItemId: MENU_ITEM_ID, quantity: 2 }],
    }), expect.anything());
    expect(sheet.proposedUserId).toBeNull();
    expect(sheet.matchedUserId).toBe(USER_ID);
    expect(sheet.identitySelectedBy).toBe(ACTOR.id);
    expect(sheet.identitySelectedAt).toBeInstanceOf(Date);
    expect(sheet.identitySelectionSource).toBe(IdentitySelectionSource.RANKED_CANDIDATE);
    expect(sheet.identitySelectionReason).toBeNull();
    expect(sheet.status).toBe(SheetStatus.VERIFIED);
    expect(result.replaced).toBe(false);
  });

  it('requires a bounded reason for manual or non-top selection before any money mutation', async () => {
    const { svc, sheet, createOrReplace } = buildHarness({ user: makeUser(OTHER_USER_ID) });
    await expect(svc.confirm(SHEET_ID, makeDto({ userId: OTHER_USER_ID }), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.IDENTITY_REASON_REQUIRED' },
    });
    expect(createOrReplace).not.toHaveBeenCalled();
    expect(sheet.matchedUserId).toBeNull();
    expect(sheet.status).toBe(SheetStatus.FLAGGED);
  });

  it('records a manual selection reason and high-risk audit flag', async () => {
    const { svc, sheet } = buildHarness({ user: makeUser(OTHER_USER_ID) });
    await svc.confirm(SHEET_ID, makeDto({ userId: OTHER_USER_ID, reason: 'Cell text unreadable' }), ACTOR);
    expect(sheet.identitySelectionSource).toBe(IdentitySelectionSource.MANUAL_SEARCH);
    expect(sheet.identitySelectionReason).toBe('Cell text unreadable');
    expect(sheet.flags).toContain('IDENTITY_HIGH_RISK_SELECTION');
  });

  it('rejects a globally valid but unscanned code-mode item before order/debit', async () => {
    const { svc, createOrReplace } = buildHarness();
    await expect(svc.confirm(SHEET_ID, makeDto({
      items: [{ menuItemId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
    }), ACTOR)).rejects.toMatchObject({ response: { code: 'VERIFY.ITEM_NOT_SCANNED' } });
    expect(createOrReplace).not.toHaveBeenCalled();
  });

  it('requires replacement acknowledgement when an active OMR order already exists', async () => {
    const existingOrder = { id: 'existing', status: OrderStatus.ACTIVE } as Order;
    const { svc, createOrReplace } = buildHarness({ existingOrder });
    await expect(svc.confirm(SHEET_ID, makeDto(), ACTOR)).rejects.toMatchObject({
      response: { code: 'VERIFY.REPLACEMENT_ACK_REQUIRED' },
    });
    expect(createOrReplace).toHaveBeenCalledWith(expect.objectContaining({
      replacementAcknowledged: false,
    }), expect.anything());
  });

  it('commits an acknowledged replacement and returns the locked-funnel outcome', async () => {
    const existingOrder = { id: 'existing', status: OrderStatus.ACTIVE } as Order;
    const { svc, createOrReplace } = buildHarness({ existingOrder });

    await expect(svc.confirm(SHEET_ID, makeDto({ replacementAck: true }), ACTOR)).resolves.toMatchObject({
      replaced: true,
    });
    expect(createOrReplace).toHaveBeenCalledWith(expect.objectContaining({
      replacementAcknowledged: true,
    }), expect.anything());
  });

  it('uses immutable full-list rows as item authority', async () => {
    const row = { templateId: TEMPLATE_ID, menuItemId: MENU_ITEM_ID } as OmrFormTemplateRow;
    const { svc, createOrReplace } = buildHarness({
      template: makeTemplate({ mode: OmrFormMode.FULL_LIST }),
      rows: [row],
    });
    await svc.confirm(SHEET_ID, makeDto(), ACTOR);
    expect(createOrReplace).toHaveBeenCalledTimes(1);
  });
});
