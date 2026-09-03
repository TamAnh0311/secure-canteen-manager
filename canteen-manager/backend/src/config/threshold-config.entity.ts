import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// True singleton for global recognition thresholds. Legacy ROI fields remain only as
// transitional A4 audit/backfill input; operational geometry belongs to versioned templates.
// Seeded lazily (get-or-create) on first access. The `singleton` column carries a UNIQUE
// constraint with a single legal value, so a second insert raises 23505 — the global
// roi_template owner can never split into two rows (a split read returns null mid-operation,
// which would surface as a spurious FORM_NOT_GENERATED).
@Entity('threshold_config')
export class ThresholdConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Single-value sentinel enforcing one row. Always true; the UNIQUE index on it permits
  // exactly one row to exist.
  @Index('UQ_threshold_config_singleton', { unique: true })
  @Column({ type: 'boolean', default: true })
  singleton!: boolean;

  // ICR digit-recognition confidence: scores below this trigger manual verify
  @Column({ name: 'icr_threshold', type: 'float' })
  icrThreshold!: number;

  // Fill ratio 0..omrEmptyMax is treated as an empty bubble
  @Column({ name: 'omr_empty_max', type: 'float' })
  omrEmptyMax!: number;

  // Fill ratio omrTickedMin..1.0 is treated as a ticked bubble; between the two = FLAG
  @Column({ name: 'omr_ticked_min', type: 'float' })
  omrTickedMin!: number;

  // Number of digit boxes on the printed form (must match the generated form)
  @Column({ name: 'digit_box_count', type: 'int' })
  digitBoxCount!: number;

  // Transitional legacy A4 ROI retained for migration compatibility. New issuance and scan
  // resolution must use the immutable template bound to the issued form.
  @Column({ name: 'roi_template', type: 'jsonb', nullable: true })
  roiTemplate!: object | null;

  // Identifies the template generation version for audit purposes
  @Column({ name: 'roi_version', type: 'varchar', length: 50, nullable: true })
  roiVersion!: string | null;

  // When the form was last generated — used to detect stale templates
  @Column({ name: 'roi_generated_at', type: 'timestamptz', nullable: true })
  roiGeneratedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
