import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { User } from '../src/users/user.entity';
import { BCRYPT_COST } from '../src/operators/operator-public';
import { AccountsService } from '../src/accounts/accounts.service';
import { AccountTransactionType } from '../src/accounts/account-transaction.entity';

describe('Accounts — balance + ledger money path (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let accounts: AccountsService;
  let adminToken: string;
  let operatorToken: string;
  const OP = randomUUID();

  async function makeUser(legacyId: string): Promise<string> {
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
        legacyId,
        name: `Inmate ${legacyId}`,
        zone: null,
        cell: null,
        isActive: true,
        source: 'test',
        syncedAt: new Date(),
      }),
    );
    return u.id;
  }

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

    ds = moduleRef.get<DataSource>(DataSource);
    accounts = moduleRef.get<AccountsService>(AccountsService);

    await ds.query('TRUNCATE TABLE account_transactions, prisoner_accounts, operators, users CASCADE');

    const hash = await bcrypt.hash('adminpass123', BCRYPT_COST);
    const opHash = await bcrypt.hash('operpass123', BCRYPT_COST);
    const opRepo = ds.getRepository(Operator);
    await opRepo.save([
      opRepo.create({ username: 'acct_admin', passwordHash: hash, displayName: 'Acct Admin', role: OperatorRole.ADMIN, isActive: true }),
      opRepo.create({ username: 'acct_oper', passwordHash: opHash, displayName: 'Acct Oper', role: OperatorRole.OPERATOR, isActive: true }),
    ]);

    adminToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ username: 'acct_admin', password: 'adminpass123' })
    ).body.token as string;
    operatorToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ username: 'acct_oper', password: 'operpass123' })
    ).body.token as string;
  });

  afterAll(async () => {
    await ds.query('TRUNCATE TABLE account_transactions, prisoner_accounts, operators, users CASCADE');
    await app.close();
  });

  describe('credit / debit round-trip', () => {
    it('credits then debits and the balance + ledger stay consistent', async () => {
      const userId = await makeUser('A001');

      await accounts.credit({ userId, amount: 50000, type: AccountTransactionType.TOPUP, operatorId: OP, method: 'cash' });
      await accounts.debit({ userId, amount: 18000, operatorId: OP, relatedOrderId: null });

      const res = await request(app.getHttpServer())
        .get(`/accounts/${userId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.balance).toBe(32000);

      const ledgerRes = await request(app.getHttpServer())
        .get(`/accounts/${userId}/ledger`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ledger = ledgerRes.body as { amount: number; balanceAfter: number }[];
      expect(ledger).toHaveLength(2);
      // ordered DESC by created_at — sum is order-independent
      const sum = ledger.reduce((s, r) => s + Number(r.amount), 0);
      expect(sum).toBe(32000);
    });

    it('backfilled accounts start at zero balance', async () => {
      const userId = await makeUser('A002');
      // No backfill for test-inserted users, but getBalance returns 0 for no-row.
      const res = await request(app.getHttpServer())
        .get(`/accounts/${userId}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.balance).toBe(0);
    });
  });

  describe('insufficient funds', () => {
    it('returns 400 with ACCOUNT.INSUFFICIENT_FUNDS and leaves balance untouched', async () => {
      const userId = await makeUser('A003');
      await accounts.credit({ userId, amount: 1000, type: AccountTransactionType.TOPUP, operatorId: OP });

      await expect(
        accounts.debit({ userId, amount: 5000, operatorId: OP }),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT.INSUFFICIENT_FUNDS' } });

      expect(await accounts.getBalance(userId)).toBe(1000);
    });
  });

  describe('admin gating', () => {
    it('403 for operator-role token on ledger', async () => {
      const userId = await makeUser('A004');
      await request(app.getHttpServer())
        .get(`/accounts/${userId}/ledger`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });

    it('403 for operator-role token on balance', async () => {
      const userId = await makeUser('A005');
      await request(app.getHttpServer())
        .get(`/accounts/${userId}/balance`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });
  });

  describe('concurrency — real Postgres row locks', () => {
    it('concurrent first-touch credits create exactly one account row', async () => {
      const userId = await makeUser('A006');

      await Promise.all([
        accounts.credit({ userId, amount: 1000, type: AccountTransactionType.TOPUP, operatorId: OP }),
        accounts.credit({ userId, amount: 2000, type: AccountTransactionType.TOPUP, operatorId: OP }),
        accounts.credit({ userId, amount: 3000, type: AccountTransactionType.TOPUP, operatorId: OP }),
      ]);

      const rows: Array<{ count: number }> = await ds.query(
        'SELECT COUNT(*)::int AS count FROM prisoner_accounts WHERE user_id = $1',
        [userId],
      );
      expect(rows[0].count).toBe(1);
      expect(await accounts.getBalance(userId)).toBe(6000);
    });

    it('concurrent debits never oversell (FOR UPDATE serializes them)', async () => {
      const userId = await makeUser('A007');
      await accounts.credit({ userId, amount: 10000, type: AccountTransactionType.TOPUP, operatorId: OP });

      // Fire 5 debits of 3000 against a 10000 balance — only 3 can succeed (9000).
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => accounts.debit({ userId, amount: 3000, operatorId: OP })),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      expect(ok).toBe(3);
      expect(rejected).toBe(2);

      const balance = await accounts.getBalance(userId);
      expect(balance).toBe(1000);
      expect(balance).toBeGreaterThanOrEqual(0);

      // Invariant: balance == Σ signed ledger amounts
      const ledger: Array<{ sum: string | null }> = await ds.query(
        'SELECT SUM(amount) AS sum FROM account_transactions WHERE user_id = $1',
        [userId],
      );
      expect(Number(ledger[0].sum)).toBe(balance);
    });
  });
});
