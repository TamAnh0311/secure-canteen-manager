import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppEnv } from '../src/config/env-validation';
import {
  ScanWorkflowMode,
  ScanWorkflowModeService,
} from '../src/config/scan-workflow-mode.service';
import { OperatorRole } from '../src/operators/operator.entity';
import { OmrOperationalFormMode, ScanAdmissionSource, Sheet } from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';
import { ScannerWebhookEvent } from '../src/scans/webhook/scanner-webhook-event.entity';
import { ScannerWebhookAuthGuard } from '../src/scans/webhook/scanner-webhook-auth.guard';
import {
  createE2EApp,
  E2EContext,
  login,
  seedOperator,
  today,
  truncate,
} from './setup/e2e-bootstrap';

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MENU_ITEM_ID = '33333333-3333-4333-8333-333333333333';

function workflowMode(mode: ScanWorkflowMode): ScanWorkflowModeService {
  return new ScanWorkflowModeService({
    get: jest.fn().mockReturnValue(mode),
  } as unknown as ConfigService<AppEnv, true>);
}

function callback(suffix: string) {
  return {
    event_id: `evt_${suffix}`,
    event_type: 'order_scan.result',
    idempotency_key: `order-scanner/v1/doc_${suffix}/1`,
    occurred_at: new Date().toISOString(),
    schema_version: '1.0-draft',
    result: {
      result_id: `result_${suffix}`,
      document_id: `doc_${suffix}`,
      page_index: 0,
      revision: 1,
      service_date: today(),
      outcome: 'accepted',
      ma_luu_ky: { value: '000001' },
      buong_giam: { value: 'A1' },
      items: [],
      artifacts: [],
      warnings: [],
      versions: { catalogue: 'mode-matrix-test' },
    },
  };
}

async function open(mode: ScanWorkflowMode): Promise<{
  app: INestApplication;
  ctx: E2EContext;
  dataSource: DataSource;
  token: string;
}> {
  const ctx = await createE2EApp({
    configure: (builder) => {
      builder.overrideGuard(ScannerWebhookAuthGuard).useValue({ canActivate: () => true });
      builder.overrideProvider(ScanWorkflowModeService).useValue(workflowMode(mode));
    },
  });
  const dataSource = ctx.dataSource;
  await truncate(dataSource, [
    'scanner_artifact_jobs',
    'sheets',
    'scanner_webhook_events',
    'issued_omr_forms',
    'operators',
  ]);
  await seedOperator(dataSource, `mode-${mode}`, OperatorRole.ADMIN);
  return {
    app: ctx.app,
    ctx,
    dataSource,
    token: await login(ctx.app, `mode-${mode}`),
  };
}

async function close(app: INestApplication, dataSource: DataSource): Promise<void> {
  await truncate(dataSource, [
    'scanner_artifact_jobs',
    'sheets',
    'scanner_webhook_events',
    'issued_omr_forms',
    'operators',
  ]);
  await app.close();
}

function postCallback(app: INestApplication, suffix: string) {
  const payload = callback(suffix);
  return request(app.getHttpServer())
    .post('/webhooks/order-scanner')
    .set('Idempotency-Key', payload.idempotency_key)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(payload));
}

async function seedStaleReviewSheet(dataSource: DataSource, mode: OmrOperationalFormMode): Promise<Sheet> {
  return dataSource.getRepository(Sheet).save(dataSource.getRepository(Sheet).create({
    id: SHEET_ID,
    sheetId: `MODE-${mode}`,
    batch: null,
    serviceDate: today(),
    checksum: mode === OmrOperationalFormMode.SCANNER ? 'a'.repeat(64) : 'b'.repeat(64),
    imagePath: null,
    status: SheetStatus.FLAGGED,
    resultJson: { items: [], artifacts: [], versions: {} },
    avgConfidence: null,
    recognizedId: null,
    matchedUserId: null,
    issuedFormId: null,
    templateId: null,
    admittedAt: new Date(),
    admissionSource: mode === OmrOperationalFormMode.SCANNER
      ? ScanAdmissionSource.SCANNER
      : ScanAdmissionSource.AGENT,
    admittedMode: mode,
    admittedGeneration: 'mode-matrix-test',
    admittedBy: null,
    scannerEventId: null,
    orderId: null,
    flags: null,
    processedAt: new Date(),
  }));
}

describe('Scan workflow mode direct API matrix (e2e)', () => {
  it('legacy_omr stores scanner receipts only and rejects stale scanner confirmation', async () => {
    const { app, dataSource, token } = await open('legacy_omr');
    try {
      await postCallback(app, 'legacy_store_only').expect(202);
      expect(await dataSource.getRepository(ScannerWebhookEvent).count()).toBe(1);
      expect(await dataSource.getRepository(Sheet).count()).toBe(0);

      const sheet = await seedStaleReviewSheet(dataSource, OmrOperationalFormMode.SCANNER);
      const response = await request(app.getHttpServer())
        .post(`/scans/verify/${sheet.id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: USER_ID, items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }] })
        .expect(409);
      expect(response.body.code).toBe('SCAN_WORKFLOW.SCANNER_CONFIRM_DISABLED');
    } finally {
      await close(app, dataSource);
    }
  });

  it('scanner_shadow creates review work but rejects scanner confirmation', async () => {
    const { app, dataSource, token } = await open('scanner_shadow');
    try {
      await postCallback(app, 'shadow_review').expect(202);
      const sheet = await dataSource.getRepository(Sheet).findOneByOrFail({
        sheetId: 'result_shadow_review',
      });
      const response = await request(app.getHttpServer())
        .post(`/scans/verify/${sheet.id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: USER_ID, items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }] })
        .expect(409);
      expect(response.body.code).toBe('SCAN_WORKFLOW.SCANNER_CONFIRM_DISABLED');
    } finally {
      await close(app, dataSource);
    }
  });

  it('scanner_webhook rejects OMR intake, form generation, and confirmation', async () => {
    const { app, dataSource, token } = await open('scanner_webhook');
    try {
      const intake = await request(app.getHttpServer())
        .post('/scans')
        .set('Authorization', `Bearer ${token}`)
        .send({ sheetId: 'OMR-MODE', checksum: 'c'.repeat(64), imageBase64: 'AA==' })
        .expect(409);
      expect(intake.body.code).toBe('SCAN_WORKFLOW.OMR_INTAKE_DISABLED');

      const forms = await request(app.getHttpServer())
        .post('/omr-forms/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({ userIds: [USER_ID], mode: 'code' })
        .expect(409);
      expect(forms.body.code).toBe('SCAN_WORKFLOW.OMR_FORMS_DISABLED');

      const template = await request(app.getHttpServer())
        .post('/menu/form')
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'code' })
        .expect(409);
      expect(template.body.code).toBe('SCAN_WORKFLOW.OMR_FORMS_DISABLED');

      const sheet = await seedStaleReviewSheet(dataSource, OmrOperationalFormMode.ISSUED);
      const confirm = await request(app.getHttpServer())
        .post(`/scans/verify/${sheet.id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }] })
        .expect(409);
      expect(confirm.body.code).toBe('SCAN_WORKFLOW.OMR_CONFIRM_DISABLED');
    } finally {
      await close(app, dataSource);
    }
  });
});
