import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OperatorRole {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  // Counter staff: records balance top-ups and takes cash/bank payment for relative orders.
  CASHIER = 'cashier',
}

@Entity('operators')
export class Operator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 100 })
  username!: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash!: string;

  @Column({ name: 'display_name', length: 200 })
  displayName!: string;

  @Column({ type: 'enum', enum: OperatorRole, default: OperatorRole.OPERATOR })
  role!: OperatorRole;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  zone!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
