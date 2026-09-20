import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// True singleton: the one global canteen bank account the kiosk renders as an offline VietQR.
// Copies the singleton shape + 23505-recovery from threshold_config, but UNLIKE that table the
// fields are nullable and seeded empty — a bank account has no env default, so the row is seeded
// blank (migration + lazy get-or-create) and stays unconfigured until an admin sets it.
@Entity('payment_config')
export class PaymentConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Single-value sentinel enforcing one row: always true, UNIQUE index permits exactly one row.
  @Index('UQ_payment_config_singleton', { unique: true })
  @Column({ type: 'boolean', default: true })
  singleton!: boolean;

  // NAPAS member acquirer BIN (6 digits). Null until configured.
  @Column({ name: 'bank_bin', type: 'varchar', length: 6, nullable: true })
  bankBin!: string | null;

  // Canteen account number (6-19 digits). Null until configured. Masked to last-4 on the admin
  // GET; the kiosk reads the full value internally to build the transfer QR.
  @Column({ name: 'account_number', type: 'varchar', length: 19, nullable: true })
  accountNumber!: string | null;

  // Beneficiary display name, ascii-folded + uppercased at write (Vietnamese bank names are
  // themselves stored that way). Null until configured.
  @Column({ name: 'account_name', type: 'varchar', length: 140, nullable: true })
  accountName!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
