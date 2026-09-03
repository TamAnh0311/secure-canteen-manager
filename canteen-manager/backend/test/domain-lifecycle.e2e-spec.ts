import { INestApplication } from '@nestjs/common';
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
import { OrderStatus } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { AccountsService } from '../src/accounts/accounts.service';
import { AccountTransactionType } from '../src/accounts/account-transaction.entity';

// Date-bucketing lifecycle. The session model is gone: an order belongs to a calendar
// service_date, and the active-order uniqueness invariant is per (service_date, user, source).
// This spec exercises the three day-bucketing guarantees end to end against real Postgres:
//   1. orders on different service dates are independent (a new date never supersedes an old one)
//   2. a same-date same-source (omr) re-scan supersedes the prior order in place
//   3. a second relative create on the same date 409s (ORDER.ALREADY_PENDING) — at most one
//      pending visitor order per prisoner+date
describe('Date-bucketing order lifecycle (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ordersService: OrdersService;
  let accountsService: AccountsService;
  let adminId: string;
  let userId: string;
  let menu: SeededMenuItem[];

  const D1 = '2026-06-20';
  const D2 = '2026-06-21';

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

    const admin = await seedOperator(ds, 'lc_admin', OperatorRole.ADMIN);
    adminId = admin.id;
    const user = await seedUser(ds, 'LC-U001');
    userId = user.id;

    menu = await seedGlobalMenu(ds);
    await generateGlobalForm(ds);

    // Warden (omr) orders debit the balance, so fund the prisoner generously.
    await accountsService.credit({
      userId,
      amount: 1_000_000,
      type: AccountTransactionType.TOPUP,
      operatorId: adminId,
    });
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

  describe('independence across service dates', () => {
    it('an omr order on a later date does NOT supersede the order on an earlier date', async () => {
      const day1 = await ordersService.createOrReplace({
        serviceDate: D1,
        userId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      const day2 = await ordersService.createOrReplace({
        serviceDate: D2,
        userId,
        items: [{ menuItemId: menu[1].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });

      // Both stay active — different buckets, no supersede.
      expect((await ordersService.findOne(day1.id)).status).toBe(OrderStatus.ACTIVE);
      expect((await ordersService.findOne(day2.id)).status).toBe(OrderStatus.ACTIVE);

      const d1Orders = await ordersService.findAll({
        dateFrom: D1,
        dateTo: D1,
        userId,
        limit: 50,
        offset: 0,
      });
      expect(d1Orders.filter((o) => o.status === OrderStatus.ACTIVE)).toHaveLength(1);

      const d2Orders = await ordersService.findAll({
        dateFrom: D2,
        dateTo: D2,
        userId,
        limit: 50,
        offset: 0,
      });
      expect(d2Orders.filter((o) => o.status === OrderStatus.ACTIVE)).toHaveLength(1);
    });
  });

  describe('same-date same-source supersede in place', () => {
    it('a same-date omr re-scan supersedes the prior order and leaves exactly one active', async () => {
      const first = await ordersService.createOrReplace({
        serviceDate: D1,
        userId,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      const second = await ordersService.createOrReplace({
        serviceDate: D1,
        userId,
        items: [{ menuItemId: menu[2].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });

      const reloaded = await ordersService.findOne(first.id);
      expect(reloaded.status).toBe(OrderStatus.SUPERSEDED);
      expect(reloaded.supersededByOrderId).toBe(second.id);
      expect(reloaded.supersededAt).not.toBeNull();

      const d1Active = (
        await ordersService.findAll({ dateFrom: D1, dateTo: D1, userId, limit: 50, offset: 0 })
      ).filter((o) => o.status === OrderStatus.ACTIVE);
      expect(d1Active).toHaveLength(1);
      expect(d1Active[0].id).toBe(second.id);
    });
  });

  describe('relative single-pending guard', () => {
    it('a second relative create on the same date 409s with ORDER.ALREADY_PENDING', async () => {
      const relUser = await seedUser(ds, 'LC-REL-1');

      await ordersService.createOrReplace({
        serviceDate: D1,
        userId: relUser.id,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'relative',
        paymentMethod: 'cash',
      });

      await expect(
        ordersService.createOrReplace({
          serviceDate: D1,
          userId: relUser.id,
          items: [{ menuItemId: menu[1].id, quantity: 1 }],
          source: 'relative',
          paymentMethod: 'cash',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ORDER.ALREADY_PENDING' },
      });
    });

    it('an omr and a relative order coexist on the same date for the same prisoner', async () => {
      const coUser = await seedUser(ds, 'LC-CO-1');
      await accountsService.credit({
        userId: coUser.id,
        amount: 500_000,
        type: AccountTransactionType.TOPUP,
        operatorId: adminId,
      });

      await ordersService.createOrReplace({
        serviceDate: D2,
        userId: coUser.id,
        items: [{ menuItemId: menu[0].id, quantity: 1 }],
        source: 'omr',
        operatorId: adminId,
      });
      await ordersService.createOrReplace({
        serviceDate: D2,
        userId: coUser.id,
        items: [{ menuItemId: menu[1].id, quantity: 1 }],
        source: 'relative',
        paymentMethod: 'bank',
      });

      const active = (
        await ordersService.findAll({ dateFrom: D2, dateTo: D2, userId: coUser.id, limit: 50, offset: 0 })
      ).filter((o) => o.status === OrderStatus.ACTIVE);
      expect(active).toHaveLength(2);
      expect(active.map((o) => o.source).sort()).toEqual(['omr', 'relative']);
    });
  });
});
