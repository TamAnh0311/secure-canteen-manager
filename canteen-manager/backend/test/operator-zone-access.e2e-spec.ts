import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createE2EApp,
  E2EContext,
  login,
  seedGlobalMenu,
  seedOperator,
  seedUser,
  tomorrow,
  truncate,
} from './setup/e2e-bootstrap';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { OrdersService } from '../src/orders/orders.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `e2e-hash:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `e2e-hash:${value}`),
}));

describe('Operator current-zone authorization matrix (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let orders: OrdersService;
  let zoneAToken: string;
  let unassignedToken: string;
  let adminToken: string;
  let cashierToken: string;
  let zoneAUserId: string;
  let zoneBUserId: string;
  let zoneAOrderId: string;
  let zoneBOrderId: string;
  const serviceDate = tomorrow();

  const authorized = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ctx: E2EContext = await createE2EApp();
    app = ctx.app;
    ds = ctx.dataSource;
    orders = ctx.moduleRef.get(OrdersService);

    await truncate(ds, [
      'order_items',
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);

    const [zoneAOperator, unassigned] = await Promise.all([
      seedOperator(ds, 'zone_matrix_a', OperatorRole.OPERATOR),
      seedOperator(ds, 'zone_matrix_none', OperatorRole.OPERATOR),
      seedOperator(ds, 'zone_matrix_admin', OperatorRole.ADMIN),
      seedOperator(ds, 'zone_matrix_cashier', OperatorRole.CASHIER),
    ]);
    await ds.getRepository(Operator).update(zoneAOperator.id, { zone: 'Zone A' });
    expect(unassigned.zone).toBeNull();

    [zoneAToken, unassignedToken, adminToken, cashierToken] = await Promise.all([
      login(app, 'zone_matrix_a'),
      login(app, 'zone_matrix_none'),
      login(app, 'zone_matrix_admin'),
      login(app, 'zone_matrix_cashier'),
    ]);

    const [zoneAUser, zoneBUser] = await Promise.all([
      seedUser(ds, 'ZONE-A-001', 'ZZZ Same Zone'),
      seedUser(ds, 'ZONE-B-001', 'AAA Cross Zone'),
    ]);
    await ds.getRepository('users').update(zoneAUser.id, { zone: 'Zone A', cell: 'A-01' });
    await ds.getRepository('users').update(zoneBUser.id, { zone: 'Zone B', cell: 'B-01' });
    zoneAUserId = zoneAUser.id;
    zoneBUserId = zoneBUser.id;

    const menu = await seedGlobalMenu(ds);
    const [zoneAOrder, zoneBOrder] = await Promise.all([
      orders.createOrReplace({
        serviceDate,
        userId: zoneAUserId,
        items: [{ menuItemId: menu[0].id, quantity: 2 }],
        source: 'relative',
        paymentMethod: 'cash',
      }),
      orders.createOrReplace({
        serviceDate,
        userId: zoneBUserId,
        items: [{ menuItemId: menu[1].id, quantity: 3 }],
        source: 'relative',
        paymentMethod: 'cash',
      }),
    ]);
    zoneAOrderId = zoneAOrder.id;
    zoneBOrderId = zoneBOrder.id;
  });

  afterAll(async () => {
    await truncate(ds, [
      'order_items',
      'orders',
      'menu_items',
      'operators',
      'users',
    ]);
    await app.close();
  });

  it('scopes OPERATOR user lists in SQL before pagination and permits same-zone direct reads', async () => {
    const list = await request(app.getHttpServer())
      .get('/users?limit=1&offset=0')
      .set(authorized(zoneAToken))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: zoneAUserId, zone: 'Zone A' });

    await request(app.getHttpServer())
      .get(`/users/${zoneAUserId}`)
      .set(authorized(zoneAToken))
      .expect(200);
  });

  it('makes cross-zone and missing direct user identifiers non-enumerating', async () => {
    const cross = await request(app.getHttpServer())
      .get(`/users/${zoneBUserId}`)
      .set(authorized(zoneAToken))
      .expect(404);
    const missing = await request(app.getHttpServer())
      .get('/users/00000000-0000-4000-8000-000000000000')
      .set(authorized(zoneAToken))
      .expect(404);
    expect(cross.body).toMatchObject({ code: 'USER.NOT_FOUND' });
    expect(cross.body).toEqual(missing.body);
  });

  it('scopes OPERATOR order lists', async () => {
    const list = await request(app.getHttpServer())
      .get(`/orders?dateFrom=${serviceDate}&dateTo=${serviceDate}&limit=50&offset=0`)
      .set(authorized(zoneAToken))
      .expect(200);
    expect(list.body.map((order: { id: string }) => order.id)).toEqual([zoneAOrderId]);

    const secondPage = await request(app.getHttpServer())
      .get(`/orders?dateFrom=${serviceDate}&dateTo=${serviceDate}&limit=1&offset=1`)
      .set(authorized(zoneAToken))
      .expect(200);
    expect(secondPage.body).toEqual([]);
  });

  it.each([
    ['ADMIN', () => adminToken],
    ['CASHIER', () => cashierToken],
  ])('keeps %s order list behavior all-zone', async (_role, token) => {
    const list = await request(app.getHttpServer())
      .get(`/orders?dateFrom=${serviceDate}&dateTo=${serviceDate}&limit=50&offset=0`)
      .set(authorized(token()))
      .expect(200);
    expect(list.body.map((order: { id: string }) => order.id).sort()).toEqual(
      [zoneAOrderId, zoneBOrderId].sort(),
    );
  });

  it('permits same-zone order reads and makes cross-zone identifiers non-enumerating', async () => {
    await request(app.getHttpServer())
      .get(`/orders/${zoneAOrderId}`)
      .set(authorized(zoneAToken))
      .expect(200);
    const cross = await request(app.getHttpServer())
      .get(`/orders/${zoneBOrderId}`)
      .set(authorized(zoneAToken))
      .expect(404);
    const missing = await request(app.getHttpServer())
      .get('/orders/00000000-0000-4000-8000-000000000000')
      .set(authorized(zoneAToken))
      .expect(404);
    expect(cross.body).toMatchObject({ code: 'ORDER.NOT_FOUND' });
    expect(cross.body).toEqual(missing.body);
  });

  it('scopes kitchen summary counts to the assigned zone', async () => {
    const operator = await request(app.getHttpServer())
      .get(`/menu/summary?date=${serviceDate}`)
      .set(authorized(zoneAToken))
      .expect(200);
    expect(operator.body.map((row: { count: number }) => row.count)).toEqual([2, 0, 0]);

    const admin = await request(app.getHttpServer())
      .get(`/menu/summary?date=${serviceDate}`)
      .set(authorized(adminToken))
      .expect(200);
    expect(admin.body.map((row: { count: number }) => row.count)).toEqual([2, 3, 0]);
  });

  it.each([
    ['/users?limit=50&offset=0', 'GET'],
    [`/orders?dateFrom=${serviceDate}&dateTo=${serviceDate}&limit=50&offset=0`, 'GET'],
    [`/menu/summary?date=${serviceDate}`, 'GET'],
  ])('fails closed for an unassigned OPERATOR on %s', async (path) => {
    const response = await request(app.getHttpServer())
      .get(path)
      .set(authorized(unassignedToken))
      .expect(403);
    expect(response.body).toMatchObject({ code: 'AUTH.OPERATOR_ZONE_REQUIRED' });
  });

  it('keeps ADMIN all-zone and CASHIER list behavior unchanged', async () => {
    const adminUsers = await request(app.getHttpServer())
      .get('/users?limit=50&offset=0')
      .set(authorized(adminToken))
      .expect(200);
    const cashierUsers = await request(app.getHttpServer())
      .get('/users?limit=50&offset=0')
      .set(authorized(cashierToken))
      .expect(200);
    expect(adminUsers.body.map((user: { id: string }) => user.id).sort()).toEqual(
      [zoneAUserId, zoneBUserId].sort(),
    );
    expect(cashierUsers.body).toEqual(adminUsers.body);
  });

  it('fails closed for unassigned operators and CASHIER on issuance roster APIs', async () => {
    const unassigned = await request(app.getHttpServer())
      .get('/omr-forms/roster/options')
      .set(authorized(unassignedToken))
      .expect(403);
    expect(unassigned.body).toMatchObject({ code: 'AUTH.OPERATOR_ZONE_REQUIRED' });

    await request(app.getHttpServer())
      .get('/omr-forms/roster?zone=Zone%20A&cell=A-01')
      .set(authorized(cashierToken))
      .expect(403);
  });
});
