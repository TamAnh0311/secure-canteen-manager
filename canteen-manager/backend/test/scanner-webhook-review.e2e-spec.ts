import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  createE2EApp,
  E2EContext,
  login,
  seedOperator,
  seedUser,
  today,
  truncate,
} from './setup/e2e-bootstrap';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { MenuItem } from '../src/menu/menu-item.entity';
import { MenuItemCategory } from '../src/menu/menu-item-category.enum';
import { MenuService } from '../src/menu/menu.service';
import { Sheet } from '../src/scans/sheet.entity';
import { Order, OrderStatus } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { User } from '../src/users/user.entity';
import { normalizeCell } from '../src/users/cell-normalization';
import { AccountTransaction, AccountTransactionType } from '../src/accounts/account-transaction.entity';
import { AccountsService } from '../src/accounts/accounts.service';
import { ScannerWebhookAuthGuard } from '../src/scans/webhook/scanner-webhook-auth.guard';
import { ScanWorkflowModeService } from '../src/config/scan-workflow-mode.service';

describe('Scanner webhook review and confirmation (e2e)', () => {
  let app: INestApplication;
  let ctx: E2EContext;
  let ds: DataSource;
  let adminToken: string;
  let zoneAToken: string;
  let zoneBToken: string;
  let adminId: string;
  let menuItem: MenuItem;
  let catalogueVersion: string;
  let ordersService: OrdersService;
  let accountsService: AccountsService;

  beforeAll(async () => {
    ctx = await createE2EApp({
      configure: (builder) => {
        builder.overrideGuard(ScannerWebhookAuthGuard).useValue({ canActivate: () => true });
        builder.overrideProvider(ScanWorkflowModeService).useValue({
          mode: 'scanner_webhook',
          scannerReviewEnabled: true,
          scannerConfirmationEnabled: true,
          omrRuntimeEnabled: false,
          assertScannerConfirmationEnabled: () => undefined,
          assertOmrIntakeEnabled: () => { throw new Error('OMR intake is disabled'); },
          assertOmrConfirmationEnabled: () => { throw new Error('OMR confirmation is disabled'); },
          assertOmrFormMutationEnabled: () => { throw new Error('OMR forms are disabled'); },
        });
      },
    });
    app = ctx.app;
    ds = ctx.dataSource;
    await truncate(ds, [
      'scanner_artifact_jobs',
      'sheets',
      'scanner_webhook_events',
      'order_items',
      'orders',
      'account_transactions',
      'prisoner_accounts',
      'menu_items',
      'users',
      'operators',
    ]);
    const admin = await seedOperator(ds, 'scanner-review-admin', OperatorRole.ADMIN);
    adminId = admin.id;
    adminToken = await login(app, 'scanner-review-admin');
    const zoneAOperator = await seedOperator(ds, 'scanner-zone-a', OperatorRole.OPERATOR);
    zoneAOperator.zone = 'A';
    await ds.getRepository(Operator).save(zoneAOperator);
    zoneAToken = await login(app, 'scanner-zone-a');
    const zoneBOperator = await seedOperator(ds, 'scanner-zone-b', OperatorRole.OPERATOR);
    zoneBOperator.zone = 'B';
    await ds.getRepository(Operator).save(zoneBOperator);
    zoneBToken = await login(app, 'scanner-zone-b');
    menuItem = await ds.getRepository(MenuItem).save(ds.getRepository(MenuItem).create({
      code: '001',
      name: 'Scanner E2E Rice',
      price: 35_000,
      category: MenuItemCategory.FOOD,
      position: 0,
      isActive: true,
    }));
    catalogueVersion = (await ctx.moduleRef.get(MenuService).scannerCatalogueExport()).version;
    ordersService = ctx.moduleRef.get(OrdersService);
    accountsService = ctx.moduleRef.get(AccountsService);
  });

  afterAll(async () => {
    await truncate(ds, [
      'scanner_artifact_jobs',
      'sheets',
      'scanner_webhook_events',
      'order_items',
      'orders',
      'account_transactions',
      'prisoner_accounts',
      'menu_items',
      'users',
      'operators',
    ]);
    await app.close();
  });

  async function seedScannerUser(legacyId: string, name: string, zone = 'A', cell = 'A1'): Promise<User> {
    const user = await seedUser(ds, legacyId, name);
    const normalized = normalizeCell(cell);
    user.zone = zone;
    user.cell = cell;
    user.normalizedCell = normalized.value;
    user.cellNormalizationVersion = normalized.version;
    return ds.getRepository(User).save(user);
  }

  async function fund(userId: string, balance = 200_000): Promise<void> {
    await ds.query(
      `INSERT INTO prisoner_accounts (user_id, balance) VALUES ($1, $2)`,
      [userId, balance],
    );
  }

  function scannerPayload(suffix: string, legacyId: string, quantity = 2): any {
    return {
      event_id: `evt_${suffix}`,
      event_type: 'order_scan.result',
      idempotency_key: `order-scanner/v1/doc_${suffix}/1`,
      occurred_at: new Date().toISOString(),
      schema_version: '1.0-draft',
      result: {
        result_id: `result_${suffix}`,
        document_id: `doc_${suffix}`,
        page_index: 0,
        revision: 1,
        service_date: today(),
        outcome: 'accepted',
        ma_luu_ky: { value: legacyId },
        buong_giam: { value: 'A1' },
        items: [{
          row_index: 0,
          catalogue_item_id: menuItem.code,
          item: { value: menuItem.name, confidence: 0.99, candidates: [], warnings: [] },
          quantity: { value: quantity, confidence: 0.99, candidates: [], warnings: [] },
        }],
        artifacts: [],
        warnings: [],
        versions: { catalogue: catalogueVersion },
      },
    };
  }

  async function ingest(payload: ReturnType<typeof scannerPayload>): Promise<Sheet> {
    await request(app.getHttpServer())
      .post('/webhooks/order-scanner')
      .set('Idempotency-Key', payload.idempotency_key)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(202);
    return ds.getRepository(Sheet).findOneOrFail({ where: { sheetId: payload.result.result_id } });
  }

  it('stores, reviews, and explicitly confirms a scanner result exactly once', async () => {
    const user = await seedScannerUser('000001', 'Scanner E2E Prisoner');
    await fund(user.id, 100_000);
    const payload = scannerPayload('scanner_review_e2e', user.legacyId);
    const serviceDate = payload.result.service_date;
    const sheet = await ingest(payload);
    const queue = await request(app.getHttpServer())
      .get('/scans/verify/queue')
      .query({ dateFrom: serviceDate, dateTo: serviceDate })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.sheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sheet.id, source: 'scanner', bindingKind: 'scanner' }),
    ]));
    const monitor = await request(app.getHttpServer())
      .get('/scans')
      .query({ dateFrom: serviceDate, dateTo: serviceDate })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(monitor.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sheet.id, scannerReviewState: 'ready' }),
    ]));

    await request(app.getHttpServer())
      .post(`/scans/verify/${sheet.id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: user.id, items: [{ menuItemId: menuItem.id, quantity: 2 }] })
      .expect(201);

    const orders = await ds.getRepository(Order).find({ where: { userId: user.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ source: 'scanner', totalAmount: menuItem.price * 2 });

    const retry = await request(app.getHttpServer())
      .post('/webhooks/order-scanner')
      .set('Idempotency-Key', payload.idempotency_key)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(202);
    expect(retry.body.duplicate).toBe(true);
    expect(await ds.getRepository(Sheet).count({ where: { sheetId: payload.result.result_id } })).toBe(1);
  });

  it('keeps direct confirmation behind scanner field-review acknowledgement', async () => {
    const user = await seedScannerUser('000007', 'Needs Review Scanner Prisoner');
    await fund(user.id);
    const payload = scannerPayload('scanner_field_review_gate', user.legacyId);
    payload.result.outcome = 'needs_review';
    payload.result.items[0].catalogue_item_id = null;
    payload.result.items[0].item = {
      value: null,
      confidence: 0.61,
      candidates: [{ catalogue_item_id: menuItem.code, value: menuItem.name, confidence: 0.61 }],
      warnings: [{ code: 'item_needs_review', severity: 'warning' }],
    };
    payload.result.items[0].quantity.warnings = [{ code: 'quantity_uncertain', severity: 'warning' }];
    const sheet = await ingest(payload);

    const blocked = await request(app.getHttpServer())
      .post(`/scans/verify/${sheet.id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: user.id, items: [{ menuItemId: menuItem.id, quantity: 2 }] })
      .expect(400);
    expect(blocked.body.code).toBe('VERIFY.SCANNER_ITEM_REASON_REQUIRED');
    expect(await ds.getRepository(Order).count({ where: { userId: user.id } })).toBe(0);

    await request(app.getHttpServer())
      .post(`/scans/verify/${sheet.id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: user.id,
        items: [{ menuItemId: menuItem.id, quantity: 2 }],
        reason: 'Reviewed scanner item and quantity evidence against the source crop.',
      })
      .expect(201);
    expect(await ds.getRepository(Order).count({ where: { userId: user.id } })).toBe(1);
  });

  it('serializes concurrent scanner confirmation to one order and one debit', async () => {
    const user = await seedScannerUser('000002', 'Concurrent Scanner Prisoner');
    await fund(user.id);
    const sheet = await ingest(scannerPayload('scanner_confirm_race', user.legacyId));
    const sendConfirm = () => request(app.getHttpServer())
      .post(`/scans/verify/${sheet.id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: user.id, items: [{ menuItemId: menuItem.id, quantity: 2 }] });

    const responses = await Promise.all([sendConfirm(), sendConfirm()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await ds.getRepository(Order).count({
      where: { userId: user.id, status: OrderStatus.ACTIVE },
    })).toBe(1);
    expect(await ds.getRepository(AccountTransaction).count({
      where: { userId: user.id, type: AccountTransactionType.ORDER_DEBIT },
    })).toBe(1);
  });

  it('routes an exact scanner identity only to its current operator zone', async () => {
    const user = await seedScannerUser('000004', 'Zone Scoped Scanner Prisoner');
    await fund(user.id);
    const payload = scannerPayload('scanner_zone_scope', user.legacyId);
    const sheet = await ingest(payload);

    const zoneAQueue = await request(app.getHttpServer())
      .get('/scans/verify/queue')
      .query({ dateFrom: payload.result.service_date, dateTo: payload.result.service_date })
      .set('Authorization', `Bearer ${zoneAToken}`)
      .expect(200);
    expect(zoneAQueue.body.sheets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sheet.id,
        bindingKind: 'scanner',
        rankedCandidates: expect.arrayContaining([expect.objectContaining({ userId: user.id })]),
      }),
    ]));

    const zoneBQueue = await request(app.getHttpServer())
      .get('/scans/verify/queue')
      .query({ dateFrom: payload.result.service_date, dateTo: payload.result.service_date })
      .set('Authorization', `Bearer ${zoneBToken}`)
      .expect(200);
    expect(zoneBQueue.body.sheets).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sheet.id }),
    ]));

    await request(app.getHttpServer())
      .get(`/scans/verify/${sheet.id}/identity-preview`)
      .query({ userId: user.id })
      .set('Authorization', `Bearer ${zoneBToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/scans/verify/${sheet.id}/confirm`)
      .set('Authorization', `Bearer ${zoneAToken}`)
      .send({ userId: user.id, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
      .expect(201);
  });

  it('routes unresolved identity only by a unique current room and keeps it operator-resolvable', async () => {
    const roomUser = await seedScannerUser('000006', 'Room Candidate');
    const payload = scannerPayload('scanner_room_recovery', '000099');
    const sheet = await ingest(payload);

    const queue = await request(app.getHttpServer())
      .get('/scans/verify/queue')
      .query({ dateFrom: payload.result.service_date, dateTo: payload.result.service_date })
      .set('Authorization', `Bearer ${zoneAToken}`)
      .expect(200);
    const row = queue.body.sheets.find((candidate: { id: string }) => candidate.id === sheet.id);
    expect(row).toMatchObject({ id: sheet.id, scannerEvidence: { reviewState: 'needs_review' } });
    expect(row.rankedCandidates.map((candidate: { userId: string }) => candidate.userId)).toContain(roomUser.id);
  });

  it('keeps an ID/room cross-zone conflict out of both operator queues', async () => {
    const crossZoneUser = await seedScannerUser('000005', 'Cross Zone Identity', 'B', 'B1');
    const payload = scannerPayload('scanner_cross_zone_conflict', crossZoneUser.legacyId);
    const sheet = await ingest(payload);

    for (const token of [zoneAToken, zoneBToken]) {
      const queue = await request(app.getHttpServer())
        .get('/scans/verify/queue')
        .query({ dateFrom: payload.result.service_date, dateTo: payload.result.service_date })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(queue.body.sheets).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: sheet.id })]));
    }

    const adminQueue = await request(app.getHttpServer())
      .get('/scans/verify/queue')
      .query({ dateFrom: payload.result.service_date, dateTo: payload.result.service_date })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminQueue.body.sheets).toEqual(expect.arrayContaining([expect.objectContaining({ id: sheet.id })]));
  });

  it('replaces OMR with scanner and rolls back scanner to OMR with exact net balance', async () => {
    const openingBalance = 200_000;
    const user = await seedScannerUser('000003', 'Scanner Rollback Prisoner');
    await fund(user.id, openingBalance);
    const serviceDate = today();

    const firstOmr = await ordersService.createOrReplaceWithOutcome({
      serviceDate,
      userId: user.id,
      items: [{ menuItemId: menuItem.id, quantity: 1 }],
      source: 'omr',
      operatorId: adminId,
    });
    const sheet = await ingest(scannerPayload('scanner_cross_source', user.legacyId, 2));
    await request(app.getHttpServer())
      .post(`/scans/verify/${sheet.id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: user.id,
        items: [{ menuItemId: menuItem.id, quantity: 2 }],
        replacementAck: true,
      })
      .expect(201);

    const scannerOrder = await ds.getRepository(Order).findOneByOrFail({
      userId: user.id,
      source: 'scanner',
      status: OrderStatus.ACTIVE,
    });
    expect((await ds.getRepository(Order).findOneByOrFail({ id: firstOmr.order.id })).status)
      .toBe(OrderStatus.SUPERSEDED);
    expect(await accountsService.getBalance(user.id)).toBe(openingBalance - menuItem.price * 2);

    const rollback = await ordersService.createOrReplaceWithOutcome({
      serviceDate,
      userId: user.id,
      items: [{ menuItemId: menuItem.id, quantity: 1 }],
      source: 'omr',
      operatorId: adminId,
      replacementAcknowledged: true,
    });
    expect(rollback.replaced).toBe(true);
    expect((await ds.getRepository(Order).findOneByOrFail({ id: scannerOrder.id })).status)
      .toBe(OrderStatus.SUPERSEDED);
    expect(await accountsService.getBalance(user.id)).toBe(openingBalance - menuItem.price);

    const ledger = await ds.getRepository(AccountTransaction).find({ where: { userId: user.id } });
    expect(ledger.filter((row) => row.type === AccountTransactionType.ORDER_DEBIT)).toHaveLength(3);
    expect(ledger.filter((row) => row.type === AccountTransactionType.REVERSAL)).toHaveLength(2);
    expect(await ds.getRepository(Order).count({
      where: { userId: user.id, status: OrderStatus.ACTIVE },
    })).toBe(1);
  });
});
