import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  E2EContext,
  createE2EApp,
  seedGlobalMenu,
  seedOperator,
  seedUser,
  login,
  truncate,
  SeededMenuItem,
} from './setup/e2e-bootstrap';
import { OperatorRole } from '../src/operators/operator.entity';
import { OrdersService } from '../src/orders/orders.service';
import { AccountsService } from '../src/accounts/accounts.service';
import { AccountTransactionType } from '../src/accounts/account-transaction.entity';
import { User } from '../src/users/user.entity';

// Delivery vouchers: ADMIN-only GET /orders/vouchers?date= returns one merged signed sheet
// per prisoner over the date's PAID active orders. These assertions are NOT unit-testable:
//   - non-admin → 403 (RolesGuard is a global APP_GUARD)
//   - GET /orders/vouchers must hit the literal route, NOT be captured by @Get(':id')
//     (ParseUUIDPipe would 400 on the non-UUID "vouchers" if the route order regressed)
//   - the merge/total/balance assembly over real PAID orders (omr paid-from-balance +
//     an accepted relative order) — and the exclusion of an unpaid pending relative order
describe('Delivery vouchers (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;
  let adminId: string;
  let ordersService: OrdersService;
  let accountsService: AccountsService;

  let menu: SeededMenuItem[];
  let paidUserId: string;
  let unpaidUserId: string;

  const SVC_DATE = '2026-06-25';
  const FUND = 1_000_000;

  const fund = (uid: string) =>
    accountsService.credit({
      userId: uid,
      amount: FUND,
      type: AccountTransactionType.TOPUP,
      operatorId: adminId,
    });

  const setZoneCell = (uid: string, zone: string, cell: string) =>
    ds.getRepository(User).update(uid, { zone, cell });

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

    const admin = await seedOperator(ds, 'vou_admin', OperatorRole.ADMIN);
    adminId = admin.id;
    adminToken = await login(app, 'vou_admin');

    await seedOperator(ds, 'vou_operator', OperatorRole.OPERATOR);
    operatorToken = await login(app, 'vou_operator');

    menu = await seedGlobalMenu(ds);

    // Prisoner with PAID orders: an omr order (paid from balance) + a relative order accepted
    // by a cashier (paid by cash). Both contribute to the merged voucher.
    const paid = await seedUser(ds, 'P-PAID', 'Paid Prisoner');
    paidUserId = paid.id;
    await setZoneCell(paidUserId, 'Khu 1', 'Buong 1');
    await fund(paidUserId);

    await ordersService.createOrReplace({
      serviceDate: SVC_DATE,
      userId: paidUserId,
      items: [{ menuItemId: menu[0].id, quantity: 1 }],
      source: 'omr',
      operatorId: adminId,
    });
    const rel = await ordersService.createOrReplace({
      serviceDate: SVC_DATE,
      userId: paidUserId,
      // menu[1] qty 3 proves the voucher sums intra-order quantity, not row count.
      items: [{ menuItemId: menu[0].id, quantity: 1 }, { menuItemId: menu[1].id, quantity: 3 }],
      source: 'relative',
      paymentMethod: 'cash',
    });
    await ordersService.acceptRelativeOrder(rel.id, { operatorId: adminId, method: 'cash' });

    // Prisoner with ONLY an unpaid pending relative order → must NOT appear on any voucher.
    const unpaid = await seedUser(ds, 'P-UNPAID', 'Unpaid Prisoner');
    unpaidUserId = unpaid.id;
    await setZoneCell(unpaidUserId, 'Khu 1', 'Buong 2');
    await ordersService.createOrReplace({
      serviceDate: SVC_DATE,
      userId: unpaidUserId,
      items: [{ menuItemId: menu[2].id, quantity: 1 }],
      source: 'relative',
      paymentMethod: 'cash',
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

  it('rejects a non-admin operator with 403', async () => {
    await request(app.getHttpServer())
      .get('/orders/vouchers')
      .query({ date: SVC_DATE })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('GET /orders/vouchers hits the literal route (not captured by :id / ParseUUIDPipe)', async () => {
    // A route-order regression would send "vouchers" through @Get(':id')'s ParseUUIDPipe → 400.
    const res = await request(app.getHttpServer())
      .get('/orders/vouchers')
      .query({ date: SVC_DATE })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns one merged voucher per prisoner over PAID active orders; excludes unpaid pending', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders/vouchers')
      .query({ date: SVC_DATE })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const vouchers = res.body as Array<{
      userId: string;
      name: string;
      legacyId: string;
      zone: string | null;
      cell: string | null;
      items: { name: string; qty: number }[];
      totalAmount: number;
      remainingBalance: number;
      printedAt: string;
    }>;

    // The unpaid-only prisoner is absent; only the paid prisoner has a voucher.
    expect(vouchers.map((v) => v.userId)).toContain(paidUserId);
    expect(vouchers.map((v) => v.userId)).not.toContain(unpaidUserId);

    const v = vouchers.find((x) => x.userId === paidUserId)!;
    expect(v.name).toBe('Paid Prisoner');
    expect(v.legacyId).toBe('P-PAID');
    expect(v.zone).toBe('Khu 1');
    expect(v.cell).toBe('Buong 1');

    // menu[0] in both orders (qty 1 each) → cross-order sum 2; menu[1] only in the relative at
    // qty 3 → intra-order sum 3. Together they prove SUM(oi.quantity) merges both axes.
    const com = v.items.find((i) => i.name === menu[0].name);
    const bun = v.items.find((i) => i.name === menu[1].name);
    expect(com?.qty).toBe(2);
    expect(bun?.qty).toBe(3);

    // total = omr (price0) + relative (price0 + price1 × 3).
    expect(v.totalAmount).toBe(menu[0].price + menu[0].price + menu[1].price * 3);
    // Only the omr order debits the balance (relative paid by cash).
    expect(v.remainingBalance).toBe(FUND - menu[0].price);
    expect(typeof v.printedAt).toBe('string');
    expect(v.printedAt.length).toBeGreaterThan(0);
  });
});
