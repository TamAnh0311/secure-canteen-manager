import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { acquireOmrCatalogLock, CanonicalCatalogRow, snapshotActiveCatalog } from '../menu/menu.service';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from './omr-form-template.entity';
import { OmrFormTemplateRow } from './omr-form-template-row.entity';

export interface OmrTemplateRowSnapshot extends CanonicalCatalogRow {}

export interface OmrTemplateDraft {
  mode: OmrFormMode;
  orientation: OmrFormOrientation;
  geometry: object;
  rows: OmrTemplateRowSnapshot[];
}

export interface ActivateTemplateInput {
  revision: string;
  geometry: object;
  expectedCatalogHash?: string;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key.normalize('NFC'), canonicalize(child)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

export function canonicalGeometryHash(geometry: object): string {
  return sha256(geometry);
}

export function canonicalCatalogHash(rows: OmrTemplateRowSnapshot[]): string {
  return sha256(rows.map(({ menuItemId, codeSnapshot, shortLabelSnapshot, position }) => ({
    menuItemId,
    codeSnapshot,
    shortLabelSnapshot,
    position,
  })));
}

@Injectable()
export class OmrFormTemplatesService {
  constructor(private readonly dataSource: DataSource) {}

  validateDraft(draft: OmrTemplateDraft): void {
    if (draft.mode === OmrFormMode.CODE) {
      if (draft.orientation !== OmrFormOrientation.PORTRAIT || draft.rows.length !== 0) {
        throw new BadRequestException({
          message: 'Code templates must be A5 portrait and cannot contain catalog rows',
          code: 'OMR_TEMPLATE.INVALID_CODE_LAYOUT',
        });
      }
      return;
    }

    if (draft.orientation !== OmrFormOrientation.LANDSCAPE) {
      throw new BadRequestException({
        message: 'Full-list templates must be A5 landscape',
        code: 'OMR_TEMPLATE.INVALID_FULL_LIST_LAYOUT',
      });
    }
    if (draft.rows.length > 52) {
      throw new BadRequestException({
        message: 'Full-list templates support at most 52 active items',
        code: 'OMR_TEMPLATE.CAPACITY_EXCEEDED',
      });
    }
    if (draft.rows.length === 0) {
      throw new BadRequestException({
        message: 'Full-list templates require at least one active item',
        code: 'OMR_TEMPLATE.CATALOG_EMPTY',
      });
    }
    const menuIds = new Set<string>();
    for (const [index, row] of draft.rows.entries()) {
      if (!/^[0-9]{3}$/.test(row.codeSnapshot) || row.position < 0 ||
          (index > 0 && row.position <= draft.rows[index - 1].position) ||
          !row.shortLabelSnapshot.trim() || row.shortLabelSnapshot.length > 100) {
        throw new BadRequestException({
          message: 'Template rows require stable ascending positions, three-digit codes, and labels',
          code: 'OMR_TEMPLATE.INVALID_ROW',
        });
      }
      if (menuIds.has(row.menuItemId)) {
        throw new BadRequestException({
          message: 'A menu item may appear only once in a template',
          code: 'OMR_TEMPLATE.DUPLICATE_ITEM',
        });
      }
      menuIds.add(row.menuItemId);
    }
  }

  activateCodeTemplate(input: ActivateTemplateInput): Promise<OmrFormTemplate> {
    return this.activate(input, OmrFormMode.CODE, OmrFormOrientation.PORTRAIT);
  }

  activateFullListTemplate(input: ActivateTemplateInput): Promise<OmrFormTemplate> {
    return this.activate(input, OmrFormMode.FULL_LIST, OmrFormOrientation.LANDSCAPE);
  }

  async retire(templateId: string): Promise<OmrFormTemplate> {
    return this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      const template = await manager.findOne(OmrFormTemplate, { where: { id: templateId } });
      if (!template) throw new NotFoundException({ message: 'OMR template not found', code: 'OMR_TEMPLATE.NOT_FOUND' });
      if (!template.isActive) return template;
      template.isActive = false;
      template.retiredAt = new Date();
      return manager.save(OmrFormTemplate, template);
    });
  }

  async resolveForIssuedForm(templateId: string): Promise<OmrFormTemplate> {
    const template = await this.dataSource.getRepository(OmrFormTemplate).findOne({
      where: { id: templateId },
      relations: { rows: true },
      order: { rows: { rowIndex: 'ASC' } },
    });
    if (!template) throw new NotFoundException({ message: 'OMR template not found', code: 'OMR_TEMPLATE.NOT_FOUND' });
    return template;
  }

  async getActiveTemplates(): Promise<OmrFormTemplate[]> {
    return this.dataSource.getRepository(OmrFormTemplate).find({
      where: { isActive: true },
      relations: { rows: true },
      order: { rows: { rowIndex: 'ASC' } },
    });
  }

  assertIssuable(template: OmrFormTemplate, currentCatalogHash: string | null): void {
    if (!template.isActive || template.retiredAt) {
      throw new ConflictException({ message: 'OMR template is retired', code: 'OMR_TEMPLATE.RETIRED' });
    }
    if (template.mode === OmrFormMode.FULL_LIST && template.catalogHash !== currentCatalogHash) {
      throw new ConflictException({ message: 'Active catalog no longer matches the template', code: 'OMR_TEMPLATE.CATALOG_CHANGED' });
    }
  }

  private async activate(
    input: ActivateTemplateInput,
    mode: OmrFormMode,
    orientation: OmrFormOrientation,
  ): Promise<OmrFormTemplate> {
    return this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      if (!input.revision.trim() || input.revision.length > 64) {
        throw new BadRequestException({
          message: 'Template revision must contain 1..64 characters',
          code: 'OMR_TEMPLATE.INVALID_REVISION',
        });
      }
      const rows = mode === OmrFormMode.FULL_LIST ? await snapshotActiveCatalog(manager) : [];
      this.validateDraft({ mode, orientation, geometry: input.geometry, rows });

      const geometryHash = canonicalGeometryHash(input.geometry);
      const catalogHash = mode === OmrFormMode.FULL_LIST ? canonicalCatalogHash(rows) : null;
      if (input.expectedCatalogHash !== undefined && input.expectedCatalogHash !== catalogHash) {
        throw new ConflictException({
          message: 'The active catalog changed while the template was rendering',
          code: 'OMR_TEMPLATE.CATALOG_CHANGED',
        });
      }
      const duplicate = await manager.findOne(OmrFormTemplate, {
        where: [{ revision: input.revision }, { geometryHash }],
      });
      if (duplicate) {
        throw new ConflictException({ message: 'Template revision or geometry already exists', code: 'OMR_TEMPLATE.ALREADY_EXISTS' });
      }

      const now = new Date();
      const template = await manager.save(OmrFormTemplate, manager.create(OmrFormTemplate, {
        revision: input.revision,
        mode,
        paperSize: 'A5',
        orientation,
        geometry: input.geometry,
        geometryHash,
        catalogHash,
        isActive: false,
        activatedAt: null,
        retiredAt: null,
      }));
      if (rows.length) {
        await manager.save(OmrFormTemplateRow, rows.map((row, rowIndex) => manager.create(OmrFormTemplateRow, {
          templateId: template.id,
          rowIndex,
          ...row,
        })));
      }
      await manager.update(
        OmrFormTemplate,
        { mode, isActive: true },
        { isActive: false, retiredAt: now },
      );
      template.isActive = true;
      template.activatedAt = now;
      await manager.save(OmrFormTemplate, template);
      return Object.assign(template, { rows });
    });
  }
}
