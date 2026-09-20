import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// Collapses three Vietnamese custody classifications into one stored status:
// pre-charge custody, pre-trial detention, and post-conviction. Sourced read-only from the
// legacy sync (or demo seed); nullable because the legacy box may not expose it yet.
export enum DetentionStatus {
  TEMPORARY_HOLD = 'temporary_hold', // tạm giữ
  PRE_TRIAL_DETENTION = 'pre_trial_detention', // tạm giam
  CONVICTED = 'convicted', // phạm nhân
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_users_legacy_id', { unique: true })
  @Column({ name: 'legacy_id', length: 255 })
  legacyId!: string;

  @Column({ length: 500 })
  name!: string;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  zone!: string | null;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  cell!: string | null;

  @Column({ name: 'normalized_cell', type: 'varchar', nullable: true, length: 255 })
  normalizedCell!: string | null;

  @Column({ name: 'cell_normalization_version', type: 'smallint', nullable: true })
  cellNormalizationVersion!: number | null;

  // Read-only detainee profile, populated by the legacy sync / demo seed. All nullable: no
  // backfill, and the legacy box may not map these yet. Birth/arrest are calendar dates
  // (type 'date' → 'YYYY-MM-DD' string, not Date): no time component to shift, so storage
  // carries no timezone. Display formats it in the deploy timezone (UTC+7).
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  hometown!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  offense!: string | null;

  @Column({ name: 'arrest_date', type: 'date', nullable: true })
  arrestDate!: string | null;

  @Column({ name: 'detention_status', type: 'simple-enum', enum: DetentionStatus, nullable: true })
  detentionStatus!: DetentionStatus | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ length: 100, default: 'sql2005' })
  source!: string;

  @Column({ name: 'synced_at', type: 'datetime' })
  syncedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
