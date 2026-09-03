import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import {
  createE2EApp,
  E2E_PASSWORD,
  login,
  seedOperator,
  truncate,
} from './setup/e2e-bootstrap';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `e2e-hash:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `e2e-hash:${value}`),
}));

describe('Operator assignment (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createE2EApp());
    await truncate(dataSource, ['operators']);
    await seedOperator(dataSource, 'assignment_admin', OperatorRole.ADMIN);
    await seedOperator(dataSource, 'assignment_operator', OperatorRole.OPERATOR);
    await seedOperator(dataSource, 'assignment_cashier', OperatorRole.CASHIER);
    adminToken = await login(app, 'assignment_admin');
    operatorToken = await login(app, 'assignment_operator');
  });

  afterAll(async () => {
    await truncate(dataSource, ['operators']);
    await app.close();
  });

  it('allows an admin to list operators without exposing password hashes', async () => {
    const response = await request(app.getHttpServer())
      .get('/operators')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: 'assignment_operator',
          role: OperatorRole.OPERATOR,
          zone: null,
        }),
      ]),
    );
    expect(
      response.body.every((operator: Record<string, unknown>) => !('passwordHash' in operator)),
    ).toBe(true);
  });

  it('allows an admin to create an operator with a normalized required zone', async () => {
    const response = await request(app.getHttpServer())
      .post('/operators')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'created_zone_operator',
        password: E2E_PASSWORD,
        displayName: 'Created Zone Operator',
        role: OperatorRole.OPERATOR,
        zone: '  Zone A  ',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      username: 'created_zone_operator',
      role: OperatorRole.OPERATOR,
      zone: 'Zone A',
    });
    expect(response.body).not.toHaveProperty('passwordHash');

    const stored = await dataSource.getRepository(Operator).findOneByOrFail({
      username: 'created_zone_operator',
    });
    expect(stored.zone).toBe('Zone A');
    expect(stored.passwordHash).not.toBe(E2E_PASSWORD);
  });

  it('assigns, reassigns, and clears a zone while an existing token sees fresh state', async () => {
    const repo = dataSource.getRepository(Operator);
    const operator = await repo.findOneByOrFail({ username: 'assignment_operator' });

    await request(app.getHttpServer())
      .patch(`/operators/${operator.id}/zone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ zone: '  Zone A  ' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.zone).toBe('Zone A');
        expect(body).not.toHaveProperty('passwordHash');
      });

    await request(app.getHttpServer())
      .patch(`/operators/${operator.id}/zone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ zone: ' Zone B ' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.zone).toBe('Zone B');
        expect(body).not.toHaveProperty('passwordHash');
      });

    await request(app.getHttpServer())
      .patch(`/operators/${operator.id}/zone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ zone: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.zone).toBeNull();
        expect(body).not.toHaveProperty('passwordHash');
      });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.zone).toBeNull();
        expect(body).not.toHaveProperty('passwordHash');
      });
  });

  it('rejects a blank zone when an admin creates an operator', async () => {
    const response = await request(app.getHttpServer())
      .post('/operators')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'blank_zone_operator',
        password: E2E_PASSWORD,
        displayName: 'Blank Zone Operator',
        role: OperatorRole.OPERATOR,
        zone: '   ',
      })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'OPERATOR.ZONE_REQUIRED' });
  });

  it.each([
    ['list', 'get', '/operators', undefined],
    [
      'create',
      'post',
      '/operators',
      {
        username: 'forbidden_created_operator',
        password: E2E_PASSWORD,
        displayName: 'Forbidden Operator',
        role: OperatorRole.OPERATOR,
        zone: 'Zone A',
      },
    ],
  ] as const)('forbids an operator-role token from %s operations', async (_label, method, path, body) => {
    const pending = request(app.getHttpServer())[method](path).set(
      'Authorization',
      `Bearer ${operatorToken}`,
    );
    if (body) pending.send(body);
    await pending.expect(403);
  });

  it('forbids an operator-role token from assigning zones', async () => {
    const operator = await dataSource
      .getRepository(Operator)
      .findOneByOrFail({ username: 'assignment_operator' });

    await request(app.getHttpServer())
      .patch(`/operators/${operator.id}/zone`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ zone: 'Zone C' })
      .expect(403);
  });
});
