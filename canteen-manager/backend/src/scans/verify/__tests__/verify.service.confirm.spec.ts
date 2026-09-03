import { plainToInstance } from 'class-transformer';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { EXPECTED_ROI_VERSION } from '../../../config/threshold-config.service';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../../../omr-forms/issued-omr-form.entity';
import { Order, OrderStatus } from '../../../orders/order.entity';
import { CreateOrReplaceInput, OrderWithItems } from '../../../orders/orders.service';
import { User } from '../../../users/user.entity';
import { SheetStatus } from '../../sheet-status.enum';
import { Sheet } from '../../sheet.entity';
import { ConfirmScanDto } from '../dto/confirm-scan.dto';
import { VerifyService } from '../verify.service';
import { OperatorRole } from '../../../operators/operator.entity';
import { OperatorPublic } from '../../../operators/operator-public';

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const FORM_TOKEN = '22222222-2222-4222-8222-222222222222';
const FORM_USER_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_USER_ID = '44444444-4444-4444-8444-444444444444';
const MENU_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const SERVICE_DATE = '2026-07-15';

function actor(id = 'operator-1'): OperatorPublic {
  return { id, role: OperatorRole.ADMIN, zone: null } as OperatorPublic;
}

function zoneOperator(zone: string | null): OperatorPublic {
  return { id: 'operator-zone', role: OperatorRole.OPERATOR, zone } as OperatorPublic;
}

const itemsOnlyDto = (): ConfirmScanDto =>
  ({ items: [{ menuItemId: MENU_ITEM_ID, quantity: 2 }] }) as ConfirmScanDto;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: FORM_USER_ID,
    legacyId: 'P-004218',
    name: 'Issued Form Owner',
    zone: 'A',
    cell: '12',
    isActive: true,
    ...overrides,
  } as User;
}

function makeForm(overrides: Partial<IssuedOmrForm> = {}): IssuedOmrForm {
  const user = makeUser();
  return {
    token: FORM_TOKEN,
    userId: user.id,
    user,
    serviceDate: SERVICE_DATE,
    roiVersion: EXPECTED_ROI_VERSION,
    templateId: '33333333-3333-4333-8333-333333333333',
    status: IssuedOmrFormStatus.ISSUED,
    reservedSheetId: SHEET_ID,
    consumedSheetId: null,
    consumedAt: null,
    voidReason: null,
    ...overrides,
  } as IssuedOmrForm;
}

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: SHEET_ID,
    sheetId: 'SHEET-001',
    serviceDate: SERVICE_DATE,
    status: SheetStatus.FLAGGED,
    issuedFormId: FORM_TOKEN,
    // Deliberately attacker-controlled/stale cache data. The form must win.
    matchedUserId: CLIENT_USER_ID,
    recognizedId: 'P-ATTACKER',
    orderId: null,
    rejectionCode: null,
    flags: null,
    ...overrides,
  } as Sheet;
}

interface HarnessOverrides {
  sheet?: Sheet;
  form?: IssuedOmrForm | null;
  user?: User | null;
  existingOrder?: Order | null;
  createOrReplace?: jest.Mock;
  save?: jest.Mock;
}

function buildHarness(overrides: HarnessOverrides = {}) {
  const sheet = overrides.sheet ?? makeSheet();
  const form = overrides.form === undefined ? makeForm() : overrides.form;
  const user = overrides.user === undefined ? form?.user ?? makeUser() : overrides.user;
  const existingOrder = overrides.existingOrder ?? null;
  const createdOrder = {
    id: '66666666-6666-4666-8666-666666666666',
    userId: FORM_USER_ID,
    serviceDate: SERVICE_DATE,
    items: [],
  } as unknown as OrderWithItems;
  const captured: { input?: CreateOrReplaceInput } = {};
  const createOrReplace =
    overrides.createOrReplace ??
    jest.fn(async (input: CreateOrReplaceInput) => {
      captured.input = input;
      return createdOrder;
    });

  const em = {
    findOne: jest.fn(async (entity: unknown, _options?: unknown) => {
      if (entity === Sheet) return sheet;
      if (entity === IssuedOmrForm) return form;
      if (entity === User) return user;
      if (entity === Order) return existingOrder;
      return null;
    }),
    save:
      overrides.save ??
      jest.fn(async (_entity: unknown, value: Sheet | IssuedOmrForm) => value),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<unknown>) =>
      work(em as unknown as EntityManager),
    ),
  };
  const authorizedSheetQuery = {
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => sheet),
  };
  const zoneAccess = {
    requireOperatorZone: jest.fn((currentActor: OperatorPublic) => {
      if (currentActor.role === OperatorRole.OPERATOR && !currentActor.zone) {
        throw new ForbiddenException({
          message: 'Operator zone assignment required',
          code: 'AUTH.OPERATOR_ZONE_REQUIRED',
        });
      }
      return currentActor.role === OperatorRole.OPERATOR ? currentActor.zone : null;
    }),
    scopeByUser: jest.fn(),
    assertUserAccess: jest.fn(async () => user),
  };

  // Construct without binding tests to constructor growth while Phase 3 adds
  // issued-form collaborators. The method's actual dependencies are explicit here.
  const svc = Object.assign(Object.create(VerifyService.prototype), {
    dataSource: dataSource as unknown as DataSource,
    sheetRepo: {
      findOne: jest.fn(async () => sheet),
      save: jest.fn(async (value: Sheet) => value),
      createQueryBuilder: jest.fn(() => authorizedSheetQuery),
    },
    usersService: {
      assertActive: jest.fn(async () => user),
    },
    menuService: {
      listAll: jest.fn(async () => [{ id: MENU_ITEM_ID }]),
    },
    ordersService: { createOrReplace },
    zoneAccess,
    workflowMode: { assertOmrConfirmationEnabled: jest.fn() },
  }) as VerifyService;

  return {
    svc,
    dataSource,
    em,
    sheet,
    form,
    user,
    createOrReplace,
    captured,
    createdOrder,
    authorizedSheetQuery,
    zoneAccess,
  };
}

describe('ConfirmScanDto — issued form is the only identity authority', () => {
  const validationOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
  } as const;

  it('accepts the breaking items-only request contract', async () => {
    const dto = plainToInstance(ConfirmScanDto, {
      items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
    });

    await expect(validate(dto, validationOptions)).resolves.toHaveLength(0);
  });

  it('accepts userId as the binding-aware generic identity field', async () => {
    const dto = plainToInstance(ConfirmScanDto, {
      items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      userId: CLIENT_USER_ID,
    });

    await expect(validate(dto, validationOptions)).resolves.toHaveLength(0);
  });

  it('rejects legacy recognized identity input as non-whitelisted', async () => {
    const field = 'idDigits';
    const dto = plainToInstance(ConfirmScanDto, {
      items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
      [field]: 'P-ATTACKER',
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: field,
          constraints: expect.objectContaining({ whitelistValidation: expect.any(String) }),
        }),
      ]),
    );
  });
});

describe('VerifyService.confirm — locked issued identity and atomic form consumption', () => {
  it('rejects a userId override on an issued sheet before money mutation', async () => {
    const { svc, createOrReplace } = buildHarness();
    await expect(svc.confirm(SHEET_ID, {
      ...itemsOnlyDto(),
      userId: CLIENT_USER_ID,
    }, actor())).rejects.toMatchObject({ response: { code: 'VERIFY.IDENTITY_NOT_ALLOWED' } });
    expect(createOrReplace).not.toHaveBeenCalled();
  });

  it('fails an unassigned OPERATOR before looking up either an existing or missing sheet', async () => {
    const { svc, authorizedSheetQuery } = buildHarness();

    await expect(
      svc.confirm(SHEET_ID, itemsOnlyDto(), zoneOperator(null)),
    ).rejects.toMatchObject({
      response: { code: 'AUTH.OPERATOR_ZONE_REQUIRED' },
    });

    expect(authorizedSheetQuery.getOne).not.toHaveBeenCalled();
  });

  it('reads binding, then locks issued form → sheet → user and derives order user from the form', async () => {
    const { svc, em, captured, sheet, form } = buildHarness();

    await svc.confirm(SHEET_ID, itemsOnlyDto(), actor());

    const writeLocks = em.findOne.mock.calls
      .filter(([, options]) =>
        (options as { lock?: { mode?: string } } | undefined)?.lock?.mode === 'pessimistic_write',
      )
      .map(([entity]) => entity);
    expect(writeLocks.slice(0, 2)).toEqual([IssuedOmrForm, Sheet]);
    expect(em.findOne).toHaveBeenCalledWith(
      Sheet,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(em.findOne).toHaveBeenCalledWith(
      IssuedOmrForm,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(captured.input).toMatchObject({
      userId: FORM_USER_ID,
      sheetId: SHEET_ID,
      serviceDate: SERVICE_DATE,
      items: [{ menuItemId: MENU_ITEM_ID, quantity: 2 }],
    });
    expect(sheet.matchedUserId).toBe(FORM_USER_ID);
    expect(form?.status).toBe(IssuedOmrFormStatus.CONSUMED);
    expect(form?.consumedSheetId).toBe(SHEET_ID);
    expect(form?.consumedAt).toBeInstanceOf(Date);
    expect(sheet.status).toBe(SheetStatus.VERIFIED);
  });

  it.each([
    ['missing form', null, SheetStatus.FLAGGED],
    ['void form', makeForm({ status: IssuedOmrFormStatus.VOID }), SheetStatus.REJECTED],
    [
      'reservation owned by another sheet',
      makeForm({ reservedSheetId: '77777777-7777-4777-8777-777777777777' }),
      SheetStatus.REJECTED,
    ],
    ['stale service date', makeForm({ serviceDate: '2026-07-14' }), SheetStatus.REJECTED],
    ['missing form template binding', makeForm({ templateId: '' }), SheetStatus.REJECTED],
    ['inactive prisoner', makeForm({ user: makeUser({ isActive: false }) }), SheetStatus.FLAGGED],
  ])('fails closed for %s before any order/debit or verification', async (_label, invalidForm, expectedStatus) => {
    const sheet = makeSheet();
    const { svc, em, createOrReplace } = buildHarness({
      sheet,
      form: invalidForm as IssuedOmrForm | null,
      user: invalidForm ? (invalidForm as IssuedOmrForm).user : null,
    });

    await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toBeDefined();

    expect(em.findOne).toHaveBeenCalledWith(
      IssuedOmrForm,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(createOrReplace).not.toHaveBeenCalled();
    expect(sheet.status).toBe(expectedStatus);
    expect(sheet.orderId).toBeNull();
    if (invalidForm) {
      expect((invalidForm as IssuedOmrForm).consumedSheetId).toBeNull();
    }
  });

  it('propagates an order/debit failure without consuming the form or verifying the sheet', async () => {
    const orderFailure = new BadRequestException({
      message: 'food subtotal exceeds limit',
      code: 'ORDER.CATEGORY_LIMIT_EXCEEDED',
      audience: 'prisoner',
      category: 'food',
      actualAmount: 100001,
      limitAmount: 100000,
    });
    const createOrReplace = jest.fn().mockRejectedValue(orderFailure);
    const sheet = makeSheet();
    const form = makeForm();
    const { svc } = buildHarness({ sheet, form, createOrReplace });

    await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toBe(orderFailure);

    expect(sheet.status).toBe(SheetStatus.FLAGGED);
    expect(sheet.orderId).toBeNull();
    expect(form.status).toBe(IssuedOmrFormStatus.ISSUED);
    expect(form.consumedSheetId).toBeNull();
    expect(form.consumedAt).toBeNull();
  });

  it('maps a current cross-zone owner to SHEET.NOT_FOUND before any side effect', async () => {
    const sheet = makeSheet();
    const form = makeForm();
    const { svc, em, createOrReplace } = buildHarness({ sheet, form });
    (svc['zoneAccess'].assertUserAccess as jest.Mock).mockRejectedValue(
      new NotFoundException({ message: 'User not found', code: 'USER.NOT_FOUND' }),
    );

    await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toMatchObject({
      response: { code: 'SHEET.NOT_FOUND' },
    });

    expect(createOrReplace).not.toHaveBeenCalled();
    expect(em.save).not.toHaveBeenCalled();
    expect(form.status).toBe(IssuedOmrFormStatus.ISSUED);
    expect(sheet.status).toBe(SheetStatus.FLAGGED);
    expect(sheet.orderId).toBeNull();
  });

  it('does not reveal a cross-zone sheet state before returning SHEET.NOT_FOUND', async () => {
    const sheet = makeSheet({ status: SheetStatus.VERIFIED });
    const { svc, em, createOrReplace } = buildHarness({ sheet });
    (svc['zoneAccess'].assertUserAccess as jest.Mock).mockRejectedValue(
      new NotFoundException({ message: 'User not found', code: 'USER.NOT_FOUND' }),
    );

    await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toMatchObject({
      response: { code: 'SHEET.NOT_FOUND' },
    });

    expect(createOrReplace).not.toHaveBeenCalled();
    expect(em.save).not.toHaveBeenCalled();
  });

  it.each([IssuedOmrForm, Sheet])(
    'rolls back order/debit, form consumption, and verification when saving %p fails',
    async (failingEntity) => {
      const persisted = { orders: 0, debits: 0 };
      const createOrReplace = jest.fn(async (input: CreateOrReplaceInput) => {
        persisted.orders += 1;
        persisted.debits += 1;
        return {
          id: '66666666-6666-4666-8666-666666666666',
          userId: input.userId,
          serviceDate: input.serviceDate,
          items: [],
        } as unknown as OrderWithItems;
      });
      const sheet = makeSheet();
      const form = makeForm();
      const { svc, dataSource, em } = buildHarness({ sheet, form, createOrReplace });
      const sheetSnapshot = { ...sheet };
      const formSnapshot = { ...form };
      em.save.mockImplementation(async (entity: unknown, value: Sheet | IssuedOmrForm) => {
        if (entity === failingEntity) throw new Error('injected persistence failure');
        return value;
      });
      dataSource.transaction.mockImplementation(async (work: (manager: EntityManager) => Promise<unknown>) => {
        try {
          return await work(em as unknown as EntityManager);
        } catch (error) {
          // Model TypeORM/Postgres rollback of every write made through this manager.
          Object.assign(sheet, sheetSnapshot);
          Object.assign(form, formSnapshot);
          persisted.orders = 0;
          persisted.debits = 0;
          throw error;
        }
      });

      await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toThrow(
        'injected persistence failure',
      );

      expect(createOrReplace).toHaveBeenCalledTimes(1);
      expect(persisted).toEqual({ orders: 0, debits: 0 });
      expect(sheet.status).toBe(SheetStatus.FLAGGED);
      expect(sheet.orderId).toBeNull();
      expect(form.status).toBe(IssuedOmrFormStatus.ISSUED);
      expect(form.consumedSheetId).toBeNull();
      expect(form.consumedAt).toBeNull();
    },
  );

  it('commits a consumed-token race loser as terminal REJECTED with no money mutation', async () => {
    const sheet = makeSheet();
    const form = makeForm({
      status: IssuedOmrFormStatus.CONSUMED,
      consumedSheetId: '88888888-8888-4888-8888-888888888888',
      consumedAt: new Date('2026-07-14T01:00:00Z'),
    });
    const { svc, createOrReplace } = buildHarness({ sheet, form });

    await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toMatchObject({
      response: { code: 'OMR_FORM.ALREADY_CONSUMED' },
    });

    expect(createOrReplace).not.toHaveBeenCalled();
    expect(sheet.status).toBe(SheetStatus.REJECTED);
    expect(sheet.rejectionCode).toBe('OMR_FORM.ALREADY_CONSUMED');
    expect(sheet.orderId).toBeNull();
  });

  it('requires acknowledgement and preserves supersede detection across the scanned channel', async () => {
    const prior = { id: 'prior', status: OrderStatus.ACTIVE } as Order;
    const { svc, em } = buildHarness({ existingOrder: prior });

    await expect(svc.confirm(SHEET_ID, itemsOnlyDto(), actor())).rejects.toMatchObject({
      response: { code: 'VERIFY.REPLACEMENT_ACK_REQUIRED' },
    });
    const result = await svc.confirm(
      SHEET_ID,
      { ...itemsOnlyDto(), replacementAck: true },
      actor(),
    );

    expect(result.replaced).toBe(true);
    const orderLookup = em.findOne.mock.calls.find(([entity]) => entity === Order);
    expect(orderLookup?.[1]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: FORM_USER_ID,
          serviceDate: SERVICE_DATE,
        }),
      }),
    );
  });

  it('allows only one order/debit when two sheets race on the same issued token', async () => {
    const first = makeSheet();
    const second = makeSheet({
      id: '99999999-9999-4999-8999-999999999999',
      sheetId: 'SHEET-002',
    });
    const form = makeForm({ reservedSheetId: first.id });
    const { svc, dataSource, em, createOrReplace } = buildHarness({ sheet: first, form });
    const sheets = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    em.findOne.mockImplementation(async (entity: unknown, options?: unknown) => {
      const where = (options as { where?: { id?: string } } | undefined)?.where;
      if (entity === Sheet) return where?.id ? sheets.get(where.id) ?? null : null;
      if (entity === IssuedOmrForm) return form;
      if (entity === User) return form.user;
      if (entity === Order) return null;
      return null;
    });

    // A serialized transaction seam models the row-lock ordering of real Postgres:
    // the second transaction observes the first transaction's consumed form state.
    let transactionTail = Promise.resolve<unknown>(undefined);
    dataSource.transaction.mockImplementation((work: (manager: EntityManager) => Promise<unknown>) => {
      const result = transactionTail.then(() => work(em as unknown as EntityManager));
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });

    const results = await Promise.allSettled([
      svc.confirm(first.id, itemsOnlyDto(), actor()),
      svc.confirm(second.id, itemsOnlyDto(), actor('operator-2')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(createOrReplace).toHaveBeenCalledTimes(1);
    expect(form.status).toBe(IssuedOmrFormStatus.CONSUMED);
    expect(form.consumedSheetId).toBe(first.id);
    expect(first.status).toBe(SheetStatus.VERIFIED);
    expect(second.status).toBe(SheetStatus.REJECTED);
    expect(second.rejectionCode).toBe('OMR_FORM.ALREADY_CONSUMED');
    expect([first.orderId, second.orderId].filter(Boolean)).toHaveLength(1);
  });

  it('serializes confirm versus reject so only one terminal transition can win', async () => {
    const sheet = makeSheet();
    const form = makeForm();
    const { svc, dataSource, em, createOrReplace } = buildHarness({ sheet, form });
    let transactionTail = Promise.resolve<unknown>(undefined);
    dataSource.transaction.mockImplementation((work: (manager: EntityManager) => Promise<unknown>) => {
      const result = transactionTail.then(() => work(em as unknown as EntityManager));
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });

    const confirming = svc.confirm(SHEET_ID, itemsOnlyDto(), actor());
    // Let confirm enqueue its transaction after its read-only menu validation.
    await Promise.resolve();
    const rejecting = svc.reject(SHEET_ID, actor());
    const results = await Promise.allSettled([confirming, rejecting]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([SheetStatus.VERIFIED, SheetStatus.REJECTED]).toContain(sheet.status);
    if (sheet.status === SheetStatus.VERIFIED) {
      expect(createOrReplace).toHaveBeenCalledTimes(1);
      expect(form.status).toBe(IssuedOmrFormStatus.CONSUMED);
      expect(sheet.orderId).toBeTruthy();
    } else {
      expect(createOrReplace).not.toHaveBeenCalled();
      expect(form.status).toBe(IssuedOmrFormStatus.ISSUED);
      expect(sheet.orderId).toBeNull();
    }
  });
});

describe('VerifyService.reject — terminal transition uses the same sheet lock', () => {
  it('locks the current prisoner before writing REJECTED', async () => {
    const { svc, dataSource, em, sheet, zoneAccess } = buildHarness();

    await svc.reject(SHEET_ID, actor());

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(em.findOne).toHaveBeenCalledWith(
      Sheet,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(zoneAccess.assertUserAccess).toHaveBeenCalledWith(
      actor(),
      FORM_USER_ID,
      em,
      true,
    );
    expect(zoneAccess.assertUserAccess.mock.invocationCallOrder[0])
      .toBeLessThan(em.save.mock.invocationCallOrder[0]);
    expect(sheet.status).toBe(SheetStatus.REJECTED);
    expect(em.save).toHaveBeenCalledWith(Sheet, sheet);
  });
});
