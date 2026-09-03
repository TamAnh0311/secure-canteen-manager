import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  E2EContext,
  createE2EApp,
  seedGlobalMenu,
  generateGlobalForm,
  clearGlobalForm,
  seedOperator,
  seedUser,
  login,
  tomorrow,
  truncate,
  SeededMenuItem,
  seedIssuedForm,
} from './setup/e2e-bootstrap';
import { Operator, OperatorRole } from '../src/operators/operator.entity';
import { User } from '../src/users/user.entity';
import { Sheet } from '../src/scans/sheet.entity';
import { SheetStatus } from '../src/scans/sheet-status.enum';
import { OmrClientService, ProcessScanResult } from '../src/omr/omr-client.service';

const SYNTHETIC_SCAN_FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'verify-flow', 'verify-fixture.png'),
);
let fixtureSequence = 0;
let issuedFormSequence = 0;
let currentFormToken = '00000000-0000-4000-8000-000000000000';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Add a harmless PNG tEXt chunk before IEND. Each submission remains a decodable copy of
// the committed synthetic form while receiving distinct bytes/checksum for dedupe scenarios.
function nextValidScan(): { checksum: string; imageBase64: string } {
  const data = Buffer.from(`fixture\0synthetic-${fixtureSequence++}`, 'utf8');
  const type = Buffer.from('tEXt', 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const iendOffset = SYNTHETIC_SCAN_FIXTURE.length - 12;
  const bytes = Buffer.concat([
    SYNTHETIC_SCAN_FIXTURE.subarray(0, iendOffset),
    length,
    type,
    data,
    crc,
    SYNTHETIC_SCAN_FIXTURE.subarray(iendOffset),
  ]);
  return {
    checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
    imageBase64: bytes.toString('base64'),
  };
}

const buildOmrResult = (overrides: Partial<ProcessScanResult> = {}): ProcessScanResult => ({
  form_token: currentFormToken,
  recognized_id: '12345',
  id_digits: [{ index: 0, value: 1, confidence: 0.95 }],
  order_lines: [
    {
      line_index: 0,
      code: '001',
      qty: 1,
      code_digits: [
        { index: 0, value: 0, confidence: 0.95 },
        { index: 1, value: 0, confidence: 0.95 },
        { index: 2, value: 1, confidence: 0.9 },
      ],
      qty_digits: [
        { index: 0, value: 0, confidence: 0.95 },
        { index: 1, value: 1, confidence: 0.9 },
      ],
      flags: [],
    },
  ],
  avg_confidence: 0.88,
  flags: [],
  warp_ok: true,
  ...overrides,
});

// Operator JWT, set in beforeAll; module-scoped so the poll helper can read it.
let operatorToken: string;

const waitForSheetTerminal = async (
  app: INestApplication,
  sheetId: string,
  maxAttempts = 10,
): Promise<Sheet> => {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const sheet = await request(app.getHttpServer())
      .get(`/scans/${sheetId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    if (![SheetStatus.PENDING, SheetStatus.PROCESSING].includes(sheet.body.status)) {
      return sheet.body;
    }
    await new Promise((r) => setTimeout(r, 100));
    attempts++;
  }
  throw new Error(`Sheet did not reach terminal state after ${maxAttempts} polls`);
};

// Ingestion pipeline against the global menu + global OMR form (no sessions). Sheets are
// server-stamped with the next collection day's service_date (tomorrow) and decoded against the
// single global ROI template. The OMR client is mocked so each test drives a specific decision
// branch deterministically.
describe('Scan Ingestion Pipeline (e2e)', () => {
  let app: INestApplication;
  let ctx: E2EContext;
  let dataSource: DataSource;
  let agentToken: string;
  let testUser: User;
  let scanOperatorId: string;
  let menu: SeededMenuItem[];
  const SVC_DATE = tomorrow();

  beforeAll(async () => {
    ctx = await createE2EApp({
      configure: (builder) =>
        builder
          .overrideProvider(OmrClientService)
          .useValue({
            preflightImage: jest.fn().mockResolvedValue(undefined),
            identifyFormToken: jest.fn(async () => ({
              form_token: currentFormToken,
              form_reference: currentFormToken,
              flags: [],
            })),
            processScan: jest.fn(),
            generateForm: jest.fn(),
            warpSheet: jest.fn(),
          }),
    });
    app = ctx.app;
    dataSource = ctx.dataSource;

    await truncate(dataSource, [
      'orders',
      'issued_omr_forms',
      'sheets',
      'menu_items',
      'users',
      'operators',
    ]);

    // Unbound pending sheets are intentionally ADMIN-only until processing establishes an
    // authorized issued owner or generic candidate route.
    const scanOperator = await seedOperator(dataSource, 'e2e_scan_operator', OperatorRole.ADMIN);
    scanOperator.zone = 'Khu A';
    await dataSource.getRepository(Operator).save(scanOperator);
    scanOperatorId = scanOperator.id;
    operatorToken = await login(app, 'e2e_scan_operator');
    agentToken = process.env.AGENT_TOKEN || 'e2e-agent-token-1234567890';

    menu = await seedGlobalMenu(dataSource);
    await generateGlobalForm(dataSource);
  });

  afterAll(async () => {
    await truncate(dataSource, [
      'orders',
      'issued_omr_forms',
      'sheets',
      'menu_items',
      'users',
      'operators',
    ]);
    await app.close();
  });

  // Sane default so background processing always has a valid OMR result;
  // individual tests reassign processScan to exercise specific branches.
  // Sheets/orders accumulate across tests intentionally (read-endpoint tests
  // assert on the built-up corpus), so this does NOT truncate.
  beforeEach(async () => {
    const sequence = issuedFormSequence++;
    testUser = await seedUser(
      dataSource,
      `SYNTH-SCAN-${String(sequence).padStart(4, '0')}`,
      `Synthetic Scan User ${sequence}`,
    );
    testUser.zone = 'Khu A';
    testUser = await dataSource.getRepository(User).save(testUser);
    const form = await seedIssuedForm(dataSource, {
      userId: testUser.id,
      issuedBy: scanOperatorId,
      serviceDate: SVC_DATE,
    });
    currentFormToken = form.token;
    const omrClient = app.get(OmrClientService);
    omrClient.processScan = jest.fn().mockResolvedValue(buildOmrResult());
  });

  // Drain the in-process serial queue before the next test runs. A sheet left
  // pending/processing would otherwise be picked up mid-next-test and call that
  // test's reassigned mock, skewing call-count assertions.
  afterEach(async () => {
    for (let i = 0; i < 60; i++) {
      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM sheets WHERE status IN ('pending','processing')`,
      );
      if (count === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  describe('Authentication', () => {
    it('POST /scans with valid x-agent-token → 202', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-001',
          checksum,
          imageBase64,
        })
        .expect(202);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(SheetStatus.PENDING);
    });

    it('POST /scans without agent token and without JWT → 401', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      await request(app.getHttpServer())
        .post('/scans')
        .send({
          sheetId: 'sheet-002',
          checksum,
          imageBase64,
        })
        .expect(401);
    });

    it('POST /scans with operator JWT (no agent token) → 202', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          sheetId: 'sheet-003',
          checksum,
          imageBase64,
        })
        .expect(202);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(SheetStatus.PENDING);
    });
  });

  describe('Idempotency (Checksum Deduplication)', () => {
    it('POST identical checksum twice → first 202, second 409 with existing sheet ref', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const payload = {
        sheetId: 'sheet-dedupe-1',
        checksum,
        imageBase64,
      };

      const res1 = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send(payload)
        .expect(202);

      const firstId = res1.body.id;
      expect(res1.body.status).toBe(SheetStatus.PENDING);

      const res2 = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send(payload)
        .expect(409);

      expect(res2.body.id).toBe(firstId);

      const sheetRepo = dataSource.getRepository(Sheet);
      const sheets = await sheetRepo.find({ where: { checksum } });
      expect(sheets).toHaveLength(1);
    });

    it('Concurrent identical submits → exactly one 202 and one 409, single row (never 500)', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const payload = {
        sheetId: 'sheet-race-1',
        checksum,
        imageBase64,
      };

      const responses = await Promise.all([
        request(app.getHttpServer()).post('/scans').set('x-agent-token', agentToken).send(payload),
        request(app.getHttpServer()).post('/scans').set('x-agent-token', agentToken).send(payload),
      ]);

      // One submit wins (202), the loser is caught at the unique checksum index
      // (or the findOne pre-check) and returns the same 409 — never a 500.
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([202, 409]);

      const accepted = responses.find((r) => r.status === 202)!;
      const conflict = responses.find((r) => r.status === 409)!;
      expect(conflict.body.id).toBe(accepted.body.id);

      const sheetRepo = dataSource.getRepository(Sheet);
      const sheets = await sheetRepo.find({ where: { checksum } });
      expect(sheets).toHaveLength(1);
    });

    it('Processing runs only once on deduplicated submissions', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockResolvedValue(buildOmrResult());

      const payload = {
        sheetId: 'sheet-dedupe-2',
        checksum,
        imageBase64,
      };

      await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send(payload)
        .expect(202);

      await new Promise((r) => setTimeout(r, 1000));

      expect(omrClient.processScan).toHaveBeenCalledTimes(1);

      await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send(payload)
        .expect(409);

      expect(omrClient.processScan).toHaveBeenCalledTimes(1);
    });
  });

  describe('Matched Routes to Verify (no auto-accept)', () => {
    it('High-confidence matched sheet → FLAGGED with matchedUserId, NO order (warden confirms)', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockResolvedValue(
        buildOmrResult({
          recognized_id: testUser.legacyId,
          warp_ok: true,
          avg_confidence: 0.92,
          order_lines: [
            {
              line_index: 0,
              code: '001',
              qty: 1,
              code_digits: [
                { index: 0, value: 0, confidence: 0.95 },
                { index: 1, value: 0, confidence: 0.95 },
                { index: 2, value: 1, confidence: 0.95 },
              ],
              qty_digits: [
                { index: 0, value: 0, confidence: 0.95 },
                { index: 1, value: 1, confidence: 0.95 },
              ],
              flags: [],
            },
          ],
          flags: [],
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-matched-verify',
          checksum,
          imageBase64,
        })
        .expect(202);

      const finalSheet = await waitForSheetTerminal(app, res.body.id);

      // Even a clean, high-confidence match routes to the verify queue: the processor
      // never creates an order, so a warden always confirms the balance debit.
      expect(finalSheet.status).toBe(SheetStatus.FLAGGED);
      expect(finalSheet.matchedUserId).toBe(testUser.id);
      expect(finalSheet.orderId).toBeNull();
      expect(finalSheet.avgConfidence).toBe(0.92);
      expect(finalSheet.recognizedId).toBeUndefined();
      expect(finalSheet.serviceDate).toBe(SVC_DATE);
      expect(finalSheet.issuedFormId).toBeUndefined();
    });
  });

  describe('Legacy ID is not an identity authority', () => {
    it('an unrelated recognized ID is ignored and the issued token binds the prisoner', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockResolvedValue(
        buildOmrResult({ recognized_id: '99999', warp_ok: true, flags: [] }),
      );

      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-not-matched',
          checksum,
          imageBase64,
        })
        .expect(202);

      const finalSheet = await waitForSheetTerminal(app, res.body.id);

      expect(finalSheet.status).toBe(SheetStatus.FLAGGED);
      expect(finalSheet.flags ?? []).not.toContain('NOT_MATCHED');
      expect(finalSheet.matchedUserId).toBe(testUser.id);
      expect(finalSheet.orderId).toBeNull();
    });
  });

  describe('Needs Verify (Field Flags)', () => {
    it('recognized_id null with clean flags → flagged, NO order', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockResolvedValue(
        buildOmrResult({ recognized_id: null, warp_ok: true, flags: [] }),
      );

      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-id-null',
          checksum,
          imageBase64,
        })
        .expect(202);

      const finalSheet = await waitForSheetTerminal(app, res.body.id);

      expect(finalSheet.status).toBe(SheetStatus.FLAGGED);
      expect(finalSheet.orderId).toBeNull();
    });

    it('Field flag present (e.g., FLAG_DIGIT_*) → flagged, NO order', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockResolvedValue(
        buildOmrResult({
          recognized_id: testUser.legacyId,
          warp_ok: true,
          flags: ['FLAG_DIGIT_IDX_0'],
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-field-flag',
          checksum,
          imageBase64,
        })
        .expect(202);

      const finalSheet = await waitForSheetTerminal(app, res.body.id);

      expect(finalSheet.status).toBe(SheetStatus.FLAGGED);
      expect(finalSheet.flags).toContain('FLAG_DIGIT_IDX_0');
      expect(finalSheet.orderId).toBeNull();
      expect(finalSheet.matchedUserId).toBe(testUser.id);
    });
  });

  describe('Rejected', () => {
    it('warp_ok false → rejected, NO order', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockResolvedValue(
        buildOmrResult({ warp_ok: false, recognized_id: null, flags: [] }),
      );

      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-rejected',
          checksum,
          imageBase64,
        })
        .expect(202);

      const finalSheet = await waitForSheetTerminal(app, res.body.id);

      expect(finalSheet.status).toBe(SheetStatus.REJECTED);
      expect(finalSheet.orderId).toBeNull();
    });
  });

  describe('Read Endpoints', () => {
    it('GET /scans?dateFrom&dateTo → lists newest-first, includes all statuses', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scans?dateFrom=${SVC_DATE}&dateTo=${SVC_DATE}&limit=100&offset=0`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      for (let i = 1; i < res.body.length; i++) {
        const prevTime = new Date(res.body[i - 1].createdAt).getTime();
        const currTime = new Date(res.body[i].createdAt).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });

    it('GET /scans/:id returns the explicit safe response without sensitive internals', async () => {
      const sheetRepo = dataSource.getRepository(Sheet);
      const sheet = await sheetRepo.findOne({ where: { status: SheetStatus.FLAGGED } });
      expect(sheet).toBeDefined();

      const res = await request(app.getHttpServer())
        .get(`/scans/${sheet!.id}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(res.body.id).toBe(sheet!.id);
      expect(res.body.avgConfidence).toBeDefined();
      expect(res.body).not.toHaveProperty('resultJson');
      expect(res.body).not.toHaveProperty('recognizedId');
      expect(res.body).not.toHaveProperty('issuedFormId');
      expect(res.body).not.toHaveProperty('checksum');
      expect(res.body).not.toHaveProperty('imagePath');
    });

    it('GET /scans/kpi?dateFrom&dateTo → returns correct status counts', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scans/kpi?dateFrom=${SVC_DATE}&dateTo=${SVC_DATE}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('pending');
      expect(res.body).toHaveProperty('processing');
      expect(res.body).toHaveProperty('autoAccepted');
      expect(res.body).toHaveProperty('flagged');
      expect(res.body).toHaveProperty('rejected');
      expect(res.body).toHaveProperty('verified');

      for (const key in res.body) {
        expect(typeof res.body[key]).toBe('number');
        expect(res.body[key]).toBeGreaterThanOrEqual(0);
      }

      // Every recognized sheet now routes to the verify queue (no auto-accept).
      expect(res.body.flagged).toBeGreaterThan(0);
    });
  });

  describe('Immutable issued-template authority', () => {
    it('continues processing an issued form when the legacy global ROI signal is absent', async () => {
      // Issued forms now bind their immutable geometry directly; the legacy threshold row is
      // no longer scan authority and must not invalidate an already printed form.
      await clearGlobalForm(dataSource);
      try {
        const { checksum, imageBase64 } = nextValidScan();
        const omrClient = app.get(OmrClientService);
        omrClient.processScan = jest.fn().mockResolvedValue(
          buildOmrResult({ recognized_id: testUser.legacyId, warp_ok: true }),
        );

        const res = await request(app.getHttpServer())
          .post('/scans')
          .set('x-agent-token', agentToken)
          .send({
            sheetId: 'sheet-no-roi',
            checksum,
            imageBase64,
          })
          .expect(202);

        const finalSheet = await waitForSheetTerminal(app, res.body.id);

        expect(finalSheet.status).toBe(SheetStatus.FLAGGED);
        expect(finalSheet.flags ?? []).not.toContain('FORM_NOT_GENERATED');
        expect(finalSheet.orderId).toBeNull();
        expect(omrClient.processScan).toHaveBeenCalledTimes(1);
      } finally {
        // Restore the global form for any later test ordering.
        await generateGlobalForm(dataSource);
      }
    });
  });

  describe('Recovery on Boot', () => {
    it('Pending sheets survive app restart and are re-driven to terminal state', async () => {
      const { checksum, imageBase64 } = nextValidScan();
      const omrClient = app.get(OmrClientService);

      omrClient.processScan = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(buildOmrResult()), 5000)),
      );

      const res = await request(app.getHttpServer())
        .post('/scans')
        .set('x-agent-token', agentToken)
        .send({
          sheetId: 'sheet-recovery',
          checksum,
          imageBase64,
        })
        .expect(202);

      const sheetId = res.body.id;

      await new Promise((r) => setTimeout(r, 200));

      await app.close();

      ctx = await createE2EApp({
        configure: (builder) =>
          builder.overrideProvider(OmrClientService).useValue({
            preflightImage: jest.fn().mockResolvedValue(undefined),
            identifyFormToken: jest.fn(async () => ({
              form_token: currentFormToken,
              form_reference: currentFormToken,
              flags: [],
            })),
            processScan: jest.fn().mockResolvedValue(buildOmrResult()),
            generateForm: jest.fn(),
            warpSheet: jest.fn(),
          }),
      });
      app = ctx.app;
      // app.close() above tore down the original DataSource; repoint to the
      // restarted app's connection so this assertion and afterAll stay live.
      dataSource = ctx.dataSource;

      await new Promise((r) => setTimeout(r, 1000));

      const sheetRepo = dataSource.getRepository(Sheet);
      const finalSheet = await sheetRepo.findOne({ where: { id: sheetId } });

      expect(finalSheet).toBeDefined();
      expect([
        SheetStatus.AUTO_ACCEPTED,
        SheetStatus.FLAGGED,
        SheetStatus.REJECTED,
        SheetStatus.VERIFIED,
      ]).toContain(finalSheet!.status);
    });
  });
});
