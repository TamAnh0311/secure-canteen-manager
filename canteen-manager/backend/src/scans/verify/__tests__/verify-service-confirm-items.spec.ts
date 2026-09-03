/**
 * Unit tests for VerifyService.confirm with the items[] (code+qty) path.
 * Verifies money-safety: unknown menuItemId is rejected before createOrReplace is called.
 */
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { VerifyService } from '../verify.service';
import { Sheet } from '../../sheet.entity';
import { SheetStatus } from '../../sheet-status.enum';
import { Order, OrderStatus } from '../../../orders/order.entity';
import { ScanStorageService } from '../../scan-storage.service';
import { OmrClientService } from '../../../omr/omr-client.service';
import { UsersService } from '../../../users/users.service';
import { MenuService } from '../../../menu/menu.service';
import { ThresholdConfigService } from '../../../config/threshold-config.service';
import { AccountsService } from '../../../accounts/accounts.service';
import { CreateOrReplaceInput, OrdersService, OrderWithItems } from '../../../orders/orders.service';
import { MenuItem } from '../../../menu/menu-item.entity';
import { ConfirmScanDto } from '../dto/confirm-scan.dto';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../../../omr-forms/issued-omr-form.entity';
import { User } from '../../../users/user.entity';
import { EXPECTED_ROI_VERSION } from '../../../config/threshold-config.service';
import { PurchaseLimitConfigService } from '../../../purchase-limit-config/purchase-limit-config.service';
import { OperatorZoneAccessService } from '../../../auth/operator-zone-access.service';
import { ScanWorkflowModeService } from '../../../config/scan-workflow-mode.service';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../../../config/env-validation';
import { OperatorRole } from '../../../operators/operator.entity';
import { OperatorPublic } from '../../../operators/operator-public';
import { MenuItemCategory } from '../../../menu/menu-item-category.enum';

const ACTOR = { id: 'op-1', role: OperatorRole.ADMIN, zone: null } as OperatorPublic;
const SHEET_DATE = '2026-06-20';
const FORM_TOKEN = '11111111-1111-4111-8111-111111111111';
const FORM_USER_ID = '22222222-2222-4222-8222-222222222222';

function makeMenuItem(code: string, id: string, isActive = true): MenuItem {
  return { id, code, name: `item-${code}`, price: 5000, position: 0, category: MenuItemCategory.FOOD, isActive } as MenuItem;
}

interface Stubs {
  sheet: Sheet;
  menuItems: MenuItem[];
  existingOrder: Order | null;
  createOrReplace: jest.Mock;
}

function buildService(stubs: Partial<Stubs> = {}) {
  const sheet: Sheet =
    stubs.sheet ??
    ({
      id: 'sheet-1',
      serviceDate: SHEET_DATE,
      status: SheetStatus.FLAGGED,
      issuedFormId: FORM_TOKEN,
    } as Sheet);

  const user = {
    id: FORM_USER_ID,
    legacyId: '100001',
    isActive: true,
  } as User;
  const form = {
    token: FORM_TOKEN,
    userId: user.id,
    user,
    serviceDate: SHEET_DATE,
    roiVersion: EXPECTED_ROI_VERSION,
    templateId: '33333333-3333-4333-8333-333333333333',
    status: IssuedOmrFormStatus.ISSUED,
    reservedSheetId: sheet.id,
    consumedSheetId: null,
    consumedAt: null,
  } as IssuedOmrForm;

  const menuItems: MenuItem[] =
    stubs.menuItems ?? [
      makeMenuItem('001', 'menu-001'),
      makeMenuItem('002', 'menu-002'),
      makeMenuItem('003', 'menu-003-inactive', false),
    ];

  const existingOrder = stubs.existingOrder ?? null;

  const captured: { input?: CreateOrReplaceInput } = {};
  const createOrReplace =
    stubs.createOrReplace ??
    jest.fn(async (input: CreateOrReplaceInput) => {
      captured.input = input;
      return { id: 'order-1', serviceDate: input.serviceDate, items: [] } as unknown as OrderWithItems;
    });

  const em: { findOne: jest.Mock; save: jest.Mock } = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Sheet) return sheet;
      if (entity === IssuedOmrForm) return form;
      if (entity === User) return user;
      if (entity === Order) return existingOrder;
      return null;
    }),
    save: jest.fn(async (_entity: unknown, value: Sheet) => value),
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (m: typeof em) => Promise<unknown>) => cb(em)),
  } as unknown as DataSource;

  const authorizedSheetQuery = {
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(sheet),
  };
  const sheetRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(authorizedSheetQuery),
  } as unknown as Repository<Sheet>;
  const storage = {} as unknown as ScanStorageService;
  const omrClient = {} as unknown as OmrClientService;
  const usersService = {
    assertActive: jest.fn(async () => user),
  } as unknown as UsersService;
  const menuService = {
    listAll: jest.fn(async () => menuItems),
  } as unknown as MenuService;
  const thresholdConfig = {} as unknown as ThresholdConfigService;
  const ordersService = { createOrReplace } as unknown as OrdersService;
  const accountsService = {} as unknown as AccountsService;

  const svc = new VerifyService(
    sheetRepo,
    storage,
    omrClient,
    usersService,
    menuService,
    thresholdConfig,
    ordersService,
    accountsService,
    dataSource,
    {} as PurchaseLimitConfigService,
    {
      requireOperatorZone: jest.fn().mockReturnValue(null),
      scopeByUser: jest.fn(),
      assertUserAccess: jest.fn().mockResolvedValue(user),
    } as unknown as OperatorZoneAccessService,
    { assertOmrConfirmationEnabled: jest.fn() } as unknown as ScanWorkflowModeService,
    { get: jest.fn() } as unknown as ConfigService<AppEnv, true>,
  );

  return { svc, em, createOrReplace, captured };
}

function makeDto(
  items: { menuItemId: string; quantity: number }[],
  replacementAck = false,
): ConfirmScanDto {
  return {
    items,
    replacementAck,
  } as ConfirmScanDto;
}

describe('VerifyService.confirm — items[] path', () => {
  it('passes items directly to createOrReplace with correct quantities', async () => {
    const { svc, captured } = buildService();

    await svc.confirm('sheet-1', makeDto([
      { menuItemId: 'menu-001', quantity: 2 },
      { menuItemId: 'menu-002', quantity: 1 },
    ]), ACTOR);

    expect(captured.input?.items).toEqual([
      { menuItemId: 'menu-001', quantity: 2 },
      { menuItemId: 'menu-002', quantity: 1 },
    ]);
    expect(captured.input?.serviceDate).toBe(SHEET_DATE);
    expect(captured.input?.source).toBe('omr');
    expect(captured.input?.operatorId).toBe('op-1');
  });

  it('rejects unknown menuItemId with VERIFY.UNKNOWN_MENU_ITEM (money-safety)', async () => {
    const { svc } = buildService();

    await expect(
      svc.confirm('sheet-1', makeDto([
        { menuItemId: 'menu-001', quantity: 1 },
        { menuItemId: 'menu-UNKNOWN', quantity: 1 }, // not in menu
      ]), ACTOR),
    ).rejects.toThrow(BadRequestException);

    await expect(
      svc.confirm('sheet-1', makeDto([
        { menuItemId: 'menu-UNKNOWN', quantity: 1 },
      ]), ACTOR),
    ).rejects.toMatchObject({ response: { code: 'VERIFY.UNKNOWN_MENU_ITEM' } });
  });

  it('allows an inactive menuItemId (omr path resolves inactive items)', async () => {
    const { svc, captured } = buildService();

    await svc.confirm('sheet-1', makeDto([
      { menuItemId: 'menu-003-inactive', quantity: 1 },
    ]), ACTOR);

    expect(captured.input?.items).toEqual([{ menuItemId: 'menu-003-inactive', quantity: 1 }]);
  });

  it('reports replaced=true when an active omr order already exists for the prisoner+date', async () => {
    const existingOrder = {
      id: 'prior-order',
      serviceDate: SHEET_DATE,
      status: OrderStatus.ACTIVE,
    } as Order;
    const { svc } = buildService({ existingOrder });

    const result = await svc.confirm('sheet-1', makeDto([
      { menuItemId: 'menu-001', quantity: 1 },
    ], true), ACTOR);

    expect(result.replaced).toBe(true);
  });

  it('reports replaced=false when no prior order exists', async () => {
    const { svc } = buildService({ existingOrder: null });

    const result = await svc.confirm('sheet-1', makeDto([
      { menuItemId: 'menu-001', quantity: 1 },
    ]), ACTOR);

    expect(result.replaced).toBe(false);
  });
});
