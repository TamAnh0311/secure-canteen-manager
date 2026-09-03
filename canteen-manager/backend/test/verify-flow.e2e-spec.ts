/**
 * Live OMR v3 issuance + token-authoritative confirmation.
 *
 * The real sidecar renders both the calibration form and personalized issued PDF. The scan
 * raster/decode corpus is validated separately; this suite binds a synthetic already-decoded
 * FLAGGED sheet to the persisted issued token so confirmation exercises real Postgres money
 * and consumption transactions without reviving the removed handwritten-ID fallback.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AccountTransaction, AccountTransactionType } from '../src/accounts/account-transaction.entity';
import { AccountsService } from '../src/accounts/accounts.service';
import { IssuedOmrForm, IssuedOmrFormStatus } from '../src/omr-forms/issued-omr-form.entity';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { Order, OrderStatus, PaymentStatus } from '../src/orders/order.entity';
import {
  OmrOperationalFormMode,
  ScanAdmissionSource,
  Sheet,
} from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';
import { normalizeCell } from '../src/users/cell-normalization';
import { User } from '../src/users/user.entity';
import {
  E2EContext,
  SeededMenuItem,
  createE2EApp,
  login,
  seedGlobalMenu,
  seedOperator,
  seedUser,
  tomorrow,
  truncate,
} from './setup/e2e-bootstrap';

describe('Verify Flow (live OMR v3 issuance, e2e)', () => {
  let ctx: E2EContext;
  let app: INestApplication;
  let dataSource: DataSource;
  let accounts: AccountsService;
  let operator: Operator;
  let operatorToken: string;
  let prisoner: User;
  let inactivePrisoner: User;
  let menu: SeededMenuItem[];
  let form: IssuedOmrForm;
  let sheet: Sheet;

  const FUND_AMOUNT = 100_000;
  const auth = (test: request.Test): request.Test =>
    test.set('Authorization', `Bearer ${operatorToken}`);

  beforeAll(async () => {
    process.env.OMR_SERVICE_URL = process.env.OMR_SERVICE_URL || 'http://localhost:8000';
    ctx = await createE2EApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    accounts = ctx.moduleRef.get(AccountsService);

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

    operator = await seedOperator(dataSource, 'live_v3_operator', OperatorRole.ADMIN);
    operatorToken = await login(app, operator.username);
    prisoner = await seedUser(dataSource, 'SYNTH-LIVE-1001', 'Synthetic Live V3 User');
    inactivePrisoner = await seedUser(
      dataSource,
      'SYNTH-LIVE-9001',
      'Synthetic Inactive User',
      false,
    );
    const normalizedCell = normalizeCell('A-01');
    prisoner.zone = 'Khu A';
    prisoner.cell = 'A-01';
    prisoner.normalizedCell = normalizedCell.value;
    prisoner.cellNormalizationVersion = normalizedCell.version;
    prisoner = await dataSource.getRepository(User).save(prisoner);
    menu = await seedGlobalMenu(dataSource);
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

  it('real OMR renders calibration and personalized v3 PDFs while the HTTP response hides the token', async () => {
    const calibration = await auth(
      request(app.getHttpServer()).post('/menu/form'),
    ).send().expect(201);
    expect(Buffer.from(calibration.body.pdfBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');

    const inactive = await auth(
      request(app.getHttpServer()).post('/omr-forms'),
    ).send({ userId: inactivePrisoner.id });
    expect(inactive.status).toBe(404);
    expect(inactive.body.code).toBe('USER.NOT_FOUND');

    const issued = await auth(
      request(app.getHttpServer()).post('/omr-forms'),
    ).send({ userId: prisoner.id }).expect(201);
    expect(issued.body).not.toHaveProperty('token');
    expect(issued.body.serial).toMatch(/^[0-9A-F]{8}$/);
    expect(issued.body.serviceDate).toBe(tomorrow());
    expect(Buffer.from(issued.body.pdfBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');

    form = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({
      userId: prisoner.id,
      serviceDate: tomorrow(),
      status: IssuedOmrFormStatus.ISSUED,
    });
    expect(issued.body.serial).toBe(form.token.slice(0, 8).toUpperCase());
    expect(form.roiVersion).toMatch(/^a5-code-/);

    const reissues = await Promise.all([
      auth(request(app.getHttpServer()).post('/omr-forms')).send({ userId: prisoner.id }),
      auth(request(app.getHttpServer()).post('/omr-forms')).send({ userId: prisoner.id }),
    ]);
    expect(reissues.map((response) => response.status)).toEqual([201, 201]);

    const forms = await dataSource.getRepository(IssuedOmrForm).find({
      where: { userId: prisoner.id, serviceDate: tomorrow() },
      order: { issuedAt: 'ASC' },
    });
    expect(forms.filter((candidate) => candidate.status === IssuedOmrFormStatus.ISSUED)).toHaveLength(1);
    expect(forms.filter((candidate) => candidate.status === IssuedOmrFormStatus.VOID)).toHaveLength(2);
    form = forms.find((candidate) => candidate.status === IssuedOmrFormStatus.ISSUED)!;
    expect(reissues.map((response) => response.body.serial)).toContain(
      form.token.slice(0, 8).toUpperCase(),
    );
  });

  it('confirm accepts items only and rejects every client-supplied identity field', async () => {
    const missingSheet = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const items = [{ menuItemId: menu[0].id, quantity: 1 }];

    const itemsOnly = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${missingSheet}/confirm`),
    ).send({ items });
    expect(itemsOnly.status).toBe(404);
    expect(itemsOnly.body.code).toBe('SHEET.NOT_FOUND');

    const genericIdentity = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${missingSheet}/confirm`),
    ).send({ items, userId: prisoner.id });
    expect(genericIdentity.status).toBe(404);
    expect(genericIdentity.body.code).toBe('SHEET.NOT_FOUND');

    const legacyIdentity = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${missingSheet}/confirm`),
    ).send({ items, idDigits: prisoner.legacyId });
    expect(legacyIdentity.status).toBe(400);
  });

  it('queues an issued-token-bound sheet with locked identity and short form metadata', async () => {
    const sheetRepo = dataSource.getRepository(Sheet);
    sheet = await sheetRepo.save(sheetRepo.create({
      sheetId: 'SYNTH-LIVE-V3-SHEET',
      batch: 'live-v3-contract',
      serviceDate: form.serviceDate,
      checksum: 'b'.repeat(64),
      imagePath: 'synthetic-live-v3.png',
      status: SheetStatus.FLAGGED,
      admittedAt: new Date(),
      admissionSource: ScanAdmissionSource.AGENT,
      admittedMode: OmrOperationalFormMode.ISSUED,
      admittedGeneration: 'issued-v1',
      admittedBy: null,
      resultJson: { order_lines: [] },
      avgConfidence: 0.99,
      recognizedId: null,
      matchedUserId: form.userId,
      issuedFormId: form.token,
      flags: [],
      processedAt: new Date(),
    }));
    form.reservedSheetId = sheet.id;
    await dataSource.getRepository(IssuedOmrForm).save(form);

    const queue = await auth(
      request(app.getHttpServer()).get(
        `/scans/verify/queue?dateFrom=${form.serviceDate}&dateTo=${form.serviceDate}`,
      ),
    ).expect(200);
    const queued = queue.body.sheets.find((item: { id: string }) => item.id === sheet.id);
    expect(queued.identity).toMatchObject({
      id: prisoner.id,
      legacyId: prisoner.legacyId,
      name: prisoner.name,
    });
    expect(queued.form).toEqual({
      serial: form.token.slice(0, 8).toUpperCase(),
      revision: form.roiVersion,
      serviceDate: form.serviceDate,
    });
    expect(queued).not.toHaveProperty('idDigits');
  });

  it('insufficient funds rolls back order, debit, form consumption, and sheet finalization', async () => {
    const response = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`),
    ).send({ items: [{ menuItemId: menu[0].id, quantity: 1 }] });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('ACCOUNT.INSUFFICIENT_FUNDS');

    expect(await dataSource.getRepository(Order).count()).toBe(0);
    expect(await dataSource.getRepository(AccountTransaction).count({
      where: { type: AccountTransactionType.ORDER_DEBIT },
    })).toBe(0);
    expect((await dataSource.getRepository(Sheet).findOneByOrFail({ id: sheet.id })).status)
      .toBe(SheetStatus.FLAGGED);
    expect((await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({ token: form.token })).status)
      .toBe(IssuedOmrFormStatus.ISSUED);
  });

  it('funded items-only confirm atomically creates one paid order, one debit, and consumes the token', async () => {
    await accounts.credit({
      userId: prisoner.id,
      amount: FUND_AMOUNT,
      type: AccountTransactionType.TOPUP,
      operatorId: operator.id,
    });
    const items = [
      { menuItemId: menu[0].id, quantity: 1 },
      { menuItemId: menu[1].id, quantity: 1 },
    ];
    const expectedTotal = menu[0].price + menu[1].price;

    const response = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheet.id}/confirm`),
    ).send({ items }).expect(201);
    expect(response.body).toEqual({ replaced: false });

    const persistedSheet = await dataSource.getRepository(Sheet).findOneByOrFail({ id: sheet.id });
    expect(persistedSheet.status).toBe(SheetStatus.VERIFIED);

    const order = await dataSource.getRepository(Order).findOneByOrFail({
      sheetId: sheet.id,
    });
    expect(order).toMatchObject({
      userId: prisoner.id,
      status: OrderStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: 'balance',
      totalAmount: expectedTotal,
    });
    const debits = await dataSource.getRepository(AccountTransaction).find({
      where: { type: AccountTransactionType.ORDER_DEBIT },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({
      userId: prisoner.id,
      amount: -expectedTotal,
      relatedOrderId: order.id,
      operatorId: operator.id,
    });
    const consumed = await dataSource.getRepository(IssuedOmrForm).findOneByOrFail({
      token: form.token,
    });
    expect(consumed.status).toBe(IssuedOmrFormStatus.CONSUMED);
    expect(consumed.consumedSheetId).toBe(sheet.id);
    expect(await accounts.getBalance(prisoner.id)).toBe(FUND_AMOUNT - expectedTotal);
  });
});
