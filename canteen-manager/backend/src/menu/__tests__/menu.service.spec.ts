import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MenuService } from '../menu.service';
import { MenuItem } from '../menu-item.entity';
import { ThresholdConfigService } from '../../config/threshold-config.service';
import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { MAX_VND } from '../../common/numeric.transformer';
import { MenuItemCategory } from '../menu-item-category.enum';

// ---------------------------------------------------------------------------
// In-memory MenuItem store + repo/dataSource doubles.
//
// The store keeps soft-deleted rows (isActive=false) physically present, exactly
// like the production store: there is no DeleteDateColumn — soft-delete just flips
// isActive. nextPosition/nextCode therefore see every row, deleted or not, which is
// the invariant under test (a freed position must never be handed out again).
// ---------------------------------------------------------------------------

interface Doubles {
  svc: MenuService;
  repo: Repository<MenuItem>;
  store: MenuItem[];
}

function buildService(): Doubles {
  const store: MenuItem[] = [];
  let seq = 0;

  const persist = (item: MenuItem): MenuItem => {
    if (!item.id) item.id = `item-${seq++}`;
    const idx = store.findIndex((m) => m.id === item.id);
    if (idx >= 0) store[idx] = item;
    else store.push(item);
    return item;
  };

  const repo = {
    find: jest.fn(async (opts?: { order?: { position?: 'ASC' | 'DESC'; code?: 'ASC' | 'DESC' } }) => {
      const rows = [...store];
      if (opts?.order?.position === 'ASC') rows.sort((a, b) => a.position - b.position);
      if (opts?.order?.position === 'DESC') rows.sort((a, b) => b.position - a.position);
      if (opts?.order?.code === 'ASC') rows.sort((a, b) => a.code.localeCompare(b.code));
      if (opts?.order?.code === 'DESC') rows.sort((a, b) => b.code.localeCompare(a.code));
      return rows;
    }),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      store.find((m) => m.id === where.id) ?? null,
    ),
    create: jest.fn((data: Partial<MenuItem>) => ({ ...data }) as MenuItem),
    save: jest.fn(async (item: MenuItem) => persist(item)),
    remove: jest.fn(async (item: MenuItem) => {
      const idx = store.findIndex((m) => m.id === item.id);
      if (idx >= 0) store.splice(idx, 1);
      return item;
    }),
  } as unknown as Repository<MenuItem>;

  // Transaction double: runs the callback against an EntityManager that proxies
  // the same in-memory store, mirroring the production two-phase position writes.
  const em = {
    connection: { options: { type: 'better-sqlite3' } },
    create: (_e: unknown, data: Partial<MenuItem>) => (repo.create as jest.Mock)(data),
    find: async (_e: unknown, opts?: { order?: { position?: 'ASC' | 'DESC' } }) =>
      (repo.find as jest.Mock)(opts),
    findOne: async (_e: unknown, opts: { where: { id: string } }) =>
      (repo.findOne as jest.Mock)(opts),
    save: async (_e: unknown, payload: MenuItem | MenuItem[]) =>
      Array.isArray(payload) ? payload.map(persist) : persist(payload),
    remove: async (_e: unknown, item: MenuItem) => (repo.remove as jest.Mock)(item),
    query: jest.fn(async () => []),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) => cb(em)),
  } as unknown as DataSource;

  const thresholdConfig = {} as unknown as ThresholdConfigService;
  const svc = new MenuService(repo, thresholdConfig, dataSource);
  return { svc, repo, store };
}

// ---------------------------------------------------------------------------
// addItem — monotonic code + position
// ---------------------------------------------------------------------------

describe('MenuService.addItem — monotonic code + position', () => {
  it('rejects the first code that cannot fit the three printed boxes', async () => {
    const { svc, store } = buildService();
    store.push({ id: 'item-999', code: '999', position: 998, name: 'Last', isActive: true } as MenuItem);
    await expect(svc.addItem({ name: 'Overflow', price: 1, category: MenuItemCategory.FOOD }))
      .rejects.toMatchObject({ response: { code: 'MENU.CODE_WIDTH_EXCEEDED' } });
  });

  it('assigns zero-padded codes 001,002 and positions 0,1 for two adds', async () => {
    const { svc } = buildService();

    const a = await svc.addItem({ name: 'Rice', price: 5000, category: MenuItemCategory.FOOD });
    const b = await svc.addItem({ name: 'Soup', price: 3000, category: MenuItemCategory.FOOD });

    expect(a.position).toBe(0);
    expect(a.code).toBe('001');
    expect(b.position).toBe(1);
    expect(b.code).toBe('002');
  });

  it('persists the price passed and returns it', async () => {
    const { svc, repo } = buildService();
    const created = await svc.addItem({ name: 'Noodles', price: 5000, category: MenuItemCategory.FOOD });
    expect(created.price).toBe(5000);
    const createArg = (repo.create as jest.Mock).mock.calls[0][0];
    expect(createArg.price).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// removeItem — hard-delete + reindex (no form-lock in SQLite mode)
// ---------------------------------------------------------------------------

describe('MenuService.removeItem', () => {
  it('hard-deletes and reindexes positions', async () => {
    const { svc, store } = buildService();
    const a = await svc.addItem({ name: 'A', price: 1, category: MenuItemCategory.FOOD }); // pos 0
    const b = await svc.addItem({ name: 'B', price: 1, category: MenuItemCategory.FOOD }); // pos 1
    const c = await svc.addItem({ name: 'C', price: 1, category: MenuItemCategory.FOOD }); // pos 2

    await svc.removeItem(b.id);

    expect(store.find((m) => m.id === b.id)).toBeUndefined(); // gone physically
    const positions = store
      .slice()
      .sort((x, y) => x.position - y.position)
      .map((m) => m.position);
    expect(positions).toEqual([0, 1]); // reindexed contiguous
    expect(store.find((m) => m.id === a.id)!.position).toBe(0);
    expect(store.find((m) => m.id === c.id)!.position).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reorder
// ---------------------------------------------------------------------------

describe('MenuService.reorder', () => {
  it('reorders items correctly', async () => {
    const { svc } = buildService();
    const a = await svc.addItem({ name: 'A', price: 1, category: MenuItemCategory.FOOD });
    const b = await svc.addItem({ name: 'B', price: 1, category: MenuItemCategory.FOOD });

    const result = await svc.reorder([b.id, a.id]);
    const byId = new Map(result.map((r) => [r.id, r.position]));
    expect(byId.get(b.id)).toBe(0);
    expect(byId.get(a.id)).toBe(1);
  });

  it('throws REORDER_COUNT_MISMATCH when IDs count does not match item count', async () => {
    const { svc } = buildService();
    const a = await svc.addItem({ name: 'A', price: 1, category: MenuItemCategory.FOOD });
    await expect(svc.reorder([])).rejects.toMatchObject({ response: { code: 'MENU.REORDER_COUNT_MISMATCH' } });
    void a;
  });
});

// ---------------------------------------------------------------------------
// updateItem
// ---------------------------------------------------------------------------

describe('MenuService.updateItem', () => {
  it('updates name, price, category, and isActive', async () => {
    const { svc } = buildService();
    const item = await svc.addItem({ name: 'Rice', price: 5000, category: MenuItemCategory.FOOD });

    const updated = await svc.updateItem(item.id, { name: 'Rice+', price: 6000, isActive: false } as UpdateMenuItemDto);
    expect(updated.name).toBe('Rice+');
    expect(updated.price).toBe(6000);
    expect(updated.isActive).toBe(false);
  });

  it('allows a name edit at any time', async () => {
    const { svc } = buildService();
    const a = await svc.addItem({ name: 'A', price: 1, category: MenuItemCategory.FOOD });
    const renamed = await svc.updateItem(a.id, { name: 'A2' } as UpdateMenuItemDto);
    expect(renamed.name).toBe('A2');
  });

  it('allows category edits', async () => {
    const { svc } = buildService();
    const item = await svc.addItem({ name: 'Soap', price: 5000, category: MenuItemCategory.FOOD });
    const updated = await svc.updateItem(item.id, { category: MenuItemCategory.ESSENTIAL });
    expect(updated.category).toBe(MenuItemCategory.ESSENTIAL);
  });
});

// ---------------------------------------------------------------------------
// listAll — global, position-ordered
// ---------------------------------------------------------------------------

describe('MenuService.listAll', () => {
  it('returns all items ordered by position ascending', async () => {
    const { svc } = buildService();
    await svc.addItem({ name: 'A', price: 1, category: MenuItemCategory.FOOD });
    await svc.addItem({ name: 'B', price: 1, category: MenuItemCategory.FOOD });

    const list = await svc.listAll();
    expect(list.map((m) => m.position)).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// getSummary — required date, default tomorrow, never sums across dates
// ---------------------------------------------------------------------------

describe('MenuService.getSummary', () => {
  function buildSummaryService(captured: { serviceDate?: string }) {
    const qb: Record<string, jest.Mock> = {
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      from: jest.fn(() => qb),
      leftJoin: jest.fn((_t: string, _a: string, _c: string, params?: { serviceDate?: string }) => {
        if (params?.serviceDate) captured.serviceDate = params.serviceDate;
        return qb;
      }),
      where: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      addGroupBy: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      getRawMany: jest.fn(async () => [
        { menuItemId: 'm1', name: 'Rice', position: '0', count: '3' },
      ]),
    };
    const dataSource = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as DataSource;
    const repo = {} as unknown as Repository<MenuItem>;
    const thresholdConfig = {} as unknown as ThresholdConfigService;
    return new MenuService(repo, thresholdConfig, dataSource);
  }

  function tomorrowInDeployTz(): string {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }

  it('scopes to the given date', async () => {
    const captured: { serviceDate?: string } = {};
    const svc = buildSummaryService(captured);
    const rows = await svc.getSummary('2026-06-18');
    expect(captured.serviceDate).toBe('2026-06-18');
    expect(rows).toEqual([{ menuItemId: 'm1', name: 'Rice', position: 0, count: 3 }]);
  });

  it('defaults to tomorrow (deploy TZ) when no date supplied', async () => {
    const captured: { serviceDate?: string } = {};
    const svc = buildSummaryService(captured);
    await svc.getSummary();
    expect(captured.serviceDate).toBe(tomorrowInDeployTz());
  });
});

// ---------------------------------------------------------------------------
// DTO validation
// ---------------------------------------------------------------------------

describe('CreateMenuItemDto — price validation', () => {
  async function errorsFor(price: unknown) {
    const dto = plainToInstance(CreateMenuItemDto, { name: 'X', price, category: MenuItemCategory.FOOD });
    return validate(dto);
  }

  it('accepts a valid integer price within range', async () => {
    expect(await errorsFor(5000)).toHaveLength(0);
    expect(await errorsFor(0)).toHaveLength(0);
    expect(await errorsFor(MAX_VND)).toHaveLength(0);
  });

  it('rejects a price above MAX_VND', async () => {
    expect((await errorsFor(MAX_VND + 1)).length).toBeGreaterThan(0);
  });

  it('rejects a negative price', async () => {
    expect((await errorsFor(-1)).length).toBeGreaterThan(0);
  });

  it('rejects a non-integer price', async () => {
    expect((await errorsFor(50.5)).length).toBeGreaterThan(0);
  });
});

describe('menu item category DTO validation', () => {
  it('requires a valid category when creating an item', async () => {
    expect(await validate(plainToInstance(CreateMenuItemDto, { name: 'X', price: 1 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateMenuItemDto, { name: 'X', price: 1, category: 'other' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateMenuItemDto, { name: 'X', price: 1, category: MenuItemCategory.ESSENTIAL }))).toHaveLength(0);
  });
});
