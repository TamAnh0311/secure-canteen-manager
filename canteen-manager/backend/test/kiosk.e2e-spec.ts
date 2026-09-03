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
  truncate,
  SeededMenuItem,
} from './setup/e2e-bootstrap';
import { OperatorRole } from '../src/operators/operator.entity';
import { OrderStatus, PaymentStatus } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { MenuService } from '../src/menu/menu.service';
import { MenuItemCategory } from '../src/menu/menu-item-category.enum';
import { AccountsService } from '../src/accounts/accounts.service';
import { AccountTransactionType } from '../src/accounts/account-transaction.entity';

// The kiosk is the relative-facing, unauthenticated read-only screen on the trusted LAN.
// It surfaces a prisoner's NAME + the single global active menu (display-only id/name/price)
// and nothing financial, plus one public write that places a PENDING relative order — money is
// never moved here (the order is unpaid until a cashier accepts it at the counter).
describe('Kiosk — public read-only relative screen (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ordersService: OrdersService;
  let menuService: MenuService;
  let accountsService: AccountsService;
  let adminOperatorId: string;

  let menu: SeededMenuItem[];
  let visibleItemId: string;
  let inactiveItemId: string;

  const ACTIVE_PRISON_ID = 'KIOSK-ACTIVE';
  const INACTIVE_PRISON_ID = 'KIOSK-INACTIVE';
  const UNKNOWN_PRISON_ID = 'KIOSK-NOPE';
  const ORDER_PRISON_ID = 'KIOSK-ORDER';
  const DUP_PRISON_ID = 'KIOSK-DUP';
  const PAR_PRISON_ID = 'KIOSK-PAR';
  const INACTIVE_ITEM_PRICE = 9_000;

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
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);

    const admin = await seedOperator(ds, 'kiosk_admin', OperatorRole.ADMIN);
    adminOperatorId = admin.id;

    await seedUser(ds, ACTIVE_PRISON_ID, 'Kiosk Active Prisoner');
    // Dedicated prisoners for the order-placing scenarios (≤1 pending per prisoner+date).
    await Promise.all([
      seedUser(ds, ORDER_PRISON_ID, 'Kiosk Order Prisoner'),
      seedUser(ds, DUP_PRISON_ID, 'Kiosk Dup Prisoner'),
      seedUser(ds, PAR_PRISON_ID, 'Kiosk Parallel Prisoner'),
    ]);
    await seedUser(ds, INACTIVE_PRISON_ID, 'Kiosk Released Prisoner', false);

    // The three global active items + one appended item that is then deactivated. A delisted
    // dish must never be offered to a visitor (read view) nor be orderable (write path).
    menu = await seedGlobalMenu(ds);
    visibleItemId = menu[0].id;
    const hidden = await menuService.addItem({
      name: 'Kiosk Item Hidden',
      price: INACTIVE_ITEM_PRICE,
      category: MenuItemCategory.FOOD,
    });
    inactiveItemId = hidden.id;
    await menuService.updateItem(inactiveItemId, { isActive: false });

    // Generate the global form AFTER the menu is finalised so positions/decode are frozen.
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

  it('resolves a prison ID → name + global active menu with prices, no auth required', async () => {
    const res = await request(app.getHttpServer())
      .get(`/kiosk/prisoner/${ACTIVE_PRISON_ID}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kiosk Active Prisoner');
    expect(Array.isArray(res.body.menu)).toBe(true);
    // Only the three active seeded items — the deactivated one is excluded.
    expect(res.body.menu).toHaveLength(menu.length);
    const names = res.body.menu.map((m: { name: string }) => m.name);
    expect(names).toEqual(menu.map((m) => m.name));
    expect(names).not.toContain('Kiosk Item Hidden');
  });

  it('never exposes any financial field (balance / ledger / order) in the payload', async () => {
    const res = await request(app.getHttpServer())
      .get(`/kiosk/prisoner/${ACTIVE_PRISON_ID}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('balance');
    expect(res.body).not.toHaveProperty('ledger');
    expect(res.body).not.toHaveProperty('sessions');
    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toContain('balance');
    expect(serialized).not.toContain('ledger');
    // Menu entries expose category for client-side purchase-limit guidance, but no
    // activation/position internals or financial account state.
    const item = res.body.menu[0];
    expect(Object.keys(item).sort()).toEqual(['category', 'id', 'name', 'price']);
  });

  it('returns 404 for an unknown prison ID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/kiosk/prisoner/${UNKNOWN_PRISON_ID}`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER.NOT_FOUND');
  });

  it('does not surface a released (inactive) prisoner → 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/kiosk/prisoner/${INACTIVE_PRISON_ID}`)
      .send();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('USER.NOT_FOUND');
  });

  it('exposes no write routes on the prisoner view (only GET is mounted there)', async () => {
    const server = app.getHttpServer();
    const post = await request(server)
      .post(`/kiosk/prisoner/${ACTIVE_PRISON_ID}`)
      .send({ anything: true });
    expect(post.status).toBe(404);
    const patch = await request(server)
      .patch(`/kiosk/prisoner/${ACTIVE_PRISON_ID}`)
      .send({ anything: true });
    expect(patch.status).toBe(404);
    const del = await request(server).delete(`/kiosk/prisoner/${ACTIVE_PRISON_ID}`).send();
    expect(del.status).toBe(404);
  });

  describe('placing a pending order (POST /kiosk/orders)', () => {
    const placeOrder = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/kiosk/orders').send(body);

    it('creates a PENDING relative order, returns a confirmation code, and never touches the balance', async () => {
      // Fund the prisoner first so "balance unchanged" is a meaningful assertion (not just 0 == 0).
      const user = await seedUser(ds, 'KIOSK-FUNDED', 'Kiosk Funded Prisoner');
      await accountsService.credit({
        userId: user.id,
        amount: 80_000,
        type: AccountTransactionType.TOPUP,
        operatorId: adminOperatorId,
      });
      const balanceBefore = await accountsService.getBalance(user.id);

      const res = await placeOrder({
        prisonId: 'KIOSK-FUNDED',
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(res.status).toBe(201);
      expect(res.body.orderId).toBeTruthy();
      expect(res.body.confirmationCode).toBe((res.body.orderId as string).slice(0, 8).toUpperCase());

      // The created order is ACTIVE/UNPAID/relative — no auto-pay on create.
      const order = await ordersService.findOne(res.body.orderId as string);
      expect(order.source).toBe('relative');
      expect(order.status).toBe(OrderStatus.ACTIVE);
      expect(order.paymentStatus).toBe(PaymentStatus.UNPAID);
      expect(order.paymentMethod).toBe('cash');

      // The balance is identical before/after — proves the kiosk write cannot reach the omr branch.
      expect(await accountsService.getBalance(user.id)).toBe(balanceBefore);
    });

    it('multiplies the line total by quantity and persists order_items.quantity', async () => {
      await seedUser(ds, 'KIOSK-QTY', 'Kiosk Qty Prisoner');
      const res = await placeOrder({
        prisonId: 'KIOSK-QTY',
        items: [{ menuItemId: visibleItemId, quantity: 3 }],
        method: 'cash',
      });
      expect(res.status).toBe(201);

      const order = await ordersService.findOne(res.body.orderId as string);
      // total = unit_price × quantity; the persisted line carries the chosen portions.
      expect(order.totalAmount).toBe(menu[0].price * 3);
      expect(order.items).toHaveLength(1);
      expect(order.items[0].quantity).toBe(3);
    });

    it('returns 404 for an unknown prison ID', async () => {
      const res = await placeOrder({
        prisonId: UNKNOWN_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('USER.NOT_FOUND');
    });

    it('returns the same opaque 404 for a released (inactive) prisoner', async () => {
      const res = await placeOrder({
        prisonId: INACTIVE_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('USER.NOT_FOUND');
    });

    it('rejects an unknown menu item id with ORDER.ITEM_NOT_IN_MENU', async () => {
      const res = await placeOrder({
        prisonId: ORDER_PRISON_ID,
        items: [{ menuItemId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ORDER.ITEM_NOT_IN_MENU');
    });

    it('rejects a known-but-deactivated menu item id with ORDER.ITEM_NOT_IN_MENU', async () => {
      const res = await placeOrder({
        prisonId: ORDER_PRISON_ID,
        items: [{ menuItemId: inactiveItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ORDER.ITEM_NOT_IN_MENU');
    });

    it('rejects extra non-whitelisted fields (source / operatorId / unknown) → 400', async () => {
      const withSource = await placeOrder({
        prisonId: PAR_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
        source: 'omr',
      });
      expect(withSource.status).toBe(400);
      const withOperator = await placeOrder({
        prisonId: PAR_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
        operatorId: adminOperatorId,
      });
      expect(withOperator.status).toBe(400);
      // A public kiosk write must never be able to forge order provenance.
      const withForgedField = await placeOrder({
        prisonId: PAR_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
        paymentStatus: 'paid',
      });
      expect(withForgedField.status).toBe(400);
    });

    it('rejects extra non-whitelisted keys INSIDE a line object → 400', async () => {
      // The nested @Type + @ValidateNested must recurse on the public endpoint, so a client
      // cannot smuggle provenance fields inside a line to reach the balance-paying omr branch.
      const res = await placeOrder({
        prisonId: PAR_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1, source: 'omr', operatorId: adminOperatorId }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects quantity below 1 (0) → 400', async () => {
      const res = await placeOrder({
        prisonId: ORDER_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 0 }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects quantity above 99 (100) → 400', async () => {
      const res = await placeOrder({
        prisonId: ORDER_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 100 }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a line missing quantity → 400', async () => {
      const res = await placeOrder({
        prisonId: ORDER_PRISON_ID,
        items: [{ menuItemId: visibleItemId }],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('rejects an empty items array → 400', async () => {
      const res = await placeOrder({
        prisonId: ORDER_PRISON_ID,
        items: [],
        method: 'cash',
      });
      expect(res.status).toBe(400);
    });

    it('a duplicate pending for the same prisoner today → 409 ORDER.ALREADY_PENDING', async () => {
      const first = await placeOrder({
        prisonId: DUP_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(first.status).toBe(201);
      const second = await placeOrder({
        prisonId: DUP_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ORDER.ALREADY_PENDING');

      // After a reject (frees the slot), a fresh kiosk create succeeds again.
      await ordersService.rejectRelativeOrder(first.body.orderId as string, {
        operatorId: adminOperatorId,
        reason: 'test cleanup',
      });
      const third = await placeOrder({
        prisonId: DUP_PRISON_ID,
        items: [{ menuItemId: visibleItemId, quantity: 1 }],
        method: 'cash',
      });
      expect(third.status).toBe(201);
    });

    it('two PARALLEL creates for the same prisoner today → exactly one 201, one 409', async () => {
      const [a, b] = await Promise.all([
        placeOrder({ prisonId: PAR_PRISON_ID, items: [{ menuItemId: visibleItemId, quantity: 1 }], method: 'cash' }),
        placeOrder({ prisonId: PAR_PRISON_ID, items: [{ menuItemId: visibleItemId, quantity: 1 }], method: 'cash' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = [a, b].find((r) => r.status === 409);
      expect(conflict!.body.code).toBe('ORDER.ALREADY_PENDING');
    });
  });
});
