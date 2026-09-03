import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  E2EContext,
  createE2EApp,
  seedGlobalMenu,
  generateGlobalForm,
  seedOperator,
  seedUser,
  login,
  today,
  truncate,
  SeededMenuItem,
  bindIssuedFormToSheet,
} from './setup/e2e-bootstrap';
import { OperatorRole } from '../src/operators/operator.entity';
import { OrderStatus } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { MenuService } from '../src/menu/menu.service';
import { MenuItemCategory } from '../src/menu/menu-item-category.enum';
import { AccountsService } from '../src/accounts/accounts.service';
import {
  AccountTransaction,
  AccountTransactionType,
} from '../src/accounts/account-transaction.entity';
import {
  OmrOperationalFormMode,
  ScanAdmissionSource,
  Sheet,
} from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';

// Orders against the global menu, bucketed by service_date (no sessions). Covers the
// money path the warden (omr) flow depends on:
//   - createOrReplace debits the prisoner balance and supersedes the prior same-date omr order
//   - a re-scan's reversal uses the SUPERSEDED order's STORED total, so a replay across a
//     menu price change nets to zero
//   - omr and relative orders coexist for the same prisoner+date; an omr re-scan supersedes
//     only the omr order
//   - the kitchen summary (GET /menu/summary?date=) counts only ACTIVE selections for the day
//   - two concurrent confirms of one flagged sheet → exactly one order + one debit, loser 409s
describe('Orders — supersede-in-place + summary money path (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let adminId: string;
  let ordersService: OrdersService;
  let menuService: MenuService;
  let accountsService: AccountsService;

  let userId: string;
  let menu: SeededMenuItem[];
  const SVC_DATE = today();

  const fund = (uid: string, amount = 1_000_000) =>
    accountsService.credit({
      userId: uid,
      amount,
      type: AccountTransactionType.TOPUP,
      operatorId: adminId,
    });

  beforeAll(async () => {
    const ctx: E2EContext = await createE2EApp();
    app = ctx.app;
    ds = ctx.dataSource;
    ordersService = ctx.moduleRef.get(OrdersService);
    menuService = ctx.moduleRef.get(MenuService);
    accountsService = ctx.moduleRef.get(AccountsService);

    await truncate(ds, [
      'account_transactions',
      'prisoner_accounts',
      'issued_omr_forms',
      'sheets',
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);

    const admin = await seedOperator(ds, 'ord_admin', OperatorRole.ADMIN);
    adminId = admin.id;
    adminToken = await login(app, 'ord_admin');

    const user = await seedUser(ds, 'U001', 'Test User');
    userId = user.id;
    await fund(userId);

    menu = await seedGlobalMenu(ds);
    await generateGlobalForm(ds);
  });

  afterAll(async () => {
    await truncate(ds, [
      'account_transactions',
      'prisoner_accounts',
      'issued_omr_forms',
      'sheets',
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);
    await app.close();
  });

  describe('createOrReplace — first order + supersede', () => {
    let firstOrderId: string;

    it('creates an active order with items atomically', async () => {
      const result = await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }, { menuItemId: menu[1].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });

      expect(result.status).toBe(OrderStatus.ACTIVE);
      expect(result.serviceDate).toBe(SVC_DATE);
      expect(result.userId).toBe(userId);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.menuItemId).sort()).toEqual(
        [menu[0].id, menu[1].id].sort(),
      );
      firstOrderId = result.id;
    });

    it('GET /orders/:id returns the order with its items', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orders/${firstOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.status).toBe(OrderStatus.ACTIVE);
      expect(res.body.items).toHaveLength(2);
    });

    it('second createOrReplace supersedes the first order', async () => {
      const result = await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId,
        items: [{ menuItemId: menu[2].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });

      expect(result.status).toBe(OrderStatus.ACTIVE);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].menuItemId).toBe(menu[2].id);

      const original = await ordersService.findOne(firstOrderId);
      expect(original.status).toBe(OrderStatus.SUPERSEDED);
      expect(original.supersededAt).not.toBeNull();
      expect(original.supersededByOrderId).toBe(result.id);
    });

    it('exactly one active order per (date, user) after supersede', async () => {
      const all = await ordersService.findAll({
        dateFrom: SVC_DATE,
        dateTo: SVC_DATE,
        userId,
        limit: 50,
        offset: 0,
      });
      const active = all.filter((o) => o.status === OrderStatus.ACTIVE);
      const superseded = all.filter((o) => o.status === OrderStatus.SUPERSEDED);
      expect(active).toHaveLength(1);
      expect(superseded).toHaveLength(1);
    });

    it('old order items still queryable (audit trail intact)', async () => {
      const all = await ordersService.findAll({
        dateFrom: SVC_DATE,
        dateTo: SVC_DATE,
        userId,
        limit: 50,
        offset: 0,
      });
      const old = all.find((o) => o.status === OrderStatus.SUPERSEDED)!;
      const withItems = await ordersService.findOne(old.id);
      expect(withItems.items).toHaveLength(2);
    });
  });

  describe('createOrReplace — validations', () => {
    it('rejects a menuItemId not in the global menu', async () => {
      await expect(
        ordersService.createOrReplace({
          serviceDate: SVC_DATE,
          userId,
          items: [{ menuItemId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
          source: 'omr',
          operatorId: adminId,
        }),
      ).rejects.toMatchObject({ response: { code: 'ORDER.ITEM_NOT_IN_MENU' } });
    });

    it('rejects an empty item list', async () => {
      await expect(
        ordersService.createOrReplace({
          serviceDate: SVC_DATE,
          userId,
          items: [],
          source: 'omr',
          operatorId: adminId,
        }),
      ).rejects.toMatchObject({ response: { code: 'ORDER.EMPTY_ITEMS' } });
    });

    it('rejects an omr order without an operator id', async () => {
      await expect(
        ordersService.createOrReplace({
          serviceDate: SVC_DATE,
          userId,
          items: [{ menuItemId: menu[0].id, quantity: 1 }],
          source: 'omr',
        }),
      ).rejects.toMatchObject({ response: { code: 'ORDER.OPERATOR_REQUIRED' } });
    });
  });

  describe('GET /menu/summary — kitchen counts per service date', () => {
    let userId2: string;

    beforeAll(async () => {
      const u2 = await seedUser(ds, 'U002', 'Second User');
      userId2 = u2.id;
      await fund(userId2);

      // user1 picks item0 then re-scans to item1 (supersedes); user2 picks item0.
      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId,
        items: [{ menuItemId: menu[1].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId: userId2,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
    });

    it('summary counts only ACTIVE selections for the date', async () => {
      const res = await request(app.getHttpServer())
        .get('/menu/summary')
        .query({ date: SVC_DATE })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const summary = res.body as {
        menuItemId: string;
        position: number;
        count: number;
      }[];
      const row0 = summary.find((r) => r.menuItemId === menu[0].id);
      const row1 = summary.find((r) => r.menuItemId === menu[1].id);

      // user1's superseded item0 must NOT count; only user2 picks item0; user1's active is item1.
      expect(row0?.count).toBe(1);
      expect(row1?.count).toBe(1);
    });

    it('summary is ordered by position', async () => {
      const res = await request(app.getHttpServer())
        .get('/menu/summary')
        .query({ date: SVC_DATE })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const positions = (res.body as { position: number }[]).map((r) => r.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
  });

  describe('coexist — per (date, user, source) active uniqueness', () => {
    let coUserId: string;

    beforeAll(async () => {
      const cu = await seedUser(ds, 'COEXIST-1', 'Coexist Prisoner');
      coUserId = cu.id;
      await fund(coUserId);

      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId: coUserId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      // A relative order for the SAME (date, user) — permitted because source differs.
      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId: coUserId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'relative',
        paymentMethod: 'cash',
      });
    });

    it('allows an omr and a relative ACTIVE order to coexist for the same prisoner+date', async () => {
      const active = (
        await ordersService.findAll({ dateFrom: SVC_DATE, dateTo: SVC_DATE, userId: coUserId, limit: 50, offset: 0 })
      ).filter((o) => o.status === OrderStatus.ACTIVE);
      expect(active).toHaveLength(2);
      expect(active.map((o) => o.source).sort()).toEqual(['omr', 'relative']);
    });

    it('an omr re-scan supersedes only the omr order; the relative order stays active', async () => {
      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId: coUserId,
        items: [{ menuItemId: menu[1].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });

      const all = await ordersService.findAll({
        dateFrom: SVC_DATE,
        dateTo: SVC_DATE,
        userId: coUserId,
        limit: 50,
        offset: 0,
      });
      const active = all.filter((o) => o.status === OrderStatus.ACTIVE);
      expect(active).toHaveLength(2);
      expect(active.map((o) => o.source).sort()).toEqual(['omr', 'relative']);

      const supersededOmr = all.filter(
        (o) => o.status === OrderStatus.SUPERSEDED && o.source === 'omr',
      );
      expect(supersededOmr).toHaveLength(1);

      const rel = all.filter((o) => o.source === 'relative');
      expect(rel).toHaveLength(1);
      expect(rel[0].status).toBe(OrderStatus.ACTIVE);
    });

    it('kitchen summary counts both omr and relative active selections', async () => {
      const res = await request(app.getHttpServer())
        .get('/menu/summary')
        .query({ date: SVC_DATE })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const summary = res.body as { menuItemId: string; count: number }[];
      // coUser's active omr is item1; active relative is item0. Both counted (+ any others).
      const row1 = summary.find((r) => r.menuItemId === menu[1].id);
      expect((row1?.count ?? 0)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /orders filter', () => {
    it('GET /orders?status=active returns only active orders', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .query({ status: 'active', dateFrom: SVC_DATE, dateTo: SVC_DATE })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const orders = res.body as { status: string }[];
      expect(orders.length).toBeGreaterThan(0);
      expect(orders.every((o) => o.status === 'active')).toBe(true);
    });

    it('GET /orders?userId=x returns only that prisoner orders', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .query({ userId, dateFrom: SVC_DATE, dateTo: SVC_DATE })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const orders = res.body as { userId: string }[];
      expect(orders.every((o) => o.userId === userId)).toBe(true);
    });
  });

  // A warden re-scan that lands after the menu was re-priced must net to zero against the
  // original debit using the SUPERSEDED order's STORED total — never the new price — so the
  // prisoner is only ever out the new active order's amount and the append-only ledger
  // reconciles to the balance.
  describe('ledger reconciliation across supersede + price change', () => {
    let lUserId: string;
    let lItemId: string;
    const FUND = 100_000;
    const P1 = 5_000;
    const P2 = 8_000;
    const LDATE = '2026-07-01';

    beforeAll(async () => {
      const u = await seedUser(ds, 'LEDGER-1', 'Ledger Prisoner');
      lUserId = u.id;
      await fund(lUserId, FUND);

      // A dedicated priced item appended to the global menu for this scenario.
      const item = await menuService.addItem({
        name: 'Priced Item',
        price: P1,
        category: MenuItemCategory.FOOD,
      });
      lItemId = item.id;
    });

    it('reversal uses the prior STORED total (not the new price); balance == FUND − newTotal', async () => {
      const first = await ordersService.createOrReplace({
        serviceDate: LDATE,
        userId: lUserId,
        items: [{ menuItemId: lItemId, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      expect(first.totalAmount).toBe(P1);
      expect(await accountsService.getBalance(lUserId)).toBe(FUND - P1);

      // Menu re-priced between attempts. The first order's stored total must stay P1.
      await ds.query('UPDATE menu_items SET price = $1 WHERE id = $2', [P2, lItemId]);

      const second = await ordersService.createOrReplace({
        serviceDate: LDATE,
        userId: lUserId,
        items: [{ menuItemId: lItemId, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      expect(second.totalAmount).toBe(P2);
      expect(second.id).not.toBe(first.id);
      expect(await accountsService.getBalance(lUserId)).toBe(FUND - P2);

      const all = await ordersService.findAll({
        dateFrom: LDATE,
        dateTo: LDATE,
        userId: lUserId,
        limit: 50,
        offset: 0,
      });
      const active = all.filter((o) => o.status === OrderStatus.ACTIVE);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(second.id);
      expect((await ordersService.findOne(first.id)).status).toBe(OrderStatus.SUPERSEDED);

      const txRepo = ds.getRepository(AccountTransaction);
      const txs = await txRepo.find({ where: { userId: lUserId }, order: { createdAt: 'ASC' } });

      const reversals = txs.filter((t) => t.type === AccountTransactionType.REVERSAL);
      expect(reversals).toHaveLength(1);
      expect(reversals[0].amount).toBe(P1);
      expect(reversals[0].relatedOrderId).toBe(first.id);

      const debits = txs.filter((t) => t.type === AccountTransactionType.ORDER_DEBIT);
      expect(debits.map((d) => d.amount).sort((a, b) => a - b)).toEqual([-P2, -P1]);

      const ledgerSum = txs.reduce((s, t) => s + t.amount, 0);
      expect(ledgerSum).toBe(FUND - P2);
      expect(await accountsService.getBalance(lUserId)).toBe(ledgerSum);
    });
  });

  describe('replacement acknowledgement under concurrent first create', () => {
    let ackUserId: string;
    const ACK_DATE = '2026-07-03';
    const FUND = 100_000;

    beforeAll(async () => {
      const user = await seedUser(ds, 'ACK-RACE-1', 'Replacement Ack Prisoner');
      ackUserId = user.id;
      await fund(ackUserId, FUND);
    });

    it('serializes on the account lock so the loser cannot silently replace without acknowledgement', async () => {
      const input = {
        serviceDate: ACK_DATE,
        userId: ackUserId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
        replacementAcknowledged: false,
      };

      const results = await Promise.allSettled([
        ordersService.createOrReplaceWithOutcome(input),
        ordersService.createOrReplaceWithOutcome(input),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        response: { code: 'VERIFY.REPLACEMENT_ACK_REQUIRED' },
      });
      expect((fulfilled[0] as PromiseFulfilledResult<{ replaced: boolean }>).value.replaced).toBe(false);

      const orders = await ordersService.findAll({
        dateFrom: ACK_DATE,
        dateTo: ACK_DATE,
        userId: ackUserId,
        limit: 50,
        offset: 0,
      });
      expect(orders.filter((order) => order.source === 'omr')).toHaveLength(1);

      const transactions = await ds.getRepository(AccountTransaction).find({
        where: { userId: ackUserId },
      });
      expect(transactions.filter((tx) => tx.type === AccountTransactionType.ORDER_DEBIT)).toHaveLength(1);
      expect(transactions.filter((tx) => tx.type === AccountTransactionType.REVERSAL)).toHaveLength(0);
      expect(await accountsService.getBalance(ackUserId)).toBe(FUND - menu[0].price);
    });
  });

  // Two warden stations confirming the SAME flagged sheet at once must not double-charge: the
  // sheet row is locked and re-asserted FLAGGED inside the confirm TX, so exactly one confirm
  // wins (one order, one debit) and the loser 409s with no ledger side effects.
  describe('concurrent double-confirm of one flagged sheet', () => {
    let cUserId: string;
    let cMenuItemId: string;
    let sheetUuid: string;
    const FUND = 100_000;
    const CDATE = '2026-07-02';

    beforeAll(async () => {
      const u = await seedUser(ds, 'RACE-1', 'Race Prisoner');
      cUserId = u.id;
      await fund(cUserId, FUND);

      // The first global item — its handwritten code decodes to that dish.
      cMenuItemId = menu[0].id;

      const sheetRepo = ds.getRepository(Sheet);
      const sheet = await sheetRepo.save(
        sheetRepo.create({
          sheetId: 'RACE-SHEET-001',
          serviceDate: CDATE,
          admittedAt: new Date(),
          admissionSource: ScanAdmissionSource.AGENT,
          admittedMode: OmrOperationalFormMode.ISSUED,
          admittedGeneration: 'issued-v1',
          admittedBy: null,
          checksum: 'race-checksum',
          imagePath: 'race/none.png',
          status: SheetStatus.FLAGGED,
          recognizedId: 'RACE-1',
          matchedUserId: cUserId,
        }),
      );
      await bindIssuedFormToSheet(ds, sheet, {
        userId: cUserId,
        issuedBy: adminId,
      });
      sheetUuid = sheet.id;
    });

    it('two simultaneous confirms → one 201 + one 409, exactly one order + one debit, no reversal', async () => {
      const price = menu[0].price;
      const body = { items: [{ menuItemId: cMenuItemId, quantity: 1 }] };
      const fire = () =>
        request(app.getHttpServer())
          .post(`/scans/verify/${sheetUuid}/confirm`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(body);

      const [a, b] = await Promise.all([fire(), fire()]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const conflict = [a, b].find((r) => r.status === 409)!;
      expect(conflict.body.code).toBe('SHEET.NOT_AWAITING_VERIFICATION');

      const all = await ordersService.findAll({
        dateFrom: CDATE,
        dateTo: CDATE,
        userId: cUserId,
        limit: 50,
        offset: 0,
      });
      const omr = all.filter((o) => o.source === 'omr');
      expect(omr).toHaveLength(1);
      expect(omr[0].status).toBe(OrderStatus.ACTIVE);

      const txRepo = ds.getRepository(AccountTransaction);
      const txs = await txRepo.find({ where: { userId: cUserId } });
      const debits = txs.filter((t) => t.type === AccountTransactionType.ORDER_DEBIT);
      const reversals = txs.filter((t) => t.type === AccountTransactionType.REVERSAL);
      expect(debits).toHaveLength(1);
      expect(debits[0].amount).toBe(-price);
      expect(reversals).toHaveLength(0);
      expect(await accountsService.getBalance(cUserId)).toBe(FUND - price);

      const sheetRepo = ds.getRepository(Sheet);
      const finalSheet = await sheetRepo.findOneByOrFail({ id: sheetUuid });
      expect(finalSheet.status).toBe(SheetStatus.VERIFIED);
      expect(finalSheet.orderId).toBe(omr[0].id);
    });
  });

  // Per-item quantity end-to-end against real Postgres: the quantity column is persisted, the
  // total is price × quantity, and the kitchen summary SUMs quantities (not row count) while the
  // active-row FILTER excludes a superseded order's surviving item rows.
  describe('per-item quantity — persisted + summed in kitchen summary', () => {
    let qUserId: string;
    const QDATE = '2026-07-04';

    beforeAll(async () => {
      const u = await seedUser(ds, 'QTY-1', 'Quantity Prisoner');
      qUserId = u.id;
      await fund(qUserId);
    });

    it('persists per-line quantity and totals price × quantity', async () => {
      const order = await ordersService.createOrReplace({
        serviceDate: QDATE,
        userId: qUserId,
        items: [
          { menuItemId: menu[0].id, quantity: 1 },
          { menuItemId: menu[2].id, quantity: 2 },
        ],
        source: 'omr',
        operatorId: adminId,
      });

      expect(order.totalAmount).toBe(menu[0].price + menu[2].price * 2);

      const persisted = await ordersService.findOne(order.id);
      const qtyById = new Map(persisted.items.map((i) => [i.menuItemId, i.quantity]));
      expect(qtyById.get(menu[0].id)).toBe(1);
      expect(qtyById.get(menu[2].id)).toBe(2);
    });

    it('kitchen summary sums quantities (not row count) and excludes superseded order_items', async () => {
      // Re-scan to item0 qty 2 supersedes the qty-1 order above. The superseded order_items
      // survive (audit) with non-null quantity but a superseded order, so the active-row FILTER
      // must report SUM=2 for item0 — neither the row count (1) nor both orders' sum (3) — and
      // item2 (only on the superseded order) drops to 0.
      await ordersService.createOrReplace({
        serviceDate: QDATE,
        userId: qUserId,
        items: [{ menuItemId: menu[0].id, quantity: 2 }],
        source: 'omr',
        operatorId: adminId,
      });

      const res = await request(app.getHttpServer())
        .get('/menu/summary')
        .query({ date: QDATE })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const summary = res.body as { menuItemId: string; count: number }[];
      expect(summary.find((r) => r.menuItemId === menu[0].id)?.count).toBe(2);
      expect(summary.find((r) => r.menuItemId === menu[2].id)?.count).toBe(0);
    });
  });
});
