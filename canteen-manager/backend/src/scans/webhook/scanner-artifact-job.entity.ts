import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScannerWebhookEvent } from './scanner-webhook-event.entity';

export enum ScannerArtifactJobState {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RETRYING = 'retrying',
  AVAILABLE = 'available',
  MISSING = 'missing',
  PERMANENT_FAILED = 'permanent_failed',
  INTEGRITY_FAULT = 'integrity_fault',
  PURGED = 'purged',
}

@Entity('scanner_artifact_jobs')
@Index('UQ_scanner_artifact_jobs_event_artifact', ['eventId', 'artifactId'], {
  unique: true,
})
@Index('IDX_scanner_artifact_jobs_due', ['state', 'nextAttemptAt'])
export class ScannerArtifactJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @ManyToOne(() => ScannerWebhookEvent, (event) => event.artifactJobs, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'event_id' })
  event!: ScannerWebhookEvent;

  @Column({ name: 'artifact_id', type: 'varchar', length: 100 })
  artifactId!: string;

  @Column({ type: 'varchar', length: 100 })
  kind!: string;

  @Column({ name: 'media_type', type: 'varchar', length: 100 })
  mediaType!: string;

  @Column({ name: 'source_url', type: 'varchar', length: 1000 })
  sourceUrl!: string;

  @Column({ name: 'expected_sha256', type: 'char', length: 64 })
  expectedSha256!: string;

  @Column({ name: 'source_occurred_at', type: 'timestamptz' })
  sourceOccurredAt!: Date;

  @Column({ name: 'relative_path', type: 'varchar', length: 500, nullable: true })
  relativePath!: string | null;

  @Column({
    type: 'enum',
    enum: ScannerArtifactJobState,
    enumName: 'scanner_artifact_job_state_enum',
    default: ScannerArtifactJobState.PENDING,
  })
  state!: ScannerArtifactJobState;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true })
  leaseToken!: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 100, nullable: true })
  failureCode!: string | null;

  @Column({ name: 'available_at', type: 'timestamptz', nullable: true })
  availableAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
