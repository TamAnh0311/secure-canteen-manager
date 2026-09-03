import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';
import { MenuItemCategory } from './menu-item-category.enum';

// Global persistent menu — one shared list of commissary dishes, not scoped to a session.
@Entity('menu_items')
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Auto-generated item code (monotonic, never reused, gaps allowed). Stable
  // human reference for the item. Globally unique.
  @Index('UQ_menu_items_code', { unique: true })
  @Column({ length: 20 })
  code!: string;

  // Zero-based display position. Globally unique and never reused so a freed slot
  // can never be reassigned to a different item.
  @Index('UQ_menu_items_position', { unique: true })
  @Column({ type: 'int' })
  position!: number;

  @Column({ length: 255 })
  name!: string;

  // Selling price in integer VND. Shown on screen/kiosk/counter.
  @Column({ type: 'bigint', default: 0, transformer: numericTransformer })
  price!: number;

  @Column({ type: 'simple-enum', enum: MenuItemCategory })
  category!: MenuItemCategory;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
