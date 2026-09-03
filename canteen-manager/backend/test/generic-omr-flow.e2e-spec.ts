import { ConflictException, INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AccountTransaction, AccountTransactionType } from '../src/accounts/account-transaction.entity';
import { AccountsService } from '../src/accounts/accounts.service';
import { MenuItem } from '../src/menu/menu-item.entity';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from '../src/omr-forms/omr-form-template.entity';
import { canonicalGeometryHash } from '../src/omr-forms/omr-form-templates.service';
import { OmrOperationalModeService } from '../src/omr-forms/omr-operational-mode.service';
import { OmrClientService } from '../src/omr/omr-client.service';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { Order } from '../src/orders/order.entity';
import { ScanStorageService } from '../src/scans/scan-storage.service';
import { OmrOperationalFormMode, ScanAdmissionSource, Sheet } from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';
import { normalizeCell } from '../src/users/cell-normalization';
import { User } from '../src/users/user.entity';
import {
  E2EContext,
  createE2EApp,
  login,
  seedGlobalMenu,
  seedOperator,
  seedUser,
  tomorrow,
  truncate,
} from './setup/e2e-bootstrap';

const REAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAAEAAQBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABgQAQEAAwAAAAAAAAAAAAAAAAECACEx/9oACAEBAAA/AFR1IEyAHM//2Q==',
  'base64',
);

const GEOMETRY = {
  roi_version: 'generic-code-r1',
  schema_version: 'omr-a5-v2',
  mode: 'code',
  orientation: 'portrait',
  paper_size: 'A5',
  dpi: 300,
  template_width_px: 1748,
  template_height_px: 2480,
  fiducials: [
    { x: 40, y: 40 },
    { x: 1708, y: 40 },
    { x: 40, y: 2440 },
    { x: 1708, y: 2440 },
  ],
  digit_boxes: [],
  checkboxes: [],
  order_lines: [],
  entry_regions: [],
  qr_roi: { x: 1400, y: 80, w: 240, h: 240 },
  handwriting_fields: [
    { field: 'name', required: true, x: 100, y: 100, w: 1100, h: 100, charset_hint: 'vietnamese_name' },
    { field: 'cell', required: true, x: 100, y: 220, w: 400, h: 90, charset_hint: 'cell' },
    { field: 'prisoner_id', required: false, x: 520, y: 220, w: 680, h: 90, charset_hint: 'prisoner_id' },
  ],
};

describe('Generic OMR browser workflow (e2e)', () => {
  let ctx: E2EContext;
  let app: INestApplication;
  let ds: DataSource;
  let accounts: AccountsService;
  let operator: Operator;
  let prisoner: User;
  let menuItem: MenuItem;
  let token: string;
  let templateId = '';
  let genericReference = '';

  const storage = {
    saveImage: jest.fn().mockResolvedValue('generic-browser.jpg'),
    readImageAsBase64: jest.fn().mockReturnValue(REAL_JPEG.toString('base64')),
    reconcileOrphans: jest.fn().mockReturnValue(0),
    deleteImage: jest.fn(),
    deleteWarpedImages: jest.fn(),
  };
  const omr = {
    preflightImage: jest.fn().mockResolvedValue({ width: 4, height: 4 }),
    identifyFormToken: jest.fn(async () => ({
      form_token: null,
      form_reference: genericReference,
      flags: [],
    })),
    processScan: jest.fn(async () => ({
      form_token: null,
      form_reference: genericReference,
      recognized_id: null,
      id_digits: [],
      order_lines: [{
        line_index: 0,
        code: menuItem.code,
        qty: 1,
        code_digits: [],
        qty_digits: [],
        flags: [],
      }],
      avg_confidence: 0.82,
      flags: [],
      warp_ok: true,
      handwriting_fields: [
        { field: 'name', status: 'recognized', raw_text: prisoner.name, confidence: 0.8, raw_score: 0.7, flags: [] },
        { field: 'cell', status: 'recognized', raw_text: prisoner.cell, confidence: 0.9, raw_score: 0.8, flags: [] },
        { field: 'prisoner_id', status: 'blank', raw_text: null, confidence: null, raw_score: null, flags: [] },
      ],
      handwriting_model: {
        adapter: 'trocr-onnx-greedy',
        model_name: 'Xenova/trocr-small-handwritten',
        model_version: 'pinned-test-revision',
        weights_sha256: 'a'.repeat(64),
        runtime: 'onnxruntime==1.20.1',
        execution_provider: 'CPUExecutionProvider',
        preprocessing_version: 'trocr-deit-384-v1',
        calibration_version: null,
      },
    })),
    renderGenericMaster: jest.fn(async () => ({
      roi_template: GEOMETRY,
      pdf_base64: Buffer.from('%PDF generic test').toString('base64'),
      page_count: 1,
      form_reference: genericReference,
    })),
  };
  const operationalMode = {
    mode: OmrOperationalFormMode.GENERIC,
    generation: 'generic-test-v1',
    assertAdmissionSource: jest.fn((source: ScanAdmissionSource) => {
      if (source !== ScanAdmissionSource.BROWSER) {
        throw new ConflictException({ code: 'OMR_GENERIC.BROWSER_UPLOAD_REQUIRED' });
      }
    }),
    assertGenericReady: jest.fn().mockResolvedValue(undefined),
  };

  const auth = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createE2EApp({
      configure: (builder) => {
        builder.overrideProvider(OmrClientService).useValue(omr);
        builder.overrideProvider(ScanStorageService).useValue(storage);
        builder.overrideProvider(OmrOperationalModeService).useValue(operationalMode);
      },
    });
    app = ctx.app;
    ds = ctx.dataSource;
    accounts = ctx.moduleRef.get(AccountsService);
    await truncate(ds, [
      'account_transactions',
      'prisoner_accounts',
      'order_items',
      'orders',
      'sheets',
      'issued_omr_forms',
      'omr_form_template_rows',
      'omr_form_templates',
      'menu_items',
      'users',
      'operators',
    ]);

    operator = await seedOperator(ds, 'generic_browser_admin', OperatorRole.ADMIN);
    token = await login(app, operator.username);
    prisoner = await seedUser(ds, 'GENERIC-P001', 'Nguyễn Văn An');
    const normalizedCell = normalizeCell('A-01');
    prisoner.zone = 'Khu A';
    prisoner.cell = 'A-01';
    prisoner.normalizedCell = normalizedCell.value;
    prisoner.cellNormalizationVersion = normalizedCell.version;
    prisoner = await ds.getRepository(User).save(prisoner);
    await seedGlobalMenu(ds);
    menuItem = await ds.getRepository(MenuItem).findOneByOrFail({ position: 0 });

    const templateRepo = ds.getRepository(OmrFormTemplate);
    const template = await templateRepo.save(templateRepo.create({
      revision: 'generic-code-r1',
      mode: OmrFormMode.CODE,
      paperSize: 'A5',
      orientation: OmrFormOrientation.PORTRAIT,
      geometry: GEOMETRY,
      geometryHash: canonicalGeometryHash(GEOMETRY),
      catalogHash: null,
      isActive: true,
      activatedAt: new Date(),
      retiredAt: null,
    }));
    templateId = template.id;
    genericReference = `CM-G1:${templateId}`;
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await truncate(ds, [
        'account_transactions',
        'prisoner_accounts',
        'order_items',
        'orders',
        'sheets',
        'issued_omr_forms',
        'omr_form_template_rows',
        'omr_form_templates',
        'menu_items',
        'users',
        'operators',
      ]);
    }
    await app?.close();
  });

  it('serves a token-free generic master and rejects personalized issuance', async () => {
    const master = await auth(
      request(app.getHttpServer()).get('/omr-forms/masters/code'),
    ).expect(200);
    expect(master.body).toMatchObject({
      mode: 'code',
      templateId,
      formReference: genericReference,
      pageCount: 1,
    });
    expect(master.body).not.toHaveProperty('serviceDate');
    expect(master.body).not.toHaveProperty('userId');
    expect(master.body).not.toHaveProperty('token');

    const issued = await auth(request(app.getHttpServer()).post('/omr-forms'))
      .send({ userId: prisoner.id });
    expect(issued.status).toBe(409);
    expect(issued.body.code).toBe('OMR_GENERIC.PERSONALIZED_ISSUANCE_DISABLED');
  });

  it('rejects client capture timestamps, then admits and processes a browser upload with server time', async () => {
    const checksum = createHash('sha256').update(REAL_JPEG).digest('hex');
    const body = {
      sheetId: 'GENERIC-BROWSER-001',
      checksum,
      imageBase64: REAL_JPEG.toString('base64'),
    };
    await auth(request(app.getHttpServer()).post('/scans'))
      .send({ ...body, capturedAt: '2026-07-28T00:00:00.000Z' })
      .expect(400);

    const submitted = await auth(request(app.getHttpServer()).post('/scans'))
      .send(body)
      .expect(202);
    let sheet: Sheet | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      sheet = await ds.getRepository(Sheet).findOne({ where: { id: submitted.body.id } });
      if (sheet && ![SheetStatus.PENDING, SheetStatus.PROCESSING].includes(sheet.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(sheet).not.toBeNull();
    expect(sheet).toMatchObject({
      status: SheetStatus.FLAGGED,
      admissionSource: ScanAdmissionSource.BROWSER,
      admittedMode: OmrOperationalFormMode.GENERIC,
      admittedGeneration: 'generic-test-v1',
      admittedBy: operator.id,
      serviceDate: tomorrow(),
      templateId,
      proposedUserId: null,
      matchedUserId: null,
      orderId: null,
    });
    expect(sheet!.admittedAt).toBeInstanceOf(Date);

    const queue = await auth(request(app.getHttpServer()).get(
      `/scans/verify/queue?dateFrom=${tomorrow()}&dateTo=${tomorrow()}`,
    )).expect(200);
    const queued = queue.body.sheets.find((item: { id: string }) => item.id === sheet!.id);
    expect(queued).toMatchObject({
      bindingKind: 'generic',
      identity: null,
      rankedCandidates: [expect.objectContaining({ userId: prisoner.id })],
    });
    expect(queued).not.toHaveProperty('selectedUserId');

    await accounts.credit({
      userId: prisoner.id,
      amount: 100_000,
      type: AccountTransactionType.TOPUP,
      operatorId: operator.id,
    });
    const preview = await auth(request(app.getHttpServer()).get(
      `/scans/verify/${sheet!.id}/identity-preview?userId=${prisoner.id}`,
    )).expect(200);
    expect(preview.body).toMatchObject({ user: { id: prisoner.id }, balance: 100_000 });

    await auth(request(app.getHttpServer()).post(`/scans/verify/${sheet!.id}/confirm`))
      .send({ userId: prisoner.id, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
      .expect(201);
    const persisted = await ds.getRepository(Sheet).findOneByOrFail({ id: sheet!.id });
    expect(persisted).toMatchObject({
      status: SheetStatus.VERIFIED,
      matchedUserId: prisoner.id,
      proposedUserId: null,
      identitySelectedBy: operator.id,
    });
    expect(await ds.getRepository(Order).count({ where: { sheetId: sheet!.id } })).toBe(1);
    expect(await ds.getRepository(AccountTransaction).count({
      where: { type: AccountTransactionType.ORDER_DEBIT },
    })).toBe(1);
  });
});
