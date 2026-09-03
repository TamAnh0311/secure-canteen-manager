import request from 'supertest';
import { DataSource } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import { OperatorRole } from '../src/operators/operator.entity';
import { createE2EApp, E2EContext, login, seedOperator, truncate } from './setup/e2e-bootstrap';

describe('purchase limit configuration (e2e)', () => {
  let context: E2EContext;
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let operatorToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    context = await createE2EApp();
    app = context.app;
    ds = context.dataSource;
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await truncate(ds, ['operators', 'purchase_limit_config']);
    await ds.query(`
      INSERT INTO purchase_limit_config (singleton) VALUES (true)
      ON CONFLICT (singleton) DO NOTHING
    `);
    await seedOperator(ds, 'limits-admin', OperatorRole.ADMIN);
    await seedOperator(ds, 'limits-operator', OperatorRole.OPERATOR);
    await seedOperator(ds, 'limits-cashier', OperatorRole.CASHIER);
    adminToken = await login(app, 'limits-admin');
    operatorToken = await login(app, 'limits-operator');
    cashierToken = await login(app, 'limits-cashier');
  });

  const matrix = {
    prisoner: {
      food: { enabled: true, amount: 90_000 },
      essential: { enabled: true, amount: 30_000 },
    },
    visitor: {
      food: { enabled: true, amount: 450_000 },
      essential: { enabled: false, amount: null },
    },
  };

  it.each([
    ['unauthenticated', undefined],
    ['operator', () => operatorToken],
    ['cashier', () => cashierToken],
  ])('denies GET and PUT to %s callers', async (_name, tokenFactory) => {
    const token = tokenFactory?.();
    for (const method of ['get', 'put'] as const) {
      const pending = request(app.getHttpServer())[method]('/config/purchase-limits');
      if (token) pending.set('Authorization', `Bearer ${token}`);
      if (method === 'put') pending.send(matrix);
      const response = await pending;
      expect([401, 403]).toContain(response.status);
    }
  });

  it('lets an admin read defaults and atomically replace all four rules', async () => {
    const initial = await request(app.getHttpServer())
      .get('/config/purchase-limits')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(initial.body).toEqual({
      prisoner: { food: { enabled: true, amount: 100_000 }, essential: { enabled: false, amount: null } },
      visitor: { food: { enabled: true, amount: 500_000 }, essential: { enabled: false, amount: null } },
    });

    const updated = await request(app.getHttpServer())
      .put('/config/purchase-limits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(matrix)
      .expect(200);
    expect(updated.body).toEqual(matrix);
  });

  it('rejects an invalid enabled rule without changing any rule', async () => {
    await request(app.getHttpServer())
      .put('/config/purchase-limits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(matrix)
      .expect(200);

    await request(app.getHttpServer())
      .put('/config/purchase-limits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...matrix, prisoner: { ...matrix.prisoner, food: { enabled: true, amount: null } } })
      .expect(400);

    const after = await request(app.getHttpServer())
      .get('/config/purchase-limits')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body).toEqual(matrix);
  });
});
