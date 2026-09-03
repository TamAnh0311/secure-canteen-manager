import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AccountTransaction, AccountTransactionType } from '../src/accounts/account-transaction.entity';
import { AccountsService } from '../src/accounts/accounts.service';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { Order, OrderStatus } from '../src/orders/order.entity';
import { IssuedOmrForm, IssuedOmrFormStatus } from '../src/omr-forms/issued-omr-form.entity';
import {
  OmrOperationalFormMode,
  ScanAdmissionSource,
  Sheet,
} from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';
import { User } from '../src/users/user.entity';
import {
  E2EContext,
  SeededMenuItem,
  createE2EApp,
  login,
  seedGlobalMenu,
  seedOperator,
  seedIssuedForm,
  seedUser,
  tomorrow,
  truncate,
} from './setup/e2e-bootstrap';

const FUND_AMOUNT = 500_000;
const OPERATOR_ZONE = 'Khu A';

describe('OMR identity and confirmation safety (e2e)', () => {
  let ctx: E2EContext;
  let app: INestApplication;
  let dataSource: DataSource;
  let accounts: AccountsService;
  let operator: Operator;
  let operatorToken: string;
  let boundUser: User;
  let decoyUser: User;
  let menu: SeededMenuItem[];

  const auth = (test: request.Test): request.Test =>
    test.set('Authorization', `Bearer ${operatorToken}`);

  beforeAll(async () => {
    ctx = await createE2EApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    accounts = ctx.moduleRef.get(AccountsService);
  });

  beforeEach(async () => {
    await truncate(dataSource, [
      'account_transactions',
      'prisoner_accounts',
      'order_items',
      'orders',
      'issued_omr_forms',
      'sheets',
      'menu_items',
      'users',
      'operators',
    ]);

    operator = await seedOperator(dataSource, 'omr_safety_operator', OperatorRole.OPERATOR);
    operator.zone = OPERATOR_ZONE;
    operator = await dataSource.getRepository(Operator).save(operator);
    operatorToken = await login(app, operator.username);
    boundUser = await seedUser(dataSource, 'SYNTH-100001', 'Synthetic Bound User');
    decoyUser = await seedUser(dataSource, 'SYNTH-999999', 'Synthetic Decoy User');
    boundUser.zone = OPERATOR_ZONE;
    decoyUser.zone = OPERATOR_ZONE;
    [boundUser, decoyUser] = await dataSource.getRepository(User).save([boundUser, decoyUser]);
    menu = await seedGlobalMenu(dataSource);
    await accounts.credit({
      userId: boundUser.id,
      amount: FUND_AMOUNT,
      type: AccountTransactionType.TOPUP,
      operatorId: operator.id,
      method: 'cash',
      ref: 'synthetic-e2e-funding',
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await truncate(dataSource, [
        'account_transactions',
        'prisoner_accounts',
        'order_items',
        'orders',
        'issued_omr_forms',
        'sheets',
        'menu_items',
        'users',
        'operators',
      ]);
    }
    await app?.close();
  });

  async function createFlaggedSheet(overrides: Partial<Sheet> = {}): Promise<Sheet> {
    const id = overrides.id ?? randomUUID();
    return dataSource.getRepository(Sheet).save(
      dataSource.getRepository(Sheet).create({
        id,
        sheetId: `SYNTH-${id.slice(0, 8)}`,
        batch: 'identity-safety-e2e',
        serviceDate: tomorrow(),
        admittedAt: new Date(),
        admissionSource: ScanAdmissionSource.AGENT,
        admittedMode: OmrOperationalFormMode.ISSUED,
        admittedGeneration: 'issued-v1',
        admittedBy: null,
        checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        imagePath: `${id}.png`,
        status: SheetStatus.FLAGGED,
        resultJson: { order_lines: [] },
        avgConfidence: 0.91,
        recognizedId: decoyUser.legacyId,
        matchedUserId: decoyUser.id,
        issuedFormId: null,
        rejectionCode: null,
        processingAttempts: 1,
        nextRetryAt: null,
        lastErrorCode: null,
        orderId: null,
        flags: ['SYNTHETIC_REVIEW'],
        processedAt: new Date(),
        ...overrides,
      }),
    );
  }

  async function bindIssuedForm(
    sheet: Sheet,
    overrides: Partial<IssuedOmrForm> = {},
  ): Promise<IssuedOmrForm> {
    const token = overrides.token ?? randomUUID();
    const status = overrides.status ?? IssuedOmrFormStatus.ISSUED;
    const form = await seedIssuedForm(dataSource, {
      token,
      userId: boundUser.id,
      serviceDate: overrides.serviceDate ?? sheet.serviceDate,
      roiVersion: overrides.roiVersion,
      issuedBy: operator.id,
      status,
      reservedSheetId: sheet.id,
      consumedSheetId: status === IssuedOmrFormStatus.CONSUMED ? sheet.id : null,
    });
    sheet.issuedFormId = form.token;
    // The binding lives in issued_form_id; bearer tokens are not retained in result_json.
    sheet.resultJson = { order_lines: [] };
    await dataSource.getRepository(Sheet).save(sheet);
    return form;
  }

  async function effectCounts(): Promise<{
    orders: number;
    activeOrders: number;
    debits: number;
    debitTotal: number;
  }> {
    const orderRepo = dataSource.getRepository(Order);
    const ledgerRepo = dataSource.getRepository(AccountTransaction);
    const orders = await orderRepo.count();
    const activeOrders = await orderRepo.count({ where: { status: OrderStatus.ACTIVE } });
    const debitRows = await ledgerRepo.find({
      where: { type: AccountTransactionType.ORDER_DEBIT },
    });
    return {
      orders,
      activeOrders,
      debits: debitRows.length,
      debitTotal: debitRows.reduce((sum, row) => sum + row.amount, 0),
    };
  }

  it('accepts items only and derives the order identity exclusively from the bound token', async () => {
    const sheet = await createFlaggedSheet();
    const form = await bindIssuedForm(sheet);
    const items = [
      { menuItemId: menu[0].id, quantity: 2 },
      { menuItemId: menu[2].id, quantity: 1 },
    ];
    const expectedTotal = menu[0].price * 2 + menu[2].price;

    const response = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`),
    ).send({ items }).expect(201);

    expect(response.body).toEqual({ replaced: false });

    const storedSheet = await dataSource.getRepository(Sheet).findOneByOrFail({ id: sheet.id });
    const storedOrder = await dataSource.getRepository(Order).findOneByOrFail({ sheetId: sheet.id });
    expect(storedOrder.userId).toBe(boundUser.id);
    expect(storedOrder.userId).not.toBe(decoyUser.id);
    expect(storedOrder.totalAmount).toBe(expectedTotal);
    const storedForm = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({ token: form.token });
    expect(storedSheet).toMatchObject({
      status: SheetStatus.VERIFIED,
      issuedFormId: form.token,
      matchedUserId: boundUser.id,
      recognizedId: null,
      orderId: storedOrder.id,
    });
    expect(storedForm).toMatchObject({
      status: IssuedOmrFormStatus.CONSUMED,
      consumedSheetId: sheet.id,
    });
    expect(await effectCounts()).toEqual({
      orders: 1,
      activeOrders: 1,
      debits: 1,
      debitTotal: -expectedTotal,
    });

    const identityOverride = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`),
    ).send({ items, userId: decoyUser.id });
    expect(identityOverride.status).toBe(400);
    expect(await effectCounts()).toEqual({
      orders: 1,
      activeOrders: 1,
      debits: 1,
      debitTotal: -expectedTotal,
    });
  });

  it('serializes a double confirm of one sheet to one order and one debit', async () => {
    const sheet = await createFlaggedSheet();
    const form = await bindIssuedForm(sheet);
    const items = [{ menuItemId: menu[2].id, quantity: 3 }];
    const expectedTotal = menu[2].price * 3;

    const responses = await Promise.all([
      auth(request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`)).send({ items }),
      auth(request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`)).send({ items }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await effectCounts()).toEqual({
      orders: 1,
      activeOrders: 1,
      debits: 1,
      debitTotal: -expectedTotal,
    });
    const storedForm = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({ token: form.token });
    expect(storedForm.status).toBe(IssuedOmrFormStatus.CONSUMED);
    expect(storedForm.consumedSheetId).toBe(sheet.id);
  });

  it('quarantines a second sheet presenting the same token and permits only the reserved sheet debit', async () => {
    const reservedSheet = await createFlaggedSheet();
    const form = await bindIssuedForm(reservedSheet);
    const conflictingSheet = await createFlaggedSheet();
    conflictingSheet.issuedFormId = form.token;
    conflictingSheet.resultJson = { order_lines: [] };
    await dataSource.getRepository(Sheet).save(conflictingSheet);
    const items = [{ menuItemId: menu[0].id, quantity: 1 }];

    const responses = await Promise.all([
      auth(request(app.getHttpServer()).post(`/scans/verify/${reservedSheet.id}/confirm`)).send({ items }),
      auth(request(app.getHttpServer()).post(`/scans/verify/${conflictingSheet.id}/confirm`)).send({ items }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await effectCounts()).toEqual({
      orders: 1,
      activeOrders: 1,
      debits: 1,
      debitTotal: -menu[0].price,
    });
    const storedConflict = await dataSource.getRepository(Sheet).findOneByOrFail({ id: conflictingSheet.id });
    expect(storedConflict.status).toBe(SheetStatus.REJECTED);
    expect(storedConflict.rejectionCode).toMatch(/^OMR_FORM\.(RESERVATION_CONFLICT|ALREADY_CONSUMED)$/);
    expect(storedConflict.orderId).toBeNull();

    const storedForm = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({ token: form.token });
    expect(storedForm.status).toBe(IssuedOmrFormStatus.CONSUMED);
    expect(storedForm.consumedSheetId).toBe(reservedSheet.id);
  });

  it.each([
    ['void', { status: IssuedOmrFormStatus.VOID }, 'OMR_FORM.VOID'],
    ['consumed', { status: IssuedOmrFormStatus.CONSUMED }, 'OMR_FORM.ALREADY_CONSUMED'],
    ['stale date', { serviceDate: '2026-07-13' }, 'OMR_FORM.DATE_MISMATCH'],
  ] as const)(
    'blocks a %s token state with no order or debit',
    async (_label, overrides, expectedCode) => {
      const sheet = await createFlaggedSheet();
      const form = await bindIssuedForm(sheet, overrides as Partial<IssuedOmrForm>);
      const response = await auth(
        request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`),
      ).send({ items: [{ menuItemId: menu[0].id, quantity: 1 }] });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(expectedCode);
      expect(await effectCounts()).toEqual({
        orders: 0,
        activeOrders: 0,
        debits: 0,
        debitTotal: 0,
      });
      const storedSheet = await dataSource.getRepository(Sheet).findOneByOrFail({ id: sheet.id });
      expect(storedSheet.status).toBe(SheetStatus.REJECTED);
      expect(storedSheet.rejectionCode).toBe(expectedCode);
      expect(storedSheet.orderId).toBeNull();
      const storedForm = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({ token: form.token });
      const expectedStatus = 'status' in overrides
        ? overrides.status
        : IssuedOmrFormStatus.ISSUED;
      expect(storedForm.status).toBe(expectedStatus);
    },
  );

  it('keeps historical issued forms confirmable when legacy ROI metadata differs', async () => {
    const sheet = await createFlaggedSheet();
    const form = await bindIssuedForm(sheet, { roiVersion: 'v2' });
    const response = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`),
    ).send({ items: [{ menuItemId: menu[0].id, quantity: 1 }] });

    expect(response.status).toBe(201);
    const storedForm = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({
      token: form.token,
    });
    expect(storedForm.roiVersion).toBe('v2');
    expect(storedForm.templateId).toBe(form.templateId);
  });
});
