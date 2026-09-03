import { DataSource } from 'typeorm';
import { EXPECTED_ROI_VERSION } from '../../../config/threshold-config.service';
import { IssuedOmrForm } from '../../../omr-forms/issued-omr-form.entity';
import { Order } from '../../../orders/order.entity';
import { OrderItem } from '../../../orders/order-item.entity';
import { User } from '../../../users/user.entity';
import { SheetStatus } from '../../sheet-status.enum';
import { Sheet } from '../../sheet.entity';
import { VerifyService } from '../verify.service';
import { OperatorRole } from '../../../operators/operator.entity';
import { OperatorPublic } from '../../../operators/operator-public';

const FORM_TOKEN = '22222222-2222-4222-8222-222222222222';
const FORM_USER_ID = '33333333-3333-4333-8333-333333333333';
const STALE_USER_ID = '44444444-4444-4444-8444-444444444444';
const SERVICE_DATE = '2026-07-15';
const ACTOR = { id: 'operator-1', role: OperatorRole.ADMIN, zone: null } as OperatorPublic;

function makeSheet(): Sheet {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sheetId: 'SHEET-001',
    serviceDate: SERVICE_DATE,
    status: SheetStatus.FLAGGED,
    issuedFormId: FORM_TOKEN,
    matchedUserId: STALE_USER_ID,
    avgConfidence: 0.9,
    resultJson: { order_lines: [] },
    flags: null,
  } as Sheet;
}

function makeUser(): User {
  return {
    id: FORM_USER_ID,
    legacyId: 'P-004218',
    name: 'Issued Form Owner',
    zone: 'A',
    cell: '12',
    isActive: true,
  } as User;
}

function buildHarness(
  forms: IssuedOmrForm[],
  owner: User | null = makeUser(),
  workflowMode = { scannerReviewEnabled: true, omrRuntimeEnabled: true },
) {
  const sheets = [makeSheet()];
  const queryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(sheets),
  };
  const formRepo = { find: jest.fn().mockResolvedValue(forms) };
  const orderRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const orderItemRepo = { find: jest.fn().mockResolvedValue([]) };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === IssuedOmrForm) return formRepo;
      if (entity === Order) return orderRepo;
      if (entity === OrderItem) return orderItemRepo;
      throw new Error('unexpected repository');
    }),
  };
  const usersService = {
    findById: jest.fn(async (id: string) => {
      if (owner && id === owner.id) return owner;
      throw new Error('user not found');
    }),
  };
  const accountsService = { getBalance: jest.fn().mockResolvedValue(87500) };
  const service = Object.assign(Object.create(VerifyService.prototype), {
    sheetRepo: { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) },
    dataSource: dataSource as unknown as DataSource,
    usersService,
    accountsService,
    thresholdConfig: { getRoi: jest.fn().mockResolvedValue({ roiTemplate: {} }) },
    menuService: { listAll: jest.fn().mockResolvedValue([]) },
    purchaseLimits: { getEffective: jest.fn().mockResolvedValue({ food: { enabled: true, amount: 100000 }, essential: { enabled: false, amount: null } }) },
    zoneAccess: { requireOperatorZone: jest.fn().mockReturnValue(null) },
    workflowMode,
    logger: { warn: jest.fn() },
  }) as VerifyService;

  return { service, usersService, accountsService, orderRepo, queryBuilder };
}

describe('VerifyService.getQueue — issued form identity authority', () => {
  const form = {
    token: FORM_TOKEN,
    userId: FORM_USER_ID,
    serviceDate: SERVICE_DATE,
    roiVersion: EXPECTED_ROI_VERSION,
  } as IssuedOmrForm;

  it('loads identity, balance, and supersede lookup exclusively for the form owner', async () => {
    const { service, usersService, accountsService, orderRepo, queryBuilder } = buildHarness([form]);

    const queue = await service.getQueue(ACTOR, SERVICE_DATE, SERVICE_DATE);

    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(usersService.findById).toHaveBeenCalledWith(FORM_USER_ID);
    expect(usersService.findById).not.toHaveBeenCalledWith(STALE_USER_ID);
    expect(accountsService.getBalance).toHaveBeenCalledWith(FORM_USER_ID);
    expect(service['zoneAccess'].requireOperatorZone).toHaveBeenCalledWith(ACTOR);
    expect(orderRepo.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: FORM_USER_ID, serviceDate: SERVICE_DATE }),
    });
    expect(queue.sheets[0]).toMatchObject({
      identity: { id: FORM_USER_ID, legacyId: 'P-004218', name: 'Issued Form Owner' },
      balance: 87500,
    });
  });

  it.each([
    ['missing form', [], makeUser()],
    ['missing form owner', [form], null],
  ])('does not expose stale cached identity for a %s', async (_label, forms, owner) => {
    const { service, usersService, accountsService, orderRepo } = buildHarness(forms, owner);

    const queue = await service.getQueue(ACTOR, SERVICE_DATE, SERVICE_DATE);

    expect(usersService.findById).not.toHaveBeenCalledWith(STALE_USER_ID);
    expect(accountsService.getBalance).not.toHaveBeenCalledWith(STALE_USER_ID);
    expect(orderRepo.findOne).not.toHaveBeenCalled();
    expect(queue.sheets[0].identity).toBeNull();
    expect(queue.sheets[0].balance).toBeNull();
  });

  it.each([
    ['legacy_omr', { scannerReviewEnabled: false, omrRuntimeEnabled: true }, "s.admitted_mode <> 'scanner'"],
    ['scanner_webhook', { scannerReviewEnabled: true, omrRuntimeEnabled: false }, "s.admitted_mode = 'scanner'"],
  ])('applies the %s queue source boundary', async (_mode, workflowMode, expectedClause) => {
    const { service, queryBuilder } = buildHarness([form], makeUser(), workflowMode as {
      scannerReviewEnabled: boolean;
      omrRuntimeEnabled: boolean;
    });

    await service.getQueue(ACTOR, SERVICE_DATE, SERVICE_DATE);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expectedClause);
  });
});
