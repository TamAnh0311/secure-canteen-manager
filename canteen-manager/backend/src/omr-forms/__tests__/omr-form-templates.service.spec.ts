import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  canonicalCatalogHash,
  canonicalGeometryHash,
  OmrFormTemplatesService,
} from '../omr-form-templates.service';
import { OmrFormMode, OmrFormOrientation } from '../omr-form-template.entity';
import { MenuItem } from '../../menu/menu-item.entity';

const CODE_GEOMETRY = {
  paper: { widthMm: 148, heightMm: 210 },
  qr: { x: 12.5, y: 9 },
  labels: ['Đơn hàng', 'Căn tin'],
};

describe('canonical OMR template hashes', () => {
  it('is stable across object key order and Unicode normalization', () => {
    expect(canonicalGeometryHash({ b: 'Căn tin', a: 1 })).toBe(
      canonicalGeometryHash({ a: 1, b: 'Căn tin' }),
    );
  });

  it('includes ordered catalog snapshots and positions', () => {
    const rows = [
      { menuItemId: 'm1', codeSnapshot: '001', shortLabelSnapshot: 'Cơm', position: 4 },
      { menuItemId: 'm2', codeSnapshot: '002', shortLabelSnapshot: 'Sữa', position: 7 },
    ];
    expect(canonicalCatalogHash(rows)).not.toBe(canonicalCatalogHash([...rows].reverse()));
    expect(canonicalCatalogHash(rows)).not.toBe(
      canonicalCatalogHash([{ ...rows[0], shortLabelSnapshot: 'Cơm mới' }, rows[1]]),
    );
  });
});

describe('OmrFormTemplatesService validation', () => {
  const service = new OmrFormTemplatesService({} as never);

  it('accepts code portrait with no rows and rejects wrong orientation', () => {
    expect(() => service.validateDraft({
      mode: OmrFormMode.CODE,
      orientation: OmrFormOrientation.PORTRAIT,
      geometry: CODE_GEOMETRY,
      rows: [],
    })).not.toThrow();
    expect(() => service.validateDraft({
      mode: OmrFormMode.CODE,
      orientation: OmrFormOrientation.LANDSCAPE,
      geometry: CODE_GEOMETRY,
      rows: [],
    })).toThrow(BadRequestException);
  });

  it('rejects code rows and validates full-list 52/53 boundaries', () => {
    const rows = Array.from({ length: 53 }, (_, index) => ({
      menuItemId: `m${index}`,
      codeSnapshot: String(index + 1).padStart(3, '0'),
      shortLabelSnapshot: `Item ${index}`,
      position: index,
    }));
    expect(() => service.validateDraft({
      mode: OmrFormMode.CODE,
      orientation: OmrFormOrientation.PORTRAIT,
      geometry: CODE_GEOMETRY,
      rows: rows.slice(0, 1),
    })).toThrow(BadRequestException);
    expect(() => service.validateDraft({
      mode: OmrFormMode.FULL_LIST,
      orientation: OmrFormOrientation.LANDSCAPE,
      geometry: CODE_GEOMETRY,
      rows: rows.slice(0, 52),
    })).not.toThrow();
    try {
      service.validateDraft({
        mode: OmrFormMode.FULL_LIST,
        orientation: OmrFormOrientation.LANDSCAPE,
        geometry: CODE_GEOMETRY,
        rows,
      });
      throw new Error('expected capacity rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'OMR_TEMPLATE.CAPACITY_EXCEEDED',
      });
    }
  });

  it('rejects non-three-digit row snapshots', () => {
    expect(() => service.validateDraft({
      mode: OmrFormMode.FULL_LIST,
      orientation: OmrFormOrientation.LANDSCAPE,
      geometry: CODE_GEOMETRY,
      rows: [{ menuItemId: 'm1', codeSnapshot: '12', shortLabelSnapshot: 'Rice', position: 2 }],
    })).toThrow(BadRequestException);
  });

  it('distinguishes retired decoding from new issuance', () => {
    const retired = {
      id: 'template-1',
      isActive: false,
      catalogHash: null,
    };
    expect(() => service.assertIssuable(retired as never, null)).toThrow(ConflictException);
  });
});

describe('OmrFormTemplatesService activation', () => {
  function buildActivationHarness(itemCount: number) {
    const events: string[] = [];
    const templates: Array<Record<string, unknown>> = [];
    const rows: Array<Record<string, unknown>> = [];
    const menu = Array.from({ length: itemCount }, (_, position) => ({
      id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
      code: String(position + 1).padStart(3, '0'),
      name: `Item ${position}`,
      position,
      isActive: true,
    })) as MenuItem[];
    const manager = {
      query: jest.fn(async () => { events.push('lock'); }),
      find: jest.fn(async (entity: unknown) => {
        events.push('snapshot');
        return entity === MenuItem ? menu : [];
      }),
      findOne: jest.fn(async () => null),
      update: jest.fn(async (_entity: unknown, _where: unknown, changes: Record<string, unknown>) => {
        events.push('retire');
        for (const template of templates) {
          if (template.isActive) Object.assign(template, changes);
        }
      }),
      create: jest.fn((_entity: unknown, value: Record<string, unknown>) => ({ ...value })),
      save: jest.fn(async (entity: unknown, value: Record<string, unknown> | Array<Record<string, unknown>>) => {
        events.push(Array.isArray(value) ? 'save-rows' : 'save-template');
        if (Array.isArray(value)) {
          rows.push(...value);
          return value;
        }
        if (value.id) {
          const index = templates.findIndex((template) => template.id === value.id);
          if (index >= 0) templates[index] = value;
          return value;
        }
        const saved = { id: `template-${templates.length + 1}`, ...value };
        templates.push(saved);
        return saved;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (em: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    return {
      service: new OmrFormTemplatesService(dataSource as never),
      manager,
      templates,
      rows,
      events,
    };
  }

  it('locks before taking one coherent catalog snapshot and stores 52 ordered rows', async () => {
    const harness = buildActivationHarness(52);
    const template = await harness.service.activateFullListTemplate({
      revision: 'a5-full-list-v1',
      geometry: { schema: 'omr-a5-v1' },
    });
    expect(template.mode).toBe(OmrFormMode.FULL_LIST);
    expect(harness.rows).toHaveLength(52);
    expect(harness.events.slice(0, 2)).toEqual(['lock', 'snapshot']);
    expect(harness.events).toEqual([
      'lock',
      'snapshot',
      'save-template',
      'save-rows',
      'retire',
      'save-template',
    ]);
    expect(harness.rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  it('rejects 53 active items before template or row mutation', async () => {
    const harness = buildActivationHarness(53);
    await expect(harness.service.activateFullListTemplate({
      revision: 'a5-full-list-too-large',
      geometry: { schema: 'omr-a5-v1' },
    })).rejects.toMatchObject({ response: { code: 'OMR_TEMPLATE.CAPACITY_EXCEEDED' } });
    expect(harness.templates).toHaveLength(0);
    expect(harness.rows).toHaveLength(0);
    expect(harness.manager.update).not.toHaveBeenCalled();
  });

  it('retires the prior active mode atomically before activating its replacement', async () => {
    const harness = buildActivationHarness(0);
    const first = await harness.service.activateCodeTemplate({
      revision: 'a5-code-v1',
      geometry: { schema: 'omr-a5-v1', revision: 1 },
    });
    const second = await harness.service.activateCodeTemplate({
      revision: 'a5-code-v2',
      geometry: { schema: 'omr-a5-v1', revision: 2 },
    });
    expect(first.isActive).toBe(false);
    expect(first.retiredAt).toBeInstanceOf(Date);
    expect(second.isActive).toBe(true);
  });
});
