import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Append-only audit trail for operator actions. Every mutating HTTP request
 * (POST/PATCH/PUT/DELETE) by an authenticated operator is logged here.
 * Read-only GET requests are not audited to keep the table lean.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'operator_id', type: 'varchar', length: 36 })
  operatorId!: string;

  @Column({ type: 'varchar', length: 100 })
  username!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: string;

  /** High-level action label: menu.create, order.accept, operator.deactivate, etc. */
  @Index()
  @Column({ type: 'varchar', length: 50 })
  action!: string;

  /** Resource type: menu, order, operator, account, config, form, etc. */
  @Column({ type: 'varchar', length: 50 })
  resource!: string;

  /** ID of the affected resource (nullable for list/batch operations). */
  @Column({ name: 'resource_id', type: 'varchar', length: 36, nullable: true })
  resourceId!: string | null;

  @Column({ type: 'varchar', length: 10 })
  method!: string;

  @Column({ type: 'varchar', length: 500 })
  path!: string;

  @Column({ name: 'status_code', type: 'int' })
  statusCode!: number;

  /** JSON-serialised summary of the request body (sensitive fields redacted). */
  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip!: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
