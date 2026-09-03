import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum SyncRunStatus {
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export type SyncTrigger = 'cron' | 'manual';

@Entity('sync_runs')
export class SyncRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'started_at', type: 'datetime' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'row_count', type: 'int', default: 0 })
  rowCount!: number;

  @Column({ type: 'simple-enum', enum: SyncRunStatus, default: SyncRunStatus.RUNNING })
  status!: SyncRunStatus;

  @Column({ length: 50 })
  trigger!: SyncTrigger;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
