import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OmrFormTemplateRow } from './omr-form-template-row.entity';

export enum OmrFormMode {
  CODE = 'code',
  FULL_LIST = 'full_list',
}

export enum OmrFormOrientation {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
}

@Entity('omr_form_templates')
@Index('UQ_omr_form_templates_revision', ['revision'], { unique: true })
@Index('UQ_omr_form_templates_geometry_hash', ['geometryHash'], { unique: true })
export class OmrFormTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  revision!: string;

  @Column({ type: 'enum', enum: OmrFormMode, enumName: 'omr_form_mode_enum' })
  mode!: OmrFormMode;

  @Column({ name: 'paper_size', type: 'varchar', length: 8 })
  paperSize!: 'A4' | 'A5';

  @Column({ type: 'enum', enum: OmrFormOrientation, enumName: 'omr_form_orientation_enum' })
  orientation!: OmrFormOrientation;

  @Column({ type: 'jsonb' })
  geometry!: object;

  @Column({ name: 'geometry_hash', type: 'char', length: 64 })
  geometryHash!: string;

  @Column({ name: 'catalog_hash', type: 'char', length: 64, nullable: true })
  catalogHash!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => OmrFormTemplateRow, (row) => row.template)
  rows!: OmrFormTemplateRow[];
}
