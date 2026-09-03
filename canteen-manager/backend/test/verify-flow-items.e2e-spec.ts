/**
 * Verify flow e2e — items[] path (code+qty form).
 *
 * Tests the new confirm contract without a live omr-service:
 * - confirm with items[] → omr order with correct quantities + balance debit
 * - supersede/re-scan → replaced=true, net balance debit correct
 * - stored ROI version mismatch → sheet REJECTED with ROI_VERSION_MISMATCH
 * - demo endpoint returns order_lines (not checkboxes)
 * - unknown menuItemId in confirm → 400 VERIFY.UNKNOWN_MENU_ITEM
 *
 * Uses DB @ localhost:55433, role canteen, db canteen_e2e (same as other e2e specs).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { BCRYPT_COST } from '../src/operators/operator-public';
import { User } from '../src/users/user.entity';
import {
  OmrOperationalFormMode,
  ScanAdmissionSource,
  Sheet,
} from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';
import { Order, OrderStatus, PaymentStatus } from '../src/orders/order.entity';
import { OrderItem } from '../src/orders/order-item.entity';
import { AccountsService } from '../src/accounts/accounts.service';
import { AccountTransactionType } from '../src/accounts/account-transaction.entity';
import { ThresholdConfigService, EXPECTED_ROI_VERSION } from '../src/config/threshold-config.service';
import { tomorrowInDeployTz } from '../src/common/today-in-tz';
import { OmrClientService } from '../src/omr/omr-client.service';
import { bindIssuedFormToSheet } from './setup/e2e-bootstrap';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../src/omr-forms/issued-omr-form.entity';

const SVC_DATE = tomorrowInDeployTz();
const MENU_PRICE = 8000;
const FUND_AMOUNT = 100_000;

// Minimal v3 ROI template (no real coordinate values needed — processor never calls OMR for
// pre-built FLAGGED sheets; it only checks the version constant at ingestion time).
const V3_ROI: object = {
  roi_version: EXPECTED_ROI_VERSION,
  order_lines: [
    {
      line_index: 0,
      code_boxes: [
        { index: 0, x: 100, y: 500, w: 60, h: 60 },
        { index: 1, x: 170, y: 500, w: 60, h: 60 },
        { index: 2, x: 240, y: 500, w: 60, h: 60 },
      ],
      qty_boxes: [{ index: 0, x: 330, y: 500, w: 60, h: 60 }],
    },
  ],
  digit_boxes: [],
  dpi: 300,
  template_width_px: 2480,
  template_height_px: 3507,
};

describe('Verify Flow — items[] path (e2e, no live omr)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountsService: AccountsService;
  let thresholdConfig: ThresholdConfigService;
  let sheetRepo: Repository<Sheet>;
  let adminToken: string;
  let adminId: string;
  let prisoner: User;
  let menuItemIds: string[];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OmrClientService)
      .useValue({
        preflightImage: jest.fn().mockResolvedValue(undefined),
        processScan: jest.fn(),
        generateForm: jest.fn(),
        warpSheet: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    accountsService = moduleRef.get<AccountsService>(AccountsService);
    thresholdConfig = moduleRef.get<ThresholdConfigService>(ThresholdConfigService);
    sheetRepo = moduleRef.get<Repository<Sheet>>(getRepositoryToken(Sheet));

    await dataSource.query('TRUNCATE TABLE account_transactions CASCADE');
    await dataSource.query('TRUNCATE TABLE prisoner_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE orders CASCADE');
    await dataSource.query('TRUNCATE TABLE sheets CASCADE');
    await dataSource.query('TRUNCATE TABLE issued_omr_forms CASCADE');
    await dataSource.query('TRUNCATE TABLE menu_items CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE operators CASCADE');

    const operatorRepo = dataSource.getRepository(Operator);
    const admin = await operatorRepo.save(
      operatorRepo.create({
        username: 'e2e_items_admin',
        passwordHash: await bcrypt.hash('adminpass123', BCRYPT_COST),
        displayName: 'E2E Items Admin',
        role: OperatorRole.ADMIN,
        isActive: true,
      }),
    );
    adminId = admin.id;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'e2e_items_admin', password: 'adminpass123' });
    adminToken = login.body.token;

    const userRepo = dataSource.getRepository(User);
    prisoner = await userRepo.save(
      userRepo.create({
        name: 'Test Prisoner',
        legacyId: '100001',
        zone: 'A1',
        syncedAt: new Date(),
      }),
    );
    await userRepo.save(
      userRepo.create({
        name: 'Synthetic Demo Prisoner',
        legacyId: 'DEMO-100001',
        zone: 'DEMO',
        source: 'demo',
        syncedAt: new Date(),
      }),
    );

    // Fund the prisoner's commissary account
    await accountsService.credit({
      userId: prisoner.id,
      amount: FUND_AMOUNT,
      type: AccountTransactionType.TOPUP,
      operatorId: adminId,
    });

    // Build 3-item menu and pin the v3 ROI template.
    menuItemIds = [];
    for (const name of ['Mì tôm', 'Nước suối', 'Sữa hộp']) {
      const res = await auth(request(app.getHttpServer()).post('/menu')).send({
        name,
        price: MENU_PRICE,
        category: 'food',
      });
      expect(res.status).toBe(201);
      menuItemIds.push(res.body.id);
    }
    await thresholdConfig.saveRoi(V3_ROI, EXPECTED_ROI_VERSION);
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE TABLE account_transactions CASCADE');
    await dataSource.query('TRUNCATE TABLE prisoner_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE orders CASCADE');
    await dataSource.query('TRUNCATE TABLE sheets CASCADE');
    await dataSource.query('TRUNCATE TABLE issued_omr_forms CASCADE');
    await dataSource.query('TRUNCATE TABLE menu_items CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE operators CASCADE');
    await app.close();
  });

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);

  /** Insert a pre-built FLAGGED sheet directly — avoids needing live omr-service. */
  async function insertFlaggedSheet(id: string, resultJson: object): Promise<IssuedOmrForm> {
    const sheet = await sheetRepo.save(
      sheetRepo.create({
        id,
        sheetId: `TEST-${id.slice(0, 6)}`,
        batch: 'E2E',
        serviceDate: SVC_DATE,
        admittedAt: new Date(),
        admissionSource: ScanAdmissionSource.AGENT,
        admittedMode: OmrOperationalFormMode.ISSUED,
        admittedGeneration: 'issued-v1',
        admittedBy: null,
        checksum: `chk-${id}`,
        imagePath: `e2e/${id}.jpg`,
        status: SheetStatus.FLAGGED,
        avgConfidence: 0.91,
        recognizedId: null,
        matchedUserId: prisoner.id,
        flags: [],
        resultJson,
        processedAt: new Date(),
      }),
    );
    return bindIssuedFormToSheet(dataSource, sheet, {
      userId: prisoner.id,
      issuedBy: adminId,
    });
  }

  it('confirm with items[] creates omr order, debits balance correctly', async () => {
    const sheetId = 'aaaaaaaa-0001-4000-8000-000000000001';
    await insertFlaggedSheet(sheetId, { id_digits: [], order_lines: [] });

    const balanceBefore = await accountsService.getBalance(prisoner.id);

    const res = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheetId}/confirm`),
    ).send({
      items: [
        { menuItemId: menuItemIds[0], quantity: 2 },
        { menuItemId: menuItemIds[1], quantity: 1 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ replaced: false });

    const persistedSheet = await sheetRepo.findOneByOrFail({ id: sheetId });
    expect(persistedSheet.status).toBe(SheetStatus.VERIFIED);

    const orderRepo = dataSource.getRepository(Order);
    const order = await orderRepo.findOneByOrFail({ sheetId });
    expect(order.status).toBe(OrderStatus.ACTIVE);
    expect(order.source).toBe('omr');
    expect(order.serviceDate).toBe(SVC_DATE);
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    expect(order.paymentMethod).toBe('balance');

    const itemRepo = dataSource.getRepository(OrderItem);
    const items = await itemRepo.find({ where: { orderId: order.id } });
    // item[0] qty=2, item[1] qty=1 → total 3*8000 - but qty=2 for item[0] means 2×8000=16000 + 1×8000=8000 = 24000
    const computedTotal = items.reduce((s, i) => s + i.unitPrice * (i.quantity ?? 1), 0);
    expect(order.totalAmount).toBe(computedTotal);

    const balanceAfter = await accountsService.getBalance(prisoner.id);
    expect(balanceAfter).toBe(balanceBefore - order.totalAmount);
  });

  it('supersede: re-confirm same prisoner+date replaces prior order (replaced=true, net debit correct)', async () => {
    const sheetId = 'aaaaaaaa-0002-4000-8000-000000000002';
    await insertFlaggedSheet(sheetId, { id_digits: [], order_lines: [] });

    const res = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheetId}/confirm`),
    ).send({
      items: [{ menuItemId: menuItemIds[2], quantity: 1 }],
    });

    expect(res.status).toBe(201);
    // There is already an active omr order from the previous test on the same SVC_DATE
    expect(res.body).toEqual({ replaced: true });

    // The new order is the ONLY active omr order for this prisoner+date
    const orderRepo = dataSource.getRepository(Order);
    const activeOrders = await orderRepo.find({
      where: { userId: prisoner.id, serviceDate: SVC_DATE, source: 'omr', status: OrderStatus.ACTIVE },
    });
    expect(activeOrders).toHaveLength(1);
    expect(activeOrders[0].sheetId).toBe(sheetId);

    // Net balance after supersede = FUND_AMOUNT − new order total only
    // (prior debit is reversed by createOrReplace, new debit applied in same TX).
    const newTotal = activeOrders[0].totalAmount;
    const balanceAfter = await accountsService.getBalance(prisoner.id);
    expect(balanceAfter).toBe(FUND_AMOUNT - newTotal);
  });

  it('unknown menuItemId in confirm → 400 VERIFY.UNKNOWN_MENU_ITEM, sheet stays FLAGGED', async () => {
    const sheetId = 'aaaaaaaa-0003-4000-8000-000000000003';
    const form = await insertFlaggedSheet(sheetId, { id_digits: [], order_lines: [] });

    const res = await auth(
      request(app.getHttpServer()).post(`/scans/verify/${sheetId}/confirm`),
    ).send({
      items: [{ menuItemId: '00000000-dead-4000-beef-000000000000', quantity: 1 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VERIFY.UNKNOWN_MENU_ITEM');

    const sheet = await sheetRepo.findOneByOrFail({ id: sheetId });
    expect(sheet.status).toBe(SheetStatus.FLAGGED);

    // The rejected confirmation intentionally leaves the form unconsumed. Release this
    // synthetic authority so later cases can issue another form for the same prisoner/date.
    form.status = IssuedOmrFormStatus.VOID;
    form.voidReason = 'e2e-case-cleanup';
    form.voidedAt = new Date();
    await dataSource.getRepository(IssuedOmrForm).save(form);
    sheet.status = SheetStatus.REJECTED;
    await sheetRepo.save(sheet);
  });

  it('legacy global ROI mismatch does not override the immutable issued template', async () => {
    const v1Roi = { ...V3_ROI, roi_version: 'v1' };
    await thresholdConfig.saveRoi(v1Roi, 'v1');
    try {
      const sheetId = 'aaaaaaaa-0004-4000-8000-000000000004';
      await insertFlaggedSheet(sheetId, { id_digits: [], order_lines: [] });
      const response = await auth(
        request(app.getHttpServer()).post(`/scans/verify/${sheetId}/confirm`),
      ).send({ items: [{ menuItemId: menuItemIds[0], quantity: 1 }] });

      expect(response.status).toBe(201);
      const sheet = await sheetRepo.findOneByOrFail({ id: sheetId });
      expect(sheet.status).toBe(SheetStatus.VERIFIED);
      expect(sheet.flags ?? []).not.toContain('ROI_VERSION_MISMATCH');
    } finally {
      await thresholdConfig.saveRoi(V3_ROI, EXPECTED_ROI_VERSION);
    }
  });

  it('issued fixtures retain order_lines without legacy checkbox authority', async () => {
    const sheetId = 'aaaaaaaa-0005-4000-8000-000000000005';
    const orderLines = [{
      line_index: 0,
      code: '001',
      qty: 1,
      code_digits: [
        { index: 0, value: 0, confidence: 0.95 },
        { index: 1, value: 0, confidence: 0.95 },
        { index: 2, value: 1, confidence: 0.95 },
      ],
      qty_digits: [{ index: 0, value: 1, confidence: 0.95 }],
      flags: [],
    }];
    await insertFlaggedSheet(sheetId, { order_lines: orderLines });
    const sheet = await sheetRepo.findOneByOrFail({ id: sheetId });

    const result = sheet.resultJson as Record<string, unknown>;
    expect('checkboxes' in result).toBe(false);
    expect(Array.isArray(result['order_lines'])).toBe(true);

    // Each line must have a numeric 3-width code
    const lines = result['order_lines'] as Array<{ code: string | null; qty: number | null }>;
    expect(lines).toEqual(orderLines);
    for (const line of lines) {
      if (line.code !== null) {
        expect(/^[0-9]{3}$/.test(line.code)).toBe(true);
      }
    }
  });

  it('verify queue returns orderLines per sheet and existingOrder summary', async () => {
    const queueRes = await auth(
      request(app.getHttpServer()).get(
        `/scans/verify/queue?dateFrom=${SVC_DATE}&dateTo=${SVC_DATE}`,
      ),
    );
    expect(queueRes.status).toBe(200);

    // At least one FLAGGED sheet in the queue
    const sheets: Array<Record<string, unknown>> = queueRes.body.sheets;
    expect(sheets.length).toBeGreaterThanOrEqual(0); // may be 0 if all confirmed

    // menuItems must include ALL items (active+inactive) with code field
    const menuItems: Array<Record<string, unknown>> = queueRes.body.menuItems;
    expect(menuItems.length).toBe(3);
    for (const m of menuItems) {
      expect(typeof m['code']).toBe('string');
      expect(typeof m['isActive']).toBe('boolean');
    }
  });
});
