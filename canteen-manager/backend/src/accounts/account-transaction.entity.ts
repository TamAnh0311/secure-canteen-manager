import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';

// Ledger entry types. 'adjustment' is intentionally absent — refund/correction is out
// of scope and must arrive with its own write path so a correction always has a reason.
export enum AccountTransactionType {
  TOPUP = 'topup',
  ORDER_DEBIT = 'order_debit',
  REVERSAL = 'reversal',
}

// Append-only ledger: one row per balance change. Never updated or deleted. The full
// audit chain (who, when, why, resulting balance) is reconstructable from these rows.
@Entity('account_transactions')
export class AccountTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_account_transactions_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: AccountTransactionType })
  type!: AccountTransactionType;

  // Signed integer VND: positive = credit (topup/reversal), negative = debit.
  @Column({ type: 'bigint', transformer: numericTransformer })
  amount!: number;

  // Balance immediately after this row was applied — the running total, snapshotted
  // so each row is independently auditable without replaying the whole ledger.
  @Column({ name: 'balance_after', type: 'bigint', transformer: numericTransformer })
  balanceAfter!: number;

  // 'cash' | 'bank' for counter topups; null for order/system entries.
  @Column({ type: 'varchar', length: 20, nullable: true })
  method!: string | null;

  // External reference (bank transfer id, receipt no.); null when not applicable.
  @Column({ type: 'varchar', length: 255, nullable: true })
  ref!: string | null;

  // Back-reference to the order that drove an order_debit / reversal; null otherwise.
  @Index('IDX_account_transactions_related_order_id')
  @Column({ name: 'related_order_id', type: 'uuid', nullable: true })
  relatedOrderId!: string | null;

  // Operator who performed the mutation. NON-NULL: every money move is attributable.
  @Column({ name: 'operator_id', type: 'uuid' })
  operatorId!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
