import { DataSource, EntityManager, Repository } from 'typeorm';
import { ScanProcessorService } from '../scan-processor.service';
import { OmrOperationalFormMode, Sheet } from '../sheet.entity';
import { SheetStatus } from '../sheet-status.enum';
import { ScanStorageService } from '../scan-storage.service';
import { OmrClientService } from '../../omr/omr-client.service';
import { UsersService } from '../../users/users.service';
import { ThresholdConfigService } from '../../config/threshold-config.service';
import { User } from '../../users/user.entity';
import { MenuItem } from '../../menu/menu-item.entity';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../../omr-forms/issued-omr-form.entity';
import { OmrFormMode, OmrFormOrientation, OmrFormTemplate } from '../../omr-forms/omr-form-template.entity';
import { Operator, OperatorRole } from '../../operators/operator.entity';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';

export const FORM_TOKEN = '123e4567-e89b-42d3-a456-426614174000';
export const GENERIC_TEMPLATE_ID = '223e4567-e89b-42d3-a456-426614174000';

export interface OmrResult {
  warp_ok: boolean;
  form_token: string | null;
  form_reference?: string | null;
  recognized_id: string | null;
  id_digits: unknown[];
  avg_confidence: number;
  flags: string[];
  order_lines: Array<{
    line_index: number;
    code: string | null;
    qty: number | null;
    code_digits: unknown[];
    qty_digits: unknown[];
    flags: string[];
  }>;
  handwriting_fields?: Array<{
    field: 'name' | 'cell' | 'prisoner_id';
    status: 'recognized' | 'blank' | 'abstained' | 'error';
    raw_text: string | null;
    confidence: number | null;
    raw_score: number | null;
    flags: string[];
  }>;
  handwriting_model?: null;
}

export interface MockDeps {
  repo: jest.Mocked<Pick<Repository<Sheet>, 'find' | 'findOneOrFail' | 'save'>>;
  storage: { readImageAsBase64: jest.Mock };
  omrClient: { identifyFormToken: jest.Mock; processScan: jest.Mock };
  usersService: { findByLegacyId: jest.Mock; findActiveByExactCell: jest.Mock };
  thresholdConfig: { resolve: jest.Mock; getRoi: jest.Mock };
  dataSource: { transaction: jest.Mock };
  manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    query: jest.Mock;
  };
  setIssuedForm: (form: IssuedOmrForm | null) => void;
  setGenericTemplate: (template: OmrFormTemplate | null) => void;
  registerSheet: (sheet: Sheet) => void;
}

export function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: 'sheet-uuid-1',
    sheetId: 'FORM-001',
    batch: null,
    serviceDate: '2026-07-15',
    checksum: 'a'.repeat(64),
    imagePath: 'abc123.jpg',
    status: SheetStatus.PENDING,
    resultJson: null,
    avgConfidence: null,
    recognizedId: null,
    matchedUserId: null,
    orderId: null,
    flags: null,
    issuedFormId: null,
    issuedForm: null,
    templateId: null,
    admittedMode: OmrOperationalFormMode.ISSUED,
    admittedBy: null,
    processingAttempts: 0,
    nextRetryAt: null,
    lastErrorCode: null,
    rejectionCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    processedAt: null,
    matchedUser: null,
    ...overrides,
  } as Sheet;
}

export function makeRoiState(overrides: Record<string, unknown> = {}): {
  roiTemplate: object | null;
  roiVersion: string | null;
  roiGeneratedAt: Date | null;
} {
  return {
    roiTemplate: {
      roi_version: 'v3',
      digit_boxes: [],
      qr_roi: { x: 100, y: 100, w: 300, h: 300 },
      order_lines: [],
    },
    roiVersion: 'v3',
    roiGeneratedAt: new Date(),
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    legacyId: 'P-004218',
    name: 'Alice',
    isActive: true,
    ...overrides,
  } as User;
}

export function makeIssuedForm(overrides: Partial<IssuedOmrForm> = {}): IssuedOmrForm {
  const user = makeUser();
  const template = {
    id: 'template-uuid-1',
    revision: 'v3',
    mode: OmrFormMode.CODE,
    paperSize: 'A5',
    orientation: OmrFormOrientation.PORTRAIT,
    geometry: makeRoiState().roiTemplate,
    geometryHash: 'a'.repeat(64),
    catalogHash: null,
    isActive: true,
    activatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    rows: [],
  } as OmrFormTemplate;
  return {
    token: FORM_TOKEN,
    userId: user.id,
    user,
    serviceDate: '2026-07-15',
    roiVersion: 'v3',
    templateId: template.id,
    template,
    formMode: OmrFormMode.CODE,
    issuedBy: 'operator-uuid-1',
    issuer: null,
    status: IssuedOmrFormStatus.ISSUED,
    consumedSheetId: null,
    reservedSheetId: null,
    voidReason: null,
    issuedAt: new Date(),
    consumedAt: null,
    voidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IssuedOmrForm;
}

export function makeGenericTemplate(overrides: Partial<OmrFormTemplate> = {}): OmrFormTemplate {
  return {
    id: GENERIC_TEMPLATE_ID,
    revision: 'generic-r1',
    mode: OmrFormMode.CODE,
    paperSize: 'A5',
    orientation: OmrFormOrientation.PORTRAIT,
    geometry: makeRoiState({ roiVersion: 'generic-r1' }).roiTemplate,
    geometryHash: 'b'.repeat(64),
    catalogHash: null,
    isActive: true,
    activatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    rows: [],
    ...overrides,
  } as OmrFormTemplate;
}

export function makeMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'item-uuid-1',
    code: '01',
    name: 'Rice',
    position: 0,
    isActive: true,
    ...overrides,
  } as MenuItem;
}

export function makeOmrResult(overrides: Partial<OmrResult> = {}): OmrResult {
  return {
    warp_ok: true,
    form_token: FORM_TOKEN,
    recognized_id: null,
    id_digits: [],
    avg_confidence: 0.95,
    flags: [],
    order_lines: [
      {
        line_index: 0,
        code: '001',
        qty: 1,
        code_digits: [],
        qty_digits: [],
        flags: [],
      },
    ],
    ...overrides,
  };
}

export function buildService(): { svc: ScanProcessorService; deps: MockDeps } {
  const sheets = new Map<string, Sheet>();
  let issuedForm: IssuedOmrForm | null = makeIssuedForm();
  let genericTemplate: OmrFormTemplate | null = null;
  const operator = {
    id: 'operator-uuid-1',
    username: 'operator',
    role: OperatorRole.ADMIN,
    zone: null,
    isActive: true,
  } as Operator;

  const savedStatuses: SheetStatus[] = [];
  const saveMock = jest.fn(async (sheet: Sheet) => {
    savedStatuses.push(sheet.status);
    sheets.set(sheet.id, sheet);
    return sheet;
  });
  (saveMock as jest.Mock & { _snapshots: SheetStatus[] })._snapshots = savedStatuses;

  const manager = {
    findOne: jest.fn(async (entity: unknown, options?: { where?: Record<string, unknown> }) => {
      if (entity === IssuedOmrForm) {
        const token = options?.where?.token;
        return issuedForm && (!token || issuedForm.token === token) ? issuedForm : null;
      }
      if (entity === User) {
        const id = options?.where?.id;
        return issuedForm?.user && (!id || issuedForm.user.id === id) ? issuedForm.user : null;
      }
      if (entity === OmrFormTemplate) return genericTemplate;
      if (entity === Operator) return operator;
      if (entity === Sheet) {
        const id = options?.where?.id;
        return typeof id === 'string' ? sheets.get(id) ?? null : null;
      }
      return null;
    }),
    find: jest.fn(async (entity: unknown, options?: { where?: Record<string, unknown> }) => {
      if (entity !== Sheet) return [];
      const formId = options?.where?.issuedFormId;
      return [...sheets.values()].filter(
        (sheet) => !formId || (sheet as Sheet & { issuedFormId?: string }).issuedFormId === formId,
      );
    }),
    save: jest.fn(async (entityOrValue: unknown, maybeValue?: unknown) => {
      const value = (maybeValue ?? entityOrValue) as Sheet | IssuedOmrForm;
      if ('sheetId' in value) {
        savedStatuses.push(value.status);
        sheets.set(value.id, value);
      } else if ('token' in value) {
        issuedForm = value;
      }
      return value;
    }),
    update: jest.fn(async (entity: unknown, criteria: unknown, patch: Record<string, unknown>) => {
      if (entity === IssuedOmrForm && issuedForm) Object.assign(issuedForm, patch);
      if (entity === Sheet) {
        const ids = typeof criteria === 'string'
          ? [criteria]
          : Object.values(criteria as Record<string, unknown>).filter(
              (value): value is string => typeof value === 'string',
            );
        for (const id of ids) {
          const sheet = sheets.get(id);
          if (sheet) Object.assign(sheet, patch);
        }
      }
      return { affected: 1 };
    }),
    query: jest.fn().mockResolvedValue([]),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (entityManager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager)),
    getRepository: jest.fn((entity: unknown) => ({
      findOne: jest.fn(async ({ where }: { where: Record<string, string> }) => {
        if (entity === IssuedOmrForm) return issuedForm?.token === where.token ? issuedForm : null;
        if (entity === OmrFormTemplate) return genericTemplate?.id === where.id ? genericTemplate : null;
        if (entity === Operator) return operator.id === where.id ? operator : null;
        return null;
      }),
    })),
  };

  const deps: MockDeps = {
    repo: {
      find: jest.fn().mockResolvedValue([]),
      findOneOrFail: jest.fn(async ({ where }: { where: { id: string } }) => {
        const sheet = sheets.get(where.id);
        if (!sheet) throw new Error('not found');
        return sheet;
      }),
      save: saveMock,
    } as unknown as jest.Mocked<Pick<Repository<Sheet>, 'find' | 'findOneOrFail' | 'save'>>,
    storage: { readImageAsBase64: jest.fn().mockReturnValue('base64data') },
    omrClient: {
      identifyFormToken: jest.fn().mockResolvedValue({ form_token: FORM_TOKEN, flags: [] }),
      processScan: jest.fn(),
    },
    usersService: { findByLegacyId: jest.fn(), findActiveByExactCell: jest.fn().mockResolvedValue([]) },
    thresholdConfig: {
      resolve: jest.fn().mockResolvedValue({
        digitBoxCount: 0,
        omrEmptyMax: 0.30,
        omrTickedMin: 0.70,
        icrThreshold: 0.85,
      }),
      getRoi: jest.fn().mockResolvedValue(makeRoiState()),
    },
    dataSource,
    manager,
    setIssuedForm: (form) => {
      issuedForm = form;
    },
    setGenericTemplate: (template) => {
      genericTemplate = template;
    },
    registerSheet: (sheet) => {
      sheets.set(sheet.id, sheet);
    },
  };

  const svc = new ScanProcessorService(
    deps.repo as unknown as Repository<Sheet>,
    deps.storage as unknown as ScanStorageService,
    deps.omrClient as unknown as OmrClientService,
    deps.usersService as unknown as UsersService,
    deps.thresholdConfig as unknown as ThresholdConfigService,
    deps.dataSource as unknown as DataSource,
    { omrRuntimeEnabled: true } as ScanWorkflowModeService,
  );

  return { svc, deps };
}

export async function drainQueue(
  svc: ScanProcessorService,
  deps: MockDeps,
  sheetId: string,
): Promise<Sheet> {
  svc.enqueue(sheetId);
  await (svc as unknown as { tail: Promise<void> }).tail;

  const candidates: Array<{ order: number; sheet: Sheet }> = [];
  (deps.repo.save as jest.Mock).mock.calls.forEach(([sheet]: [Sheet], index: number) => {
    candidates.push({
      order: (deps.repo.save as jest.Mock).mock.invocationCallOrder[index],
      sheet,
    });
  });
  deps.manager.save.mock.calls.forEach((args: unknown[], index: number) => {
    const value = (args.length > 1 ? args[1] : args[0]) as Partial<Sheet>;
    if (value && typeof value === 'object' && 'sheetId' in value) {
      candidates.push({ order: deps.manager.save.mock.invocationCallOrder[index], sheet: value as Sheet });
    }
  });

  const last = candidates.sort((a, b) => b.order - a.order)[0];
  if (!last) throw new Error(`No sheet state was saved for ${sheetId}`);
  return last.sheet;
}
