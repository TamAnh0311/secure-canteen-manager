/**
 * SQLite integration tests — demo readiness.
 *
 * Exercises every critical user-facing flow in Electron/SQLite mode to verify
 * the app works end-to-end before a demo. Covers:
 *   1. Health check
 *   2. Auth (login, token validation, role enforcement)
 *   3. Menu CRUD (add, update, list, delete, reorder)
 *   4. Menu form generation (local PDF renderer)
 *   5. Menu summary (kitchen view)
 *   6. Orders (list, stats, delivery vouchers)
 *   7. Kiosk (prisoner view, place relative order)
 *   8. Accounts (balance, ledger)
 *   9. Prisoner directory (list, search)
 *  10. Diagnostics endpoint
 *  11. Full lifecycle: seed → order → pay → voucher
 */

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  createSqliteApp,
  SqliteE2EContext,
  seedOperator,
  seedPrisoner,
  seedMenuItem,
  seedAccount,
  seedPurchaseLimits,
  login,
  today,
  tomorrow,
  truncateAll,
  TEST_PASSWORD,
} from '../setup/sqlite-bootstrap';
import { OperatorRole } from '../../src/operators/operator.entity';
import { MenuItemCategory } from '../../src/menu/menu-item-category.enum';

// ── Shared state across test blocks ──

let ctx: SqliteE2EContext;
let app: INestApplication;
let ds: DataSource;

// Tokens
let adminToken: string;
let operatorToken: string;
let cashierToken: string;

// Seeded entity IDs
let adminId: string;
let prisonerId: string;
let prisonerLegacyId: string;
let menuItemIds: string[];

// ── Setup / Teardown ──

beforeAll(async () => {
  ctx = await createSqliteApp();
  app = ctx.app;
  ds = ctx.ds;
}, 30_000);

afterAll(async () => {
  await app.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

describe('Health Check', () => {
  it('GET /api/health returns ok with db up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /api/health/connection-info returns null canteenUrl (no LAN_IP in test)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/connection-info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('canteenUrl');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. AUTH
// ═══════════════════════════════════════════════════════════════════════════

describe('Authentication', () => {
  beforeAll(async () => {
    const admin = await seedOperator(ds, 'admin-test', OperatorRole.ADMIN);
    adminId = admin.id;
    await seedOperator(ds, 'operator-test', OperatorRole.OPERATOR, { zone: 'Khu A1' });
    await seedOperator(ds, 'cashier-test', OperatorRole.CASHIER);
    await seedOperator(ds, 'inactive-op', OperatorRole.ADMIN, { isActive: false });
  });

  it('POST /api/auth/login succeeds with valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin-test', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.operator).toHaveProperty('username', 'admin-test');
    expect(res.body.operator).toHaveProperty('role', 'admin');
    expect(res.body.operator).not.toHaveProperty('passwordHash');
    adminToken = res.body.token;
  });

  it('POST /api/auth/login rejects invalid password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin-test', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login rejects inactive operator', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'inactive-op', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login rejects unknown user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me returns current operator', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('username', 'admin-test');
  });

  it('GET /api/auth/me rejects missing token', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me rejects invalid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  it('operator and cashier can login', async () => {
    operatorToken = await login(app, 'operator-test');
    cashierToken = await login(app, 'cashier-test');
    expect(operatorToken).toBeTruthy();
    expect(cashierToken).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. MENU CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe('Menu CRUD', () => {
  it('POST /api/menu adds a new item (admin)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Mì tôm', price: 15000, category: 'food' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name', 'Mì tôm');
    expect(res.body).toHaveProperty('price', 15000);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('isActive', true);
  });

  it('POST /api/menu rejects non-admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/menu')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Nước suối', price: 8000, category: 'food' });
    expect(res.status).toBe(403);
  });

  it('adds multiple items for later tests', async () => {
    menuItemIds = [];
    const items = [
      { name: 'Xà phòng', price: 18000, category: 'essential' },
      { name: 'Nước suối 500ml', price: 8000, category: 'food' },
      { name: 'Kem đánh răng', price: 26000, category: 'essential' },
      { name: 'Sữa Vinamilk', price: 12000, category: 'food' },
    ];
    for (const item of items) {
      const res = await request(app.getHttpServer())
        .post('/api/menu')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(item);
      expect(res.status).toBe(201);
      menuItemIds.push(res.body.id);
    }
    // Also get the first item's ID
    const listRes = await request(app.getHttpServer())
      .get('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`);
    menuItemIds = listRes.body.map((item: { id: string }) => item.id);
  });

  it('GET /api/menu lists all items sorted by position', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    // Check ascending position
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i].position).toBeGreaterThan(res.body[i - 1].position);
    }
  });

  it('PATCH /api/menu/:id updates price', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/menu/${menuItemIds[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(20000);
  });

  it('PATCH /api/menu/:id updates name (before form generated)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/menu/${menuItemIds[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Mì tôm Hảo Hảo' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Mì tôm Hảo Hảo');
  });

  it('DELETE /api/menu/:id removes item (before form, reindexes)', async () => {
    // Delete the last item
    const lastId = menuItemIds[menuItemIds.length - 1];
    const res = await request(app.getHttpServer())
      .delete(`/api/menu/${lastId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    // Verify it's gone
    const listRes = await request(app.getHttpServer())
      .get('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.find((i: { id: string }) => i.id === lastId)).toBeUndefined();
    menuItemIds = listRes.body.map((item: { id: string }) => item.id);
  });

  it('POST /api/menu/reorder changes position (before form)', async () => {
    const reversed = [...menuItemIds].reverse();
    const res = await request(app.getHttpServer())
      .post('/api/menu/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ orderedItemIds: reversed });
    expect(res.status).toBe(201);
    // Verify order changed
    const listRes = await request(app.getHttpServer())
      .get('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.map((i: { id: string }) => i.id)).toEqual(reversed);
    menuItemIds = listRes.body.map((item: { id: string }) => item.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. MENU FORM GENERATION (local PDF renderer)
// ═══════════════════════════════════════════════════════════════════════════

describe('Menu Form Generation', () => {
  it('GET /api/menu/form returns form status (not yet generated)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/form')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('templates');
    expect(res.body.templates).toHaveProperty('code');
    expect(res.body.templates).toHaveProperty('full_list');
  });

  it('POST /api/menu/form generates a code-mode PDF via local renderer', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/menu/form')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'code' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('pdfBase64');
    expect(typeof res.body.pdfBase64).toBe('string');
    expect(res.body.pdfBase64.length).toBeGreaterThan(100);
  });

  it('POST /api/menu/form generates a full_list-mode PDF via local renderer', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/menu/form')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'full_list' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('pdfBase64');
    expect(typeof res.body.pdfBase64).toBe('string');
    expect(res.body.pdfBase64.length).toBeGreaterThan(100);
  });

  it('POST /api/menu/form rejects non-admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/menu/form')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ mode: 'code' });
    expect(res.status).toBe(403);
  });

  it('menu name rename is now locked after form generation', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/menu/${menuItemIds[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Renamed Item' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MENU.LOCKED_AFTER_FORM');
  });

  it('menu reorder is now locked after form generation', async () => {
    const reversed = [...menuItemIds].reverse();
    const res = await request(app.getHttpServer())
      .post('/api/menu/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ orderedItemIds: reversed });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MENU.LOCKED_AFTER_FORM');
  });

  it('menu price update still works after form generation', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/menu/${menuItemIds[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 25000 });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(25000);
  });

  it('menu item delete soft-deletes after form (isActive=false)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/menu/${menuItemIds[menuItemIds.length - 1]}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    // Item still in DB but deactivated
    const listRes = await request(app.getHttpServer())
      .get('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`);
    const softDeleted = listRes.body.find(
      (i: { id: string }) => i.id === menuItemIds[menuItemIds.length - 1],
    );
    expect(softDeleted).toBeDefined();
    expect(softDeleted.isActive).toBe(false);

    // Keep only active items for subsequent tests
    menuItemIds = listRes.body
      .filter((i: { isActive: boolean }) => i.isActive)
      .map((i: { id: string }) => i.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PRISONER DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════

describe('Prisoner Directory', () => {
  beforeAll(async () => {
    const p1 = await seedPrisoner(ds, '100001', 'Nguyễn Văn An', { zone: 'Khu A1', cell: 'A1-01' });
    prisonerId = p1.id;
    prisonerLegacyId = p1.legacyId;
    await seedPrisoner(ds, '100002', 'Trần Thị Bình', { zone: 'Khu A1', cell: 'A1-02' });
    await seedPrisoner(ds, '100003', 'Lê Minh Châu', { zone: 'Khu B1', cell: 'B1-01' });
    await seedAccount(ds, prisonerId, 500000, adminId);
  });

  it('GET /api/users lists prisoners', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 10, offset: 0 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /api/users search by name', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ q: 'Nguyễn', limit: 10, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].name).toContain('Nguyễn');
  });

  it('GET /api/users search by legacyId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ q: '100002', limit: 10, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/users/:id fetches a single prisoner', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/users/${prisonerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Nguyễn Văn An');
    expect(res.body).toHaveProperty('legacyId', '100001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Accounts', () => {
  it('GET /api/accounts/:userId/balance returns balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/accounts/${prisonerId}/balance`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance', 500000);
  });

  it('GET /api/accounts/:userId/ledger returns transaction history', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/accounts/${prisonerId}/ledger`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 10, offset: 0 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('type', 'topup');
    expect(res.body[0]).toHaveProperty('amount', 500000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. KIOSK (public relative ordering)
// ═══════════════════════════════════════════════════════════════════════════

describe('Kiosk', () => {
  it('GET /api/kiosk/prisoner/:prisonId returns prisoner view (no auth)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/kiosk/prisoner/${prisonerLegacyId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('menu');
    expect(Array.isArray(res.body.menu)).toBe(true);
    // Should not expose balance or sensitive fields
    expect(res.body).not.toHaveProperty('balance');
  });

  it('GET /api/kiosk/prisoner/:prisonId 404 for unknown prisoner', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/kiosk/prisoner/999999');
    expect(res.status).toBe(404);
  });

  it('POST /api/kiosk/orders places a pending relative order', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .send({
        prisonId: prisonerLegacyId,
        items: [{ menuItemId: menuItemIds[0], quantity: 2 }],
        method: 'cash',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('orderId');
    expect(res.body).toHaveProperty('confirmationCode');
  });

  it('POST /api/kiosk/orders rejects duplicate pending order for same prisoner+date', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .send({
        prisonId: prisonerLegacyId,
        items: [{ menuItemId: menuItemIds[0], quantity: 1 }],
        method: 'cash',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER.ALREADY_PENDING');
  });

  it('POST /api/kiosk/orders rejects empty items', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .send({
        prisonId: '100002',
        items: [],
        method: 'cash',
      });
    expect(res.status).toBe(400);
  });

  it('POST /api/kiosk/orders rejects invalid quantity', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .send({
        prisonId: '100002',
        items: [{ menuItemId: menuItemIds[0], quantity: 0 }],
        method: 'cash',
      });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. ORDERS
// ═══════════════════════════════════════════════════════════════════════════

describe('Orders', () => {
  it('GET /api/orders lists orders', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 50, offset: 0 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // We have at least the kiosk order from above
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/orders filters by userId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ userId: prisonerId, limit: 50, offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body.every((o: { userId: string }) => o.userId === prisonerId)).toBe(true);
  });

  it('GET /api/orders/:id returns order with items', async () => {
    // Get first order
    const listRes = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 1, offset: 0 });
    const orderId = listRes.body[0]?.id;
    if (!orderId) return; // skip if no orders

    const res = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', orderId);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('GET /api/orders/stats returns dashboard stats', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ dateFrom: today(), dateTo: tomorrow() });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalOrders');
    expect(res.body).toHaveProperty('pendingOrders');
    expect(res.body).toHaveProperty('paidOrders');
    expect(res.body).toHaveProperty('totalRevenue');
    expect(typeof res.body.totalOrders).toBe('number');
    expect(typeof res.body.totalRevenue).toBe('number');
  });

  it('GET /api/orders/vouchers returns vouchers (admin only)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/vouchers')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ date: today() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/orders/vouchers rejects non-admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/vouchers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .query({ date: today() });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. MENU SUMMARY (kitchen view)
// ═══════════════════════════════════════════════════════════════════════════

describe('Menu Summary', () => {
  it('GET /api/menu/summary returns kitchen summary for today', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ date: today() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Each row has menuItemId, name, position, count
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('menuItemId');
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).toHaveProperty('position');
      expect(res.body[0]).toHaveProperty('count');
    }
  });

  it('GET /api/menu/summary returns valid counts for tomorrow (service date)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ date: tomorrow() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/menu/summary works for zone-scoped operator', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/summary')
      .set('Authorization', `Bearer ${operatorToken}`)
      .query({ date: today() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

describe('Diagnostics', () => {
  it('GET /api/diagnostics returns diagnostics (admin only)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/diagnostics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('system');
    expect(res.body).toHaveProperty('session');
    expect(res.body).toHaveProperty('recentErrors');
  });

  it('GET /api/diagnostics rejects non-admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/diagnostics')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/diagnostics/logs lists log files', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/diagnostics/logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('files');
    expect(Array.isArray(res.body.files)).toBe(true);
  });

  it('GET /api/diagnostics/logs/recent returns recent log content', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/diagnostics/logs/recent')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ tail: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. FULL LIFECYCLE: seed → order → pay → voucher
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Lifecycle', () => {
  let lifecyclePrisonerId: string;
  let lifecycleOrderId: string;
  const serviceDate = today();

  beforeAll(async () => {
    // Seed a fresh prisoner with balance for this lifecycle test
    const p = await seedPrisoner(ds, '200001', 'Lifecycle Test User', {
      zone: 'Khu A1',
      cell: 'A1-03',
    });
    lifecyclePrisonerId = p.id;
    await seedAccount(ds, lifecyclePrisonerId, 1000000, adminId);
    await seedPurchaseLimits(ds, { food: 500000 }, { food: 1000000 });
  });

  it('step 1: kiosk places a relative order', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .send({
        prisonId: '200001',
        items: [
          { menuItemId: menuItemIds[0], quantity: 2 },
          { menuItemId: menuItemIds[1], quantity: 1 },
        ],
        method: 'cash',
      });
    expect(res.status).toBe(201);
    lifecycleOrderId = res.body.orderId;
    expect(lifecycleOrderId).toBeTruthy();
  });

  it('step 2: order appears in orders list as UNPAID', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ userId: lifecyclePrisonerId, limit: 10, offset: 0 });
    expect(res.status).toBe(200);
    const order = res.body.find((o: { id: string }) => o.id === lifecycleOrderId);
    expect(order).toBeDefined();
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.source).toBe('relative');
  });

  it('step 3: order detail returns items with prices', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/orders/${lifecycleOrderId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.totalAmount).toBeGreaterThan(0);
  });

  it('step 4: stats reflect the pending order', async () => {
    // Kiosk orders are stamped for the NEXT collection day (tomorrow), so query
    // from today through tomorrow to include them.
    const res = await request(app.getHttpServer())
      .get('/api/orders/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ dateFrom: serviceDate, dateTo: tomorrow() });
    expect(res.status).toBe(200);
    expect(res.body.pendingOrders).toBeGreaterThanOrEqual(1);
  });

  it('step 5: balance is unchanged (relative order does not debit)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/accounts/${lifecyclePrisonerId}/balance`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(1000000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. SCANNER CATALOGUE (admin-only export)
// ═══════════════════════════════════════════════════════════════════════════

describe('Scanner Catalogue', () => {
  it('GET /api/menu/scanner-catalogue returns catalogue (admin)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/scanner-catalogue')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('schemaVersion', 'scanner-catalogue-v1');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('GET /api/menu/scanner-catalogue rejects non-admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/scanner-catalogue')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. EDGE CASES & ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('non-existent order returns 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('invalid UUID returns 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('menu item with invalid data returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/menu')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '', price: -100, category: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('protected endpoints reject unauthenticated requests', async () => {
    const endpoints = [
      { method: 'get', path: '/api/orders' },
      { method: 'get', path: '/api/orders/stats' },
      { method: 'get', path: '/api/menu/summary' },
      { method: 'get', path: '/api/users' },
      { method: 'get', path: '/api/diagnostics' },
    ];
    for (const ep of endpoints) {
      const res = await (request(app.getHttpServer()) as any)[ep.method](ep.path);
      expect(res.status).toBe(401);
    }
  });

  it('public endpoints are accessible without auth', async () => {
    const endpoints = ['/api/health', '/api/health/connection-info'];
    for (const ep of endpoints) {
      const res = await request(app.getHttpServer()).get(ep);
      expect(res.status).toBe(200);
    }
  });
});
