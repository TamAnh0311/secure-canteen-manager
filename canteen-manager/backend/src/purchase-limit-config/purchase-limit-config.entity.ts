import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';

@Entity('purchase_limit_config')
export class PurchaseLimitConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_purchase_limit_config_singleton', { unique: true })
  @Column({ type: 'boolean', default: true })
  singleton!: boolean;

  @Column({ name: 'prisoner_food_enabled', default: true })
  prisonerFoodEnabled!: boolean;

  @Column({ name: 'prisoner_food_amount', type: 'bigint', nullable: true, transformer: numericTransformer })
  prisonerFoodAmount!: number | null;

  @Column({ name: 'prisoner_essential_enabled', default: false })
  prisonerEssentialEnabled!: boolean;

  @Column({ name: 'prisoner_essential_amount', type: 'bigint', nullable: true, transformer: numericTransformer })
  prisonerEssentialAmount!: number | null;

  @Column({ name: 'visitor_food_enabled', default: true })
  visitorFoodEnabled!: boolean;

  @Column({ name: 'visitor_food_amount', type: 'bigint', nullable: true, transformer: numericTransformer })
  visitorFoodAmount!: number | null;

  @Column({ name: 'visitor_essential_enabled', default: false })
  visitorEssentialEnabled!: boolean;

  @Column({ name: 'visitor_essential_amount', type: 'bigint', nullable: true, transformer: numericTransformer })
  visitorEssentialAmount!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
