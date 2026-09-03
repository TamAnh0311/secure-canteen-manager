import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Sheet } from './sheet.entity';
import { SheetStatus } from './sheet-status.enum';
import { ScanStorageService } from './scan-storage.service';
import {
  ThresholdConfigService,
} from '../config/threshold-config.service';
import { User } from '../users/user.entity';
import { OrderLineResult } from '../omr/omr-client.service';
import { tomorrowInDeployTz } from '../common/today-in-tz';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../omr-forms/issued-omr-form.entity';
// Reuse the embedded demo scan asset (a real warped form PNG) so the synthetic
// record renders a believable image on the verify screen with no scanner needed.
import { DEMO_FORM_PNG_BASE64 } from '../database/seeds/demo-assets';
import { OmrFormMode, OmrFormTemplate } from '../omr-forms/omr-form-template.entity';
import { acquireOmrCatalogLock } from '../menu/menu.service';
import { OperatorPublic } from '../operators/operator-public';
import { OperatorZoneAccessService } from '../auth/operator-zone-access.service';
import { ScanWorkflowModeService } from '../config/scan-workflow-mode.service';

const FLAGGED_AVG_CONFIDENCE = 0.72;
const HIGH_CONFIDENCE = 0.96;
const DEMO_SOURCE = 'demo';
const SYNTHETIC_BYPASS_FLAG = 'DEMO_SYNTHETIC_BYPASS';

// Numeric 3-width demo codes that resolve through the exact-string resolver.
// These must match the numeric codes seeded in demo-seed.ts MENU_CODES.
const DEMO_LINE_CODES = ['001', '002'];

@Injectable()
export class DemoScanService {
  private readonly logger = new Logger(DemoScanService.name);

  constructor(
    private readonly storage: ScanStorageService,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly dataSource: DataSource,
    private readonly zoneAccess: OperatorZoneAccessService,
    private readonly workflowMode: ScanWorkflowModeService,
  ) {}

  // This is an explicit scanner bypass for the demo UX. It still mints the same v3
  // issued-form authority required by the real verify/confirm path.
  async createDemoRecord(actor: OperatorPublic): Promise<Sheet> {
    this.workflowMode.assertOmrIntakeEnabled();
    if (!actor?.id) {
      throw new BadRequestException({
        message: 'Authenticated operator is required for demo generation',
        code: 'DEMO.OPERATOR_REQUIRED',
      });
    }

    const id = randomUUID();
    const sheetId = `DEMO-${id.slice(0, 8).toUpperCase()}`;
    const checksum = `demo-${id}`;
    const serviceDate = tomorrowInDeployTz();
    const formToken = randomUUID();

    const saved = await this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      // The bundled demo bitmap is the retired A4 v3 asset. Bind it only to that
      // exact immutable template so Verify overlays can never claim A5 geometry.
      const template = await manager.findOne(OmrFormTemplate, {
        where: { revision: 'a4-code-v3' },
        lock: { mode: 'pessimistic_read' },
      });
      if (!template) {
        throw new ConflictException({
          message: 'An OMR code template is required before generating a demo scan',
          code: 'DEMO.TEMPLATE_NOT_READY',
        });
      }
      // An unconsumed issued form is unique per user/service date. Excluding those
      // users keeps repeated demo clicks useful.
      const candidateQuery = manager
        .getRepository(User)
        .createQueryBuilder('candidate')
        .where('candidate.isActive = :active', { active: true })
        .andWhere('candidate.source = :source', { source: DEMO_SOURCE })
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM issued_omr_forms issued
            WHERE issued.user_id = candidate.id
              AND issued.service_date = :serviceDate
              AND issued.status = :issuedStatus
          )`,
          { serviceDate, issuedStatus: IssuedOmrFormStatus.ISSUED },
        )
        .orderBy('RANDOM()');
      this.zoneAccess.scopeByUser(candidateQuery, actor, 'candidate.zone');
      const user = await candidateQuery.getOne();

      // Keep this guard even though the query is source-scoped: a synthetic endpoint
      // must never debit a synchronized production identity.
      if (!user || !user.isActive || user.source !== DEMO_SOURCE) {
        throw new NotFoundException({
          message: 'No active demo prisoner is available for this service date',
          code: 'DEMO.NO_AVAILABLE_USER',
        });
      }

      // Use the same serialization key as normal form issuance. Recheck after the
      // lock because another issuer may have reserved this identity after selection.
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${user.id}:${serviceDate}`],
      );
      await this.zoneAccess.assertUserAccess(actor, user.id, manager);
      const existingAuthority = await manager.findOne(IssuedOmrForm, {
        where: {
          userId: user.id,
          serviceDate,
          status: IssuedOmrFormStatus.ISSUED,
        },
      });
      if (existingAuthority) {
        throw new ConflictException({
          message: 'The selected demo prisoner was reserved concurrently; try again',
          code: 'DEMO.USER_RESERVED',
        });
      }

      // The cache uses the same sheet id + ROI key as Verify, but no scanner or OMR
      // service is invoked. Files are written inside the transaction so a storage
      // failure cannot leave form authority or a sheet row behind.
      const imagePath = await this.storage.saveImage(
        id,
        Buffer.from(DEMO_FORM_PNG_BASE64, 'base64'),
        'png',
      );
      await this.storage.saveWarpedImage(
        id,
        DEMO_FORM_PNG_BASE64,
        `${template.id}:${template.geometryHash}`,
      );

      const form = manager.create(IssuedOmrForm, {
        token: formToken,
        userId: user.id,
        serviceDate,
        roiVersion: template.revision,
        templateId: template.id,
        formMode: OmrFormMode.CODE,
        issuedBy: actor.id,
        status: IssuedOmrFormStatus.ISSUED,
        consumedSheetId: null,
        reservedSheetId: null,
        voidReason: null,
        consumedAt: null,
        voidedAt: null,
      });
      const sheet = manager.create(Sheet, {
        id,
        sheetId,
        batch: 'DEMO',
        serviceDate,
        checksum,
        imagePath,
        status: SheetStatus.FLAGGED,
        avgConfidence: FLAGGED_AVG_CONFIDENCE,
        recognizedId: null,
        matchedUserId: user.id,
        flags: [SYNTHETIC_BYPASS_FLAG],
        resultJson: this.buildResult(),
        issuedFormId: formToken,
        processedAt: new Date(),
      });

      // The schema intentionally has FKs in both directions. Insert the authority,
      // insert its sheet, then reserve that sheet, all before the transaction commits.
      await manager.save(IssuedOmrForm, form);
      const savedSheet = await manager.save(Sheet, sheet);
      form.reservedSheetId = id;
      await manager.save(IssuedOmrForm, form);
      return savedSheet;
    });

    this.logger.log(`Generated demo OMR record ${sheetId} for ${saved.serviceDate}`);
    return saved;
  }

  private buildResult(): { order_lines: OrderLineResult[] } {
    const order_lines: OrderLineResult[] = DEMO_LINE_CODES.map((code, line_index) => ({
      line_index,
      code,
      qty: line_index === 0 ? 2 : 1,
      code_digits: code.split('').map((c, index) => ({
        index,
        value: Number(c),
        confidence: HIGH_CONFIDENCE,
      })),
      qty_digits: [{ index: 0, value: line_index === 0 ? 2 : 1, confidence: HIGH_CONFIDENCE }],
      flags: [],
    }));

    return { order_lines };
  }
}
