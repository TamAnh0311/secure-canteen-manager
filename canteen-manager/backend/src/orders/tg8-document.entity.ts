import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { Operator } from '../operators/operator.entity';
import { Order } from './order.entity';
import type { Tg8Snapshot } from './tg8-snapshot';

@Entity('order_tg8_documents')
export class Tg8Document {
  @PrimaryColumn({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @OneToOne(() => Order, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ name: 'template_revision', type: 'varchar', length: 50 })
  templateRevision!: string;

  @Column({ type: 'simple-json' })
  snapshot!: Tg8Snapshot;

  @Column({ name: 'accepted_at', type: 'datetime' })
  acceptedAt!: Date;

  @Column({ name: 'operator_id', type: 'uuid' })
  operatorId!: string;

  @ManyToOne(() => Operator, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'operator_id' })
  operator!: Operator;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
