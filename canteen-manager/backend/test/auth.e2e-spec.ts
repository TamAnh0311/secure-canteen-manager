import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { BCRYPT_COST } from '../src/operators/operator-public';

describe('Auth + Operators (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);

    await dataSource.query('TRUNCATE TABLE operators CASCADE');

    const adminHash = await bcrypt.hash('adminpass123', BCRYPT_COST);
    const operatorHash = await bcrypt.hash('operatorpass123', BCRYPT_COST);

    const repo = dataSource.getRepository(Operator);
    await repo.save([
      repo.create({ username: 'e2e_admin', passwordHash: adminHash, displayName: 'E2E Admin', role: OperatorRole.ADMIN, isActive: true }),
      repo.create({ username: 'e2e_operator', passwordHash: operatorHash, displayName: 'E2E Operator', role: OperatorRole.OPERATOR, isActive: true }),
      repo.create({ username: 'e2e_inactive', passwordHash: adminHash, displayName: 'Inactive', role: OperatorRole.ADMIN, isActive: false }),
    ]);
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE TABLE operators CASCADE');
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('200 + token on valid admin credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_admin', password: 'adminpass123' })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.operator.username).toBe('e2e_admin');
      expect(res.body.operator).not.toHaveProperty('passwordHash');
    });

    it('401 on wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_admin', password: 'wrongpass' })
        .expect(401);
    });

    it('401 on non-existent username', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'nobody', password: 'whatever' })
        .expect(401);
    });

    it('401 for inactive operator even with correct password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_inactive', password: 'adminpass123' })
        .expect(401);
    });

    it('400 on missing fields', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_admin' })
        .expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('401 without token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('200 + full operator profile (no passwordHash, has displayName + isActive)', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_admin', password: 'adminpass123' });

      const token: string = loginRes.body.token as string;
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.username).toBe('e2e_admin');
      expect(res.body.displayName).toBe('E2E Admin');
      expect(res.body.role).toBe(OperatorRole.ADMIN);
      expect(res.body.isActive).toBe(true);
      expect(res.body.id).toBeDefined();
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('401 after operator is deactivated (revocation takes effect immediately)', async () => {
      // Create a fresh operator to deactivate without affecting other tests
      const repo = dataSource.getRepository(Operator);
      const hash = await bcrypt.hash('temppass123', BCRYPT_COST);
      const op = await repo.save(
        repo.create({ username: 'e2e_revoke_test', passwordHash: hash, displayName: 'Revoke Test', role: OperatorRole.OPERATOR, isActive: true }),
      );

      // Obtain a valid token
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_revoke_test', password: 'temppass123' });
      const token: string = loginRes.body.token as string;

      // Confirm token works before deactivation
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Deactivate directly in DB (simulates admin action)
      await repo.update(op.id, { isActive: false });

      // Same token must now be rejected because JwtStrategy reloads the operator
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('GET /operators (admin-only)', () => {
    it('401 without token', async () => {
      await request(app.getHttpServer()).get('/operators').expect(401);
    });

    it('403 with operator-role token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_operator', password: 'operatorpass123' });

      const token: string = loginRes.body.token as string;
      await request(app.getHttpServer())
        .get('/operators')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('200 with admin-role token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'e2e_admin', password: 'adminpass123' });

      const token: string = loginRes.body.token as string;
      const res = await request(app.getHttpServer())
        .get('/operators')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /health', () => {
    it('200 with db:up when DB is connected', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('up');
    });
  });
});
