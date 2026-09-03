import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OperatorZoneAccessService } from '../../auth/operator-zone-access.service';
import { MenuItem } from '../../menu/menu-item.entity';
import { OmrClientService } from '../../omr/omr-client.service';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { IssueOmrFormBatchDto } from '../dto/issue-omr-form-batch.dto';
import { IssuedOmrForm, IssuedOmrFormStatus } from '../issued-omr-form.entity';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from '../omr-form-template.entity';
import {
  canonicalCatalogHash,
  canonicalGeometryHash,
  OmrFormTemplatesService,
} from '../omr-form-templates.service';
import { OmrFormsService } from '../omr-forms.service';
import { OmrOperationalModeService } from '../omr-operational-mode.service';
import { OmrOperationalFormMode } from '../../scans/sheet.entity';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';

const USER_A_ID = '11111111-1111-4111-8111-111111111111';
const USER_B_ID = '22222222-2222-4222-8222-222222222222';
const ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ISSUED_AT = new Date('2026-07-14T10:00:00.000Z');
const GEOMETRY = { schema_version: 'omr-a5-v1', mode: 'code', orientation: 'portrait' };
const ACTOR = {
  id: ISSUER_ID,
  role: OperatorRole.OPERATOR,
  zone: 'Khu A',
} as OperatorPublic;

function user(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    legacyId: id === USER_A_ID ? 'P-001' : 'P-002',
    name: id === USER_A_ID ? 'An' : 'Binh',
    zone: 'Khu A',
    cell: 'A-12',
    isActive: true,
    ...overrides,
  } as User;
}

const USER_A = user(USER_A_ID);
const USER_B = user(USER_B_ID);

function template(overrides: Partial<OmrFormTemplate> = {}): OmrFormTemplate {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    revision: 'a5-code-r1',
    mode: OmrFormMode.CODE,
    paperSize: 'A5',
    orientation: OmrFormOrientation.PORTRAIT,
    geometry: GEOMETRY,
    geometryHash: canonicalGeometryHash(GEOMETRY),
    catalogHash: null,
    isActive: true,
    activatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    rows: [],
    ...overrides,
  } as OmrFormTemplate;
}

function menuItems(count: number): MenuItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${String(index + 1).padStart(3, '0')}`,
    code: String(index + 1).padStart(3, '0'),
    name: `Item ${index + 1}`,
    position: index,
    isActive: true,
  } as MenuItem));
}

function catalogRows(items: MenuItem[]) {
  return items.map((item) => ({
    menuItemId: item.id,
    codeSnapshot: item.code,
    shortLabelSnapshot: item.name,
    position: item.position,
  }));
}

interface HarnessOptions {
  selected?: User[];
  locked?: User[];
  activeTemplates?: OmrFormTemplate[];
  currentTemplate?: OmrFormTemplate | null;
  catalog?: MenuItem[];
  currentCatalog?: MenuItem[];
  predecessors?: IssuedOmrForm[];
  operationalMode?: OmrOperationalFormMode;
}

function harness(options: HarnessOptions = {}) {
  const selected = options.selected ?? [USER_A, USER_B];
  const locked = options.locked ?? selected;
  const activeTemplates = options.activeTemplates ?? [template()];
  const currentTemplate = options.currentTemplate === undefined ? activeTemplates[0] : options.currentTemplate;
  const catalog = options.catalog ?? [];
  const currentCatalog = options.currentCatalog ?? catalog;
  const predecessors = options.predecessors ?? [];

  const users = {
    loadIssuanceSelection: jest.fn().mockResolvedValue(selected),
    listIssuanceRoster: jest.fn(),
    listIssuanceRosterOptions: jest.fn(),
  };
  const templates = {
    getActiveTemplates: jest.fn().mockResolvedValue(activeTemplates),
    assertIssuable: jest.fn(),
    resolveForIssuedForm: jest.fn().mockResolvedValue(currentTemplate),
  };
  const omr = {
    renderIssuedBatch: jest.fn(async (input: {
      pages: Array<{ personalization: { short_serial: string; prison_id: string } }>;
    }) => ({
      roi_template: activeTemplates[0].geometry,
      pdf_base64: 'JVBERi0xLjQ=',
      page_count: input.pages.length,
      manifest: input.pages.map((page, index) => ({
        page_number: index + 1,
        short_serial: page.personalization.short_serial,
        prison_id: page.personalization.prison_id,
      })),
    })),
    renderGenericMaster: jest.fn(async (input: { template_id: string }) => ({
      roi_template: activeTemplates[0].geometry,
      pdf_base64: 'JVBERi0xLjQ=',
      page_count: 1 as const,
      form_reference: `CM-G1:${input.template_id}`,
    })),
  };

  const catalogManager = {
    query: jest.fn().mockResolvedValue([]),
    find: jest.fn(async (entity: unknown) => {
      if (entity === OmrFormTemplate) return activeTemplates;
      if (entity === MenuItem) return catalog;
      return [];
    }),
  };
  const commitManager = {
    query: jest.fn().mockResolvedValue([]),
    find: jest.fn(async (entity: unknown) => {
      if (entity === IssuedOmrForm) return predecessors;
      if (entity === MenuItem) return currentCatalog;
      return [];
    }),
    findOne: jest.fn(async (entity: unknown, query: { where: { id: string } }) => {
      if (entity === User) return locked.find((candidate) => candidate.id === query.where.id) ?? null;
      if (entity === OmrFormTemplate) return currentTemplate;
      return null;
    }),
    create: jest.fn((_entity: unknown, value: object) => value),
    save: jest.fn(async (_entity: unknown, value: object | object[]) => {
      if (Array.isArray(value)) {
        return value.map((row) => ({ ...row, issuedAt: ISSUED_AT }));
      }
      return { ...value, issuedAt: ISSUED_AT };
    }),
  };
  let transactionIndex = 0;
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<unknown>) => {
      const manager = transactionIndex++ === 0 ? catalogManager : commitManager;
      return work(manager as unknown as EntityManager);
    }),
  };
  const zoneAccess = {
    assertUserAccess: jest.fn(async (_actor, id) => {
      const found = locked.find((candidate) => candidate.id === id);
      if (!found) throw new NotFoundException({ code: 'USER.NOT_FOUND' });
      return found;
    }),
  };
  const operationalMode = options.operationalMode
    ? {
        mode: options.operationalMode,
        assertGenericReady: jest.fn().mockResolvedValue(undefined),
      }
    : undefined;

  return {
    service: new OmrFormsService(
      dataSource as unknown as DataSource,
      users as unknown as UsersService,
      omr as unknown as OmrClientService,
      templates as unknown as OmrFormTemplatesService,
      zoneAccess as unknown as OperatorZoneAccessService,
      { assertOmrFormMutationEnabled: jest.fn() } as unknown as ScanWorkflowModeService,
      operationalMode as unknown as OmrOperationalModeService,
    ),
    users,
    templates,
    omr,
    catalogManager,
    commitManager,
    dataSource,
    zoneAccess,
    operationalMode,
  };
}

describe('IssueOmrFormBatchDto authority', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  it('accepts only mode plus explicit unique UUIDs', async () => {
    await expect(pipe.transform(
      { userIds: [USER_A_ID, USER_B_ID], mode: OmrFormMode.CODE },
      { type: 'body', metatype: IssueOmrFormBatchDto },
    )).resolves.toMatchObject({ userIds: [USER_A_ID, USER_B_ID], mode: OmrFormMode.CODE });

    for (const forbidden of ['zone', 'cell', 'serviceDate', 'templateId', 'name', 'legacyId']) {
      await expect(pipe.transform(
        { userIds: [USER_A_ID], mode: OmrFormMode.CODE, [forbidden]: 'client-authority' },
        { type: 'body', metatype: IssueOmrFormBatchDto },
      )).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects duplicate IDs', async () => {
    await expect(pipe.transform(
      { userIds: [USER_A_ID, USER_A_ID], mode: OmrFormMode.CODE },
      { type: 'body', metatype: IssueOmrFormBatchDto },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OmrFormsService atomic batch issuance', () => {
  beforeEach(() => {
    process.env.APP_TZ = 'Asia/Saigon';
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T16:59:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('pre-renders every page before mutation, then locks users in sorted advisory order and returns a token-free manifest', async () => {
    const h = harness({ selected: [USER_B, USER_A], locked: [USER_A, USER_B] });

    const result = await h.service.issueBatch(
      { userIds: [USER_B_ID, USER_A_ID], mode: OmrFormMode.CODE },
      ACTOR,
    );

    expect(h.omr.renderIssuedBatch).toHaveBeenCalledTimes(1);
    expect(h.omr.renderIssuedBatch.mock.calls[0][0].pages).toHaveLength(2);
    expect(h.omr.renderIssuedBatch.mock.invocationCallOrder[0])
      .toBeLessThan(h.commitManager.query.mock.invocationCallOrder[0]);
    expect(h.commitManager.query.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([
      [`${USER_A_ID}:2026-07-15`],
      [`${USER_B_ID}:2026-07-15`],
    ]);
    expect(result).toMatchObject({
      serviceDate: '2026-07-15',
      pageCount: 2,
      manifest: [
        { userId: USER_B_ID, shortSerial: expect.stringMatching(/^[0-9A-F]{8}$/) },
        { userId: USER_A_ID, shortSerial: expect.stringMatching(/^[0-9A-F]{8}$/) },
      ],
    });
    expect(result.manifest.every((entry) =>
      Object.keys(entry).sort().join(',') === 'shortSerial,userId')).toBe(true);
    expect(result.manifest).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ token: expect.anything() }),
    ]));
  });

  it('uses predecessor, locked-user, then catalog/template ordering before any void or insert', async () => {
    const predecessor = {
      token: 'old-token',
      userId: USER_A_ID,
      serviceDate: '2026-07-15',
      status: IssuedOmrFormStatus.ISSUED,
    } as IssuedOmrForm;
    const h = harness({ selected: [USER_A], locked: [USER_A], predecessors: [predecessor] });

    await h.service.issueBatch({ userIds: [USER_A_ID], mode: OmrFormMode.CODE }, ACTOR);

    const predecessorRead = h.commitManager.find.mock.invocationCallOrder[0];
    const lockedUserRead = h.commitManager.findOne.mock.invocationCallOrder[0];
    const catalogLock = h.commitManager.query.mock.invocationCallOrder[1];
    const templateRead = h.commitManager.findOne.mock.invocationCallOrder[1];
    const firstSave = h.commitManager.save.mock.invocationCallOrder[0];
    expect(predecessorRead).toBeLessThan(lockedUserRead);
    expect(lockedUserRead).toBeLessThan(catalogLock);
    expect(catalogLock).toBeLessThan(templateRead);
    expect(templateRead).toBeLessThan(firstSave);
    expect(predecessor).toMatchObject({
      status: IssuedOmrFormStatus.VOID,
      voidReason: 'reissued',
      voidedAt: expect.any(Date),
    });
    expect(h.commitManager.save.mock.calls[0][1]).toEqual([predecessor]);
    expect(h.commitManager.save.mock.calls[1][1]).toHaveLength(1);
  });

  it.each([
    ['page count', { page_count: 1 }],
    ['manifest order', {
      manifest: [
        { page_number: 2, short_serial: 'WRONG', prison_id: 'P-001' },
        { page_number: 1, short_serial: 'WRONG', prison_id: 'P-002' },
      ],
    }],
    ['geometry', { roi_template: { changed: true } }],
  ])('rejects a %s mismatch before the mutation transaction', async (_label, override) => {
    const h = harness();
    h.omr.renderIssuedBatch.mockImplementation(async (input: {
      pages: Array<{ personalization: { short_serial: string; prison_id: string } }>;
    }) => ({
      roi_template: GEOMETRY,
      pdf_base64: 'x',
      page_count: input.pages.length,
      manifest: input.pages.map((page, index) => ({
        page_number: index + 1,
        short_serial: page.personalization.short_serial,
        prison_id: page.personalization.prison_id,
      })),
      ...override,
    }));

    await expect(h.service.issueBatch(
      { userIds: [USER_A_ID, USER_B_ID], mode: OmrFormMode.CODE },
      ACTOR,
    )).rejects.toMatchObject({ response: { code: 'OMR_FORM.TEMPLATE_CHANGED' } });
    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(h.commitManager.query).not.toHaveBeenCalled();
    expect(h.commitManager.save).not.toHaveBeenCalled();
  });

  it('does not open the mutation transaction or change predecessors when rendering fails', async () => {
    const predecessor = {
      token: 'old-token',
      userId: USER_A_ID,
      serviceDate: '2026-07-15',
      status: IssuedOmrFormStatus.ISSUED,
    } as IssuedOmrForm;
    const h = harness({ selected: [USER_A], predecessors: [predecessor] });
    h.omr.renderIssuedBatch.mockRejectedValue(new Error('OMR timeout'));

    await expect(h.service.issueBatch(
      { userIds: [USER_A_ID], mode: OmrFormMode.CODE },
      ACTOR,
    )).rejects.toThrow('OMR timeout');
    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(h.commitManager.query).not.toHaveBeenCalled();
    expect(h.commitManager.save).not.toHaveBeenCalled();
    expect(predecessor.status).toBe(IssuedOmrFormStatus.ISSUED);
  });

  it('revalidates authorization, activity, identity, and same exact zone/cell before mutation', async () => {
    const changedCases: Array<[string, User[], string]> = [
      ['inactive user', [user(USER_A_ID, { isActive: false })], 'OMR_FORM.ROSTER_CHANGED'],
      ['renamed user', [user(USER_A_ID, { name: 'Changed' })], 'OMR_FORM.ROSTER_CHANGED'],
      ['moved user', [user(USER_A_ID, { cell: 'A-13' })], 'OMR_FORM.ROSTER_CHANGED'],
    ];
    for (const [, locked, code] of changedCases) {
      const h = harness({ selected: [USER_A], locked });
      await expect(h.service.issueBatch(
        { userIds: [USER_A_ID], mode: OmrFormMode.CODE },
        ACTOR,
      )).rejects.toMatchObject({ response: { code } });
      expect(h.commitManager.save).not.toHaveBeenCalled();
    }

    const mixed = harness({
      selected: [USER_A, USER_B],
      locked: [USER_A, user(USER_B_ID, { cell: 'A-13' })],
    });
    await expect(mixed.service.issueBatch(
      { userIds: [USER_A_ID, USER_B_ID], mode: OmrFormMode.CODE },
      ACTOR,
    )).rejects.toMatchObject({ response: { code: 'OMR_FORM.ROSTER_CHANGED' } });
    expect(mixed.commitManager.save).not.toHaveBeenCalled();

    const denied = harness({ selected: [USER_A], locked: [USER_A] });
    denied.zoneAccess.assertUserAccess.mockRejectedValue(
      new NotFoundException({ code: 'USER.NOT_FOUND' }),
    );
    await expect(denied.service.issueBatch(
      { userIds: [USER_A_ID], mode: OmrFormMode.CODE },
      ACTOR,
    )).rejects.toMatchObject({ response: { code: 'USER.NOT_FOUND' } });
    expect(denied.commitManager.save).not.toHaveBeenCalled();
  });

  it('rejects a retired/changed template before void or insert', async () => {
    const h = harness({
      selected: [USER_A],
      locked: [USER_A],
      currentTemplate: template({ isActive: false, retiredAt: new Date() }),
    });

    await expect(h.service.issueBatch(
      { userIds: [USER_A_ID], mode: OmrFormMode.CODE },
      ACTOR,
    )).rejects.toMatchObject({ response: { code: 'OMR_FORM.TEMPLATE_CHANGED' } });
    expect(h.commitManager.save).not.toHaveBeenCalled();
  });

  it('rejects a full-list catalog change before void or insert', async () => {
    const before = menuItems(2);
    const after = menuItems(2);
    after[1] = { ...after[1], name: 'Changed item' } as MenuItem;
    const rows = catalogRows(before);
    const fullTemplate = template({
      revision: 'a5-full-r1',
      mode: OmrFormMode.FULL_LIST,
      orientation: OmrFormOrientation.LANDSCAPE,
      catalogHash: canonicalCatalogHash(rows),
      rows: rows.map((row, rowIndex) => ({ ...row, rowIndex })) as never,
    });
    const h = harness({
      selected: [USER_A],
      locked: [USER_A],
      activeTemplates: [fullTemplate],
      currentTemplate: fullTemplate,
      catalog: before,
      currentCatalog: after,
    });

    await expect(h.service.issueBatch(
      { userIds: [USER_A_ID], mode: OmrFormMode.FULL_LIST },
      ACTOR,
    )).rejects.toMatchObject({ response: { code: 'OMR_TEMPLATE.CATALOG_CHANGED' } });
    expect(h.commitManager.save).not.toHaveBeenCalled();
  });

  it('reports full-list readiness at 52 items, rejects it at 53, and keeps code mode available', async () => {
    for (const count of [52, 53]) {
      const items = menuItems(count);
      const rows = catalogRows(items);
      const fullTemplate = template({
        id: '44444444-4444-4444-8444-444444444444',
        revision: 'full-r1',
        mode: OmrFormMode.FULL_LIST,
        orientation: OmrFormOrientation.LANDSCAPE,
        catalogHash: canonicalCatalogHash(rows),
      });
      const h = harness({
        activeTemplates: [template(), fullTemplate],
        catalog: items,
      });

      const result = await h.service.getCapabilities();
      const code = result.modes.find((mode) => mode.mode === OmrFormMode.CODE)!;
      const full = result.modes.find((mode) => mode.mode === OmrFormMode.FULL_LIST)!;
      expect(code).toMatchObject({
        available: true,
        templateRevision: 'a5-code-r1',
        orientation: OmrFormOrientation.PORTRAIT,
        itemCount: count,
        capacity: null,
      });
      expect(full).toMatchObject(count === 52
        ? {
          available: true,
          unavailableCode: null,
          templateRevision: 'full-r1',
          orientation: OmrFormOrientation.LANDSCAPE,
          itemCount: 52,
          capacity: 52,
        }
        : {
          available: false,
          unavailableCode: 'OMR_TEMPLATE.CAPACITY_EXCEEDED',
          templateRevision: 'full-r1',
          orientation: OmrFormOrientation.LANDSCAPE,
          itemCount: 53,
          capacity: 52,
        });
      expect(h.catalogManager.query).toHaveBeenCalledTimes(1);
      expect(h.catalogManager.find.mock.calls.map(([entity]) => entity)).toEqual([
        OmrFormTemplate,
        MenuItem,
      ]);
      expect(h.templates.getActiveTemplates).not.toHaveBeenCalled();
    }
  });

  it('reports active template metadata and expected orientation fallbacks from one coherent snapshot', async () => {
    const activeCode = template({
      revision: 'code-actual',
      orientation: OmrFormOrientation.LANDSCAPE,
    });
    const h = harness({ activeTemplates: [activeCode], catalog: menuItems(2) });

    const result = await h.service.getCapabilities();

    expect(result.modes).toEqual([
      {
        mode: OmrFormMode.CODE,
        available: true,
        unavailableCode: null,
        templateRevision: 'code-actual',
        orientation: OmrFormOrientation.LANDSCAPE,
        itemCount: 2,
        capacity: null,
      },
      {
        mode: OmrFormMode.FULL_LIST,
        available: false,
        unavailableCode: 'OMR_FORM.TEMPLATE_NOT_READY',
        templateRevision: null,
        orientation: OmrFormOrientation.LANDSCAPE,
        itemCount: 2,
        capacity: 52,
      },
    ]);
  });
});

describe('OmrFormsService generic software mode', () => {
  it('disables personalized issuance while preserving the generic master path', async () => {
    const h = harness({ operationalMode: OmrOperationalFormMode.GENERIC });
    await expect(h.service.issueBatch(
      { userIds: [USER_A_ID], mode: OmrFormMode.CODE },
      ACTOR,
    )).rejects.toMatchObject({ response: { code: 'OMR_GENERIC.PERSONALIZED_ISSUANCE_DISABLED' } });
    expect(h.omr.renderIssuedBatch).not.toHaveBeenCalled();
  });

  it('renders one read-only static-reference master and revalidates the active template', async () => {
    const active = template();
    const h = harness({
      activeTemplates: [active],
      currentTemplate: active,
      operationalMode: OmrOperationalFormMode.GENERIC,
    });
    const result = await h.service.getGenericMaster(OmrFormMode.CODE);
    expect(h.operationalMode?.assertGenericReady).toHaveBeenCalledTimes(1);
    expect(h.omr.renderGenericMaster).toHaveBeenCalledWith(expect.objectContaining({
      mode: OmrFormMode.CODE,
      template_id: active.id,
      template_revision: active.revision,
      catalog_rows: [],
    }));
    expect(h.templates.resolveForIssuedForm).toHaveBeenCalledWith(active.id);
    expect(result).toEqual(expect.objectContaining({
      mode: OmrFormMode.CODE,
      templateId: active.id,
      formReference: `CM-G1:${active.id}`,
      pageCount: 1,
      pdfBase64: 'JVBERi0xLjQ=',
    }));
  });

  it('rejects generic master downloads in issued mode', async () => {
    const h = harness({ operationalMode: OmrOperationalFormMode.ISSUED });
    await expect(h.service.getGenericMaster(OmrFormMode.CODE)).rejects.toMatchObject({
      response: { code: 'OMR_GENERIC.MODE_DISABLED' },
    });
    expect(h.omr.renderGenericMaster).not.toHaveBeenCalled();
  });

  it('rejects a template changed while rendering', async () => {
    const active = template();
    const h = harness({
      activeTemplates: [active],
      currentTemplate: template({ revision: 'generic-r2' }),
      operationalMode: OmrOperationalFormMode.GENERIC,
    });
    await expect(h.service.getGenericMaster(OmrFormMode.CODE)).rejects.toMatchObject({
      response: { code: 'OMR_FORM.TEMPLATE_CHANGED' },
    });
  });
});
