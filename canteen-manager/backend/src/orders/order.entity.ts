import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { numericTransformer } from '../common/numeric.transformer';

export enum OrderStatus {
  ACTIVE = 'active',
  SUPERSEDED = 'superseded',
  // Terminal state a cashier sets when declining a pending visitor (relative) order.
  // Non-active, so it frees the one-active-per-(service_date,user,source) index slot.
  REJECTED = 'rejected',
}

export enum PaymentStatus {
  PAID = 'paid',
  UNPAID = 'unpaid',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Calendar date this order belongs to (YYYY-MM-DD). Server-stamped at ingestion in the
  // deploy timezone. Typed `string`, not `Date`, so a DATE column never drifts a day under
  // UTC conversion on insert. Buckets orders for kitchen counts and the active-order index.
  @Column({ name: 'service_date', type: 'date' })
  serviceDate!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Origin of the order, constrained to {omr,scanner,relative,manual} by a DB CHECK:
  // 'omr'/'scanner' = balance-backed scanned sheets, 'relative' = visitor kiosk order,
  // 'manual' = operator override. The two scanned origins share one active-order channel.
  // The source drives payment branching, so a missing/garbage value is rejected at the DB.
  @Column({ length: 50, default: 'omr' })
  source!: string;

  // Sheet UUID from the scans table — that table arrives in a later phase;
  // stored here as a plain nullable column so ingestion can back-reference.
  @Column({ name: 'sheet_id', type: 'varchar', nullable: true })
  sheetId!: string | null;

  @Column({ type: 'simple-enum', enum: OrderStatus, default: OrderStatus.ACTIVE })
  status!: OrderStatus;

  // Order total in integer VND — snapshot of Σ order_item.unit_price at create time.
  @Column({ name: 'total_amount', type: 'bigint', default: 0, transformer: numericTransformer })
  totalAmount!: number;

  // Payment lifecycle. Defaults unpaid on create; flips to paid only for a warden (omr) order
  // (paid from balance on create) or when a cashier accepts a pending relative order. A
  // relative order is created unpaid everywhere — there is no auto-pay on create.
  @Column({ name: 'payment_status', type: 'simple-enum', enum: PaymentStatus, default: PaymentStatus.UNPAID })
  paymentStatus!: PaymentStatus;

  // 'balance' (warden/scanner), 'cash' | 'bank' (relative intended tender, stored at create while
  // still unpaid). Null until set.
  @Column({ name: 'payment_method', length: 20, type: 'varchar', nullable: true })
  paymentMethod!: string | null;

  // Populated when this order is superseded by a re-scan or correction
  @Column({ name: 'superseded_at', type: 'datetime', nullable: true })
  supersededAt!: Date | null;

  // Points to the newer order that replaced this one — preserves the audit chain
  @Column({ name: 'superseded_by_order_id', type: 'uuid', nullable: true })
  supersededByOrderId!: string | null;

  // Settle/reject audit for relative orders: the cashier who accepted (→ paid) or rejected
  // (→ rejected) the pending order, the timestamp, and (for a rejection) the reason.
  @Column({ name: 'settled_by_operator_id', type: 'uuid', nullable: true })
  settledByOperatorId!: string | null;

  @Column({ name: 'settled_at', type: 'datetime', nullable: true })
  settledAt!: Date | null;

  @Column({ name: 'reject_reason', length: 200, type: 'varchar', nullable: true })
  rejectReason!: string | null;

  // Bank settlement audit, set only when a cashier accepts a bank relative order. The reference
  // is the cashier-entered bank txn id / last-4 — free-text, OPTIONAL. A partial UNIQUE index
  // (WHERE transfer_reference IS NOT NULL) blocks the same non-empty reference settling two
  // orders; a blank reference is normalised to NULL so blanks never collide — the guard is
  // advisory, not hard.
  @Column({ name: 'transfer_reference', length: 120, type: 'varchar', nullable: true })
  transferReference!: string | null;

  // Cashier-entered amount actually received in the bank app. OPTIONAL, but when present it must
  // equal total_amount or the accept is rejected (strict amount integrity carries the
  // reconciliation weight the advisory reference guard gives up).
  @Column({ name: 'received_amount', type: 'bigint', nullable: true, transformer: numericTransformer })
  receivedAmount!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
