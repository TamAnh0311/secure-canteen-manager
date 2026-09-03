import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { OmrOperationalFormMode, Sheet } from './sheet.entity';
import { SheetStatus } from './sheet-status.enum';
import { ScanStorageService } from './scan-storage.service';
import { OmrClientService, OmrPermanentError, OmrRetryableError, ProcessScanResult } from '../omr/omr-client.service';
import { UsersService } from '../users/users.service';
import { ThresholdConfigService } from '../config/threshold-config.service';
import { IssuedOmrForm, IssuedOmrFormStatus } from '../omr-forms/issued-omr-form.entity';
import { OmrFormTemplate } from '../omr-forms/omr-form-template.entity';
import { OmrFormMode } from '../omr-forms/omr-form-template.entity';
import { User } from '../users/user.entity';
import { parseOmrFormReference } from './omr-form-reference';
import { Operator } from '../operators/operator.entity';
import { toOperatorPublic } from '../operators/operator-public';
import { rankPrisonerCandidates } from './prisoner-identity-matcher';
import { ScanWorkflowModeService } from '../config/scan-workflow-mode.service';

const MAX_PROCESSING_ATTEMPTS = 3;

// In-process serial queue (promise chain, concurrency 1).
// Sufficient for <100 sheets/meal; no broker needed (KISS).
// Recovery-on-boot: pending/processing sheets are re-enqueued at startup.
@Injectable()
export class ScanProcessorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScanProcessorService.name);
  // The tail of the promise chain — each enqueue appends to this.
  private tail: Promise<void> = Promise.resolve();
  // Set to true during shutdown so in-flight processSheet calls skip DB writes after
  // the DataSource is destroyed, preventing "Driver not Connected" errors on close.
  private shutdownRequested = false;

  constructor(
    @InjectRepository(Sheet)
    private readonly repo: Repository<Sheet>,
    private readonly storage: ScanStorageService,
    private readonly omrClient: OmrClientService,
    private readonly usersService: UsersService,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly dataSource: DataSource,
    private readonly workflowMode: ScanWorkflowModeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.workflowMode.omrRuntimeEnabled) return;
    // Re-enqueue any sheets that were pending or stuck in processing at last shutdown.
    // Idempotent: processSheet checks status before doing any work.
    const stale = await this.repo.find({
      where: { status: In([SheetStatus.PENDING, SheetStatus.PROCESSING]) },
      select: ['id'],
    });
    const now = Date.now();
    for (const s of stale) {
      if (!s.nextRetryAt || s.nextRetryAt.getTime() <= now) this.enqueue(s.id);
    }
    if (stale.length > 0) {
      this.logger.log(`Re-enqueued ${stale.length} sheet(s) from previous run`);
    }
  }

  @Cron('*/30 * * * * *')
  async recoverDueWork(): Promise<void> {
    if (this.shutdownRequested || !this.workflowMode.omrRuntimeEnabled) return;
    const pending = await this.repo.find({ where: { status: SheetStatus.PENDING } });
    const now = Date.now();
    for (const sheet of pending) {
      if (!sheet.nextRetryAt || sheet.nextRetryAt.getTime() <= now) this.enqueue(sheet.id);
    }
  }

  // Signal shutdown: prevents further DB writes from in-flight queue items that
  // would otherwise attempt to use a destroyed DataSource.  Sheets that were
  // mid-processing stay in PENDING/PROCESSING state so the next boot's recovery
  // sweep re-drives them — this is the designed recovery path.
  onModuleDestroy(): void {
    this.shutdownRequested = true;
  }

  // Appends sheet processing to the serial promise chain.
  // The .catch is load-bearing: if processSheet ever rejects, an uncaught
  // rejection would poison `tail` and silently stall every subsequent sheet.
  // Swallowing it here keeps the queue draining; the failed sheet stays in its
  // last-saved state and is re-driven on the next boot recovery sweep.
  enqueue(sheetId: string): void {
    if (!this.workflowMode.omrRuntimeEnabled) return;
    this.tail = this.tail.then(() =>
      this.processSheet(sheetId).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Unhandled error processing sheet ${sheetId}: ${message}`);
      }),
    );
  }

  private async processSheet(id: string): Promise<void> {
    // After onModuleDestroy, skip all DB writes. The sheet stays in its current
    // state (PENDING or PROCESSING) and the next boot's recovery sweep re-drives it.
    if (this.shutdownRequested) return;

    let sheet: Sheet;
    try {
      sheet = await this.repo.findOneOrFail({ where: { id } });
    } catch {
      this.logger.warn(`Sheet ${id} not found during processing — skipping`);
      return;
    }

    // Skip if already in a terminal state (e.g. re-enqueued on boot but since resolved)
    const nonTerminal: SheetStatus[] = [SheetStatus.PENDING, SheetStatus.PROCESSING];
    if (!nonTerminal.includes(sheet.status)) return;

    sheet.status = SheetStatus.PROCESSING;
    await this.repo.save(sheet);

    // Recognition thresholds remain global, but geometry and row authority are
    // resolved from the immutable template attached to the raw QR token.
    const thresholds = await this.thresholdConfig.resolve();

    let omrResult: ProcessScanResult;
    let rawReference: string;
    let issuedForm: IssuedOmrForm | null = null;
    let resolvedTemplate: OmrFormTemplate;
    try {
      if (!sheet.imagePath) {
        await this.finalise(sheet, SheetStatus.REJECTED, ['IMAGE_NOT_AVAILABLE']);
        return;
      }
      const imageBase64 = this.storage.readImageAsBase64(sheet.imagePath);
      const identity = await this.omrClient.identifyFormToken(imageBase64);
      rawReference = identity.form_reference ?? identity.form_token ?? '';
      const reference = parseOmrFormReference(rawReference);
      if (!reference) {
        await this.finalise(
          sheet,
          SheetStatus.REJECTED,
          identity.flags.length > 0 ? identity.flags : ['QR_NOT_FOUND'],
        );
        return;
      }
      if (reference.kind === 'issued') {
        issuedForm = await this.dataSource.getRepository(IssuedOmrForm).findOne({
          where: { token: reference.issuedFormToken },
          relations: { template: { rows: true } },
          order: { template: { rows: { rowIndex: 'ASC' } } },
        });
        const preRecognitionFlag = this.invalidFormBeforeRecognition(issuedForm, sheet);
        if (preRecognitionFlag || !issuedForm) {
          await this.finalise(sheet, SheetStatus.REJECTED, [...identity.flags, preRecognitionFlag ?? 'FORM_TOKEN_NOT_FOUND']);
          return;
        }
        resolvedTemplate = issuedForm.template;
      } else {
        const template = await this.dataSource.getRepository(OmrFormTemplate).findOne({
          where: { id: reference.templateId },
          relations: { rows: true },
          order: { rows: { rowIndex: 'ASC' } },
        });
        const genericFlag = this.invalidGenericTemplateBeforeRecognition(template, sheet);
        if (genericFlag || !template) {
          await this.finalise(sheet, SheetStatus.REJECTED, [...identity.flags, genericFlag ?? 'GENERIC_TEMPLATE_NOT_FOUND']);
          return;
        }
        resolvedTemplate = template;
      }
      omrResult = await this.omrClient.processScan({
        image_base64: imageBase64,
        roi_template: resolvedTemplate.geometry,
        omr_thresholds: {
          empty_max: thresholds.omrEmptyMax,
          ticked_min: thresholds.omrTickedMin,
        },
        icr_threshold: thresholds.icrThreshold,
        digit_box_count: 0,
        ...(issuedForm
          ? { expected_form_token: rawReference }
          : { expected_form_reference: rawReference }),
      });
    } catch (err) {
      if (this.shutdownRequested) return;
      if (err instanceof OmrPermanentError) {
        sheet.lastErrorCode = err.code;
        sheet.rejectionCode = err.code;
        await this.finalise(sheet, SheetStatus.REJECTED, [err.code]);
        return;
      }
      const retryable = err instanceof OmrRetryableError
        ? err
        : new OmrRetryableError('OMR.SERVICE_UNAVAILABLE', err instanceof Error ? err.message : String(err));
      sheet.processingAttempts = (sheet.processingAttempts ?? 0) + 1;
      sheet.lastErrorCode = retryable.code;
      if (sheet.processingAttempts >= MAX_PROCESSING_ATTEMPTS) {
        sheet.nextRetryAt = null;
        sheet.rejectionCode = 'OMR_RETRY_EXHAUSTED';
        await this.finalise(sheet, SheetStatus.REJECTED, [retryable.code, 'OMR_RETRY_EXHAUSTED']);
        return;
      }
      sheet.status = SheetStatus.PENDING;
      sheet.processedAt = null;
      sheet.nextRetryAt = new Date(Date.now() + 1_000 * 2 ** sheet.processingAttempts);
      await this.repo.save(sheet);
      return;
    }

    // OMR call is the longest-running await; check shutdown before writing results to DB.
    if (this.shutdownRequested) return;

    const processedReference = omrResult.form_reference ?? omrResult.form_token;
    if (processedReference !== rawReference || omrResult.flags.includes('QR_TOKEN_MISMATCH')) {
      await this.finalise(sheet, SheetStatus.REJECTED, [...omrResult.flags, 'QR_TOKEN_MISMATCH']);
      return;
    }
    this.normalizeTemplateEvidence(omrResult, resolvedTemplate);
    if (omrResult.flags.includes('TEMPLATE_ROW_UNKNOWN')) {
      await this.finalise(sheet, SheetStatus.REJECTED, omrResult.flags);
      return;
    }

    // Step 4: store raw result fields
    sheet.resultJson = this.sanitizedResult(omrResult);
    sheet.avgConfidence = omrResult.avg_confidence;
    sheet.recognizedId = null;
    sheet.flags = omrResult.flags.length > 0 ? omrResult.flags : null;

    // Step 5: decision tree. A failed warp is unusable → reject. Every other recognized
    // sheet routes to the verify queue (FLAGGED): no order is created here. A warden
    // confirms each order on the verify screen so its balance debit always carries an
    // operator_id — a no-human auto-accept must never move money.
    if (!omrResult.warp_ok) {
      await this.finalise(sheet, SheetStatus.REJECTED, omrResult.flags);
      return;
    }

    if (issuedForm) {
      await this.resolveIssuedToken(
        sheet,
        issuedForm.token,
        omrResult.flags,
        resolvedTemplate.id,
      );
    } else {
      await this.resolveGenericTemplate(sheet, resolvedTemplate, omrResult);
    }
  }

  private sanitizedResult(result: ProcessScanResult): object {
    return {
      order_lines: result.order_lines,
      avg_confidence: result.avg_confidence,
      flags: result.flags,
      warp_ok: result.warp_ok,
      handwriting_fields: (result.handwriting_fields ?? []).map((field) => ({
        field: field.field,
        status: field.status,
        raw_text: field.raw_text?.slice(0, 500) ?? null,
        confidence: field.confidence,
        raw_score: field.raw_score,
        flags: field.flags.slice(0, 20),
      })),
      handwriting_model: result.handwriting_model ?? null,
    };
  }

  private invalidGenericTemplateBeforeRecognition(template: OmrFormTemplate | null, sheet: Sheet): string | null {
    if (!template) return 'GENERIC_TEMPLATE_NOT_FOUND';
    if (sheet.admittedMode !== OmrOperationalFormMode.GENERIC) return 'GENERIC_MODE_MISMATCH';
    if (!template.isActive || template.retiredAt) return 'GENERIC_TEMPLATE_RETIRED';
    return null;
  }

  private async resolveGenericTemplate(
    sheet: Sheet,
    template: OmrFormTemplate,
    omrResult: ProcessScanResult,
  ): Promise<void> {
    const evidence = omrResult.handwriting_fields ?? [];
    const cellText = evidence.find((field) => field.field === 'cell' && field.status === 'recognized')?.raw_text;
    const operator = sheet.admittedBy
      ? await this.dataSource.getRepository(Operator).findOne({ where: { id: sheet.admittedBy } })
      : null;
    const authorizedCandidates = operator?.isActive && cellText
      ? await this.usersService.findActiveByExactCell(cellText, toOperatorPublic(operator))
      : [];
    const match = rankPrisonerCandidates(evidence, authorizedCandidates);

    await this.dataSource.transaction(async (em) => {
      const lockedTemplate = await em.findOne(OmrFormTemplate, {
        where: { id: template.id },
        lock: { mode: 'pessimistic_read' },
      });
      const lockedSheet = await em.findOne(Sheet, {
        where: { id: sheet.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedSheet) return;
      lockedSheet.resultJson = sheet.resultJson;
      lockedSheet.avgConfidence = sheet.avgConfidence;
      lockedSheet.recognizedId = null;
      lockedSheet.flags = [...new Set([...(sheet.flags ?? []), ...match.flags])];
      if (!lockedTemplate || !lockedTemplate.isActive || lockedTemplate.retiredAt ||
          lockedTemplate.revision !== template.revision || lockedTemplate.geometryHash !== template.geometryHash) {
        this.rejectSheet(lockedSheet, [...(lockedSheet.flags ?? []), 'GENERIC_TEMPLATE_RETIRED']);
        await em.save(Sheet, lockedSheet);
        return;
      }
      if (lockedSheet.admittedMode !== OmrOperationalFormMode.GENERIC || lockedSheet.issuedFormId) {
        this.rejectSheet(lockedSheet, [...(lockedSheet.flags ?? []), 'GENERIC_MODE_MISMATCH']);
        await em.save(Sheet, lockedSheet);
        return;
      }
      lockedSheet.templateId = lockedTemplate.id;
      lockedSheet.identityEvidenceJson = {
        fields: evidence,
        model: omrResult.handwriting_model ?? null,
        evidenceFingerprint: match.evidenceFingerprint,
      };
      lockedSheet.rankedCandidatesJson = { candidates: match.candidates };
      lockedSheet.identityRouteZone = operator?.isActive ? operator.zone?.trim() || null : null;
      lockedSheet.proposedUserId = null;
      lockedSheet.matchedUserId = null;
      lockedSheet.orderId = null;
      lockedSheet.status = SheetStatus.FLAGGED;
      lockedSheet.processedAt = new Date();
      lockedSheet.nextRetryAt = null;
      await em.save(Sheet, lockedSheet);
    });
  }

  private normalizeTemplateEvidence(result: ProcessScanResult, template: OmrFormTemplate): void {
    if (template.mode !== OmrFormMode.FULL_LIST) return;
    const rows = new Map((template.rows ?? []).map((row) => [row.rowIndex, row]));
    for (const line of result.order_lines) {
      const row = rows.get(line.line_index);
      if (!row) {
        result.flags = [...new Set([...result.flags, 'TEMPLATE_ROW_UNKNOWN'])];
        continue;
      }
      line.menu_item_id = row.menuItemId;
      line.code_snapshot = row.codeSnapshot;
      line.name_snapshot = row.shortLabelSnapshot;
    }
  }

  private async resolveIssuedToken(
    sheet: Sheet,
    token: string,
    flags: string[],
    expectedTemplateId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      // The form serializes every workflow for one physical token before any sheet lock.
      // Confirmation uses the same form -> sheet order, so this conflict path may safely
      // update the previously reserved sheet without creating a form/sheet wait cycle.
      const form = await em.findOne(IssuedOmrForm, {
        where: { token },
        lock: { mode: 'pessimistic_write' },
      });
      const lockedSheet = await em.findOne(Sheet, {
        where: { id: sheet.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedSheet) return;
      lockedSheet.resultJson = sheet.resultJson;
      lockedSheet.avgConfidence = sheet.avgConfidence;
      lockedSheet.recognizedId = sheet.recognizedId;
      lockedSheet.flags = sheet.flags;

      // PostgreSQL cannot apply FOR UPDATE to the nullable side of the LEFT JOIN
      // generated by `relations: { user: true }`. Lock the authoritative form row
      // first, then load its owner separately inside the same transaction.
      const owner = form
        ? await em.findOne(User, {
            where: { id: form.userId },
            lock: { mode: 'pessimistic_read' },
          })
        : null;
      const invalidFlag = this.invalidFormFlag(
        form,
        owner,
        lockedSheet,
        expectedTemplateId,
      );
      if (invalidFlag || !form) {
        this.rejectSheet(lockedSheet, [...flags, invalidFlag ?? 'FORM_TOKEN_NOT_FOUND']);
        await em.save(Sheet, lockedSheet);
        return;
      }

      if (form.reservedSheetId && form.reservedSheetId !== lockedSheet.id) {
        form.status = IssuedOmrFormStatus.VOID;
        form.voidReason = 'TOKEN_CHECKSUM_CONFLICT';
        form.voidedAt = new Date();
        const candidates = await em.find(Sheet, { where: { issuedFormId: token } });
        if (!candidates.some((candidate) => candidate.id === lockedSheet.id)) candidates.push(lockedSheet);
        for (const candidate of candidates) {
          candidate.issuedFormId = candidate.issuedFormId ?? token;
          this.rejectSheet(candidate, [...(candidate.flags ?? []), 'FORM_TOKEN_CONFLICT']);
          await em.save(Sheet, candidate);
        }
        await em.save(IssuedOmrForm, form);
        return;
      }

      form.reservedSheetId = lockedSheet.id;
      lockedSheet.issuedFormId = form.token;
      lockedSheet.matchedUserId = form.userId;
      lockedSheet.recognizedId = null;
      lockedSheet.status = SheetStatus.FLAGGED;
      lockedSheet.flags = flags.length > 0 ? flags : null;
      lockedSheet.processedAt = new Date();
      lockedSheet.nextRetryAt = null;
      await em.save(IssuedOmrForm, form);
      await em.save(Sheet, lockedSheet);
    });
  }

  private invalidFormBeforeRecognition(form: IssuedOmrForm | null, sheet: Sheet): string | null {
    if (!form) return 'FORM_TOKEN_NOT_FOUND';
    if (form.status === IssuedOmrFormStatus.VOID) return 'FORM_TOKEN_VOID';
    if (form.status === IssuedOmrFormStatus.CONSUMED) return 'FORM_TOKEN_CONSUMED';
    if (form.serviceDate !== sheet.serviceDate) return 'FORM_TOKEN_DATE_MISMATCH';
    if (!form.template || form.templateId !== form.template.id || form.formMode !== form.template.mode) {
      return 'FORM_TOKEN_TEMPLATE_MISMATCH';
    }
    return null;
  }

  private invalidFormFlag(
    form: IssuedOmrForm | null,
    owner: User | null,
    sheet: Sheet,
    expectedTemplateId: string,
  ): string | null {
    if (!form) return 'FORM_TOKEN_NOT_FOUND';
    if (form.status === IssuedOmrFormStatus.VOID) return 'FORM_TOKEN_VOID';
    if (form.status === IssuedOmrFormStatus.CONSUMED) return 'FORM_TOKEN_CONSUMED';
    if (form.serviceDate !== sheet.serviceDate) return 'FORM_TOKEN_DATE_MISMATCH';
    if (form.templateId !== expectedTemplateId) {
      return 'FORM_TOKEN_TEMPLATE_MISMATCH';
    }
    if (!owner?.isActive) return 'FORM_TOKEN_USER_INACTIVE';
    return null;
  }

  private rejectSheet(sheet: Sheet, flags: string[]): void {
    sheet.status = SheetStatus.REJECTED;
    sheet.matchedUserId = null;
    sheet.orderId = null;
    sheet.flags = [...new Set(flags)];
    sheet.rejectionCode = sheet.flags.at(-1) ?? null;
    sheet.processedAt = new Date();
    sheet.nextRetryAt = null;
  }

  private async finalise(sheet: Sheet, status: SheetStatus, flags: string[]): Promise<void> {
    sheet.status = status;
    sheet.processedAt = new Date();
    sheet.nextRetryAt = null;
    if (flags.length > 0) {
      sheet.flags = flags;
    }
    await this.repo.save(sheet);
  }
}
