import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AccountsService } from '../accounts.service';
import { PrisonerAccount } from '../prisoner-account.entity';
import { AccountTransaction, AccountTransactionType } from '../account-transaction.entity';
import { MAX_VND } from '../../common/numeric.transformer';

const USER = 'user-uuid-1';
const OP = 'operator-uuid-1';

interface FakeAccount {
  id: string;
  userId: string;
  balance: number;
}

// Fake EntityManager mirroring TypeORM transactional behaviour for the money path:
// query() implements INSERT ... ON CONFLICT DO NOTHING; findOne re-reads the row the
// service just updated (the real FOR UPDATE re-read); update/save share one store so
// chained same-TX ops observe each other's writes.
function makeFakeEm(seed: Array<{ userId: string; balance: number }> = []) {
  const accounts: FakeAccount[] = seed.map((a) => ({ id: randomUUID(), userId: a.userId, balance: a.balance }));
  const ledger: AccountTransaction[] = [];

  const em = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (/insert\s+into\s+prisoner_accounts/i.test(sql)) {
        const userId = params[0] as string;
        if (!accounts.some((a) => a.userId === userId)) {
          accounts.push({ id: randomUUID(), userId, balance: 0 });
        }
      }
      return [];
    }),
    findOne: jest.fn(async (_entity: unknown, opts: { where: { userId: string } }) =>
      accounts.find((a) => a.userId === opts.where.userId) ?? null,
    ),
    update: jest.fn(async (_entity: unknown, id: string, patch: { balance: number }) => {
      const acct = accounts.find((a) => a.id === id);
      if (acct) Object.assign(acct, patch);
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn(async (_entity: unknown, row: AccountTransaction) => {
      if (!row.id) row.id = randomUUID();
      ledger.push(row);
      return row;
    }),
    _accounts: accounts,
    _ledger: ledger,
  } as unknown as EntityManager & { _accounts: FakeAccount[]; _ledger: AccountTransaction[] };

  return em;
}

function buildService(seed: Array<{ userId: string; balance: number }> = []) {
  let capturedEm: ReturnType<typeof makeFakeEm>;
  const accountRepo = { findOne: jest.fn() } as unknown as Repository<PrisonerAccount>;
  const ledgerRepo = { find: jest.fn() } as unknown as Repository<AccountTransaction>;
  const dataSource = {
    transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
      capturedEm = makeFakeEm(seed);
      return cb(capturedEm);
    }),
  } as unknown as DataSource;

  const svc = new AccountsService(accountRepo, ledgerRepo, dataSource);
  return { svc, getEm: () => capturedEm };
}

// ---------------------------------------------------------------------------
// credit
// ---------------------------------------------------------------------------

describe('AccountsService.credit()', () => {
  it('increases balance and appends a ledger row with the correct balance_after', async () => {
    const { svc, getEm } = buildService([{ userId: USER, balance: 1000 }]);

    const balance = await svc.credit({
      userId: USER,
      amount: 5000,
      type: AccountTransactionType.TOPUP,
      operatorId: OP,
      method: 'cash',
      ref: 'RCPT-1',
    });

    expect(balance).toBe(6000);
    const em = getEm();
    expect(em._accounts[0].balance).toBe(6000);
    expect(em._ledger).toHaveLength(1);
    const row = em._ledger[0];
    expect(row.amount).toBe(5000);
    expect(row.balanceAfter).toBe(6000);
    expect(row.type).toBe(AccountTransactionType.TOPUP);
    expect(row.method).toBe('cash');
    expect(row.ref).toBe('RCPT-1');
    expect(row.operatorId).toBe(OP);
  });

  it('creates a zero account first-touch then credits it', async () => {
    const { svc, getEm } = buildService([]); // no pre-existing account

    const balance = await svc.credit({
      userId: USER,
      amount: 2000,
      type: AccountTransactionType.TOPUP,
      operatorId: OP,
    });

    expect(balance).toBe(2000);
    const em = getEm();
    expect(em._accounts.filter((a) => a.userId === USER)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// debit
// ---------------------------------------------------------------------------

describe('AccountsService.debit()', () => {
  it('decreases balance and writes a negative-amount ledger row (default type order_debit)', async () => {
    const { svc, getEm } = buildService([{ userId: USER, balance: 10000 }]);

    const balance = await svc.debit({
      userId: USER,
      amount: 3000,
      operatorId: OP,
      relatedOrderId: 'order-uuid-1',
    });

    expect(balance).toBe(7000);
    const em = getEm();
    expect(em._accounts[0].balance).toBe(7000);
    const row = em._ledger[0];
    expect(row.amount).toBe(-3000);
    expect(row.balanceAfter).toBe(7000);
    expect(row.type).toBe(AccountTransactionType.ORDER_DEBIT);
    expect(row.relatedOrderId).toBe('order-uuid-1');
  });

  it('throws ACCOUNT.INSUFFICIENT_FUNDS when balance < amount and writes no ledger row', async () => {
    const { svc, getEm } = buildService([{ userId: USER, balance: 2000 }]);

    await expect(
      svc.debit({ userId: USER, amount: 5000, operatorId: OP }),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT.INSUFFICIENT_FUNDS' } });

    const em = getEm();
    expect(em._accounts[0].balance).toBe(2000); // unchanged
    expect(em._ledger).toHaveLength(0);
  });

  it('allows debiting the full balance down to exactly zero', async () => {
    const { svc, getEm } = buildService([{ userId: USER, balance: 5000 }]);

    const balance = await svc.debit({ userId: USER, amount: 5000, operatorId: OP });

    expect(balance).toBe(0);
    expect(getEm()._accounts[0].balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// amount + operator validation
// ---------------------------------------------------------------------------

describe('AccountsService — amount + operator validation', () => {
  it.each([0, -100, 1.5, MAX_VND + 1])('rejects invalid credit amount %p', async (amount) => {
    const { svc } = buildService([{ userId: USER, balance: 0 }]);
    await expect(
      svc.credit({ userId: USER, amount, type: AccountTransactionType.TOPUP, operatorId: OP }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a debit amount above MAX_VND', async () => {
    const { svc } = buildService([{ userId: USER, balance: 0 }]);
    await expect(
      svc.debit({ userId: USER, amount: MAX_VND + 1, operatorId: OP }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a credit with a missing operatorId', async () => {
    const { svc } = buildService([{ userId: USER, balance: 0 }]);
    await expect(
      svc.credit({ userId: USER, amount: 1000, type: AccountTransactionType.TOPUP, operatorId: '' }),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT.OPERATOR_REQUIRED' } });
  });

  it('rejects a debit with a missing operatorId', async () => {
    const { svc } = buildService([{ userId: USER, balance: 10000 }]);
    await expect(
      svc.debit({ userId: USER, amount: 1000, operatorId: '' }),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT.OPERATOR_REQUIRED' } });
  });
});

// ---------------------------------------------------------------------------
// chained same-TX ops + invariant
// ---------------------------------------------------------------------------

describe('AccountsService — chained ops within one transaction', () => {
  it('reversal-then-debit in one TX records both ledger rows with exact balance_after', async () => {
    const accountRepo = { findOne: jest.fn() } as unknown as Repository<PrisonerAccount>;
    const ledgerRepo = { find: jest.fn() } as unknown as Repository<AccountTransaction>;
    const ds = { transaction: jest.fn() } as unknown as DataSource;
    const svc = new AccountsService(accountRepo, ledgerRepo, ds);

    const em = makeFakeEm([{ userId: USER, balance: 10000 }]);

    // reversal returns funds (credit), then a fresh debit — each re-reads the locked row
    await svc.credit(
      { userId: USER, amount: 2000, type: AccountTransactionType.REVERSAL, operatorId: OP },
      em,
    );
    await svc.debit({ userId: USER, amount: 5000, operatorId: OP }, em);

    expect(em._ledger.map((r) => r.balanceAfter)).toEqual([12000, 7000]);
    expect(em._accounts[0].balance).toBe(7000);
    // ds.transaction must not be used when an em is injected
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it('balance == Σ signed ledger amounts after mixed credit/debit ops', async () => {
    const accountRepo = { findOne: jest.fn() } as unknown as Repository<PrisonerAccount>;
    const ledgerRepo = { find: jest.fn() } as unknown as Repository<AccountTransaction>;
    const svc = new AccountsService(accountRepo, ledgerRepo, { transaction: jest.fn() } as unknown as DataSource);

    const em = makeFakeEm([{ userId: USER, balance: 0 }]);
    await svc.credit({ userId: USER, amount: 5000, type: AccountTransactionType.TOPUP, operatorId: OP }, em);
    await svc.credit({ userId: USER, amount: 3000, type: AccountTransactionType.TOPUP, operatorId: OP }, em);
    await svc.debit({ userId: USER, amount: 2000, operatorId: OP }, em);

    const sum = em._ledger.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(6000);
    expect(em._accounts[0].balance).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// getOrCreate idempotency
// ---------------------------------------------------------------------------

describe('AccountsService.getOrCreate()', () => {
  it('is idempotent — repeated first-touch yields a single account row', async () => {
    const accountRepo = { findOne: jest.fn() } as unknown as Repository<PrisonerAccount>;
    const ledgerRepo = { find: jest.fn() } as unknown as Repository<AccountTransaction>;
    const svc = new AccountsService(accountRepo, ledgerRepo, { transaction: jest.fn() } as unknown as DataSource);

    const em = makeFakeEm([]);
    const a = await svc.getOrCreate(USER, em);
    const b = await svc.getOrCreate(USER, em);

    expect(a.id).toBe(b.id);
    expect(em._accounts.filter((x) => x.userId === USER)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getBalances — bulk balance lookup for the delivery-voucher batch (no N+1).
// Returns a userId→balance Map covering every requested id, defaulting absent
// accounts to 0, via a single In() query.
// ---------------------------------------------------------------------------

describe('AccountsService.getBalances()', () => {
  function buildForGetBalances(rows: Array<{ userId: string; balance: number }>) {
    const accountRepo = {
      find: jest.fn().mockResolvedValue(rows),
    } as unknown as Repository<PrisonerAccount>;
    const ledgerRepo = {} as unknown as Repository<AccountTransaction>;
    const svc = new AccountsService(accountRepo, ledgerRepo, {} as DataSource);
    return { svc, accountRepo };
  }

  it('folds the matched accounts into a userId → balance Map', async () => {
    const { svc } = buildForGetBalances([
      { userId: 'u1', balance: 5000 },
      { userId: 'u2', balance: 12000 },
    ]);

    const map = await svc.getBalances(['u1', 'u2']);

    expect(map.get('u1')).toBe(5000);
    expect(map.get('u2')).toBe(12000);
  });

  it('defaults a prisoner with no account row to 0', async () => {
    const { svc } = buildForGetBalances([{ userId: 'u1', balance: 5000 }]);

    const map = await svc.getBalances(['u1', 'no-account']);

    expect(map.get('u1')).toBe(5000);
    expect(map.get('no-account')).toBe(0);
  });

  it('returns an empty Map and issues no query for an empty id list', async () => {
    const { svc, accountRepo } = buildForGetBalances([]);

    const map = await svc.getBalances([]);

    expect(map.size).toBe(0);
    expect(accountRepo.find).not.toHaveBeenCalled();
  });

  it('issues a single query over the requested ids (no N+1)', async () => {
    const { svc, accountRepo } = buildForGetBalances([]);

    await svc.getBalances(['u1', 'u2', 'u3']);

    expect(accountRepo.find).toHaveBeenCalledTimes(1);
    const arg = (accountRepo.find as jest.Mock).mock.calls[0][0] as { where: { userId: unknown } };
    expect(arg.where.userId).toBeDefined(); // In([...]) FindOperator
  });
});
