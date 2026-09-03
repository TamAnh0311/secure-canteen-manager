import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScannerArtifactJob } from './scanner-artifact-job.entity';

export enum ScannerWebhookEventState {
  RECEIVED = 'received',
  QUARANTINED = 'quarantined',
  INTEGRITY_FAULT = 'integrity_fault',
}

@Entity('scanner_webhook_events')
@Index('UQ_scanner_webhook_events_event_id', ['eventId'], { unique: true })
@Index('IDX_scanner_webhook_events_result', ['documentId', 'revision'])
export class ScannerWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 100 })
  eventId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'payload_sha256', type: 'char', length: 64 })
  payloadSha256!: string;

  @Column({ name: 'payload_length', type: 'int' })
  payloadLength!: number;

  @Column({ name: 'raw_payload', type: 'bytea' })
  rawPayload!: Buffer;

  @Column({ name: 'payload_json', type: 'jsonb' })
  payloadJson!: object;

  @Column({ name: 'schema_version', type: 'varchar', length: 32 })
  schemaVersion!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'document_id', type: 'varchar', length: 100 })
  documentId!: string;

  @Column({ type: 'int' })
  revision!: number;

  @Column({ name: 'service_date', type: 'date' })
  serviceDate!: string;

  @Column({ type: 'varchar', length: 32 })
  outcome!: string;

  @Column({
    type: 'enum',
    enum: ScannerWebhookEventState,
    enumName: 'scanner_webhook_event_state_enum',
    default: ScannerWebhookEventState.RECEIVED,
  })
  state!: ScannerWebhookEventState;

  @Column({ name: 'fault_code', type: 'varchar', length: 100, nullable: true })
  faultCode!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @OneToMany(() => ScannerArtifactJob, (job) => job.event)
  artifactJobs!: ScannerArtifactJob[];
}
