import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OperatorRole } from '../src/operators/operator.entity';
import { OmrClientService, RenderIssuedBatchInput } from '../src/omr/omr-client.service';
import { MenuItem } from '../src/menu/menu-item.entity';
import { MenuItemCategory } from '../src/menu/menu-item-category.enum';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../src/omr-forms/issued-omr-form.entity';
import {
  OmrFormMode,
  OmrFormOrientation,
  OmrFormTemplate,
} from '../src/omr-forms/omr-form-template.entity';
import { OmrFormTemplateRow } from '../src/omr-forms/omr-form-template-row.entity';
import {
  canonicalCatalogHash,
  canonicalGeometryHash,
} from '../src/omr-forms/omr-form-templates.service';
import { User } from '../src/users/user.entity';
import {
  createE2EApp,
  E2EContext,
  login,
  seedOperator,
  seedUser,
  tomorrow,
  truncate,
} from './setup/e2e-bootstrap';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `e2e-hash:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `e2e-hash:${value}`),
}));

type RenderHook = (input: RenderIssuedBatchInput) => Promise<void>;

describe('Issued OMR roster and atomic batches (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let operatorToken: string;
  let adminToken: string;
  let cashierToken: string;
  let zoneAIds: string[];
  let zoneBId: string;
  let codeTemplate: OmrFormTemplate;
  let renderHook: RenderHook | null = null;
  let barrierTarget = 0;
  let barrierArrivals = 0;
  let releaseBarrier: (() => void) | null = null;
  let barrier: Promise<void> | null = null;

  const codeGeometry = {
    schema_version: 'omr-a5-v1',
    template_revision: 'e2e-code-r1',
    mode: 'code',
    orientation: 'portrait',
    paper_size: 'A5',
  };
  const fullListGeometry = {
    schema_version: 'omr-a5-v1',
    template_revision: 'e2e-full-r1',
    mode: 'full_list',
    orientation: 'landscape',
    paper_size: 'A5',
  };

  const authorized = (token: string) => ({ Authorization: `Bearer ${token}` });

  function enableRenderBarrier(count: number): void {
    barrierTarget = count;
    barrierArrivals = 0;
    barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
  }

  async function seedTemplate(
    mode: OmrFormMode,
    geometry: object,
    rows: Array<{
      menuItemId: string;
      codeSnapshot: string;
      shortLabelSnapshot: string;
      position: number;
    }> = [],
  ): Promise<OmrFormTemplate> {
    const templateRepo = ds.getRepository(OmrFormTemplate);
    const rowRepo = ds.getRepository(OmrFormTemplateRow);
    const saved = await templateRepo.save(templateRepo.create({
      revision: mode === OmrFormMode.CODE ? 'e2e-code-r1' : 'e2e-full-r1',
      mode,
      paperSize: 'A5',
      orientation: mode === OmrFormMode.CODE
        ? OmrFormOrientation.PORTRAIT
        : OmrFormOrientation.LANDSCAPE,
      geometry,
      geometryHash: canonicalGeometryHash(geometry),
      catalogHash: mode === OmrFormMode.FULL_LIST ? canonicalCatalogHash(rows) : null,
      isActive: false,
      activatedAt: null,
      retiredAt: null,
    }));
    if (rows.length) {
      await rowRepo.save(rows.map((row, rowIndex) => rowRepo.create({
        templateId: saved.id,
        rowIndex,
        ...row,
      })));
    }
    saved.isActive = true;
    saved.activatedAt = new Date();
    return templateRepo.save(saved);
  }

  beforeAll(async () => {
    const omrClient = {
      renderIssuedBatch: jest.fn(async (input: RenderIssuedBatchInput) => {
        const hook = renderHook;
        renderHook = null;
        if (hook) await hook(input);
        if (barrier && barrierTarget > 0) {
          barrierArrivals += 1;
          if (barrierArrivals === barrierTarget) releaseBarrier?.();
          await barrier;
          if (barrierArrivals === barrierTarget) {
            barrier = null;
            releaseBarrier = null;
            barrierTarget = 0;
          }
        }
        const geometry = input.mode === OmrFormMode.CODE ? codeGeometry : fullListGeometry;
        return {
          roi_template: geometry,
          pdf_base64: Buffer.from(`e2e-${input.mode}-${input.pages.length}`).toString('base64'),
          page_count: input.pages.length,
          manifest: input.pages.map((page, index) => ({
            page_number: index + 1,
            short_serial: page.personalization.short_serial,
            prison_id: page.personalization.prison_id,
          })),
        };
      }),
    };
    const ctx: E2EContext = await createE2EApp({
      configure: (builder) => {
        builder.overrideProvider(OmrClientService).useValue(omrClient);
      },
    });
    app = ctx.app;
    ds = ctx.dataSource;

    await truncate(ds, [
      'issued_omr_forms',
      'omr_form_template_rows',
      'omr_form_templates',
      'menu_items',
      'operators',
      'users',
    ]);

    const [operator, admin, cashier] = await Promise.all([
      seedOperator(ds, 'omr_batch_operator', OperatorRole.OPERATOR),
      seedOperator(ds, 'omr_batch_admin', OperatorRole.ADMIN),
      seedOperator(ds, 'omr_batch_cashier', OperatorRole.CASHIER),
    ]);
    await ds.getRepository('operators').update(operator.id, { zone: 'Zone A' });
    [operatorToken, adminToken, cashierToken] = await Promise.all([
      login(app, operator.username),
      login(app, admin.username),
      login(app, cashier.username),
    ]);

    const users = await Promise.all([
      seedUser(ds, 'A-003', 'Binh'),
      seedUser(ds, 'A-001', 'An'),
      seedUser(ds, 'A-002', 'An'),
      seedUser(ds, 'A-NULL', 'No Cell'),
      seedUser(ds, 'A-INACTIVE', 'Inactive', false),
      seedUser(ds, 'B-001', 'Cross Zone'),
    ]);
    await Promise.all([
      ds.getRepository(User).update(users[0].id, { zone: 'Zone A', cell: 'A-01' }),
      ds.getRepository(User).update(users[1].id, { zone: 'Zone A', cell: 'A-01' }),
      ds.getRepository(User).update(users[2].id, { zone: 'Zone A', cell: 'A-01' }),
      ds.getRepository(User).update(users[3].id, { zone: 'Zone A', cell: null }),
      ds.getRepository(User).update(users[4].id, { zone: 'Zone A', cell: 'A-01' }),
      ds.getRepository(User).update(users[5].id, { zone: 'Zone B', cell: 'B-01' }),
    ]);
    zoneAIds = [users[1].id, users[2].id, users[0].id];
    zoneBId = users[5].id;
    codeTemplate = await seedTemplate(OmrFormMode.CODE, codeGeometry);
  });

  afterAll(async () => {
    await truncate(ds, [
      'issued_omr_forms',
      'omr_form_template_rows',
      'omr_form_templates',
      'menu_items',
      'operators',
      'users',
    ]);
    await app.close();
  });

  it('serves exact stable active roster/options with explicit null cells and operator scope', async () => {
    const options = await request(app.getHttpServer())
      .get('/omr-forms/roster/options')
      .set(authorized(operatorToken))
      .expect(200);
    expect(options.body).toEqual({
      zones: [{ zone: 'Zone A', cells: [null, 'A-01'] }],
    });

    const roster = await request(app.getHttpServer())
      .get('/omr-forms/roster?zone=Zone%20A&cell=A-01')
      .set(authorized(operatorToken))
      .expect(200);
    expect(roster.body.prisoners.map((row: { name: string; legacyId: string }) => [
      row.name,
      row.legacyId,
    ])).toEqual([
      ['An', 'A-001'],
      ['An', 'A-002'],
      ['Binh', 'A-003'],
    ]);

    const nullCell = await request(app.getHttpServer())
      .get('/omr-forms/roster?zone=Zone%20A')
      .set(authorized(operatorToken))
      .expect(200);
    expect(nullCell.body).toMatchObject({
      zone: 'Zone A',
      cell: null,
      prisoners: [{ legacyId: 'A-NULL', cell: null }],
    });
  });

  it('makes cross-zone and absent roster selections non-enumerating while ADMIN remains all-zone', async () => {
    const cross = await request(app.getHttpServer())
      .get('/omr-forms/roster?zone=Zone%20B&cell=B-01')
      .set(authorized(operatorToken))
      .expect(200);
    const absent = await request(app.getHttpServer())
      .get('/omr-forms/roster?zone=Missing&cell=B-01')
      .set(authorized(operatorToken))
      .expect(200);
    expect(cross.body.prisoners).toEqual([]);
    expect(absent.body.prisoners).toEqual([]);

    const admin = await request(app.getHttpServer())
      .get('/omr-forms/roster?zone=Zone%20B&cell=B-01')
      .set(authorized(adminToken))
      .expect(200);
    expect(admin.body.prisoners).toHaveLength(1);
    expect(admin.body.prisoners[0]).toMatchObject({ id: zoneBId, legacyId: 'B-001' });
  });

  it('enforces endpoint roles and reports current code/full-list capabilities', async () => {
    const capabilities = await request(app.getHttpServer())
      .get('/omr-forms/capabilities')
      .set(authorized(operatorToken))
      .expect(200);
    expect(capabilities.body).toMatchObject({
      maxBatchSize: 50,
      modes: [
        { mode: 'code', available: true, orientation: 'portrait' },
        {
          mode: 'full_list',
          available: false,
          unavailableCode: 'OMR_FORM.TEMPLATE_NOT_READY',
          orientation: 'landscape',
        },
      ],
    });
    await request(app.getHttpServer())
      .get('/omr-forms/roster/options')
      .set(authorized(cashierToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/omr-forms/capabilities')
      .set(authorized(cashierToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(cashierToken))
      .send({ userIds: [zoneAIds[0]], mode: 'code' })
      .expect(403);
  });

  it('rejects client location/template/date authority and duplicate explicit IDs', async () => {
    await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(operatorToken))
      .send({
        userIds: [zoneAIds[0]],
        mode: 'code',
        zone: 'Zone B',
        cell: 'B-01',
        serviceDate: '2099-01-01',
        templateId: codeTemplate.id,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(operatorToken))
      .send({ userIds: [zoneAIds[0], zoneAIds[0]], mode: 'code' })
      .expect(400);
  });

  it('makes cross-zone and missing batch IDs non-enumerating', async () => {
    const cross = await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(operatorToken))
      .send({ userIds: [zoneBId], mode: 'code' })
      .expect(404);
    const missing = await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(operatorToken))
      .send({ userIds: ['00000000-0000-4000-8000-000000000000'], mode: 'code' })
      .expect(404);
    expect(cross.body).toEqual(missing.body);
    expect(cross.body).toMatchObject({ code: 'USER.NOT_FOUND' });
  });

  it('issues one page and one token-bearing row per selected prisoner without exposing bearer tokens', async () => {
    const selectedIds = zoneAIds.slice(0, 2);
    const stableManifestIds = [...selectedIds].sort();
    const response = await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(operatorToken))
      .send({ userIds: selectedIds, mode: 'code' })
      .expect(201);
    expect(response.body).toMatchObject({
      mode: 'code',
      orientation: 'portrait',
      pageCount: 2,
      manifest: [
        { userId: stableManifestIds[0], shortSerial: expect.stringMatching(/^[0-9A-F]{8}$/) },
        { userId: stableManifestIds[1], shortSerial: expect.stringMatching(/^[0-9A-F]{8}$/) },
      ],
    });
    expect(response.body.manifest.map((entry: { userId: string }) => entry.userId))
      .toEqual(stableManifestIds);
    expect(response.body.manifest.every((entry: object) => !('token' in entry))).toBe(true);
    const rows = await ds.getRepository(IssuedOmrForm).find({
      where: { serviceDate: tomorrow(), status: IssuedOmrFormStatus.ISSUED },
    });
    expect(rows.map((row) => row.userId).sort()).toEqual(stableManifestIds);
  });

  it.each([
    ['movement', { zone: 'Zone B', cell: 'B-01', isActive: true }, 404, 'USER.NOT_FOUND'],
    ['deactivation', { zone: 'Zone A', cell: 'A-01', isActive: false }, 409, 'OMR_FORM.ROSTER_CHANGED'],
  ])('rolls back the whole reissue when %s wins the render race', async (
    _label,
    change,
    expectedStatus,
    expectedCode,
  ) => {
    const targetId = zoneAIds[0];
    await ds.getRepository(User).update(targetId, {
      zone: 'Zone A',
      cell: 'A-01',
      isActive: true,
    });
    const before = await ds.getRepository(IssuedOmrForm).find({
      where: { userId: targetId, serviceDate: tomorrow() },
    });
    const previouslyIssued = before.find((row) => row.status === IssuedOmrFormStatus.ISSUED)!;
    renderHook = async () => {
      await ds.getRepository(User).update(targetId, change);
    };

    try {
      const response = await request(app.getHttpServer())
        .post('/omr-forms/batch')
        .set(authorized(operatorToken))
        .send({ userIds: [targetId], mode: 'code' })
        .expect(expectedStatus);
      expect(response.body).toMatchObject({ code: expectedCode });

      const after = await ds.getRepository(IssuedOmrForm).find({
        where: { userId: targetId, serviceDate: tomorrow() },
      });
      expect(after).toHaveLength(before.length);
      expect(after.find((row) => row.token === previouslyIssued.token)?.status)
        .toBe(IssuedOmrFormStatus.ISSUED);
    } finally {
      await ds.getRepository(User).update(targetId, {
        zone: 'Zone A',
        cell: 'A-01',
        isActive: true,
      });
    }
  });

  it('serializes overlapping reissues to one coherent winner without deadlock', async () => {
    const targetId = zoneAIds[1];
    const before = await ds.getRepository(IssuedOmrForm).count({
      where: { userId: targetId, serviceDate: tomorrow() },
    });
    enableRenderBarrier(2);

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/omr-forms/batch')
        .set(authorized(operatorToken))
        .send({ userIds: [targetId], mode: 'code' }),
      request(app.getHttpServer())
        .post('/omr-forms/batch')
        .set(authorized(operatorToken))
        .send({ userIds: [targetId], mode: 'code' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);

    const rows = await ds.getRepository(IssuedOmrForm).find({
      where: { userId: targetId, serviceDate: tomorrow() },
    });
    expect(rows).toHaveLength(before + 2);
    expect(rows.filter((row) => row.status === IssuedOmrFormStatus.ISSUED)).toHaveLength(1);
    expect(rows.filter((row) => row.status === IssuedOmrFormStatus.VOID)).toHaveLength(before + 1);
  });

  it('detects a full-list catalog race and leaves issued-form state unchanged', async () => {
    const menuRepo = ds.getRepository(MenuItem);
    const items = await menuRepo.save([
      menuRepo.create({
        code: '001',
        name: 'Rice',
        price: 10_000,
        category: MenuItemCategory.FOOD,
        position: 0,
        isActive: true,
      }),
      menuRepo.create({
        code: '002',
        name: 'Soap',
        price: 20_000,
        category: MenuItemCategory.ESSENTIAL,
        position: 1,
        isActive: true,
      }),
    ]);
    const catalog = items.map((item) => ({
      menuItemId: item.id,
      codeSnapshot: item.code,
      shortLabelSnapshot: item.name,
      position: item.position,
    }));
    await seedTemplate(OmrFormMode.FULL_LIST, fullListGeometry, catalog);
    const targetId = zoneAIds[2];
    const before = await ds.getRepository(IssuedOmrForm).count({
      where: { userId: targetId, serviceDate: tomorrow() },
    });
    renderHook = async () => {
      await menuRepo.update(items[1].id, { isActive: false });
    };

    const response = await request(app.getHttpServer())
      .post('/omr-forms/batch')
      .set(authorized(operatorToken))
      .send({ userIds: [targetId], mode: 'full_list' })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'OMR_TEMPLATE.CATALOG_CHANGED' });
    expect(await ds.getRepository(IssuedOmrForm).count({
      where: { userId: targetId, serviceDate: tomorrow() },
    })).toBe(before);
  });
});
