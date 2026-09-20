import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Operator } from '../operators/operator.entity';
import { OmrFormMode, OmrFormTemplate } from './omr-form-template.entity';

export enum IssuedOmrFormStatus {
  ISSUED = 'issued',
  CONSUMED = 'consumed',
  VOID = 'void',
}

@Entity('issued_omr_forms')
@Index('IDX_issued_omr_forms_user_date', ['userId', 'serviceDate'])
export class IssuedOmrForm {
  @PrimaryColumn('uuid')
  token!: string;

  @Column({ name: 'user_id', type: 'varchar' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'service_date', type: 'varchar', length: 20 })
  serviceDate!: string;

  @Column({ name: 'roi_version', length: 64 })
  roiVersion!: string;

  @Column({ name: 'template_id', type: 'varchar' })
  templateId!: string;

  @ManyToOne(() => OmrFormTemplate, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'template_id' })
  template!: OmrFormTemplate;

  @Column({ name: 'form_mode', type: 'simple-enum', enum: OmrFormMode })
  formMode!: OmrFormMode;

  @Column({ name: 'issued_by', type: 'varchar' })
  issuedBy!: string;

  @ManyToOne(() => Operator, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issued_by' })
  issuer!: Operator;

  @Column({ type: 'simple-enum', enum: IssuedOmrFormStatus, default: IssuedOmrFormStatus.ISSUED })
  status!: IssuedOmrFormStatus;

  @Column({ name: 'consumed_sheet_id', type: 'varchar', nullable: true })
  consumedSheetId!: string | null;

  @Column({ name: 'reserved_sheet_id', type: 'varchar', nullable: true })
  reservedSheetId!: string | null;

  @Column({ name: 'void_reason', type: 'varchar', length: 100, nullable: true })
  voidReason!: string | null;

  @Column({ name: 'issued_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  issuedAt!: Date;

  @Column({ name: 'consumed_at', type: 'datetime', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
