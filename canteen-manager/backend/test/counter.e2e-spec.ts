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
  tomorrow,
  truncate,
  SeededMenuItem,
} from './setup/e2e-bootstrap';
import { OperatorRole } from '../src/operators/operator.entity';
import { OrderStatus, PaymentStatus } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { AccountsService } from '../src/accounts/accounts.service';
import {
  AccountTransaction,
  AccountTransactionType,
} from '../src/accounts/account-transaction.entity';
import { MAX_VND } from '../src/common/numeric.transformer';

// Staffed counter against the global menu, date-bucketed orders (no sessions). Covers cashier
// top-ups, counter-paid relative orders (pending until accepted), and the pending-approval queue.
describe('Counter — cashier top-ups + relative orders (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ordersService: OrdersService;
  let accountsService: AccountsService;

  let adminId: string;
  let adminToken: string;
  let cashierToken: string;
  let cashierId: string;
  let operatorToken: string;

  let activeUserId: string;
  let menu: SeededMenuItem[];
  let item0Id: string;
  let item1Id: string;
  // Counter relative orders are stamped for the next collection day; the seeded warden
  // order shares this date so the coexistence assertions hold on a single bucket.
  const SVC_DATE = tomorrow();
  const P0 = 35_000; // menu[0].price
  const P1 = 40_000; // menu[1].price

  const ACTIVE_PRISON_ID = 'CTR-ACTIVE';
  const INACTIVE_PRISON_ID = 'CTR-INACTIVE';
  const UNKNOWN_PRISON_ID = 'CTR-NOPE';
  const QA_PRISON_ID = 'CTR-QA';
  const QB_PRISON_ID = 'CTR-QB';
  const QC_PRISON_ID = 'CTR-QC';
  const QD_PRISON_ID = 'CTR-QD';
  const QE_PRISON_ID = 'CTR-QE';
  const QF_PRISON_ID = 'CTR-QF';
  const QG_PRISON_ID = 'CTR-QG';
  const QH_PRISON_ID = 'CTR-QH';

  beforeAll(async () => {
    const ctx: E2EContext = await createE2EApp();
    app = ctx.app;
    ds = ctx.dataSource;
    ordersService = ctx.moduleRef.get(OrdersService);
    accountsService = ctx.moduleRef.get(AccountsService);

    await truncate(ds, [
      'account_transactions',
      'prisoner_accounts',
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);

    const admin = await seedOperator(ds, 'counter_admin', OperatorRole.ADMIN);
    adminId = admin.id;
    const cashier = await seedOperator(ds, 'counter_cashier', OperatorRole.CASHIER);
    cashierId = cashier.id;
    await seedOperator(ds, 'counter_operator', OperatorRole.OPERATOR);
    cashierToken = await login(app, 'counter_cashier');
    adminToken = await login(app, 'counter_admin');
    operatorToken = await login(app, 'counter_operator');

    const activeUser = await seedUser(ds, ACTIVE_PRISON_ID, 'Active Prisoner');
    activeUserId = activeUser.id;
    await seedUser(ds, INACTIVE_PRISON_ID, 'Released Prisoner', false);

    // Dedicated prisoners for the pending-queue scenarios — one per scenario so the
    // ≤1-pending-per-(prisoner,date) rule never collides across tests.
    await Promise.all([
      seedUser(ds, QA_PRISON_ID, 'Queue Prisoner A'),
      seedUser(ds, QB_PRISON_ID, 'Queue Prisoner B'),
      seedUser(ds, QC_PRISON_ID, 'Queue Prisoner C'),
      seedUser(ds, QD_PRISON_ID, 'Queue Prisoner D'),
      seedUser(ds, QE_PRISON_ID, 'Queue Prisoner E'),
      seedUser(ds, QF_PRISON_ID, 'Queue Prisoner F'),
      seedUser(ds, QG_PRISON_ID, 'Queue Prisoner G'),
      seedUser(ds, QH_PRISON_ID, 'Queue Prisoner H'),
    ]);

    menu = await seedGlobalMenu(ds);
    item0Id = menu[0].id;
    item1Id = menu[1].id;
    await generateGlobalForm(ds);
  });

  afterAll(async () => {
    await truncate(ds, [
      'account_transactions',
      'prisoner_accounts',
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);
    await app.close();
  });

  const asCashier = (req: request.Test) => req.set('Authorization', `Bearer ${cashierToken}`);

  describe('role gating', () => {
    it('a plain operator is forbidden from the counter (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/counter/topups')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ prisonId: ACTIVE_PRISON_ID, amount: 10_000, method: 'cash' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH.INSUFFICIENT_ROLE');
    });

    it('an unauthenticated request is rejected (401)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/counter/prisoner/${ACTIVE_PRISON_ID}`)
        .send();
      expect(res.status).toBe(401);
    });
  });

  describe('prisoner lookup', () => {
    it('returns name, balance, and recent ledger for a known prisoner', async () => {
      const res = await asCashier(
        request(app.getHttpServer()).get(`/counter/prisoner/${ACTIVE_PRISON_ID}`),
      );
      expect(res.status).toBe(200);
      expect(res.body.user.legacyId).toBe(ACTIVE_PRISON_ID);
      expect(res.body.user.name).toBe('Active Prisoner');
      expect(res.body.user.isActive).toBe(true);
      expect(typeof res.body.balance).toBe('number');
      expect(Array.isArray(res.body.ledger)).toBe(true);
    });

    it('unknown prison ID → 404 USER.NOT_FOUND', async () => {
      const res = await asCashier(
        request(app.getHttpServer()).get(`/counter/prisoner/${UNKNOWN_PRISON_ID}`),
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('USER.NOT_FOUND');
    });
  });

  describe('top-up', () => {
    it('cashier credits the balance and writes a topup ledger row (operator + method + ref)', async () => {
      const before = await accountsService.getBalance(activeUserId);
      const res = await asCashier(request(app.getHttpServer()).post('/counter/topups')).send({
        prisonId: ACTIVE_PRISON_ID,
        amount: 50_000,
        method: 'cash',
        ref: 'RCPT-001',
      });
      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(activeUserId);
      expect(res.body.balance).toBe(before + 50_000);
      expect(await accountsService.getBalance(activeUserId)).toBe(before + 50_000);

      const txRepo = ds.getRepository(AccountTransaction);
      const topups = await txRepo.find({
        where: { userId: activeUserId, type: AccountTransactionType.TOPUP },
      });
      expect(topups).toHaveLength(1);
      expect(topups[0].amount).toBe(50_000);
      expect(topups[0].method).toBe('cash');
      expect(topups[0].ref).toBe('RCPT-001');
      // Cashier role used the cashier token; the row is stamped to that operator.
      expect(topups[0].operatorId).toBeTruthy();
      expect(topups[0].balanceAfter).toBe(before + 50_000);
    });

    it('rejects amount ≤ 0 (400)', async () => {
      const res = await asCashier(request(app.getHttpServer()).post('/counter/topups')).send({
        prisonId: ACTIVE_PRISON_ID,
        amount: 0,
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects amount > MAX_VND (400)', async () => {
      const res = await asCashier(request(app.getHttpServer()).post('/counter/topups')).send({
        prisonId: ACTIVE_PRISON_ID,
        amount: MAX_VND + 1,
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown tender method (400)', async () => {
      const res = await asCashier(request(app.getHttpServer()).post('/counter/topups')).send({
        prisonId: ACTIVE_PRISON_ID,
        amount: 10_000,
        method: 'crypto',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a top-up for an inactive prisoner (400 USER.INACTIVE)', async () => {
      const res = await asCashier(request(app.getHttpServer()).post('/counter/topups')).send({
        prisonId: INACTIVE_PRISON_ID,
        amount: 10_000,
        method: 'cash',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('USER.INACTIVE');
    });
  });

  describe('relative order', () => {
    it('creates a PENDING (unpaid) relative order without touching the balance, coexisting with a warden order', async () => {
      // Fund + place a warden (omr) order first; the relative order must coexist with it.
      await accountsService.credit({
        userId: activeUserId,
        amount: 100_000,
        type: AccountTransactionType.TOPUP,
        operatorId: adminId,
      });
      await ordersService.createOrReplace({
        serviceDate: SVC_DATE,
        userId: activeUserId,
        items: [{ menuItemId: item0Id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      const balanceBefore = await accountsService.getBalance(activeUserId);

      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({
        prisonId: ACTIVE_PRISON_ID,
        items: [
          { menuItemId: item0Id, quantity: 1 },
          { menuItemId: item1Id, quantity: 1 },
        ],
        method: 'bank',
      });
      expect(res.status).toBe(201);
      expect(res.body.source).toBe('relative');
      expect(res.body.status).toBe(OrderStatus.ACTIVE);
      // No auto-pay on create: a counter relative order is pending until a cashier accepts.
      expect(res.body.paymentStatus).toBe(PaymentStatus.UNPAID);
      // The chosen tender is stored up front as the intended method, even while unpaid.
      expect(res.body.paymentMethod).toBe('bank');
      expect(res.body.totalAmount).toBe(P0 + P1);
      expect(res.body.serviceDate).toBe(SVC_DATE);

      // Balance is untouched — a relative order never debits the commissary balance.
      expect(await accountsService.getBalance(activeUserId)).toBe(balanceBefore);

      // An omr and a relative ACTIVE order coexist for the same prisoner today.
      const all = await ordersService.findAll({
        dateFrom: SVC_DATE,
        dateTo: SVC_DATE,
        userId: activeUserId,
        limit: 50,
        offset: 0,
      });
      const active = all.filter((o) => o.status === OrderStatus.ACTIVE);
      expect(active.map((o) => o.source).sort()).toEqual(['omr', 'relative']);
    });

    it('multiplies each line by its quantity and persists order_items.quantity', async () => {
      await seedUser(ds, 'CTR-QTY', 'Counter Qty Prisoner');
      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({
        prisonId: 'CTR-QTY',
        items: [
          { menuItemId: item0Id, quantity: 2 },
          { menuItemId: item1Id, quantity: 3 },
        ],
        method: 'cash',
      });
      expect(res.status).toBe(201);
      expect(res.body.totalAmount).toBe(P0 * 2 + P1 * 3);

      const order = await ordersService.findOne(res.body.id as string);
      const byItem = new Map(order.items.map((i) => [i.menuItemId, i.quantity]));
      expect(byItem.get(item0Id)).toBe(2);
      expect(byItem.get(item1Id)).toBe(3);
    });

    it('rejects an empty items array (400)', async () => {
      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({ prisonId: ACTIVE_PRISON_ID, items: [], method: 'cash' });
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range quantity (100) (400)', async () => {
      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({
        prisonId: ACTIVE_PRISON_ID,
        items: [{ menuItemId: item0Id, quantity: 100 }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects extra non-whitelisted keys INSIDE a line object (400)', async () => {
      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({
        prisonId: ACTIVE_PRISON_ID,
        items: [{ menuItemId: item0Id, quantity: 1, source: 'omr' }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it("rejects method='balance' on a relative order (400)", async () => {
      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({
        prisonId: ACTIVE_PRISON_ID,
        items: [{ menuItemId: item0Id, quantity: 1 }],
        method: 'balance',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a relative order for an inactive prisoner (400 USER.INACTIVE)', async () => {
      const res = await asCashier(
        request(app.getHttpServer()).post('/counter/relative-orders'),
      ).send({
        prisonId: INACTIVE_PRISON_ID,
        items: [{ menuItemId: item0Id, quantity: 1 }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('USER.INACTIVE');
    });
  });

  // Creates a pending relative order at the counter for the given prisoner and returns its id.
  // Each menu id becomes a single-portion line on the shared items[] funnel.
  const createPending = async (
    prisonId: string,
    method = 'cash',
    menuItemIds: string[] = [item0Id],
  ): Promise<string> => {
    const res = await asCashier(
      request(app.getHttpServer()).post('/counter/relative-orders'),
    ).send({
      prisonId,
      items: menuItemIds.map((menuItemId) => ({ menuItemId, quantity: 1 })),
      method,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  describe('pending-approval queue', () => {
    it('lists a pending order enriched with prisoner name, item names, and service date (FIFO)', async () => {
      await createPending(QA_PRISON_ID, 'cash', [item0Id, item1Id]);
      const res = await asCashier(request(app.getHttpServer()).get('/counter/pending-orders'));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const row = res.body.find(
        (r: { prisoner: { legacyId: string } }) => r.prisoner.legacyId === QA_PRISON_ID,
      );
      expect(row).toBeTruthy();
      expect(row.prisoner.name).toBe('Queue Prisoner A');
      expect(row.serviceDate).toBe(SVC_DATE);
      expect(row.confirmationCode).toBe((row.orderId as string).slice(0, 8).toUpperCase());
      const itemNames = row.items.map((i: { name: string }) => i.name).sort();
      expect(itemNames).toEqual([menu[0].name, menu[1].name].sort());
      expect(row.totalAmount).toBe(P0 + P1);
      expect(row.paymentMethod).toBe('cash');

      // FIFO: rows are ordered oldest-first by createdAt.
      const times = res.body.map((r: { createdAt: string }) => new Date(r.createdAt).getTime());
      const sorted = [...times].sort((a, b) => a - b);
      expect(times).toEqual(sorted);
    });

    it('accept (no body) → PAID with the intended method + operator attribution', async () => {
      const id = await createPending(QC_PRISON_ID, 'cash');
      const res = await asCashier(
        request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
      ).send({});
      expect(res.status).toBe(201);
      expect(res.body.status).toBe(OrderStatus.ACTIVE);
      expect(res.body.paymentStatus).toBe(PaymentStatus.PAID);
      expect(res.body.paymentMethod).toBe('cash');
      expect(res.body.settledByOperatorId).toBe(cashierId);
      expect(res.body.settledAt).toBeTruthy();
      const [tg8] = await ds.query(
        `SELECT snapshot, accepted_at, operator_id
           FROM order_tg8_documents
          WHERE order_id = $1`,
        [id],
      );
      expect(tg8.operator_id).toBe(cashierId);
      expect(tg8.snapshot).toMatchObject({
        schemaVersion: 'tg8-snapshot-v1',
        prisoner: { legacyId: QC_PRISON_ID, name: 'Queue Prisoner C' },
        acceptedTotal: P0,
        items: [{ name: menu[0].name, quantity: 1 }],
      });

      // Accepted orders drop out of the pending queue.
      const queue = await asCashier(request(app.getHttpServer()).get('/counter/pending-orders'));
      expect(queue.body.find((r: { orderId: string }) => r.orderId === id)).toBeFalsy();
    });

    it('accept {method:bank} overrides the intended cash tender', async () => {
      const id = await createPending(QE_PRISON_ID, 'cash');
      const res = await asCashier(
        request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
      ).send({ method: 'bank' });
      expect(res.status).toBe(201);
      expect(res.body.paymentStatus).toBe(PaymentStatus.PAID);
      expect(res.body.paymentMethod).toBe('bank');
    });

    it('lists minimum TG8 metadata for CASHIER/ADMIN and rejects other access', async () => {
      const cashier = await asCashier(
        request(app.getHttpServer()).get(`/counter/tg8-documents?date=${today()}`),
      );
      expect(cashier.status).toBe(200);
      expect(cashier.body.length).toBeGreaterThan(0);
      expect(cashier.body[0]).toEqual(
        expect.objectContaining({
          orderId: expect.any(String),
          templateRevision: 'tg8-v1',
          acceptedAt: expect.any(String),
          prisoner: {
            legacyId: expect.any(String),
            name: expect.any(String),
          },
          totalAmount: expect.any(Number),
        }),
      );
      expect(cashier.body[0]).not.toHaveProperty('snapshot');

      const admin = await request(app.getHttpServer())
        .get(`/counter/tg8-documents?date=${today()}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(admin.status).toBe(200);

      const operator = await request(app.getHttpServer())
        .get(`/counter/tg8-documents?date=${today()}`)
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(operator.status).toBe(403);

      const unauthenticated = await request(app.getHttpServer()).get(
        `/counter/tg8-documents?date=${today()}`,
      );
      expect(unauthenticated.status).toBe(401);

      const invalidDate = await asCashier(
        request(app.getHttpServer()).get('/counter/tg8-documents?date=not-a-date'),
      );
      expect(invalidDate.status).toBe(400);
    });

    it('a second accept on the same order → 409 ORDER.NOT_PENDING', async () => {
      const id = await createPending(QF_PRISON_ID, 'cash');
      const first = await asCashier(
        request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
      ).send({});
      expect(first.status).toBe(201);
      const second = await asCashier(
        request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
      ).send({});
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ORDER.NOT_PENDING');
    });

    it('concurrent accepts on the same order → exactly one 201, one 409', async () => {
      const id = await createPending(QD_PRISON_ID, 'cash');
      const [a, b] = await Promise.all([
        asCashier(
          request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
        ).send({}),
        asCashier(
          request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
        ).send({}),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM order_tg8_documents WHERE order_id = $1`,
        [id],
      );
      expect(count).toBe(1);
    });

    it('snapshot insert failure rolls back payment and leaves no TG8 row', async () => {
      const id = await createPending(QH_PRISON_ID, 'cash');
      await ds.query(`
        CREATE OR REPLACE FUNCTION fail_tg8_insert_for_test()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'synthetic TG8 snapshot failure';
        END;
        $$ LANGUAGE plpgsql
      `);
      await ds.query(`
        CREATE TRIGGER "TRG_fail_tg8_insert_for_test"
        BEFORE INSERT ON order_tg8_documents
        FOR EACH ROW EXECUTE FUNCTION fail_tg8_insert_for_test()
      `);
      try {
        const res = await asCashier(
          request(app.getHttpServer()).post(`/counter/relative-orders/${id}/accept`),
        ).send({});
        expect(res.status).toBe(500);
      } finally {
        await ds.query(
          `DROP TRIGGER IF EXISTS "TRG_fail_tg8_insert_for_test" ON order_tg8_documents`,
        );
        await ds.query(`DROP FUNCTION IF EXISTS fail_tg8_insert_for_test()`);
      }

      const [storedOrder] = await ds.query(
        `SELECT payment_status, settled_at, settled_by_operator_id
           FROM orders
          WHERE id = $1`,
        [id],
      );
      expect(storedOrder).toMatchObject({
        payment_status: PaymentStatus.UNPAID,
        settled_at: null,
        settled_by_operator_id: null,
      });
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM order_tg8_documents WHERE order_id = $1`,
        [id],
      );
      expect(count).toBe(0);
    });

    it('reject {reason} → REJECTED, freeing the slot for a fresh pending create', async () => {
      const id = await createPending(QB_PRISON_ID, 'cash');
      const rej = await asCashier(
        request(app.getHttpServer()).post(`/counter/relative-orders/${id}/reject`),
      ).send({ reason: 'visitor left' });
      expect(rej.status).toBe(201);
      expect(rej.body.status).toBe(OrderStatus.REJECTED);
      expect(rej.body.rejectReason).toBe('visitor left');
      expect(rej.body.settledByOperatorId).toBe(cashierId);

      // The rejected order is non-active, so a new pending create for the same prisoner+date succeeds.
      const again = await createPending(QB_PRISON_ID, 'cash');
      expect(again).toBeTruthy();
    });

    it('a plain operator is forbidden from accepting (403)', async () => {
      const id = await createPending(QG_PRISON_ID, 'cash');
      const res = await request(app.getHttpServer())
        .post(`/counter/relative-orders/${id}/accept`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH.INSUFFICIENT_ROLE');
    });
  });
});
