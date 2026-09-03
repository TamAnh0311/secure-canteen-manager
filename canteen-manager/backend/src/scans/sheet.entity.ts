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
import { SheetStatus } from './sheet-status.enum';
import { IssuedOmrForm } from '../omr-forms/issued-omr-form.entity';
import { OmrFormTemplate } from '../omr-forms/omr-form-template.entity';
import { Operator } from '../operators/operator.entity';
import { ScannerReviewState } from './scanner-review-state';

export enum ScanAdmissionSource {
  BROWSER = 'browser',
  AGENT = 'agent',
  SCANNER = 'scanner',
}

export enum OmrOperationalFormMode {
  ISSUED = 'issued',
  GENERIC = 'generic',
  SCANNER = 'scanner',
}

export enum IdentitySelectionSource {
  RANKED_CANDIDATE = 'ranked_candidate_selected',
  MANUAL_SEARCH = 'manual_search_selected',
}

@Entity('sheets')
export class Sheet {
  scannerReviewState?: ScannerReviewState;
  scannerReviewBlockers?: string[];

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Printed/agent sheet identifier (the number on the physical form), NOT the row PK.
  @Column({ name: 'sheet_id', type: 'varchar', length: 100 })
  sheetId!: string;

  // Optional grouping label supplied by the scanning agent (e.g. batch run ID)
  @Column({ type: 'varchar', length: 100, nullable: true })
  batch!: string | null;

  // Calendar date the scan was ingested (YYYY-MM-DD), server-stamped in the deploy timezone.
  // Typed `string`, not `Date`, so the DATE column never drifts a day under UTC conversion.
  // Buckets scans for the verify/monitor screens by day.
  @Index('IDX_sheets_service_date')
  @Column({ name: 'service_date', type: 'date' })
  serviceDate!: string;

  // SHA-256 (or similar) hash of the raw image bytes — idempotency key.
  // Duplicate submissions with the same checksum are rejected with 409.
  @Index('UQ_sheets_checksum', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  checksum!: string;

  // Relative path inside SCAN_STORAGE_DIR — absolute path avoided for portability
  @Column({ name: 'image_path', type: 'varchar', length: 500, nullable: true })
  imagePath!: string | null;

  @Index('UQ_sheets_scanner_event_id', { unique: true })
  @Column({ name: 'scanner_event_id', type: 'uuid', nullable: true })
  scannerEventId!: string | null;

  @Column({ type: 'enum', enum: SheetStatus, default: SheetStatus.PENDING })
  status!: SheetStatus;

  // Sanitized recognition evidence for audit and Verify. Bearer form tokens and identity
  // predictions are removed before persistence.
  @Column({ name: 'result_json', type: 'jsonb', nullable: true })
  resultJson!: object | null;

  @Column({ name: 'avg_confidence', type: 'float', nullable: true })
  avgConfidence!: number | null;

  // Legacy nullable column retained through the breaking migration; v3 always stores null.
  @Column({ name: 'recognized_id', type: 'varchar', length: 255, nullable: true })
  recognizedId!: string | null;

  // Derived cache only. Identity authority is issued_form_id -> issued_omr_forms.user_id.
  @Column({ name: 'matched_user_id', type: 'uuid', nullable: true })
  matchedUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'matched_user_id' })
  matchedUser!: User | null;

  @Column({ name: 'issued_form_id', type: 'uuid', nullable: true })
  issuedFormId!: string | null;

  @ManyToOne(() => IssuedOmrForm, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issued_form_id' })
  issuedForm!: IssuedOmrForm | null;

  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId!: string | null;

  @ManyToOne(() => OmrFormTemplate, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'template_id' })
  template!: OmrFormTemplate | null;

  @Column({ name: 'admitted_at', type: 'timestamptz' })
  admittedAt!: Date;

  @Column({ name: 'admission_source', type: 'enum', enum: ScanAdmissionSource })
  admissionSource!: ScanAdmissionSource;

  @Column({ name: 'admitted_mode', type: 'enum', enum: OmrOperationalFormMode })
  admittedMode!: OmrOperationalFormMode;

  @Column({ name: 'admitted_generation', type: 'varchar', length: 64 })
  admittedGeneration!: string;

  @Column({ name: 'admitted_by', type: 'uuid', nullable: true })
  admittedBy!: string | null;

  @ManyToOne(() => Operator, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'admitted_by' })
  admittedByOperator!: Operator | null;

  @Column({ name: 'identity_route_zone', type: 'varchar', length: 255, nullable: true })
  identityRouteZone!: string | null;

  @Column({ name: 'identity_evidence_json', type: 'jsonb', nullable: true })
  identityEvidenceJson!: object | null;

  @Column({ name: 'ranked_candidates_json', type: 'jsonb', nullable: true })
  rankedCandidatesJson!: object | null;

  @Column({ name: 'proposed_user_id', type: 'uuid', nullable: true })
  proposedUserId!: string | null;

  @Column({ name: 'identity_selected_by', type: 'uuid', nullable: true })
  identitySelectedBy!: string | null;

  @ManyToOne(() => Operator, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'identity_selected_by' })
  identitySelectedByOperator!: Operator | null;

  @Column({ name: 'identity_selected_at', type: 'timestamptz', nullable: true })
  identitySelectedAt!: Date | null;

  @Column({ name: 'identity_selection_source', type: 'enum', enum: IdentitySelectionSource, nullable: true })
  identitySelectionSource!: IdentitySelectionSource | null;

  @Column({ name: 'identity_selection_reason', type: 'varchar', length: 500, nullable: true })
  identitySelectionReason!: string | null;

  @Column({ name: 'identity_evidence_purged_at', type: 'timestamptz', nullable: true })
  identityEvidencePurgedAt!: Date | null;

  @Column({ name: 'purge_generation', type: 'int', default: 0 })
  purgeGeneration!: number;

  @Column({ name: 'rejection_code', type: 'varchar', length: 100, nullable: true })
  rejectionCode!: string | null;

  @Column({ name: 'processing_attempts', type: 'int', default: 0 })
  processingAttempts!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  // UUID of the order created for this sheet (nullable — not created for flagged/rejected)
  // Plain column, no FK: avoids circular dependency between scans and orders tables.
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  // Processing flags emitted by the v3 order-line and issued-token pipeline.
  @Column({ type: 'jsonb', nullable: true })
  flags!: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Set when processing completes (success or terminal failure); null while pending/processing
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
