import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { OperatorZoneAccessService } from '../auth/operator-zone-access.service';
import { tomorrowInDeployTz } from '../common/today-in-tz';
import { acquireOmrCatalogLock, snapshotActiveCatalog } from '../menu/menu.service';
import { OmrClientService } from '../omr/omr-client.service';
import { OperatorPublic } from '../operators/operator-public';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { IssueOmrFormBatchDto, MAX_OMR_BATCH_SIZE } from './dto/issue-omr-form-batch.dto';
import { IssuedOmrForm, IssuedOmrFormStatus } from './issued-omr-form.entity';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from './omr-form-template.entity';
import { OmrOperationalModeService } from './omr-operational-mode.service';
import { ScanWorkflowModeService } from '../config/scan-workflow-mode.service';
import { OmrOperationalFormMode } from '../scans/sheet.entity';
import { genericOmrFormReference } from '../scans/omr-form-reference';
import {
  canonicalCatalogHash,
  canonicalGeometryHash,
  OmrFormTemplatesService,
} from './omr-form-templates.service';

export interface IssuedOmrFormPrint {
  serial: string;
  serviceDate: string;
  issuedAt: Date;
  pdfBase64: string;
}

export interface IssuedOmrFormBatchPrint {
  serviceDate: string;
  issuedAt: Date;
  mode: OmrFormMode;
  orientation: OmrFormOrientation;
  pageCount: number;
  manifest: Array<{ userId: string; shortSerial: string }>;
  pdfBase64: string;
}

export interface OmrIssuanceCapabilities {
  operationalMode: OmrOperationalFormMode;
  maxBatchSize: number;
  modes: Array<{
    mode: OmrFormMode;
    available: boolean;
    unavailableCode: string | null;
    templateRevision: string | null;
    orientation: OmrFormOrientation;
    itemCount: number;
    capacity: number | null;
  }>;
}

export interface GenericOmrMasterPrint {
  mode: OmrFormMode;
  templateId: string;
  revision: string;
  orientation: OmrFormOrientation;
  formReference: string;
  pageCount: 1;
  pdfBase64: string;
}

interface IdentitySnapshot {
  id: string;
  legacyId: string;
  name: string;
  zone: string;
  cell: string | null;
}

interface PreparedPage {
  user: IdentitySnapshot;
  token: string;
  serial: string;
}

const FULL_LIST_CAPACITY = 52;

function identitySnapshot(user: User): IdentitySnapshot {
  const zone = user.zone?.trim();
  if (!zone) {
    throw new BadRequestException({
      message: 'Selected prisoners require a current prison zone',
      code: 'OMR_FORM.ROSTER_MISMATCH',
    });
  }
  return {
    id: user.id,
    legacyId: user.legacyId,
    name: user.name,
    zone,
    cell: user.cell?.trim() || null,
  };
}

function sameIdentity(current: User, snapshot: IdentitySnapshot): boolean {
  return current.id === snapshot.id &&
    current.legacyId === snapshot.legacyId &&
    current.name === snapshot.name &&
    (current.zone?.trim() || null) === snapshot.zone &&
    (current.cell?.trim() || null) === snapshot.cell;
}

@Injectable()
export class OmrFormsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly omrClient: OmrClientService,
    private readonly templates: OmrFormTemplatesService,
    private readonly zoneAccess: OperatorZoneAccessService,
    private readonly workflowMode: ScanWorkflowModeService,
    private readonly operationalMode?: OmrOperationalModeService,
  ) {}

  listRosterOptions(actor: OperatorPublic) {
    this.assertIssuedMode();
    return this.usersService.listIssuanceRosterOptions(actor);
  }

  async listRoster(actor: OperatorPublic, exactZone: string, exactCell: string | null) {
    this.assertIssuedMode();
    return {
      zone: exactZone.trim(),
      cell: exactCell?.trim() || null,
      prisoners: await this.usersService.listIssuanceRoster(actor, exactZone, exactCell),
    };
  }

  async getCapabilities(): Promise<OmrIssuanceCapabilities> {
    const { templates, catalog } = await this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      const templates = await manager.find(OmrFormTemplate, {
        where: { isActive: true },
        relations: { rows: true },
        order: { rows: { rowIndex: 'ASC' } },
      });
      const catalog = await snapshotActiveCatalog(manager);
      return { templates, catalog };
    });
    const catalogHash = canonicalCatalogHash(catalog);
    const byMode = new Map(templates.map((template) => [template.mode, template]));
    const code = byMode.get(OmrFormMode.CODE);
    const fullList = byMode.get(OmrFormMode.FULL_LIST);
    let fullListUnavailable: string | null = null;
    if (catalog.length > FULL_LIST_CAPACITY) {
      fullListUnavailable = 'OMR_TEMPLATE.CAPACITY_EXCEEDED';
    } else if (!fullList) {
      fullListUnavailable = 'OMR_FORM.TEMPLATE_NOT_READY';
    } else if (fullList.catalogHash !== catalogHash) {
      fullListUnavailable = 'OMR_TEMPLATE.CATALOG_CHANGED';
    }
    return {
      operationalMode: this.operationalMode?.mode ?? OmrOperationalFormMode.ISSUED,
      maxBatchSize: MAX_OMR_BATCH_SIZE,
      modes: [
        {
          mode: OmrFormMode.CODE,
          available: Boolean(code),
          unavailableCode: code ? null : 'OMR_FORM.TEMPLATE_NOT_READY',
          templateRevision: code?.revision ?? null,
          orientation: code?.orientation ?? OmrFormOrientation.PORTRAIT,
          itemCount: catalog.length,
          capacity: null,
        },
        {
          mode: OmrFormMode.FULL_LIST,
          available: fullListUnavailable === null,
          unavailableCode: fullListUnavailable,
          templateRevision: fullList?.revision ?? null,
          orientation: fullList?.orientation ?? OmrFormOrientation.LANDSCAPE,
          itemCount: catalog.length,
          capacity: FULL_LIST_CAPACITY,
        },
      ],
    };
  }

  async issue(userId: string, actor: OperatorPublic): Promise<IssuedOmrFormPrint> {
    const result = await this.issueBatch({ userIds: [userId], mode: OmrFormMode.CODE }, actor);
    return {
      serial: result.manifest[0].shortSerial,
      serviceDate: result.serviceDate,
      issuedAt: result.issuedAt,
      pdfBase64: result.pdfBase64,
    };
  }

  async issueBatch(dto: IssueOmrFormBatchDto, actor: OperatorPublic): Promise<IssuedOmrFormBatchPrint> {
    this.workflowMode.assertOmrFormMutationEnabled();
    this.assertIssuedMode();
    if (dto.userIds.length === 0 || dto.userIds.length > MAX_OMR_BATCH_SIZE ||
        new Set(dto.userIds).size !== dto.userIds.length) {
      throw new BadRequestException({
        message: `Select between 1 and ${MAX_OMR_BATCH_SIZE} unique prisoners`,
        code: 'OMR_FORM.INVALID_BATCH',
      });
    }

    const selected = await this.usersService.loadIssuanceSelection(actor, dto.userIds);
    const snapshots = selected.map(identitySnapshot);
    const serviceDate = tomorrowInDeployTz();
    const activeTemplates = await this.templates.getActiveTemplates();
    const template = activeTemplates.find((candidate) => candidate.mode === dto.mode);
    if (!template) {
      throw new ConflictException({
        message: `Generate an active A5 ${dto.mode} template before issuing forms`,
        code: 'OMR_FORM.TEMPLATE_NOT_READY',
      });
    }

    const catalog = await this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      return snapshotActiveCatalog(manager);
    });
    const catalogHash = canonicalCatalogHash(catalog);
    if (dto.mode === OmrFormMode.FULL_LIST && catalog.length > FULL_LIST_CAPACITY) {
      throw new ConflictException({
        message: `Full-list forms support at most ${FULL_LIST_CAPACITY} active items`,
        code: 'OMR_TEMPLATE.CAPACITY_EXCEEDED',
      });
    }
    this.templates.assertIssuable(template, dto.mode === OmrFormMode.FULL_LIST ? catalogHash : null);

    const pages: PreparedPage[] = snapshots.map((user) => {
      const token = randomUUID();
      return { user, token, serial: token.slice(0, 8).toUpperCase() };
    });
    const rendered = await this.omrClient.renderIssuedBatch({
      mode: dto.mode,
      template_revision: template.revision,
      catalog_rows: template.rows.map((row) => ({
        row_index: row.rowIndex,
        menu_item_id: row.menuItemId,
        code_snapshot: row.codeSnapshot,
        short_label: row.shortLabelSnapshot,
      })),
      pages: pages.map((page) => ({
        personalization: {
          form_token: page.token,
          short_serial: page.serial,
          service_date: serviceDate,
          name: page.user.name,
          prison_id: page.user.legacyId,
          zone: page.user.zone,
          cell: page.user.cell,
        },
      })),
    });
    this.assertRenderMatches(rendered, pages, template);

    const issued = await this.dataSource.transaction((manager) =>
      this.commitBatch(manager, actor, pages, template, catalogHash, serviceDate, dto.mode));

    return {
      serviceDate,
      issuedAt: issued[0].issuedAt,
      mode: dto.mode,
      orientation: template.orientation,
      pageCount: pages.length,
      manifest: pages.map((page) => ({ userId: page.user.id, shortSerial: page.serial })),
      pdfBase64: rendered.pdf_base64,
    };
  }

  async getGenericMaster(mode: OmrFormMode): Promise<GenericOmrMasterPrint> {
    this.workflowMode.assertOmrFormMutationEnabled();
    if (!Object.values(OmrFormMode).includes(mode)) {
      throw new BadRequestException({ message: 'Unsupported OMR form mode', code: 'OMR_TEMPLATE.MODE_INVALID' });
    }
    if ((this.operationalMode?.mode ?? OmrOperationalFormMode.ISSUED) !== OmrOperationalFormMode.GENERIC) {
      throw new ConflictException({
        message: 'Generic masters are available only in generic software mode',
        code: 'OMR_GENERIC.MODE_DISABLED',
      });
    }
    await this.operationalMode?.assertGenericReady();

    const template = (await this.templates.getActiveTemplates()).find((candidate) => candidate.mode === mode);
    if (!template) {
      throw new ConflictException({ message: 'Active generic template is unavailable', code: 'OMR_FORM.TEMPLATE_NOT_READY' });
    }
    const rendered = await this.omrClient.renderGenericMaster({
      mode,
      template_id: template.id,
      template_revision: template.revision,
      catalog_rows: template.rows.map((row) => ({
        row_index: row.rowIndex,
        menu_item_id: row.menuItemId,
        code_snapshot: row.codeSnapshot,
        short_label: row.shortLabelSnapshot,
      })),
    });
    const expectedReference = genericOmrFormReference(template.id);
    if (rendered.page_count !== 1 || rendered.form_reference !== expectedReference ||
        canonicalGeometryHash(rendered.roi_template) !== template.geometryHash) {
      throw new ConflictException({
        message: 'Rendered generic master no longer matches the active template',
        code: 'OMR_FORM.TEMPLATE_CHANGED',
      });
    }

    const current = await this.templates.resolveForIssuedForm(template.id);
    if (!current.isActive || current.retiredAt || current.revision !== template.revision ||
        current.geometryHash !== template.geometryHash || current.catalogHash !== template.catalogHash) {
      throw new ConflictException({
        message: 'Generic template changed while the master was rendering',
        code: 'OMR_FORM.TEMPLATE_CHANGED',
      });
    }
    return {
      mode,
      templateId: template.id,
      revision: template.revision,
      orientation: template.orientation,
      formReference: expectedReference,
      pageCount: 1,
      pdfBase64: rendered.pdf_base64,
    };
  }

  private assertIssuedMode(): void {
    if ((this.operationalMode?.mode ?? OmrOperationalFormMode.ISSUED) === OmrOperationalFormMode.GENERIC) {
      throw new ConflictException({
        message: 'Personalized OMR issuance is disabled in generic software mode',
        code: 'OMR_GENERIC.PERSONALIZED_ISSUANCE_DISABLED',
      });
    }
  }

  private assertRenderMatches(
    rendered: Awaited<ReturnType<OmrClientService['renderIssuedBatch']>>,
    pages: PreparedPage[],
    template: OmrFormTemplate,
  ): void {
    const manifestMatches = rendered.manifest.length === pages.length &&
      rendered.manifest.every((item, index) =>
        item.page_number === index + 1 &&
        item.short_serial === pages[index].serial &&
        item.prison_id === pages[index].user.legacyId);
    if (rendered.page_count !== pages.length || !manifestMatches ||
        canonicalGeometryHash(rendered.roi_template) !== template.geometryHash) {
      throw new ConflictException({
        message: 'The rendered batch no longer matches the active template or selected roster',
        code: 'OMR_FORM.TEMPLATE_CHANGED',
      });
    }
  }

  private async commitBatch(
    manager: EntityManager,
    actor: OperatorPublic,
    pages: PreparedPage[],
    template: OmrFormTemplate,
    renderedCatalogHash: string,
    serviceDate: string,
    mode: OmrFormMode,
  ): Promise<IssuedOmrForm[]> {
    const sortedIds = pages.map((page) => page.user.id).sort();
    for (const userId of sortedIds) {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${userId}:${serviceDate}`],
      );
    }

    const predecessors = await manager.find(IssuedOmrForm, {
      where: { userId: In(sortedIds), serviceDate, status: IssuedOmrFormStatus.ISSUED },
      order: { userId: 'ASC', token: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    const lockedUsers: User[] = [];
    for (const userId of sortedIds) {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException({ message: 'One or more prisoners are unavailable', code: 'USER.NOT_FOUND' });
      }
      lockedUsers.push(user);
    }

    await acquireOmrCatalogLock(manager);
    const currentTemplate = await manager.findOne(OmrFormTemplate, {
      where: { id: template.id },
      lock: { mode: 'pessimistic_read' },
    });
    const currentCatalog = await snapshotActiveCatalog(manager);
    const snapshotById = new Map(pages.map((page) => [page.user.id, page.user]));
    for (const user of lockedUsers) {
      await this.zoneAccess.assertUserAccess(actor, user.id, manager);
      const snapshot = snapshotById.get(user.id)!;
      if (!user.isActive || !sameIdentity(user, snapshot)) {
        throw new ConflictException({
          message: 'The selected roster changed while the batch was rendering',
          code: 'OMR_FORM.ROSTER_CHANGED',
        });
      }
    }
    const first = lockedUsers[0];
    const exactZone = first.zone?.trim() || null;
    const exactCell = first.cell?.trim() || null;
    if (!exactZone || lockedUsers.some((user) =>
      (user.zone?.trim() || null) !== exactZone || (user.cell?.trim() || null) !== exactCell)) {
      throw new ConflictException({
        message: 'The selected roster changed while the batch was rendering',
        code: 'OMR_FORM.ROSTER_CHANGED',
      });
    }
    const templateChanged = !currentTemplate || !currentTemplate.isActive ||
      currentTemplate.revision !== template.revision ||
      currentTemplate.mode !== mode ||
      currentTemplate.orientation !== template.orientation ||
      currentTemplate.geometryHash !== template.geometryHash;
    const catalogChanged = mode === OmrFormMode.FULL_LIST &&
      (currentTemplate?.catalogHash !== renderedCatalogHash ||
        canonicalCatalogHash(currentCatalog) !== renderedCatalogHash);
    if (templateChanged || catalogChanged) {
      throw new ConflictException({
        message: 'Template or catalog changed while the batch was rendering',
        code: catalogChanged ? 'OMR_TEMPLATE.CATALOG_CHANGED' : 'OMR_FORM.TEMPLATE_CHANGED',
      });
    }

    const now = new Date();
    if (predecessors.length) {
      for (const predecessor of predecessors) {
        predecessor.status = IssuedOmrFormStatus.VOID;
        predecessor.voidedAt = now;
        predecessor.voidReason = 'reissued';
      }
      await manager.save(IssuedOmrForm, predecessors);
    }
    const rows = pages.map((page) => manager.create(IssuedOmrForm, {
      token: page.token,
      userId: page.user.id,
      serviceDate,
      roiVersion: template.revision,
      templateId: template.id,
      formMode: mode,
      issuedBy: actor.id,
      status: IssuedOmrFormStatus.ISSUED,
    }));
    return manager.save(IssuedOmrForm, rows);
  }
}
