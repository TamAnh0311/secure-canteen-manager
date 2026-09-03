import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { Sheet } from './sheet.entity';
import { SheetStatus } from './sheet-status.enum';
import { ScanStorageService } from './scan-storage.service';
import { ScanProcessorService } from './scan-processor.service';
import { tomorrowInDeployTz } from '../common/today-in-tz';
import { ScanImageValidatorService } from './scan-image-validator.service';
import { OmrClientService, OmrPermanentError } from '../omr/omr-client.service';
import { ScanAdmissionService } from './scan-admission.service';
import { OperatorPublic } from '../operators/operator-public';
import { OperatorZoneAccessService } from '../auth/operator-zone-access.service';
import { IssuedOmrForm } from '../omr-forms/issued-omr-form.entity';
import { User } from '../users/user.entity';
import { OmrOperationalModeService } from '../omr-forms/omr-operational-mode.service';
import { OmrOperationalFormMode, ScanAdmissionSource } from './sheet.entity';
import { ScanWorkflowModeService } from '../config/scan-workflow-mode.service';
import { MenuService } from '../menu/menu.service';
import { ScannerArtifactJob } from './webhook/scanner-artifact-job.entity';
import { evaluateScannerReviewState, scannerCatalogueVersion } from './scanner-review-state';
import { normalizeCellV1 } from '../users/cell-normalization';
import { scannerOperatorScopeSql } from './scanner-zone-routing';

export interface SubmitScanInput {
  sheetId: string;
  batch?: string;
  checksum: string;
  imageBase64: string;
  credentialId?: string;
}

// Inclusive service_date range; both bounds optional so the controller can default to today.
export interface ListScansFilter {
  dateFrom?: string;
  dateTo?: string;
  status?: SheetStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class ScansService {
  constructor(
    @InjectRepository(Sheet)
    private readonly repo: Repository<Sheet>,
    private readonly storage: ScanStorageService,
    private readonly processor: ScanProcessorService,
    private readonly validator: ScanImageValidatorService,
    private readonly zoneAccess: OperatorZoneAccessService,
    private readonly workflowMode: ScanWorkflowModeService,
    private readonly menuService: MenuService,
    private readonly omrClient?: OmrClientService,
    private readonly admission?: ScanAdmissionService,
    private readonly operationalMode?: OmrOperationalModeService,
  ) {}

  // Idempotent submit: duplicate checksum returns 409, new sheet returns 202.
  async submit(input: SubmitScanInput): Promise<Sheet> {
    this.workflowMode.assertOmrIntakeEnabled();
    const leave = this.admission ? await this.admission.enter(input.credentialId ?? 'operator') : () => undefined;
    try {
      return await this.submitAdmitted(input);
    } finally {
      leave();
    }
  }

  private async submitAdmitted(input: SubmitScanInput): Promise<Sheet> {
    const admittedAt = new Date();
    const admissionSource = input.credentialId?.startsWith('operator:')
      ? ScanAdmissionSource.BROWSER
      : ScanAdmissionSource.AGENT;
    const admittedMode = this.operationalMode?.mode ?? OmrOperationalFormMode.ISSUED;
    const admittedBy = admissionSource === ScanAdmissionSource.BROWSER
      ? input.credentialId!.slice('operator:'.length)
      : null;
    this.operationalMode?.assertAdmissionSource(admissionSource);
    const validated = this.validator.validate({ imageBase64: input.imageBase64, checksum: input.checksum });
    if (this.omrClient) {
      try {
        await this.omrClient.preflightImage(input.imageBase64);
      } catch (error) {
        if (error instanceof OmrPermanentError) {
          throw new BadRequestException({ message: error.message, code: error.code });
        }
        throw new ServiceUnavailableException({ message: 'OMR image preflight is unavailable', code: 'OMR.SERVICE_UNAVAILABLE' });
      }
    }

    const existing = await this.repo.findOne({ where: { checksum: input.checksum } });
    if (existing) {
      throw this.duplicateConflict(existing);
    }

    const imagePath = await this.storage.saveImage(input.checksum, validated.bytes, validated.format);

    const sheet = this.repo.create({
      sheetId: input.sheetId,
      batch: input.batch ?? null,
      // Server-stamped collection date in the deploy timezone: the NEXT day. A sheet
      // received on day D feeds the order a warden confirms for delivery on D+1, so the
      // sheet (and that order) bucket to tomorrow's local calendar day, not today's.
      admittedAt,
      admissionSource,
      admittedMode,
      admittedGeneration: this.operationalMode?.generation ?? 'issued-v1',
      admittedBy,
      serviceDate: tomorrowInDeployTz(admittedAt),
      checksum: input.checksum,
      imagePath,
      status: SheetStatus.PENDING,
    });

    let saved: Sheet;
    try {
      saved = await this.repo.save(sheet);
    } catch (err) {
      // Two identical submits raced past the findOne check (the crash/power-loss
      // re-upload the idempotency key targets). The unique checksum index rejected
      // the loser; re-resolve to the winning row and return the same 409 the happy
      // dedup path returns, rather than leaking a 500.
      if (err instanceof QueryFailedError && this.isUniqueViolation(err)) {
        const winner = await this.repo.findOne({ where: { checksum: input.checksum } });
        if (winner) throw this.duplicateConflict(winner);
      }
      // Do not unlink the checksum final here. Another transaction with the same checksum
      // may still commit after our visibility check and shares this exact path. Stale
      // unreferenced finals are removed later by grace-period storage reconciliation.
      throw err;
    }

    // Enqueue asynchronously — never throws into the request path
    this.processor.enqueue(saved.id);

    return saved;
  }

  private duplicateConflict(existing: Sheet): ConflictException {
    return new ConflictException({
      message: 'Duplicate scan: sheet already submitted',
      code: 'SHEET.DEDUP_CONFLICT',
      sheetId: existing.sheetId,
      status: existing.status,
      id: existing.id,
    });
  }

  private isUniqueViolation(err: QueryFailedError): boolean {
    // Postgres SQLSTATE 23505 = unique_violation
    return (err.driverError as { code?: string })?.code === '23505';
  }

  async findAll(filter: ListScansFilter, actor: OperatorPublic): Promise<Sheet[]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .leftJoin(IssuedOmrForm, 'issued_owner', 'issued_owner.token = s.issued_form_id')
      .leftJoin(User, 'sheet_owner', 'sheet_owner.id = issued_owner.user_id')
      .leftJoin(User, 'matched_owner', 'matched_owner.id = s.matched_user_id')
      .orderBy('s.createdAt', 'DESC')
      .take(filter.limit)
      .skip(filter.offset);
    this.scopeVisibleSheets(qb, actor);

    // Inclusive service_date range (both bounds optional; caller defaults to today).
    if (filter.dateFrom) {
      qb.andWhere('s.service_date >= :dateFrom', { dateFrom: filter.dateFrom });
    }
    if (filter.dateTo) {
      qb.andWhere('s.service_date <= :dateTo', { dateTo: filter.dateTo });
    }
    if (filter.status) {
      qb.andWhere('s.status = :status', { status: filter.status });
    }

    const sheets = await qb.getMany();
    await this.decorateScannerReviewState(sheets);
    return sheets;
  }

  async findOne(id: string, actor: OperatorPublic): Promise<Sheet> {
    const qb = this.repo
      .createQueryBuilder('s')
      .leftJoin(IssuedOmrForm, 'issued_owner', 'issued_owner.token = s.issued_form_id')
      .leftJoin(User, 'sheet_owner', 'sheet_owner.id = issued_owner.user_id')
      .leftJoin(User, 'matched_owner', 'matched_owner.id = s.matched_user_id')
      .where('s.id = :id', { id });
    this.scopeVisibleSheets(qb, actor);
    const sheet = await qb.getOne();
    if (!sheet) throw new NotFoundException({ message: 'Sheet not found', code: 'SHEET.NOT_FOUND' });
    await this.decorateScannerReviewState([sheet]);
    return sheet;
  }

  // Sheet counts grouped by status across an inclusive service_date range (both bounds
  // default to tomorrow in the deploy timezone — the next collection day sheets are
  // stamped for), so the monitor dashboard opens on the day being built toward.
  async getKpi(
    actor: OperatorPublic,
    dateFrom: string = tomorrowInDeployTz(),
    dateTo: string = dateFrom,
  ): Promise<Record<string, number>> {
    const qb = this.repo
      .createQueryBuilder('s')
      .leftJoin(IssuedOmrForm, 'issued_owner', 'issued_owner.token = s.issued_form_id')
      .leftJoin(User, 'sheet_owner', 'sheet_owner.id = issued_owner.user_id')
      .leftJoin(User, 'matched_owner', 'matched_owner.id = s.matched_user_id')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .where('s.service_date >= :dateFrom', { dateFrom })
      .andWhere('s.service_date <= :dateTo', { dateTo })
      .groupBy('s.status');
    this.scopeVisibleSheets(qb, actor);
    const rows = await qb.getRawMany<{ status: string; cnt: string }>();

    const kpi: Record<string, number> = {
      pending: 0,
      processing: 0,
      autoAccepted: 0,
      flagged: 0,
      rejected: 0,
      verified: 0,
      ready: 0,
      needsReview: 0,
      integrityFault: 0,
    };

    const statusMap: Record<string, string> = {
      [SheetStatus.PENDING]: 'pending',
      [SheetStatus.PROCESSING]: 'processing',
      [SheetStatus.AUTO_ACCEPTED]: 'autoAccepted',
      [SheetStatus.FLAGGED]: 'flagged',
      [SheetStatus.REJECTED]: 'rejected',
      [SheetStatus.VERIFIED]: 'verified',
    };

    for (const row of rows) {
      const key = statusMap[row.status];
      if (key) kpi[key] = Number(row.cnt);
    }

    const scannerQuery = this.repo
      .createQueryBuilder('s')
      .leftJoin(IssuedOmrForm, 'issued_owner', 'issued_owner.token = s.issued_form_id')
      .leftJoin(User, 'sheet_owner', 'sheet_owner.id = issued_owner.user_id')
      .leftJoin(User, 'matched_owner', 'matched_owner.id = s.matched_user_id')
      .where('s.service_date >= :dateFrom', { dateFrom })
      .andWhere('s.service_date <= :dateTo', { dateTo })
      .andWhere("s.admitted_mode = 'scanner'")
      .andWhere('s.status = :scannerStatus', { scannerStatus: SheetStatus.FLAGGED });
    this.scopeVisibleSheets(scannerQuery, actor);
    const scannerSheets = await scannerQuery.getMany();
    await this.decorateScannerReviewState(scannerSheets);
    for (const sheet of scannerSheets) {
      if (sheet.scannerReviewState === 'ready') kpi.ready += 1;
      else if (sheet.scannerReviewState === 'evidence_fault') kpi.integrityFault += 1;
      else kpi.needsReview += 1;
    }

    return kpi;
  }

  private scopeVisibleSheets(
    qb: ReturnType<Repository<Sheet>['createQueryBuilder']>,
    actor: OperatorPublic,
  ): void {
    const zone = this.zoneAccess.requireOperatorZone(actor);
    if (zone === null) return;
    qb.andWhere(`(
      (s.issued_form_id IS NOT NULL AND BTRIM(sheet_owner.zone) = :scanActorZone)
      OR
      (s.issued_form_id IS NULL AND s.template_id IS NOT NULL AND (
        (s.matched_user_id IS NOT NULL AND BTRIM(matched_owner.zone) = :scanActorZone)
        OR
        (s.matched_user_id IS NULL AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(s.ranked_candidates_json->'candidates', '[]'::jsonb)) candidate
          JOIN users candidate_user ON candidate_user.id = (candidate->>'userId')::uuid
          WHERE candidate_user.is_active = true
            AND BTRIM(candidate_user.zone) = :scanActorZone
        ))
      ))
      OR
      (s.admitted_mode = 'scanner' AND (
        (s.matched_user_id IS NOT NULL AND BTRIM(matched_owner.zone) = :scanActorZone)
        OR ${scannerOperatorScopeSql('s', 'scanActorZone')}
      ))
    )`, { scanActorZone: zone });
  }

  private async decorateScannerReviewState(sheets: Sheet[]): Promise<void> {
    const scannerSheets = sheets.filter((sheet) => sheet.admittedMode === OmrOperationalFormMode.SCANNER);
    if (scannerSheets.length === 0) return;
    const menuItems = await this.menuService.listAll();
    const currentCatalogueVersion = scannerCatalogueVersion(menuItems);
    const eventIds = scannerSheets.map((sheet) => sheet.scannerEventId).filter((id): id is string => Boolean(id));
    const jobs = eventIds.length > 0
      ? await this.repo.manager.getRepository(ScannerArtifactJob).find({ where: { eventId: In(eventIds) } })
      : [];
    const jobsByEvent = new Map<string, ScannerArtifactJob[]>();
    for (const job of jobs) jobsByEvent.set(job.eventId, [...(jobsByEvent.get(job.eventId) ?? []), job]);

    const legacyIds = new Set<string>();
    const normalizedRooms = new Set<string>();
    for (const sheet of scannerSheets) {
      const result = (sheet.resultJson ?? {}) as Record<string, unknown>;
      const legacyId = scannerFieldValue(result, 'ma_luu_ky');
      const room = normalizeCellV1(scannerFieldValue(result, 'buong_giam'));
      if (legacyId && /^\d{6}$/.test(legacyId)) legacyIds.add(legacyId);
      if (room) normalizedRooms.add(room);
    }
    const userWhere = [
      ...(legacyIds.size > 0 ? [{ isActive: true, legacyId: In([...legacyIds]) }] : []),
      ...(normalizedRooms.size > 0 ? [{
        isActive: true,
        normalizedCell: In([...normalizedRooms]),
        cellNormalizationVersion: 1,
      }] : []),
    ];
    const users = userWhere.length > 0
      ? await this.repo.manager.getRepository(User).find({ where: userWhere })
      : [];

    for (const sheet of scannerSheets) {
      const result = (sheet.resultJson ?? {}) as Record<string, unknown>;
      const legacyId = scannerFieldValue(result, 'ma_luu_ky');
      const room = normalizeCellV1(scannerFieldValue(result, 'buong_giam'));
      const identityExactMatch = Boolean(legacyId && room && users.some((user) =>
        user.isActive && user.legacyId === legacyId && user.normalizedCell === room));
      const evaluation = evaluateScannerReviewState({
        result,
        identityExactMatch,
        menuItems,
        artifactJobs: jobsByEvent.get(sheet.scannerEventId ?? '') ?? [],
        currentCatalogueVersion,
      });
      sheet.scannerReviewState = evaluation.state;
      sheet.scannerReviewBlockers = evaluation.blockers;
    }
  }
}

function scannerFieldValue(result: Record<string, unknown>, field: string): string | null {
  const raw = result[field];
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>).value;
  return typeof value === 'string' ? value.trim() : null;
}
