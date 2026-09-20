import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MenuItem } from '../menu/menu-item.entity';
import { OmrFormTemplate } from './omr-form-template.entity';

@Entity('omr_form_template_rows')
@Index('UQ_omr_form_template_rows_index', ['templateId', 'rowIndex'], { unique: true })
@Index('UQ_omr_form_template_rows_menu', ['templateId', 'menuItemId'], { unique: true })
export class OmrFormTemplateRow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'template_id', type: 'varchar' })
  templateId!: string;

  @ManyToOne(() => OmrFormTemplate, (template) => template.rows, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'template_id' })
  template!: OmrFormTemplate;

  @Column({ name: 'row_index', type: 'integer' })
  rowIndex!: number;

  @Column({ name: 'menu_item_id', type: 'varchar' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'menu_item_id' })
  menuItem!: MenuItem;

  @Column({ name: 'code_snapshot', type: 'varchar', length: 3 })
  codeSnapshot!: string;

  @Column({ name: 'short_label_snapshot', type: 'varchar', length: 100 })
  shortLabelSnapshot!: string;

  @Column({ type: 'int' })
  position!: number;
}
