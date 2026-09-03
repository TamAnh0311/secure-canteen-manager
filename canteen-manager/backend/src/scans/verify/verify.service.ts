import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Sheet } from '../sheet.entity';
import { SheetStatus } from '../sheet-status.enum';
import { ScanStorageService } from '../scan-storage.service';
import { OmrClientService } from '../../omr/omr-client.service';
import { UsersService } from '../../users/users.service';
import { acquireOmrCatalogLock, MenuService } from '../../menu/menu.service';
import { MenuItem } from '../../menu/menu-item.entity';
import { ThresholdConfigService } from '../../config/threshold-config.service';
import { AccountsService } from '../../accounts/accounts.service';
import { OrdersService, OrderWithItems } from '../../orders/orders.service';
import { Order, OrderStatus } from '../../orders/order.entity';
import { ConfirmScanDto } from './dto/confirm-scan.dto';
import {
  assembleMenuItems,
  assembleQueueItem,
  ExistingOrderSummary,
  QueueSheetItem,
  VerifyQueueResponse,
} from './verify-queue.assembler';
import { User } from '../../users/user.entity';
import { OrderItem } from '../../orders/order-item.entity';
import { tomorrowInDeployTz } from '../../common/today-in-tz';
import { IssuedOmrForm, IssuedOmrFormStatus } from '../../omr-forms/issued-omr-form.entity';
import { PurchaseLimitConfigService } from '../../purchase-limit-config/purchase-limit-config.service';
import { OperatorPublic } from '../../operators/operator-public';
import { OperatorZoneAccessService } from '../../auth/operator-zone-access.service';
import { OmrFormMode, OmrFormTemplate } from '../../omr-forms/omr-form-template.entity';
import { OmrFormTemplateRow } from '../../omr-forms/omr-form-template-row.entity';
import { IdentitySelectionSource, OmrOperationalFormMode } from '../sheet.entity';
import { ScannerArtifactJob, ScannerArtifactJobState } from '../webhook/scanner-artifact-job.entity';
import { ScannerWebhookEvent, ScannerWebhookEventState } from '../webhook/scanner-webhook-event.entity';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';
import { normalizeCellV1 } from '../../users/cell-normalization';
import { evaluateScannerReviewState } from '../scanner-review-state';
import { scannerOperatorScopeSql } from '../scanner-zone-routing';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../../config/env-validation';

export interface WarpedImageResult {
  imageBytes: Buffer;
  warpOk: boolean;
  contentType: 'image/png' | 'image/jpeg';
}

export interface ScannerArtifactResult {
  imageBytes: Buffer;
  contentType: string;
}

export interface ConfirmResult {
  order: OrderWithItems;
  sheet: Sheet;
  /** true when an existing active order was superseded */
  replaced: boolean;
}

@Injectable()
export class VerifyService {
  private readonly logger = new Logger(VerifyService.name);

  constructor(
    @InjectRepository(Sheet)
    private readonly sheetRepo: Repository<Sheet>,
    private readonly storage: ScanStorageService,
    private readonly omrClient: OmrClientService,
    private readonly usersService: UsersService,
    private readonly menuService: MenuService,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly ordersService: OrdersService,
    private readonly accountsService: AccountsService,
    private readonly dataSource: DataSource,
    private readonly purchaseLimits: PurchaseLimitConfigService,
    private readonly zoneAccess: OperatorZoneAccessService,
    private readonly workflowMode: ScanWorkflowModeService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  // Flagged sheets awaiting verification across an inclusive service_date range (both bounds
  // default to tomorrow in the deploy timezone — the next collection day sheets are stamped
  // for). The menu and form template are global, so the queue reflects the day(s) being
  // processed rather than any per-session scope. Each sheet still carries its own service_date,
  // so a confirmed order is bucketed by the sheet's date, never by the queue filter — widening
  // the filter cannot misbucket a debit.
  async getQueue(
    actor: OperatorPublic,
    dateFrom: string = tomorrowInDeployTz(),
    dateTo: string = dateFrom,
  ): Promise<VerifyQueueResponse> {
    const sheetsQuery = this.sheetRepo
      .createQueryBuilder('s')
      .leftJoin(IssuedOmrForm, 'issued_owner', 'issued_owner.token = s.issued_form_id')
      .leftJoin(User, 'sheet_owner', 'sheet_owner.id = issued_owner.user_id')
      .leftJoin(User, 'matched_owner', 'matched_owner.id = s.matched_user_id')
      .where('s.service_date >= :dateFrom', { dateFrom })
      .andWhere('s.service_date <= :dateTo', { dateTo })
      .andWhere('s.status = :status', { status: SheetStatus.FLAGGED })
      .orderBy('s.avg_confidence', 'ASC', 'NULLS FIRST');
    if (!this.workflowMode.scannerReviewEnabled) {
      sheetsQuery.andWhere("s.admitted_mode <> 'scanner'");
    } else if (!this.workflowMode.omrRuntimeEnabled) {
      sheetsQuery.andWhere("s.admitted_mode = 'scanner'");
    }
    this.scopeVisibleSheets(sheetsQuery, actor);
    const sheets = await sheetsQuery.getMany();

    const formIds = [...new Set(sheets.map((sheet) => sheet.issuedFormId).filter((id): id is string => Boolean(id)))];
    const forms = formIds.length > 0
      ? await this.dataSource.getRepository(IssuedOmrForm).find({
          where: { token: In(formIds) },
          relations: { template: { rows: true } },
          order: { template: { rows: { rowIndex: 'ASC' } } },
        })
      : [];
    const formMap = new Map(forms.map((form) => [form.token, form]));
    const templateIds = [...new Set(sheets.map((sheet) => sheet.templateId).filter((id): id is string => Boolean(id)))];
    const templates = templateIds.length > 0
      ? await this.dataSource.getRepository(OmrFormTemplate).find({
          where: { id: In(templateIds) },
          relations: { rows: true },
          order: { rows: { rowIndex: 'ASC' } },
        })
      : [];
    const templateMap = new Map(templates.map((template) => [template.id, template]));

    // The issued form is the sole identity authority. matchedUserId is only a cache and
    // may be stale or tampered, so it must never choose the displayed user or balance.
    const userIds = [...new Set(forms.map((form) => form.userId))];
    const userMap = new Map<string, User>();
    // Commissary balance per form owner so the operator sees fundedness before
    // confirming a debit (server stays the source of truth on insufficient funds).
    const balanceMap = new Map<string, number>();
    for (const uid of userIds) {
      try {
        const u = await this.usersService.findById(uid);
        userMap.set(uid, u);
        balanceMap.set(uid, await this.accountsService.getBalance(uid));
      } catch {
        // A missing owner cannot be confirmed; omit identity and balance from the queue.
        this.logger.warn(`Issued form owner ${uid} not found while building verify queue`);
      }
    }

    const allMenuItems = await this.menuService.listAll();
    const purchaseLimits = await this.purchaseLimits.getEffective('prisoner');
    const scannerEventIds = sheets
      .map((sheet) => sheet.scannerEventId)
      .filter((id): id is string => Boolean(id));
    const scannerArtifactJobs = scannerEventIds.length > 0
      ? await this.dataSource.getRepository(ScannerArtifactJob).find({
          where: { eventId: In(scannerEventIds) },
          order: { createdAt: 'ASC' },
        })
      : [];
    const artifactJobsByEvent = new Map<string, ScannerArtifactJob[]>();
    for (const job of scannerArtifactJobs) {
      artifactJobsByEvent.set(job.eventId, [...(artifactJobsByEvent.get(job.eventId) ?? []), job]);
    }
    const currentScannerCatalogueVersion = this.currentScannerCatalogueVersion(allMenuItems);

    // For each flagged sheet, look up the existing active OMR order for the matched prisoner
    // and service date. Surfacing it lets the operator see what a confirm will REPLACE before
    // they commit — prevents silent reversal of a prior day's sheet.
    const existingOrderMap = new Map<string, ExistingOrderSummary | null>();
    for (const sheet of sheets) {
      const formOwnerId = formMap.get(sheet.issuedFormId ?? '')?.userId;
      if (!formOwnerId || !userMap.has(formOwnerId)) {
        existingOrderMap.set(sheet.id, null);
        continue;
      }
      const order = await this.dataSource
        .getRepository(Order)
        .findOne({
          where: {
            serviceDate: sheet.serviceDate,
            userId: formOwnerId,
            source: In(['omr', 'scanner']),
            status: OrderStatus.ACTIVE,
          },
        });
      if (!order) {
        existingOrderMap.set(sheet.id, null);
        continue;
      }
      const orderItems = await this.dataSource
        .getRepository(OrderItem)
        .find({ where: { orderId: order.id } });
      const itemSummaries = orderItems.map((oi) => {
        const mi = allMenuItems.find((m) => m.id === oi.menuItemId);
        return {
          menuItemId: oi.menuItemId,
          name: mi?.name ?? oi.menuItemId,
          quantity: oi.quantity ?? 1,
          unitPrice: oi.unitPrice,
          category: oi.category,
        };
      });
      existingOrderMap.set(sheet.id, { items: itemSummaries, total: order.totalAmount });
    }

    const queueSheets = await Promise.all(sheets.map(async (s) => {
      const form = formMap.get(s.issuedFormId ?? '');
      const template = form?.template ?? templateMap.get(s.templateId ?? '');
      const isScanner = s.admittedMode === OmrOperationalFormMode.SCANNER;
      const isGeneric = Boolean(s.templateId && !s.issuedFormId) && !isScanner;
      const scannerIdentity = isScanner ? await this.scannerIdentityContext(s, actor) : null;
      const scannerJobs = artifactJobsByEvent.get(s.scannerEventId ?? '') ?? [];
      const scannerReview = isScanner ? evaluateScannerReviewState({
        result: (s.resultJson ?? {}) as Record<string, unknown>,
        identityExactMatch: scannerIdentity?.exactMatch ?? false,
        menuItems: allMenuItems,
        artifactJobs: scannerJobs,
        currentCatalogueVersion: currentScannerCatalogueVersion,
      }) : undefined;
      const candidates = isGeneric
        ? await this.authorizedStoredCandidates(s, actor)
        : scannerIdentity?.candidates ?? [];
      return assembleQueueItem(
        s,
        userMap,
        balanceMap,
        allMenuItems,
        existingOrderMap.get(s.id) ?? null,
        {
          userId: form?.userId ?? null,
          serial: form
            ? form.token.slice(0, 8).toUpperCase()
            : isScanner ? s.sheetId : s.templateId?.slice(0, 8).toUpperCase() ?? '—',
            revision: form?.roiVersion ?? template?.revision ?? (isScanner ? s.admittedGeneration : '—'),
          serviceDate: form?.serviceDate ?? s.serviceDate,
          template: template ? {
            id: template.id,
            mode: template.mode,
            geometryHash: template.geometryHash,
          } : null,
        },
        {
          bindingKind: isScanner ? 'scanner' : isGeneric ? 'generic' : 'issued',
          evidence: isGeneric
            ? this.storedIdentityEvidence(s)
            : scannerIdentity?.evidence ?? [],
          candidates,
          scannerArtifacts: isScanner ? this.scannerArtifacts(
            s,
            scannerJobs,
          ) : undefined,
          scannerRequiresIdentityReason: scannerIdentity?.requiresReason,
          currentScannerCatalogueVersion,
          scannerReview,
        },
      );
    }));

    return {
      workflow: {
        scannerConfirmationEnabled: this.workflowMode.scannerConfirmationEnabled,
        omrConfirmationEnabled: this.workflowMode.omrRuntimeEnabled,
      },
      sheets: queueSheets,
      roiTemplate: null,
      roiTemplates: Object.fromEntries([...forms.map((form) => form.template), ...templates]
        .filter((template): template is OmrFormTemplate => Boolean(template))
        .map((template) => [template.id, template.geometry])),
      menuItems: assembleMenuItems(allMenuItems),
      purchaseLimits,
    };
  }

  async getWarpedImage(id: string, actor: OperatorPublic): Promise<WarpedImageResult> {
    const sheet = await this.loadAuthorizedSheetOrThrow(id, actor);
    if (!sheet.imagePath) {
      throw new ConflictException({
        message: 'Scanner source artifact is not available yet',
        code: 'VERIFY.ARTIFACT_PENDING',
      });
    }
    const form = sheet.issuedFormId
      ? await this.dataSource.getRepository(IssuedOmrForm).findOne({
          where: { token: sheet.issuedFormId },
          relations: { template: true },
        })
      : null;
    const template = form?.template ?? (sheet.templateId
      ? await this.dataSource.getRepository(OmrFormTemplate).findOne({ where: { id: sheet.templateId } })
      : null);
    const cacheKey = template ? `${template.id}:${template.geometryHash}` : null;

    // Cache hit: serve the previously warped file. warpOk is unconditionally true
    // here because only successful warps are ever persisted (see saveWarpedImage
    // call below); a failed warp falls back to raw and is never cached.
    if (template && this.storage.warpedImageExists(id, cacheKey)) {
      const relativePath = this.storage.warpedImagePath(id, cacheKey);
      const imageBytes = this.storage.readImageBytes(relativePath);
      return { imageBytes, warpOk: true, contentType: 'image/png' };
    }

    // Read raw image
    let rawBase64: string;
    try {
      rawBase64 = this.storage.readImageAsBase64(sheet.imagePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to read raw image for sheet ${id}: ${msg}`);
      throw err;
    }

    // No ROI template → fall back to raw image
    if (!template) {
      const imageBytes = Buffer.from(rawBase64, 'base64');
      return {
        imageBytes,
        warpOk: false,
        contentType: this.detectImageContentType(imageBytes, sheet.imagePath),
      };
    }

    // Call warp-sheet; on any error fall back gracefully (never 500 the verify screen)
    try {
      const result = await this.omrClient.warpSheet({
        image_base64: rawBase64,
        roi_template: template.geometry,
      });

      if (result.warp_ok) {
        // Persist to cache then serve (keyed on roiVersion so a regenerated ROI
        // never serves a warp drawn against the previous layout)
        const relativePath = await this.storage.saveWarpedImage(
          id,
          result.warped_image_base64,
          cacheKey,
        );
        const imageBytes = this.storage.readImageBytes(relativePath);
        return { imageBytes, warpOk: true, contentType: 'image/png' };
      }

      // OMR says warp failed — return the image it sent back (may be raw) with warp_ok=false
      const imageBytes = Buffer.from(result.warped_image_base64, 'base64');
      return {
        imageBytes,
        warpOk: false,
        contentType: this.detectImageContentType(imageBytes, sheet.imagePath),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`warpSheet failed for sheet ${id}, falling back to raw: ${msg}`);
      const imageBytes = Buffer.from(rawBase64, 'base64');
      return {
        imageBytes,
        warpOk: false,
        contentType: this.detectImageContentType(imageBytes, sheet.imagePath),
      };
    }
  }

  async getScannerArtifact(
    id: string,
    artifactId: string,
    actor: OperatorPublic,
  ): Promise<ScannerArtifactResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/.test(artifactId)) throw this.sheetNotFound();
    const sheet = await this.loadAuthorizedSheetOrThrow(id, actor);
    if (sheet.admittedMode !== OmrOperationalFormMode.SCANNER || !sheet.scannerEventId) {
      throw this.sheetNotFound();
    }
    const job = await this.dataSource.getRepository(ScannerArtifactJob).findOne({
      where: { eventId: sheet.scannerEventId, artifactId },
    });
    if (!job || job.state !== ScannerArtifactJobState.AVAILABLE || !job.relativePath) {
      throw new ConflictException({
        message: 'Scanner artifact is not available',
        code: 'VERIFY.ARTIFACT_PENDING',
      });
    }
    return {
      imageBytes: this.storage.readImageBytes(job.relativePath),
      contentType: job.mediaType,
    };
  }

  async retryScannerArtifact(
    id: string,
    artifactId: string,
    actor: OperatorPublic,
  ): Promise<{ state: ScannerArtifactJobState }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/.test(artifactId)) throw this.sheetNotFound();
    const sheet = await this.loadAuthorizedSheetOrThrow(id, actor);
    if (sheet.admittedMode !== OmrOperationalFormMode.SCANNER || !sheet.scannerEventId) {
      throw this.sheetNotFound();
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const job = await manager.getRepository(ScannerArtifactJob).findOne({
        where: { eventId: sheet.scannerEventId!, artifactId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) throw this.sheetNotFound();
      const retentionDays = this.config.get('SCANNER_ARTIFACT_RETENTION_DAYS', { infer: true }) ?? 30;
      if (Date.now() - job.sourceOccurredAt.getTime() >= retentionDays * 24 * 60 * 60 * 1000 ||
          job.state === ScannerArtifactJobState.PURGED) {
        throw new ConflictException({
          message: 'Scanner artifact is outside the recoverable retention window',
          code: 'VERIFY.ARTIFACT_EXPIRED',
        });
      }
      if ([
        ScannerArtifactJobState.PENDING,
        ScannerArtifactJobState.PROCESSING,
        ScannerArtifactJobState.RETRYING,
        ScannerArtifactJobState.AVAILABLE,
      ].includes(job.state)) {
        return job.state;
      }
      job.state = ScannerArtifactJobState.RETRYING;
      job.nextAttemptAt = new Date();
      job.leaseExpiresAt = null;
      job.leaseToken = null;
      job.failureCode = 'ARTIFACT_RETRY_REQUESTED';
      job.availableAt = null;
      job.relativePath = null;
      await manager.getRepository(ScannerArtifactJob).save(job);
      return job.state;
    });
    this.logger.log(`Scanner artifact retry requested by operator ${actor.id} for sheet ${id}`);
    return { state: result };
  }

  private detectImageContentType(
    imageBytes: Buffer,
    fallbackPath: string,
  ): 'image/png' | 'image/jpeg' {
    if (
      imageBytes.length >= 8 &&
      imageBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (imageBytes.length >= 3 && imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff) {
      return 'image/jpeg';
    }
    return /\.jpe?g$/i.test(fallbackPath) ? 'image/jpeg' : 'image/png';
  }

  async confirm(id: string, dto: ConfirmScanDto, actor: OperatorPublic): Promise<ConfirmResult> {
    this.zoneAccess.requireOperatorZone(actor);
    const authorizedBinding = await this.loadAuthorizedSheetOrThrow(id, actor);
    if (authorizedBinding.admittedMode === OmrOperationalFormMode.SCANNER) {
      this.workflowMode.assertScannerConfirmationEnabled();
      return this.confirmScanner(authorizedBinding, dto, actor);
    }
    this.workflowMode.assertOmrConfirmationEnabled();
    if (authorizedBinding.templateId && !authorizedBinding.issuedFormId) {
      return this.confirmGeneric(authorizedBinding, dto, actor);
    }
    if (dto.userId !== undefined) {
      throw new BadRequestException({
        message: 'Issued forms derive identity from the issued form owner',
        code: 'VERIFY.IDENTITY_NOT_ALLOWED',
      });
    }
    // Money-safety: validate every menuItemId against the current menu BEFORE opening the TX.
    // createOrReplace prices an unknown menuItemId at ?? 0 (see orders.service.ts), so an
    // unresolved ID would debit zero and silently create a free-item order. Reject early.
    const allMenuItems = await this.menuService.listAll();
    // Order + balance debit + sheet finalisation all commit (or roll back) together.
    // Read the sheet binding, then lock form -> sheet: processing takes the same order,
    // so a second scan cannot hold the form while waiting on a sheet that confirm holds.
    // The locked sheet is revalidated FLAGGED before any order/ledger side effect. createOrReplace
    // handles item aggregation, supersede of the prior order on the same date, and the omr
    // balance debit/reversal; an insufficient balance throws and rolls back the whole TX, so
    // the sheet stays FLAGGED and re-confirmable.
    const outcome = await this.dataSource.transaction(async (em) => {
      const form = await em.findOne(IssuedOmrForm, {
        where: { token: authorizedBinding.issuedFormId! },
        lock: { mode: 'pessimistic_write' },
      });
      if (!form) {
        throw this.sheetNotFound();
      }

      const sheet = await em.findOne(Sheet, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sheet) {
        throw this.sheetNotFound();
      }
      if (sheet.issuedFormId !== form.token) {
        throw this.sheetNotFound();
      }

      const prisoner = await this.assertSheetOwnerAccess(actor, form.userId, em, true);
      if (sheet.status !== SheetStatus.FLAGGED) {
        throw new ConflictException({
          message: `Sheet is ${sheet.status}, not awaiting verification`,
          code: 'SHEET.NOT_AWAITING_VERIFICATION',
        });
      }
      if (!prisoner.isActive) {
        throw new BadRequestException({ message: 'Prisoner account is inactive', code: 'USER.INACTIVE' });
      }

      const knownIds = new Set(allMenuItems.map((m) => m.id));
      const unknownId = dto.items.find((i) => !knownIds.has(i.menuItemId));
      if (unknownId) {
        throw new BadRequestException({
          message: `Menu item ${unknownId.menuItemId} not found`,
          code: 'VERIFY.UNKNOWN_MENU_ITEM',
        });
      }

      const terminalConflict = this.formConflictCode(form, sheet);
      if (terminalConflict) {
        sheet.status = SheetStatus.REJECTED;
        sheet.rejectionCode = terminalConflict;
        sheet.flags = [...new Set([...(sheet.flags ?? []), terminalConflict])];
        sheet.matchedUserId = null;
        sheet.processedAt = new Date();
        await em.save(Sheet, sheet);
        return { conflictCode: terminalConflict } as const;
      }

      // Whether a prior scanned active order will be superseded by this confirm.
      // OMR and scanner share one balance-backed channel; relative orders remain
      // independent. Read inside the locked TX so the returned flag matches the
      // committed outcome.
      const existingOrder = await em.findOne(Order, {
        where: {
          serviceDate: sheet.serviceDate,
          userId: form.userId,
          source: In(['omr', 'scanner']),
          status: OrderStatus.ACTIVE,
        },
      });
      if (existingOrder && dto.replacementAck !== true) {
        throw new ConflictException({
          message: 'Acknowledge replacement of the existing scanned order',
          code: 'VERIFY.REPLACEMENT_ACK_REQUIRED',
        });
      }

      // Items arrive pre-resolved from the line editor: each carries a validated menuItemId
      // and the handwritten quantity. createOrReplace aggregates duplicate menuItemIds (sums
      // qty) so the operator can confirm two lines with the same code without error.
      const created = await this.ordersService.createOrReplace(
        {
          serviceDate: sheet.serviceDate,
          userId: form.userId,
          items: dto.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
          sheetId: sheet.id,
          source: 'omr',
          operatorId: actor.id,
          replacementAcknowledged: dto.replacementAck === true,
        },
        em,
      );

      form.status = IssuedOmrFormStatus.CONSUMED;
      form.consumedSheetId = sheet.id;
      form.consumedAt = new Date();
      sheet.matchedUserId = form.userId;
      sheet.recognizedId = null;
      sheet.orderId = created.id;
      sheet.status = SheetStatus.VERIFIED;
      await em.save(IssuedOmrForm, form);
      const persisted = await em.save(Sheet, sheet);
      return { order: created, savedSheet: persisted, replaced: existingOrder !== null, conflictCode: null } as const;
    });

    if (outcome.conflictCode !== null) {
      throw new ConflictException({
        message: 'Issued form can no longer be confirmed; reprint is required',
        code: outcome.conflictCode,
      });
    }
    return { order: outcome.order, sheet: outcome.savedSheet, replaced: outcome.replaced };
  }

  private async confirmScanner(
    authorizedBinding: Sheet,
    dto: ConfirmScanDto,
    actor: OperatorPublic,
  ): Promise<ConfirmResult> {
    if (!dto.userId) {
      throw new BadRequestException({
        message: 'Select a prisoner before confirming this scanner result',
        code: 'VERIFY.IDENTITY_REQUIRED',
      });
    }
    const selectedUserId = dto.userId;

    const outcome = await this.dataSource.transaction(async (em) => {
      if (!authorizedBinding.scannerEventId) throw this.sheetNotFound();

      // Serialize confirmations against scanner receipt updates with an
      // exclusive event lock; artifact availability is handled independently.
      const event = await em.findOne(ScannerWebhookEvent, {
        where: { id: authorizedBinding.scannerEventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event || event.state !== ScannerWebhookEventState.RECEIVED) {
        throw new ConflictException({
          message: 'Scanner receipt is quarantined or no longer matches the review date',
          code: 'VERIFY.SCANNER_EVENT_INVALID',
        });
      }
      const sheet = await em.findOne(Sheet, {
        where: { id: authorizedBinding.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !sheet ||
        sheet.admittedMode !== OmrOperationalFormMode.SCANNER ||
        sheet.scannerEventId !== event.id
      ) {
        throw this.sheetNotFound();
      }
      if (sheet.status !== SheetStatus.FLAGGED) {
        throw new ConflictException({
          message: `Sheet is ${sheet.status}, not awaiting verification`,
          code: 'SHEET.NOT_AWAITING_VERIFICATION',
        });
      }
      if (event.serviceDate !== sheet.serviceDate) {
        throw new ConflictException({
          message: 'Scanner receipt is quarantined or no longer matches the review date',
          code: 'VERIFY.SCANNER_EVENT_INVALID',
        });
      }

      const scannerResult = (sheet.resultJson ?? {}) as Record<string, unknown>;
      const prisoner = await this.assertSheetOwnerAccess(actor, selectedUserId, em, true);
      if (!prisoner.isActive) {
        throw new BadRequestException({ message: 'Prisoner account is inactive', code: 'USER.INACTIVE' });
      }

      const scannerIdentity = this.scannerFieldValue(scannerResult, 'ma_luu_ky');
      const scannerRoom = normalizeCellV1(this.scannerFieldValue(scannerResult, 'buong_giam'));
      const exactScannerUser = scannerIdentity ? await em.findOne(User, {
        where: { legacyId: scannerIdentity },
        lock: { mode: 'pessimistic_read' },
      }) : null;
      const identityMismatch = !scannerIdentity || !/^\d{6}$/.test(scannerIdentity) ||
        !exactScannerUser || exactScannerUser.id !== prisoner.id;
      const currentRoom = normalizeCellV1(prisoner.cell);
      const roomMismatch = !scannerRoom || !currentRoom || scannerRoom !== currentRoom;
      if ((identityMismatch || roomMismatch) && !dto.reason?.trim()) {
        throw new BadRequestException({
          message: 'A reason is required for a scanner identity or room mismatch',
          code: 'VERIFY.IDENTITY_REASON_REQUIRED',
        });
      }

      // Menu mutations use the same advisory lock. Resolve codes, activity,
      // snapshots, and catalogue version only after the lock is held so a
      // confirmation cannot race a retirement, rename, or insertion.
      await acquireOmrCatalogLock(em);
      const allMenuItems = await em.find(MenuItem, {
        order: { code: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      });
      const menuByCode = new Map(allMenuItems.map((item) => [item.code, item]));
      const allowedItemIds = this.scannerItemIds(scannerResult, menuByCode);
      if (allowedItemIds.size === 0) {
        throw new ConflictException({
          message: 'Scanner catalogue evidence could not be mapped to the current menu',
          code: 'VERIFY.CATALOGUE_DRIFT',
        });
      }
      const unknownItem = dto.items.find((item) => !allowedItemIds.has(item.menuItemId));
      if (unknownItem) {
        throw new BadRequestException({
          message: 'Confirmed items must come from the scanner result or its candidates',
          code: 'VERIFY.ITEM_NOT_SCANNED',
        });
      }
      this.assertScannerFieldReview(scannerResult, dto, menuByCode);
      const scannerCatalogueVersion = this.scannerCatalogueVersion(scannerResult);
      const currentCatalogueVersion = this.currentScannerCatalogueVersion(allMenuItems);
      const catalogueDrift = scannerCatalogueVersion !== currentCatalogueVersion;
      if (catalogueDrift && !dto.reason?.trim()) {
        throw new ConflictException({
          message: 'Scanner catalogue differs from the current manager catalogue; review and provide a reason',
          code: 'VERIFY.CATALOGUE_DRIFT',
        });
      }

      const created = await this.ordersService.createOrReplaceWithOutcome({
        serviceDate: sheet.serviceDate,
        userId: prisoner.id,
        items: dto.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
        sheetId: sheet.id,
        source: 'scanner',
        operatorId: actor.id,
        replacementAcknowledged: dto.replacementAck === true,
      }, em);

      sheet.matchedUserId = prisoner.id;
      sheet.proposedUserId = prisoner.id;
      sheet.identitySelectedBy = actor.id;
      sheet.identitySelectedAt = new Date();
      sheet.identitySelectionSource = exactScannerUser?.id === prisoner.id && !roomMismatch
        ? IdentitySelectionSource.RANKED_CANDIDATE
        : IdentitySelectionSource.MANUAL_SEARCH;
      sheet.identitySelectionReason = dto.reason?.trim() || null;
      if (identityMismatch || roomMismatch) {
        sheet.flags = [...new Set([...(sheet.flags ?? []), 'SCANNER_IDENTITY_MISMATCH'])];
      }
      if (catalogueDrift) {
        sheet.flags = [...new Set([...(sheet.flags ?? []), 'SCANNER_CATALOGUE_DRIFT'])];
      }
      sheet.orderId = created.order.id;
      sheet.status = SheetStatus.VERIFIED;
      const persisted = await em.save(Sheet, sheet);
      return { order: created.order, savedSheet: persisted, replaced: created.replaced };
    });
    return { order: outcome.order, sheet: outcome.savedSheet, replaced: outcome.replaced };
  }

  private scannerFieldValue(result: Record<string, unknown>, field: string): string | null {
    const raw = result[field];
    if (!raw || typeof raw !== 'object') return null;
    const value = (raw as Record<string, unknown>).value;
    return typeof value === 'string' ? value.trim() : null;
  }

  private scannerCatalogueVersion(result: Record<string, unknown>): string | null {
    if (!result.versions || typeof result.versions !== 'object') return null;
    const value = (result.versions as Record<string, unknown>).catalogue;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private currentScannerCatalogueVersion(menuItems: MenuItem[]): string {
    const snapshot = menuItems.map((item) => ({
      catalogueItemId: item.code,
      name: item.name.normalize('NFC').trim().replace(/\s+/g, ' '),
      active: item.isActive,
    }));
    return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
  }

  private scannerItemIds(
    result: Record<string, unknown>,
    menuByCode: Map<string, { id: string; isActive: boolean }>,
  ): Set<string> {
    const ids = new Set<string>();
    if (!Array.isArray(result.items)) return ids;
    for (const raw of result.items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const code = typeof item.catalogue_item_id === 'string' ? item.catalogue_item_id : null;
      const direct = code ? menuByCode.get(code) : undefined;
      if (direct?.isActive) ids.add(direct.id);
      const field = item.item && typeof item.item === 'object' ? item.item as Record<string, unknown> : null;
      const candidates = field && Array.isArray(field.candidates) ? field.candidates : [];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        const candidateCode = (candidate as Record<string, unknown>).catalogue_item_id;
        if (typeof candidateCode === 'string') {
          const candidateItem = menuByCode.get(candidateCode);
          if (candidateItem?.isActive) ids.add(candidateItem.id);
        }
      }
    }
    return ids;
  }

  private assertScannerFieldReview(
    result: Record<string, unknown>,
    dto: ConfirmScanDto,
    menuByCode: Map<string, { id: string; isActive: boolean }>,
  ): void {
    if (!Array.isArray(result.items)) return;

    const submittedByMenuId = new Map(dto.items.map((item) => [item.menuItemId, item]));
    for (const [index, raw] of result.items.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const itemField = row.item && typeof row.item === 'object'
        ? row.item as Record<string, unknown>
        : {};
      const quantityField = row.quantity && typeof row.quantity === 'object'
        ? row.quantity as Record<string, unknown>
        : {};
      const itemCandidates = Array.isArray(itemField.candidates) ? itemField.candidates : [];
      const candidateIds = new Set(itemCandidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const code = (candidate as Record<string, unknown>).catalogue_item_id;
        const menuItem = typeof code === 'string' ? menuByCode.get(code) : undefined;
        return menuItem?.isActive ? [menuItem.id] : [];
      }));
      const directCode = typeof row.catalogue_item_id === 'string' ? row.catalogue_item_id : null;
      const directMenuItem = directCode ? menuByCode.get(directCode) : undefined;
      const selected = directMenuItem?.isActive
        ? submittedByMenuId.get(directMenuItem.id)
        : candidateIds.size > 0
          ? [...candidateIds].map((id) => submittedByMenuId.get(id)).find(Boolean)
          : undefined;

      if (itemCandidates.length > 0 && (!selected || !candidateIds.has(selected.menuItemId))) {
        throw new ConflictException({
          message: `Scanner item ${index + 1} requires an explicit catalogue candidate selection`,
          code: 'VERIFY.SCANNER_ITEM_REVIEW_REQUIRED',
        });
      }
      if (itemCandidates.length > 0 && !dto.reason?.trim()) {
        throw new BadRequestException({
          message: `A reason is required for scanner item ${index + 1} review`,
          code: 'VERIFY.SCANNER_ITEM_REASON_REQUIRED',
        });
      }
      if (Array.isArray(itemField.warnings) && itemField.warnings.length > 0 && !dto.reason?.trim()) {
        throw new BadRequestException({
          message: `A reason is required for scanner item ${index + 1} review`,
          code: 'VERIFY.SCANNER_ITEM_REASON_REQUIRED',
        });
      }

      const quantityCandidates = Array.isArray(quantityField.candidates) ? quantityField.candidates : [];
      if (quantityCandidates.length > 0) {
        const allowedQuantities = new Set(quantityCandidates.flatMap((candidate) => {
          if (!candidate || typeof candidate !== 'object') return [];
          const value = (candidate as Record<string, unknown>).value;
          return Number.isInteger(value) && Number(value) > 0 ? [Number(value)] : [];
        }));
        if (!selected || !allowedQuantities.has(selected.quantity)) {
          throw new ConflictException({
            message: `Scanner quantity ${index + 1} requires an explicit candidate selection`,
            code: 'VERIFY.SCANNER_QUANTITY_REVIEW_REQUIRED',
          });
        }
      }
      if (Array.isArray(quantityField.warnings) && quantityField.warnings.length > 0 && !dto.reason?.trim()) {
        throw new BadRequestException({
          message: `A reason is required for scanner quantity ${index + 1} review`,
          code: 'VERIFY.SCANNER_QUANTITY_REASON_REQUIRED',
        });
      }
    }
  }

  private async confirmGeneric(
    authorizedBinding: Sheet,
    dto: ConfirmScanDto,
    actor: OperatorPublic,
  ): Promise<ConfirmResult> {
    if (!dto.userId) {
      throw new BadRequestException({
        message: 'Select a prisoner before confirming this generic sheet',
        code: 'VERIFY.IDENTITY_REQUIRED',
      });
    }
    const selectedUserId = dto.userId;
    const allMenuItems = await this.menuService.listAll();
    const menuById = new Map(allMenuItems.map((item) => [item.id, item]));
    const menuByCode = new Map(allMenuItems.map((item) => [item.code, item]));

    const outcome = await this.dataSource.transaction(async (em) => {
      const sheet = await em.findOne(Sheet, {
        where: { id: authorizedBinding.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sheet || !sheet.templateId || sheet.issuedFormId) throw this.sheetNotFound();
      if (sheet.status !== SheetStatus.FLAGGED || sheet.matchedUserId || sheet.orderId) {
        throw new ConflictException({
          message: `Sheet is ${sheet.status}, not awaiting verification`,
          code: 'SHEET.NOT_AWAITING_VERIFICATION',
        });
      }
      if (sheet.admittedMode !== OmrOperationalFormMode.GENERIC || sheet.proposedUserId) {
        throw new ConflictException({ message: 'Generic sheet identity state is invalid', code: 'VERIFY.IDENTITY_STATE_INVALID' });
      }

      const template = await em.findOne(OmrFormTemplate, {
        where: { id: sheet.templateId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!template || !template.isActive || template.retiredAt) {
        throw new ConflictException({
          message: 'Generic template is no longer active; reprint and rescan',
          code: 'GENERIC_TEMPLATE_RETIRED',
        });
      }
      const prisoner = await this.assertSheetOwnerAccess(actor, selectedUserId, em, true);
      if (!prisoner.isActive) {
        throw new BadRequestException({ message: 'Prisoner account is inactive', code: 'USER.INACTIVE' });
      }

      const allowedItemIds = new Set<string>();
      if (template.mode === OmrFormMode.FULL_LIST) {
        const rows = await em.find(OmrFormTemplateRow, { where: { templateId: template.id } });
        for (const row of rows) allowedItemIds.add(row.menuItemId);
      } else {
        const stored = (sheet.resultJson ?? {}) as {
          order_lines?: Array<{ code?: string | null; menu_item_id?: string }>;
        };
        for (const line of stored.order_lines ?? []) {
          if (line.menu_item_id && menuById.has(line.menu_item_id)) allowedItemIds.add(line.menu_item_id);
          else if (line.code && menuByCode.has(line.code)) allowedItemIds.add(menuByCode.get(line.code)!.id);
        }
      }
      const unauthorizedItem = dto.items.find((item) => !allowedItemIds.has(item.menuItemId));
      if (unauthorizedItem) {
        throw new BadRequestException({
          message: 'Confirmed items must come from the scanned generic form',
          code: 'VERIFY.ITEM_NOT_SCANNED',
        });
      }

      const rankedIds = this.storedCandidateIds(sheet);
      const source = rankedIds.includes(prisoner.id)
        ? IdentitySelectionSource.RANKED_CANDIDATE
        : IdentitySelectionSource.MANUAL_SEARCH;
      const divergent = rankedIds.length > 0 && rankedIds[0] !== prisoner.id;
      const highRisk = source === IdentitySelectionSource.MANUAL_SEARCH || divergent;
      const reason = dto.reason?.trim() || null;
      if (highRisk && !reason) {
        throw new BadRequestException({
          message: 'A reason is required for manual or non-top identity selection',
          code: 'VERIFY.IDENTITY_REASON_REQUIRED',
        });
      }

      const created = await this.ordersService.createOrReplaceWithOutcome({
        serviceDate: sheet.serviceDate,
        userId: prisoner.id,
        items: dto.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })),
        sheetId: sheet.id,
        source: 'omr',
        operatorId: actor.id,
        replacementAcknowledged: dto.replacementAck === true,
      }, em);

      sheet.matchedUserId = prisoner.id;
      sheet.identitySelectedBy = actor.id;
      sheet.identitySelectedAt = new Date();
      sheet.identitySelectionSource = source;
      sheet.identitySelectionReason = reason;
      sheet.orderId = created.order.id;
      sheet.status = SheetStatus.VERIFIED;
      if (highRisk) {
        sheet.flags = [...new Set([...(sheet.flags ?? []), 'IDENTITY_HIGH_RISK_SELECTION'])];
      }
      const persisted = await em.save(Sheet, sheet);
      return { order: created.order, savedSheet: persisted, replaced: created.replaced, highRisk };
    });

    if (outcome.highRisk) {
      this.logger.warn(`High-risk generic identity selection committed for sheet ${authorizedBinding.id} by operator ${actor.id}`);
    }
    return { order: outcome.order, sheet: outcome.savedSheet, replaced: outcome.replaced };
  }

  async reject(id: string, actor: OperatorPublic): Promise<Sheet> {
    this.zoneAccess.requireOperatorZone(actor);
    const authorizedBinding = await this.loadAuthorizedSheetOrThrow(id, actor);
    if (authorizedBinding.admittedMode === OmrOperationalFormMode.SCANNER) {
      return this.dataSource.transaction(async (em) => {
        const sheet = await em.findOne(Sheet, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!sheet || sheet.admittedMode !== OmrOperationalFormMode.SCANNER) throw this.sheetNotFound();
        if (sheet.status !== SheetStatus.FLAGGED) {
          throw new ConflictException({
            message: `Sheet is ${sheet.status}, not awaiting verification`,
            code: 'SHEET.NOT_AWAITING_VERIFICATION',
          });
        }
        sheet.status = SheetStatus.REJECTED;
        sheet.processedAt = new Date();
        sheet.rejectionCode = 'SCANNER.OPERATOR_REJECTED';
        return em.save(Sheet, sheet);
      });
    }
    if (authorizedBinding.templateId && !authorizedBinding.issuedFormId) {
      return this.dataSource.transaction(async (em) => {
        const sheet = await em.findOne(Sheet, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!sheet || sheet.templateId !== authorizedBinding.templateId || sheet.issuedFormId) {
          throw this.sheetNotFound();
        }
        if (sheet.status !== SheetStatus.FLAGGED) {
          throw new ConflictException({
            message: `Sheet is ${sheet.status}, not awaiting verification`,
            code: 'SHEET.NOT_AWAITING_VERIFICATION',
          });
        }
        sheet.status = SheetStatus.REJECTED;
        sheet.processedAt = new Date();
        return em.save(Sheet, sheet);
      });
    }
    return this.dataSource.transaction(async (em) => {
      const form = await em.findOne(IssuedOmrForm, {
        where: { token: authorizedBinding.issuedFormId! },
        lock: { mode: 'pessimistic_read' },
      });
      if (!form) throw this.sheetNotFound();
      const sheet = await em.findOne(Sheet, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sheet) throw new NotFoundException({ message: 'Sheet not found', code: 'SHEET.NOT_FOUND' });
      if (sheet.issuedFormId !== form.token) throw this.sheetNotFound();
      await this.assertSheetOwnerAccess(actor, form.userId, em, true);
      if (sheet.status !== SheetStatus.FLAGGED) {
        throw new ConflictException({
          message: `Sheet is ${sheet.status}, not awaiting verification`,
          code: 'SHEET.NOT_AWAITING_VERIFICATION',
        });
      }
      sheet.status = SheetStatus.REJECTED;
      sheet.processedAt = new Date();
      return em.save(Sheet, sheet);
    });
  }

  private formConflictCode(form: IssuedOmrForm, sheet: Sheet): string | null {
    if (form.status === IssuedOmrFormStatus.CONSUMED || form.consumedSheetId) return 'OMR_FORM.ALREADY_CONSUMED';
    if (form.status === IssuedOmrFormStatus.VOID) return 'OMR_FORM.VOID';
    if (form.reservedSheetId !== sheet.id) return 'OMR_FORM.RESERVATION_CONFLICT';
    if (!form.templateId) return 'OMR_FORM.TEMPLATE_MISMATCH';
    if (form.serviceDate !== sheet.serviceDate) return 'OMR_FORM.DATE_MISMATCH';
    return null;
  }

  // Skip is a client-side defer: no state change, return 200 with current sheet state.
  async skip(id: string, actor: OperatorPublic): Promise<Sheet> {
    return this.loadAuthorizedSheetOrThrow(id, actor);
  }

  async searchIdentityCandidates(id: string, query: string, actor: OperatorPublic) {
    const sheet = await this.loadAuthorizedSheetOrThrow(id, actor);
    const identityResolvable = sheet.admittedMode === OmrOperationalFormMode.SCANNER ||
      Boolean(sheet.templateId && !sheet.issuedFormId);
    if (!identityResolvable) throw this.sheetNotFound();
    const users = await this.usersService.searchActiveCandidates(actor, { q: query, limit: 20 });
    return users.map((user) => ({
      id: user.id,
      legacyId: user.legacyId,
      name: user.name,
      zone: user.zone,
      cell: user.cell,
    }));
  }

  async getIdentityPreview(id: string, userId: string, actor: OperatorPublic) {
    const sheet = await this.loadAuthorizedSheetOrThrow(id, actor);
    const identityResolvable = sheet.admittedMode === OmrOperationalFormMode.SCANNER ||
      Boolean(sheet.templateId && !sheet.issuedFormId);
    if (!identityResolvable) throw this.sheetNotFound();
    const user = await this.assertSheetOwnerAccess(actor, userId, this.dataSource.manager);
    if (!user.isActive) {
      throw new BadRequestException({ message: 'Prisoner account is inactive', code: 'USER.INACTIVE' });
    }
    const [balance, order] = await Promise.all([
      this.accountsService.getBalance(user.id),
      this.dataSource.getRepository(Order).findOne({
        where: {
          serviceDate: sheet.serviceDate,
          userId: user.id,
          source: In(['omr', 'scanner']),
          status: OrderStatus.ACTIVE,
        },
      }),
    ]);
    let existingOrder: ExistingOrderSummary | null = null;
    if (order) {
      const [orderItems, menuItems] = await Promise.all([
        this.dataSource.getRepository(OrderItem).find({ where: { orderId: order.id } }),
        this.menuService.listAll(),
      ]);
      const menuMap = new Map(menuItems.map((item) => [item.id, item]));
      existingOrder = {
        total: order.totalAmount,
        items: orderItems.map((item) => ({
          menuItemId: item.menuItemId,
          name: menuMap.get(item.menuItemId)?.name ?? item.menuItemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          category: item.category,
        })),
      };
    }
    return {
      user: {
        id: user.id,
        legacyId: user.legacyId,
        name: user.name,
        zone: user.zone,
        cell: user.cell,
      },
      balance,
      existingOrder,
    };
  }

  private async loadAuthorizedSheetOrThrow(id: string, actor: OperatorPublic): Promise<Sheet> {
    const qb = this.sheetRepo
      .createQueryBuilder('s')
      .leftJoin(IssuedOmrForm, 'issued_owner', 'issued_owner.token = s.issued_form_id')
      .leftJoin(User, 'sheet_owner', 'sheet_owner.id = issued_owner.user_id')
      .leftJoin(User, 'matched_owner', 'matched_owner.id = s.matched_user_id')
      .where('s.id = :id', { id });
    this.scopeVisibleSheets(qb, actor);
    const sheet = await qb.getOne();
    if (!sheet) throw this.sheetNotFound();
    return sheet;
  }

  private scopeVisibleSheets(
    qb: ReturnType<Repository<Sheet>['createQueryBuilder']>,
    actor: OperatorPublic,
  ): void {
    const zone = this.zoneAccess.requireOperatorZone(actor);
    if (zone === null) return;
    qb.andWhere(`(
      (s.issued_form_id IS NOT NULL AND BTRIM(sheet_owner.zone) = :verifyActorZone)
      OR
      (s.issued_form_id IS NULL AND s.template_id IS NOT NULL AND (
        (s.matched_user_id IS NOT NULL AND BTRIM(matched_owner.zone) = :verifyActorZone)
        OR
        (s.matched_user_id IS NULL AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(s.ranked_candidates_json->'candidates', '[]'::jsonb)) candidate
          JOIN users candidate_user ON candidate_user.id = (candidate->>'userId')::uuid
          WHERE candidate_user.is_active = true
            AND BTRIM(candidate_user.zone) = :verifyActorZone
        ))
      ))
      OR
      (s.admitted_mode = 'scanner' AND (
        (s.matched_user_id IS NOT NULL AND BTRIM(matched_owner.zone) = :verifyActorZone)
        OR ${scannerOperatorScopeSql('s', 'verifyActorZone')}
      ))
    )`, { verifyActorZone: zone });
  }

  private async scannerIdentityContext(
    sheet: Sheet,
    actor: OperatorPublic,
  ): Promise<{
    evidence: QueueSheetItem['identityEvidence'];
    candidates: QueueSheetItem['rankedCandidates'];
    requiresReason: boolean;
    exactMatch: boolean;
  }> {
    const result = (sheet.resultJson ?? {}) as Record<string, unknown>;
    const legacyId = this.scannerFieldValue(result, 'ma_luu_ky');
    const room = this.scannerFieldValue(result, 'buong_giam');
    const evidence = [
      this.scannerIdentityEvidenceField(result, 'ma_luu_ky', 'prisoner_id'),
      this.scannerIdentityEvidenceField(result, 'buong_giam', 'cell'),
    ].filter((value): value is QueueSheetItem['identityEvidence'][number] => Boolean(value));
    const roomUsers = room ? await this.usersService.findActiveByExactCell(room, actor) : [];
    const exact = legacyId && /^\d{6}$/.test(legacyId)
      ? (await this.usersService.searchActiveCandidates(actor, { q: legacyId, limit: 20 }))
        .find((user) => user.legacyId === legacyId) ?? null
      : null;
    const normalizedRoom = normalizeCellV1(room);
    const roomMatches = Boolean(
      exact && normalizedRoom && exact.normalizedCell === normalizedRoom,
    );
    const candidates = [...(exact ? [exact] : []), ...roomUsers]
      .filter((user, index, values) => values.findIndex((candidate) => candidate.id === user.id) === index)
      .slice(0, 20)
      .map((user) => {
        const exactId = user.legacyId === legacyId;
        const exactRoom = Boolean(normalizedRoom && user.normalizedCell === normalizedRoom);
        return {
          userId: user.id,
          legacyId: user.legacyId,
          name: user.name,
          zone: user.zone,
          cell: user.cell,
          score: exactId && exactRoom ? 1 : exactRoom ? 0.7 : 0.5,
          reasons: [
            ...(exactId ? ['exact_id'] : []),
            ...(exactRoom ? ['room_match'] : ['room_mismatch']),
          ],
        };
      });
    return {
      evidence,
      candidates,
      requiresReason: !roomMatches,
      exactMatch: roomMatches,
    };
  }

  private scannerIdentityEvidenceField(
    result: Record<string, unknown>,
    sourceField: string,
    field: 'cell' | 'prisoner_id',
  ): QueueSheetItem['identityEvidence'][number] | null {
    const raw = result[sourceField];
    if (!raw || typeof raw !== 'object') {
      return { field, status: 'blank', rawText: null, flags: [] };
    }
    const value = raw as Record<string, unknown>;
    const recognized = typeof value.value === 'string' && value.value.trim().length > 0;
    return {
      field,
      status: recognized ? 'recognized' : 'abstained',
      rawText: typeof value.raw_text === 'string'
        ? value.raw_text.slice(0, 500)
        : recognized ? String(value.value).slice(0, 500) : null,
      flags: Array.isArray(value.warnings) ? value.warnings.slice(0, 20).flatMap((warning) => {
        if (!warning || typeof warning !== 'object') return [];
        const code = (warning as Record<string, unknown>).code;
        return typeof code === 'string' ? [code] : [];
      }) : [],
    };
  }

  private scannerArtifacts(
    sheet: Sheet,
    jobs: ScannerArtifactJob[],
  ): NonNullable<QueueSheetItem['scannerEvidence']>['artifacts'] {
    const result = (sheet.resultJson ?? {}) as Record<string, unknown>;
    const declared = Array.isArray(result.artifacts) ? result.artifacts : [];
    const jobsById = new Map(jobs.map((job) => [job.artifactId, job]));
    return declared.slice(0, 24).flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const artifact = raw as Record<string, unknown>;
      const artifactId = typeof artifact.artifact_id === 'string' ? artifact.artifact_id : null;
      if (!artifactId) return [];
      const job = jobsById.get(artifactId);
      const state = job?.state ?? ScannerArtifactJobState.MISSING;
      return [{
        artifactId,
        kind: typeof artifact.kind === 'string' ? artifact.kind : 'unknown',
        mediaType: typeof artifact.media_type === 'string' ? artifact.media_type : 'application/octet-stream',
        fieldId: typeof artifact.field_id === 'string' ? artifact.field_id : null,
        rowIndex: typeof artifact.row_index === 'number' ? artifact.row_index : null,
        state,
        url: state === ScannerArtifactJobState.AVAILABLE
          ? `/scans/verify/${sheet.id}/artifacts/${encodeURIComponent(artifactId)}`
          : null,
      }];
    });
  }

  private storedIdentityEvidence(sheet: Sheet): QueueSheetItem['identityEvidence'] {
    const stored = sheet.identityEvidenceJson as { fields?: unknown[] } | null;
    if (!stored?.fields || !Array.isArray(stored.fields)) return [];
    return stored.fields.slice(0, 3).flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Record<string, unknown>;
      if (!['name', 'cell', 'prisoner_id'].includes(String(item.field)) ||
          !['recognized', 'blank', 'abstained', 'error'].includes(String(item.status))) return [];
      return [{
        field: item.field as 'name' | 'cell' | 'prisoner_id',
        status: item.status as 'recognized' | 'blank' | 'abstained' | 'error',
        rawText: typeof item.raw_text === 'string' ? item.raw_text.slice(0, 500) : null,
        flags: Array.isArray(item.flags) ? item.flags.slice(0, 20).map(String) : [],
      }];
    });
  }

  private storedCandidateIds(sheet: Sheet): string[] {
    const stored = sheet.rankedCandidatesJson as { candidates?: unknown[] } | null;
    if (!stored?.candidates || !Array.isArray(stored.candidates)) return [];
    return stored.candidates.slice(0, 10).flatMap((raw) => {
      const userId = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).userId : null;
      return typeof userId === 'string' ? [userId] : [];
    });
  }

  private async authorizedStoredCandidates(
    sheet: Sheet,
    actor: OperatorPublic,
  ): Promise<QueueSheetItem['rankedCandidates']> {
    const stored = sheet.rankedCandidatesJson as { candidates?: unknown[] } | null;
    if (!stored?.candidates || !Array.isArray(stored.candidates)) return [];
    const result: QueueSheetItem['rankedCandidates'] = [];
    for (const raw of stored.candidates.slice(0, 10)) {
      if (!raw || typeof raw !== 'object') continue;
      const candidate = raw as Record<string, unknown>;
      if (typeof candidate.userId !== 'string') continue;
      try {
        const user = await this.usersService.findByIdForActor(candidate.userId, actor);
        if (!user.isActive) continue;
        result.push({
          userId: user.id,
          legacyId: user.legacyId,
          name: user.name,
          zone: user.zone,
          cell: user.cell,
          score: typeof candidate.score === 'number' ? candidate.score : 0,
          reasons: Array.isArray(candidate.reasons) ? candidate.reasons.slice(0, 10).map(String) : [],
        });
      } catch {
        // Current authorization is authoritative; stale stored candidates disappear.
      }
    }
    return result;
  }

  private async assertSheetOwnerAccess(
    actor: OperatorPublic,
    userId: string,
    manager: EntityManager,
    lock = false,
  ): Promise<User> {
    try {
      return await this.zoneAccess.assertUserAccess(actor, userId, manager, lock);
    } catch (error) {
      if (error instanceof NotFoundException) throw this.sheetNotFound();
      throw error;
    }
  }

  private sheetNotFound(): NotFoundException {
    return new NotFoundException({ message: 'Sheet not found', code: 'SHEET.NOT_FOUND' });
  }

}
