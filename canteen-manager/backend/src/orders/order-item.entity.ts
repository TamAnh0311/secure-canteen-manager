import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Order } from './order.entity';
import { MenuItem } from '../menu/menu-item.entity';
import { numericTransformer } from '../common/numeric.transformer';
import { MenuItemCategory } from '../menu/menu-item-category.enum';

@Entity('order_items')
@Index('UQ_order_items_order_menu_item', ['orderId', 'menuItemId'], { unique: true })
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ name: 'menu_item_id', type: 'uuid' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'menu_item_id' })
  menuItem!: MenuItem;

  // Price of the menu item captured at order-create time — immune to later price edits.
  @Column({ name: 'unit_price', type: 'bigint', default: 0, transformer: numericTransformer })
  unitPrice!: number;

  // Category at order-create time. Historical totals and policy evidence must not change when
  // an administrator later reclassifies the current menu item.
  @Column({ type: 'simple-enum', enum: MenuItemCategory })
  category!: MenuItemCategory;

  // Portions of this item on the order. With UNIQUE(order, menu_item) an item is one row per
  // order, so quantity (not row count) carries the amount. Line total = unit_price × quantity.
  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;
}
