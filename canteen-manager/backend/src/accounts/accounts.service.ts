import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PrisonerAccount } from './prisoner-account.entity';
import { AccountTransaction, AccountTransactionType } from './account-transaction.entity';
import { MAX_VND } from '../common/numeric.transformer';
import { sqliteSafeLock } from '../common/sqlite-safe-lock';

export interface CreditInput {
  userId: string;
  amount: number; // positive VND
  type: AccountTransactionType; // topup | reversal
  operatorId: string;
  method?: string | null; // cash | bank (counter topup)
  ref?: string | null;
  relatedOrderId?: string | null; // set when a reversal cancels an order
  note?: string | null;
}

export interface DebitInput {
  userId: string;
  amount: number; // positive VND (subtracted from balance)
  operatorId: string;
  type?: AccountTransactionType; // defaults to order_debit
  relatedOrderId?: string | null;
  note?: string | null;
}

interface LedgerFields {
  userId: string;
  delta: number; // signed amount written to the ledger
  type: AccountTransactionType;
  operatorId: string;
  method?: string | null;
  ref?: string | null;
  relatedOrderId?: string | null;
  note?: string | null;
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(PrisonerAccount)
    private readonly accountRepo: Repository<PrisonerAccount>,
    @InjectRepository(AccountTransaction)
    private readonly ledgerRepo: Repository<AccountTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  // A per-transaction amount must be a strictly-positive integer within the VND ceiling.
  private assertAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_VND) {
      throw new BadRequestException({
        message: `Amount must be an integer between 1 and ${MAX_VND} VND`,
        code: 'ACCOUNT.INVALID_AMOUNT',
      });
    }
  }

  // Every money move must be attributable to an operator.
  private assertOperator(operatorId: string): void {
    if (!operatorId) {
      throw new BadRequestException({
        message: 'operatorId is required for a balance mutation',
        code: 'ACCOUNT.OPERATOR_REQUIRED',
      });
    }
  }

  // Race-safe locked fetch: INSERT ... ON CONFLICT DO NOTHING guarantees the row exists
  // even under a concurrent first-touch, then SELECT ... FOR UPDATE locks it. Must run
  // inside a transaction so the lock is held until the caller's TX commits — this is what
  // serializes concurrent debits and prevents oversell.
  async getOrCreate(userId: string, em: EntityManager): Promise<PrisonerAccount> {
    const isSqlite = em.connection.options.type === 'better-sqlite3';
    const placeholder = isSqlite ? '?' : '$1';
    await em.query(
      `INSERT INTO prisoner_accounts (user_id) VALUES (${placeholder}) ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    const account = await em.findOne(PrisonerAccount, {
      where: { userId },
      ...sqliteSafeLock('pessimistic_write'),
    });
    if (!account) {
      // Unreachable: the upsert above guarantees the row. Keeps the type honest.
      throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT.NOT_FOUND' });
    }
    return account;
  }

  async getBalance(userId: string): Promise<number> {
    const account = await this.accountRepo.findOne({ where: { userId } });
    // No row yet = no money ever moved = zero balance.
    return account ? account.balance : 0;
  }

  // Bulk balance snapshot for a batch of prisoners (the delivery-voucher print). Returns a
  // Map covering EVERY requested id — an account with no row defaults to 0 (no money ever
  // moved). One In() query, never a per-prisoner loop, so a whole-zone batch stays O(1) reads.
  async getBalances(userIds: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return balances;
    const accounts = await this.accountRepo.find({ where: { userId: In(userIds) } });
    for (const a of accounts) balances.set(a.userId, a.balance);
    return balances;
  }

  async findByPrisonId(legacyId: string): Promise<PrisonerAccount | null> {
    return this.accountRepo.findOne({
      where: { user: { legacyId } },
      relations: { user: true },
    });
  }

  getLedger(userId: string, opts: { limit: number; offset: number }): Promise<AccountTransaction[]> {
    return this.ledgerRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: opts.limit,
      skip: opts.offset,
    });
  }

  // Increase balance and append a ledger row. Composes inside a caller-provided TX
  // (e.g. order creation) when `em` is given, else opens its own. Returns new balance.
  async credit(input: CreditInput, em?: EntityManager): Promise<number> {
    this.assertAmount(input.amount);
    this.assertOperator(input.operatorId);
    const run = async (m: EntityManager): Promise<number> => {
      const account = await this.getOrCreate(input.userId, m);
      return this.mutate(m, account, {
        userId: input.userId,
        delta: input.amount,
        type: input.type,
        operatorId: input.operatorId,
        method: input.method,
        ref: input.ref,
        relatedOrderId: input.relatedOrderId,
        note: input.note,
      });
    };
    return em ? run(em) : this.dataSource.transaction(run);
  }

  // Decrease balance after a locked re-read; throws below zero. Returns new balance.
  async debit(input: DebitInput, em?: EntityManager): Promise<number> {
    this.assertAmount(input.amount);
    this.assertOperator(input.operatorId);
    const run = async (m: EntityManager): Promise<number> => {
      const account = await this.getOrCreate(input.userId, m);
      if (account.balance < input.amount) {
        throw new BadRequestException({
          message: 'Insufficient balance for this debit',
          code: 'ACCOUNT.INSUFFICIENT_FUNDS',
        });
      }
      return this.mutate(m, account, {
        userId: input.userId,
        delta: -input.amount,
        type: input.type ?? AccountTransactionType.ORDER_DEBIT,
        operatorId: input.operatorId,
        relatedOrderId: input.relatedOrderId,
        note: input.note,
      });
    };
    return em ? run(em) : this.dataSource.transaction(run);
  }

  // Apply a signed delta to a freshly-locked account and append its ledger row.
  // balance_after is computed from the just-read locked balance, so chained same-TX ops
  // (each re-reading via getOrCreate) record exact running totals.
  private async mutate(m: EntityManager, account: PrisonerAccount, f: LedgerFields): Promise<number> {
    const balanceAfter = account.balance + f.delta;
    await m.update(PrisonerAccount, account.id, { balance: balanceAfter });
    const row = m.create(AccountTransaction, {
      userId: f.userId,
      type: f.type,
      amount: f.delta,
      balanceAfter,
      method: f.method ?? null,
      ref: f.ref ?? null,
      relatedOrderId: f.relatedOrderId ?? null,
      operatorId: f.operatorId,
      note: f.note ?? null,
    });
    await m.save(AccountTransaction, row);
    return balanceAfter;
  }
}
