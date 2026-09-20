import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { numericTransformer } from '../common/numeric.transformer';

// One commissary account per prisoner. The balance is the single source of truth for
// spendable funds; every change is mirrored by an append-only account_transactions row,
// so balance must always equal Σ of that prisoner's signed ledger amounts.
@Entity('prisoner_accounts')
export class PrisonerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_prisoner_accounts_user_id', { unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // RESTRICT: a prisoner with an account is never hard-deleted; deactivation flips
  // users.is_active instead, preserving the money trail.
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Spendable balance in integer VND. A DB CHECK keeps it >= 0; debit() also guards.
  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  balance!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
