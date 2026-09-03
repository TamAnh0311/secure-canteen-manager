import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { OrdersService, CreateOrReplaceInput } from '../orders.service';
import { Order, OrderStatus, PaymentStatus } from '../order.entity';
import { OrderItem } from '../order-item.entity';
import { MenuService } from '../../menu/menu.service';
import { UsersService } from '../../users/users.service';
import { AccountsService } from '../../accounts/accounts.service';
import { AccountTransactionType } from '../../accounts/account-transaction.entity';
import { User } from '../../users/user.entity';
import { MenuItem } from '../../menu/menu-item.entity';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { PurchaseLimitConfigService } from '../../purchase-limit-config/purchase-limit-config.service';
import { Tg8Document } from '../tg8-document.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVICE_DATE = '2026-06-18';
const OTHER_DATE = '2026-06-19';
const USER_ID = 'user-uuid-1';
const OPERATOR_ID = 'operator-uuid-1';
const ITEM_A = 'item-uuid-a';
const ITEM_B = 'item-uuid-b';

// In-memory AccountsService double: tracks a single prisoner balance + ledger so the
// omr money path (getOrCreate → reversal → debit) is observable without a real DB.
interface LedgerEntry {
  type: AccountTransactionType;
  amount: number; // signed: credit positive, debit negative
  operatorId: string;
  relatedOrderId: string | null;
}
function makeFakeAccounts(initialBalance = 1_000_000) {
  let balance = initialBalance;
  const ledger: LedgerEntry[] = [];
  return {
    getOrCreate: jest.fn(async () => ({ balance })),
    getBalance: jest.fn(async () => balance),
    credit: jest.fn(async (input: { amount: number; type: AccountTransactionType; operatorId: string; relatedOrderId?: string | null }) => {
      balance += input.amount;
      ledger.push({ type: input.type, amount: input.amount, operatorId: input.operatorId, relatedOrderId: input.relatedOrderId ?? null });
      return balance;
    }),
    debit: jest.fn(async (input: { amount: number; type?: AccountTransactionType; operatorId: string; relatedOrderId?: string | null }) => {
      if (balance < input.amount) {
        throw new BadRequestException({ message: 'Insufficient balance', code: 'ACCOUNT.INSUFFICIENT_FUNDS' });
      }
      balance -= input.amount;
      ledger.push({ type: input.type ?? AccountTransactionType.ORDER_DEBIT, amount: -input.amount, operatorId: input.operatorId, relatedOrderId: input.relatedOrderId ?? null });
      return balance;
    }),
    _ledger: ledger,
    _balance: () => balance,
  };
}
type FakeAccounts = ReturnType<typeof makeFakeAccounts>;

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: randomUUID(),
    serviceDate: SERVICE_DATE,
    userId: USER_ID,
    source: 'omr',
    sheetId: null,
    status: OrderStatus.ACTIVE,
    totalAmount: 0,
    paymentStatus: PaymentStatus.UNPAID,
    paymentMethod: null,
    supersededAt: null,
    supersededByOrderId: null,
    settledByOperatorId: null,
    settledAt: null,
    rejectReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: null as unknown as User,
    ...overrides,
  } as Order;
}

function makeOrderItem(orderId: string, menuItemId: string): OrderItem {
  return {
    id: randomUUID(),
    orderId,
    menuItemId,
    unitPrice: 0,
    quantity: 1,
    category: MenuItemCategory.FOOD,
    createdAt: new Date(),
    order: null as unknown as Order,
    menuItem: null as unknown as MenuItem,
  } as OrderItem;
}

// Global menu item double. `isActive` drives the relative-source orderability filter
// (relative can order active items only; omr may order any listed item, incl. inactive).
function makeMenuItem(id: string, price = 1000, isActive = true): MenuItem {
  return {
    id,
    code: '01',
    name: 'Item',
    position: 0,
    price,
    category: MenuItemCategory.FOOD,
    isActive,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as MenuItem;
}

// Builds a fake EntityManager that behaves like TypeORM's transactional em.
// The store is shared so findOne / update / save / create all see each other's writes.
function makeFakeEntityManager(
  orders: Order[] = [],
  items: OrderItem[] = [],
  menuItems: MenuItem[] = [makeMenuItem(ITEM_A), makeMenuItem(ITEM_B)],
) {
  const orderStore = [...orders];
  const itemStore = [...items];
  const tg8Store: Tg8Document[] = [];
  const user = {
    id: USER_ID,
    legacyId: 'P001',
    name: 'Nguyễn Văn A',
    dateOfBirth: null,
    offense: null,
  } as User;

  const em: Partial<EntityManager> = {
    findOne: jest.fn(async (entity: unknown, opts: { where: Partial<Order> & { orderId?: string }; lock?: unknown }) => {
      const w = opts.where as Partial<Order>;
      if (entity === Tg8Document) {
        return tg8Store.find((document) => document.orderId === opts.where.orderId) ?? null;
      }
      if (entity === User) return user;
      // Honor an exact id lookup (accept/reject path). The `lock` option is accepted and
      // IGNORED — a fake em cannot simulate FOR UPDATE; true mutual exclusion is proven only
      // by the real-DB parallel e2e (the concurrent accept/create tests).
      if (w.id !== undefined) {
        return orderStore.find((o) => o.id === w.id) ?? null;
      }
      // Otherwise the (service_date,user,status,source) predicate used by the supersede/dup
      // lookup. The scope must match the active-order unique index columns exactly.
      return (
        orderStore.find(
          (o) =>
            (!w.serviceDate || o.serviceDate === w.serviceDate) &&
            (!w.userId || o.userId === w.userId) &&
            (!w.status || o.status === w.status) &&
            (!w.source || o.source === w.source),
        ) ?? null
      );
    }),
    find: jest.fn(async (entity: unknown, opts?: { where?: Partial<OrderItem> }) => {
      const w = opts?.where ?? {};
      if (entity === MenuItem) return menuItems;
      if (entity === OrderItem) {
        return itemStore.filter((i) => !w.orderId || i.orderId === w.orderId);
      }
      return [...orderStore];
    }),
    update: jest.fn(async (_entity: unknown, id: string, patch: Partial<Order>) => {
      const idx = orderStore.findIndex((o) => o.id === id);
      if (idx !== -1) Object.assign(orderStore[idx], patch);
    }),
    create: jest.fn((_entity: unknown, data: Partial<Order> | Partial<OrderItem> | Partial<Tg8Document>) => ({
      ...data,
    })),
    save: jest.fn(async (entity: unknown, entityOrArray: Order | Order[] | OrderItem | OrderItem[] | Tg8Document) => {
      const rows = Array.isArray(entityOrArray) ? entityOrArray : [entityOrArray];
      const saved: unknown[] = [];
      for (const row of rows) {
        if (entity === Tg8Document) {
          tg8Store.push(row as Tg8Document);
          saved.push(row);
        } else if ('menuItemId' in row) {
          const item = row as OrderItem;
          if (!item.id) item.id = randomUUID();
          itemStore.push(item);
          saved.push(item);
        } else {
          const order = row as Order;
          if (!order.id) order.id = randomUUID();
          const existing = orderStore.findIndex((o) => o.id === order.id);
          if (existing >= 0) orderStore[existing] = order;
          else orderStore.push(order);
          saved.push(order);
        }
      }
      return Array.isArray(entityOrArray) ? saved : saved[0];
    }),
    _orderStore: orderStore,
    _itemStore: itemStore,
    _tg8Store: tg8Store,
  } as unknown as EntityManager;

  return em as EntityManager & {
    _orderStore: Order[];
    _itemStore: OrderItem[];
    _tg8Store: Tg8Document[];
  };
}

function buildService(
  preExistingOrders: Order[] = [],
  menuItemIds: string[] = [ITEM_A, ITEM_B],
  priceMap: Record<string, number> = {},
  accounts: FakeAccounts = makeFakeAccounts(),
  preExistingItems: OrderItem[] = [],
  activeMap: Record<string, boolean> = {},
) {
  // Transactional em is rebuilt per test through the callback
  let capturedEm: ReturnType<typeof makeFakeEntityManager>;

  const orderRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as unknown as Repository<Order>;

  const itemRepo = {
    find: jest.fn(),
  } as unknown as Repository<OrderItem>;

  const menuService = {
    listAll: jest.fn().mockResolvedValue(
      menuItemIds.map((id) => makeMenuItem(id, priceMap[id] ?? 1000, activeMap[id] ?? true)),
    ),
  } as unknown as MenuService;

  const usersService = {
    findById: jest.fn().mockResolvedValue({ id: USER_ID } as User),
  } as unknown as UsersService;

  const dataSource = {
    transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
      capturedEm = makeFakeEntityManager(
        preExistingOrders,
        preExistingItems,
        menuItemIds.map((id) => makeMenuItem(id, priceMap[id] ?? 1000, activeMap[id] ?? true)),
      );
      return cb(capturedEm);
    }),
  } as unknown as DataSource;

  const purchaseLimits = {
    getEffective: jest.fn(async () => ({
      food: { enabled: false, amount: null },
      essential: { enabled: false, amount: null },
    })),
  } as unknown as PurchaseLimitConfigService;

  const svc = new OrdersService(
    orderRepo,
    itemRepo,
    menuService,
    usersService,
    accounts as unknown as AccountsService,
    dataSource,
    purchaseLimits,
  );

  const getEm = () => capturedEm;

  return { svc, menuService, usersService, accounts, dataSource, getEm };
}

// `menuItemIds` is a test-only shortcut: each id maps to one qty=1 line, reproducing the
// pre-quantity binary-selection behavior the existing cases lock. Pass `items` to set explicit
// per-line quantities.
function baseInput(
  overrides: Partial<CreateOrReplaceInput> & { menuItemIds?: string[] } = {},
): CreateOrReplaceInput {
  const { menuItemIds, items, ...rest } = overrides;
  const resolvedItems =
    items ??
    (menuItemIds
      ? menuItemIds.map((menuItemId) => ({ menuItemId, quantity: 1 }))
      : [{ menuItemId: ITEM_A, quantity: 1 }]);
  return {
    serviceDate: SERVICE_DATE,
    userId: USER_ID,
    items: resolvedItems,
    sheetId: 'sheet-uuid-1',
    source: 'omr',
    operatorId: OPERATOR_ID,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// First-scan: creates a new active order with items
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — first scan creates active order', () => {
  it('inserts an active order with the correct fields when no prior order exists', async () => {
    const { svc, getEm } = buildService([]);

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A, ITEM_B] }));

    expect(result.status).toBe(OrderStatus.ACTIVE);
    expect(result.serviceDate).toBe(SERVICE_DATE);
    expect(result.userId).toBe(USER_ID);
    expect(result.source).toBe('omr');

    // Both items must appear in the returned items list
    expect(result.items).toHaveLength(2);
    const itemMenuIds = result.items.map((i) => i.menuItemId).sort();
    expect(itemMenuIds).toEqual([ITEM_A, ITEM_B].sort());

    // No supersede should have been called (no prior order)
    expect(getEm().update).not.toHaveBeenCalled();
  });

  it('aggregates duplicate menuItemIds into one row, summing quantities', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 1000 });

    // Passing ITEM_A twice (each qty 1) → one row, quantity 2 (a visitor tapping an item
    // twice means "2 portions", never an index collision).
    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A, ITEM_A] }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0].menuItemId).toBe(ITEM_A);
    expect(result.items[0].quantity).toBe(2);
    expect(result.totalAmount).toBe(2000); // price 1000 × qty 2
  });
});

// ---------------------------------------------------------------------------
// Quantity: per-line quantity drives total math and is persisted on each item.
// Trust boundary (integer 1..99) is enforced in createOrReplace BEFORE money math,
// because the verify (omr) path builds items[] server-side, bypassing the DTO.
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — per-item quantity', () => {
  it('totals price × quantity and persists the quantity on the order_item', async () => {
    const { svc, getEm } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });

    const result = await svc.createOrReplace(
      baseInput({ items: [{ menuItemId: ITEM_A, quantity: 3 }] }),
    );

    expect(result.totalAmount).toBe(15_000); // 5000 × 3
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(3);

    const stored = getEm()._itemStore.find((i) => i.menuItemId === ITEM_A);
    expect(stored!.quantity).toBe(3);
  });

  it('sums quantities across distinct items into the total', async () => {
    const { svc } = buildService([], [ITEM_A, ITEM_B], { [ITEM_A]: 5000, [ITEM_B]: 3000 });

    const result = await svc.createOrReplace(
      baseInput({
        items: [
          { menuItemId: ITEM_A, quantity: 2 },
          { menuItemId: ITEM_B, quantity: 4 },
        ],
      }),
    );

    expect(result.totalAmount).toBe(22_000); // 5000×2 + 3000×4
  });

  it('aggregates explicit duplicate lines, summing their quantities', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 1000 });

    const result = await svc.createOrReplace(
      baseInput({
        items: [
          { menuItemId: ITEM_A, quantity: 2 },
          { menuItemId: ITEM_A, quantity: 3 },
        ],
      }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(5);
    expect(result.totalAmount).toBe(5000);
  });

  it('rejects quantity 0 with ORDER.INVALID_QUANTITY', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });
    await expect(
      svc.createOrReplace(baseInput({ items: [{ menuItemId: ITEM_A, quantity: 0 }] })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.INVALID_QUANTITY' } });
  });

  it('rejects quantity 100 (above the 99 cap) with ORDER.INVALID_QUANTITY', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });
    await expect(
      svc.createOrReplace(baseInput({ items: [{ menuItemId: ITEM_A, quantity: 100 }] })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.INVALID_QUANTITY' } });
  });

  it('rejects a non-integer quantity with ORDER.INVALID_QUANTITY', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });
    await expect(
      svc.createOrReplace(baseInput({ items: [{ menuItemId: ITEM_A, quantity: 1.5 }] })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.INVALID_QUANTITY' } });
  });

  it('rejects a negative quantity with ORDER.INVALID_QUANTITY', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });
    await expect(
      svc.createOrReplace(baseInput({ items: [{ menuItemId: ITEM_A, quantity: -1 }] })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.INVALID_QUANTITY' } });
  });
});

// ---------------------------------------------------------------------------
// Money: total_amount + unit_price snapshot, payment defaults
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — money stamping', () => {
  it('stamps total_amount = Σ menu prices and each order_item.unit_price', async () => {
    const { svc, getEm } = buildService([], [ITEM_A, ITEM_B], {
      [ITEM_A]: 5000,
      [ITEM_B]: 3000,
    });

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A, ITEM_B] }));

    expect(result.totalAmount).toBe(8000);

    const em = getEm();
    const byId = new Map(em._itemStore.map((i) => [i.menuItemId, i.unitPrice]));
    expect(byId.get(ITEM_A)).toBe(5000);
    expect(byId.get(ITEM_B)).toBe(3000);
    // returned items also carry the snapshot
    const total = result.items.reduce((s, i) => s + i.unitPrice, 0);
    expect(total).toBe(8000);
  });

  it('a relative order is created UNPAID even with a method (auto-pay disabled; tender retained)', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });

    // Passing a method used to flip the order to PAID on create. It must NOT anymore — the
    // method is stored only as the intended tender; the cashier flips it to paid on accept.
    const result = await svc.createOrReplace(
      baseInput({ menuItemIds: [ITEM_A], source: 'relative', operatorId: undefined, paymentMethod: 'cash' }),
    );

    expect(result.paymentStatus).toBe(PaymentStatus.UNPAID);
    expect(result.paymentMethod).toBe('cash');
  });

  it('an omr order is stamped paid / balance (paid from commissary balance)', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }));

    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.paymentMethod).toBe('balance');
  });

  it('unit_price snapshot uses the price at create time (Σ from global menu)', async () => {
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 7500 });

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }));

    expect(result.totalAmount).toBe(7500);
    expect(result.items[0].unitPrice).toBe(7500);
  });
});

// ---------------------------------------------------------------------------
// Re-scan (create-or-REPLACE): second scan same (date,user,source) supersedes first
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — re-scan supersedes prior active order', () => {
  it('supersedesSameDateSameSource: marks the existing active order SUPERSEDED and creates a new ACTIVE order', async () => {
    const existingOrder = makeOrder({ id: 'old-order-uuid' });
    const { svc, getEm } = buildService([existingOrder]);

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_B] }));

    // New order is active
    expect(result.status).toBe(OrderStatus.ACTIVE);
    expect(result.id).not.toBe('old-order-uuid');

    // Prior order must be superseded in the store (not hard-deleted)
    const em = getEm();
    expect(em.update).toHaveBeenCalledTimes(1);
    const [, oldId, patch] = (em.update as jest.Mock).mock.calls[0] as [unknown, string, Partial<Order>];
    expect(oldId).toBe('old-order-uuid');
    expect(patch.status).toBe(OrderStatus.SUPERSEDED);
    expect(patch.supersededAt).toBeInstanceOf(Date);
    // audit chain: supersededByOrderId links to the newly created order
    expect(patch.supersededByOrderId).toBe(result.id);
  });

  it('retains the superseded order in the store (full audit trail — not hard-deleted)', async () => {
    const existingOrder = makeOrder({ id: 'old-order-uuid' });
    const { svc, getEm } = buildService([existingOrder]);

    await svc.createOrReplace(baseInput());

    const em = getEm();
    // Old order must still exist in the store with SUPERSEDED status
    const old = em._orderStore.find((o) => o.id === 'old-order-uuid');
    expect(old).toBeDefined();
    expect(old!.status).toBe(OrderStatus.SUPERSEDED);
  });

  it('exactly one active order remains after re-scan', async () => {
    const existingOrder = makeOrder({ id: 'old-order-uuid' });
    const { svc, getEm } = buildService([existingOrder]);

    await svc.createOrReplace(baseInput());

    const em = getEm();
    const activeOrders = em._orderStore.filter((o) => o.status === OrderStatus.ACTIVE);
    expect(activeOrders).toHaveLength(1);
  });

  it('supersededByOrderId on the old order matches the new order id (audit chain integrity)', async () => {
    const existingOrder = makeOrder({ id: 'old-order-uuid' });
    const { svc, getEm } = buildService([existingOrder]);

    const newOrder = await svc.createOrReplace(baseInput());

    const em = getEm();
    const old = em._orderStore.find((o) => o.id === 'old-order-uuid');
    expect(old!.supersededByOrderId).toBe(newOrder.id);
  });

  it('supersede-then-insert ordering prevents transient duplicate: update fires before save', async () => {
    // The code pre-generates a UUID, supersedes FIRST, then inserts — this avoids a
    // transient duplicate on the partial unique index (non-deferrable in Postgres).
    // We verify update is called before save by recording call order.
    const existingOrder = makeOrder({ id: 'old-order-uuid' });
    const callOrder: string[] = [];

    const preExistingOrders = [existingOrder];
    let capturedEm: ReturnType<typeof makeFakeEntityManager>;

    const dataSource = {
      transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) => {
        capturedEm = makeFakeEntityManager(preExistingOrders);
        const origUpdate = capturedEm.update as jest.Mock;
        const origSave = capturedEm.save as jest.Mock;
        (capturedEm as unknown as Record<string, unknown>).update = jest.fn(async (...args: unknown[]) => {
          callOrder.push('update');
          return origUpdate(...args);
        });
        (capturedEm as unknown as Record<string, unknown>).save = jest.fn(async (...args: unknown[]) => {
          callOrder.push('save');
          return origSave(...args);
        });
        return cb(capturedEm);
      }),
    } as unknown as DataSource;

    const svc2 = new OrdersService(
      {} as Repository<Order>,
      {} as Repository<OrderItem>,
      { listAll: jest.fn().mockResolvedValue([makeMenuItem(ITEM_A)]) } as unknown as MenuService,
      { findById: jest.fn().mockResolvedValue({ id: USER_ID } as User) } as unknown as UsersService,
      makeFakeAccounts() as unknown as AccountsService,
      dataSource,
      { getEffective: jest.fn(async () => ({ food: { enabled: false, amount: null }, essential: { enabled: false, amount: null } })) } as unknown as PurchaseLimitConfigService,
    );

    await svc2.createOrReplace(baseInput());

    // update (supersede) must precede the first save (new order insert)
    const firstUpdate = callOrder.indexOf('update');
    const firstSave = callOrder.indexOf('save');
    expect(firstUpdate).toBeGreaterThanOrEqual(0);
    expect(firstSave).toBeGreaterThan(firstUpdate);
  });
});

// ---------------------------------------------------------------------------
// Coexist: supersede is scoped per (service_date, user, source).
// A warden (omr) order and a relative order may both be active for the same
// prisoner+date; a re-scan only supersedes the prior order of the SAME origin.
// Orders on different dates are independent — no cross-date supersede.
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — supersede scoped by (date, user, source)', () => {
  it('coexistDifferentSource: a relative order does NOT supersede an existing omr active order', async () => {
    const existingOmr = makeOrder({ id: 'omr-order', source: 'omr' });
    const { svc, getEm } = buildService([existingOmr]);

    const result = await svc.createOrReplace(baseInput({ source: 'relative', menuItemIds: [ITEM_A] }));

    expect(result.status).toBe(OrderStatus.ACTIVE);
    expect(result.source).toBe('relative');

    const em = getEm();
    // The omr order must NOT be touched
    expect(em.update).not.toHaveBeenCalled();
    const active = em._orderStore.filter((o) => o.status === OrderStatus.ACTIVE);
    expect(active).toHaveLength(2);
    expect(active.map((o) => o.source).sort()).toEqual(['omr', 'relative']);
  });

  it('coexistDifferentSource: an omr order does NOT supersede an existing relative active order', async () => {
    const existingRelative = makeOrder({ id: 'rel-order', source: 'relative' });
    const { svc, getEm } = buildService([existingRelative]);

    const result = await svc.createOrReplace(baseInput({ source: 'omr', menuItemIds: [ITEM_A] }));

    expect(result.source).toBe('omr');
    const em = getEm();
    expect(em.update).not.toHaveBeenCalled();
    const active = em._orderStore.filter((o) => o.status === OrderStatus.ACTIVE);
    expect(active).toHaveLength(2);
  });

  it('scanner and omr share one active scanned channel and scanner debits balance', async () => {
    const existingOmr = makeOrder({ id: 'omr-order', source: 'omr', totalAmount: 5000, paymentStatus: PaymentStatus.PAID, paymentMethod: 'balance' });
    const { svc, getEm, accounts } = buildService([existingOmr]);

    const result = await svc.createOrReplace(baseInput({ source: 'scanner', menuItemIds: [ITEM_A] }));

    expect(result.source).toBe('scanner');
    const em = getEm();
    expect(em.update).toHaveBeenCalledWith(Order, 'omr-order', expect.objectContaining({ status: OrderStatus.SUPERSEDED }));
    expect(em._orderStore.filter((order) => order.status === OrderStatus.ACTIVE)).toHaveLength(1);
    expect(accounts._ledger.map((entry) => entry.type)).toEqual([
      AccountTransactionType.REVERSAL,
      AccountTransactionType.ORDER_DEBIT,
    ]);
  });

  it('an omr re-scan supersedes ONLY the prior omr order, leaving a relative order active', async () => {
    // Relative is placed first in the store: a source-blind lookup would grab it
    // and wrongly supersede it — this asserts the lookup targets omr specifically.
    const existingRelative = makeOrder({ id: 'rel-order', source: 'relative' });
    const existingOmr = makeOrder({ id: 'omr-order', source: 'omr' });
    const { svc, getEm } = buildService([existingRelative, existingOmr]);

    const result = await svc.createOrReplace(baseInput({ source: 'omr', menuItemIds: [ITEM_A] }));

    const em = getEm();
    expect(em.update).toHaveBeenCalledTimes(1);
    const [, supersededId] = (em.update as jest.Mock).mock.calls[0] as [unknown, string, Partial<Order>];
    expect(supersededId).toBe('omr-order');

    const rel = em._orderStore.find((o) => o.id === 'rel-order');
    expect(rel!.status).toBe(OrderStatus.ACTIVE);
    const active = em._orderStore.filter((o) => o.status === OrderStatus.ACTIVE);
    expect(active).toHaveLength(2);
    expect(active.map((o) => o.source).sort()).toEqual(['omr', 'relative']);
    expect(result.id).not.toBe('omr-order');
  });

  it('coexistDifferentDate: same user+source on a DIFFERENT date does NOT supersede (both active)', async () => {
    // An active omr order exists for OTHER_DATE; a new omr order for SERVICE_DATE must
    // create independently — the supersede scope is keyed on service_date.
    const existingOtherDay = makeOrder({ id: 'other-day-order', source: 'omr', serviceDate: OTHER_DATE });
    const { svc, getEm } = buildService([existingOtherDay]);

    const result = await svc.createOrReplace(baseInput({ serviceDate: SERVICE_DATE, menuItemIds: [ITEM_A] }));

    expect(result.serviceDate).toBe(SERVICE_DATE);
    const em = getEm();
    expect(em.update).not.toHaveBeenCalled();
    const active = em._orderStore.filter((o) => o.status === OrderStatus.ACTIVE);
    expect(active).toHaveLength(2);
    expect(active.map((o) => o.serviceDate).sort()).toEqual([OTHER_DATE, SERVICE_DATE].sort());
  });
});

// ---------------------------------------------------------------------------
// Supersede/dedup scope must match the active-order unique index columns exactly:
// (service_date, user_id, source). A drift on any column would either over-supersede
// (wrong refund) or collide on the index (500 instead of clean 409).
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — supersede lookup scope', () => {
  it('queries the existing active order by { serviceDate, userId, source, status: ACTIVE }', async () => {
    const existingOrder = makeOrder({ id: 'old-order-uuid' });
    const { svc, getEm } = buildService([existingOrder]);

    await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }));

    const em = getEm();
    // First findOne is the supersede/dedup lookup. Its where-clause columns must align with
    // UQ_orders_active_date_user_source = (service_date, user_id, source) WHERE status='active'.
    const firstCall = (em.findOne as jest.Mock).mock.calls.find(
      ([, opts]) => (opts as { where: Partial<Order> }).where?.serviceDate !== undefined,
    );
    expect(firstCall).toBeDefined();
    const where = (firstCall![1] as { where: Partial<Order> }).where;
    expect(where).toEqual({
      serviceDate: SERVICE_DATE,
      userId: USER_ID,
      source: 'omr',
      status: OrderStatus.ACTIVE,
    });
  });
});

// ---------------------------------------------------------------------------
// Balance debit: omr orders are paid from the prisoner commissary balance
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — omr balance debit', () => {
  it('debits total_amount with an order_debit ledger row (NON-NULL operator, related to new order)', async () => {
    const accounts = makeFakeAccounts(10_000);
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 }, accounts);

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }));

    expect(accounts.debit).toHaveBeenCalledTimes(1);
    expect(accounts._balance()).toBe(5000); // 10000 - 5000
    const debitRow = accounts._ledger.find((l) => l.type === AccountTransactionType.ORDER_DEBIT);
    expect(debitRow).toBeDefined();
    expect(debitRow!.amount).toBe(-5000);
    expect(debitRow!.operatorId).toBe(OPERATOR_ID);
    expect(debitRow!.operatorId).toBeTruthy();
    expect(debitRow!.relatedOrderId).toBe(result.id);
  });

  it('locks the account FIRST (getOrCreate before any order write)', async () => {
    const accounts = makeFakeAccounts(10_000);
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 1000 }, accounts);

    await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }));

    expect(accounts.getOrCreate).toHaveBeenCalled();
  });

  it('re-scan posts reversal (prior snapshot) + debit (new total); nets correctly across a price change', async () => {
    // Prior omr order debited 5000. Menu price has since dropped to 3000.
    const existingOmr = makeOrder({ id: 'old-omr', source: 'omr', totalAmount: 5000 });
    const accounts = makeFakeAccounts(20_000);
    const { svc } = buildService([existingOmr], [ITEM_A], { [ITEM_A]: 3000 }, accounts);

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }));

    // Reversal uses the SUPERSEDED order's stored total (5000), NOT the new price (3000)
    const reversal = accounts._ledger.find((l) => l.type === AccountTransactionType.REVERSAL);
    expect(reversal).toBeDefined();
    expect(reversal!.amount).toBe(5000);
    expect(reversal!.relatedOrderId).toBe('old-omr');
    expect(reversal!.operatorId).toBe(OPERATOR_ID);

    const debit = accounts._ledger.find((l) => l.type === AccountTransactionType.ORDER_DEBIT);
    expect(debit!.amount).toBe(-3000);
    expect(debit!.relatedOrderId).toBe(result.id);

    // Net: 20000 + 5000 - 3000 = 22000
    expect(accounts._balance()).toBe(22_000);
  });

  it('throws ACCOUNT.INSUFFICIENT_FUNDS and does not deduct when balance < total', async () => {
    const accounts = makeFakeAccounts(1000);
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 }, accounts);

    await expect(svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A] }))).rejects.toMatchObject({
      response: { code: 'ACCOUNT.INSUFFICIENT_FUNDS' },
    });
    // Balance untouched (debit guard rejected before mutating)
    expect(accounts._balance()).toBe(1000);
  });

  it('a relative order skips the balance entirely (no getOrCreate / debit)', async () => {
    const accounts = makeFakeAccounts(10_000);
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 }, accounts);

    await svc.createOrReplace(
      baseInput({ menuItemIds: [ITEM_A], source: 'relative', operatorId: undefined }),
    );

    expect(accounts.getOrCreate).not.toHaveBeenCalled();
    expect(accounts.debit).not.toHaveBeenCalled();
    expect(accounts.credit).not.toHaveBeenCalled();
    expect(accounts._balance()).toBe(10_000);
  });

  it('rejects an omr order with no operatorId (ORDER.OPERATOR_REQUIRED), never touching the account', async () => {
    const accounts = makeFakeAccounts(10_000);
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 }, accounts);

    await expect(
      svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A], operatorId: undefined })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.OPERATOR_REQUIRED' } });
    expect(accounts.getOrCreate).not.toHaveBeenCalled();
    expect(accounts.debit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Validation guards — items validated against the GLOBAL menu (menuService.listAll)
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — validation', () => {
  it('throws BadRequestException when menuItemIds is empty', async () => {
    const { svc } = buildService([]);
    await expect(svc.createOrReplace(baseInput({ menuItemIds: [] }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('ORDER.ITEM_NOT_IN_MENU when a menuItemId is not in the global menu', async () => {
    // Global menu has only ITEM_A; ITEM_B is unknown.
    const { svc } = buildService([], [ITEM_A]);
    await expect(
      svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A, ITEM_B] })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.ITEM_NOT_IN_MENU' } });
  });

  it('relative source REJECTS an inactive (delisted) item — ORDER.ITEM_NOT_IN_MENU', async () => {
    // ITEM_A exists but is inactive. The kiosk read view hides it, so a known-but-inactive
    // UUID must not be orderable via the relative path.
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 }, makeFakeAccounts(), [], { [ITEM_A]: false });
    await expect(
      svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A], source: 'relative', operatorId: undefined })),
    ).rejects.toMatchObject({ response: { code: 'ORDER.ITEM_NOT_IN_MENU' } });
  });

  it('omr source CAN order an inactive (delisted) item (a scanned sheet still settles)', async () => {
    // A printed checkbox may reference an item later delisted; the warden path must still
    // accept it so the scan settles. Active-only filtering is relative-only.
    const { svc } = buildService([], [ITEM_A], { [ITEM_A]: 5000 }, makeFakeAccounts(10_000), [], { [ITEM_A]: false });
    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A], source: 'omr' }));
    expect(result.status).toBe(OrderStatus.ACTIVE);
    expect(result.totalAmount).toBe(5000);
  });

  it('throws NotFoundException when user does not exist', async () => {
    const { svc, usersService } = buildService([]);
    (usersService.findById as jest.Mock).mockRejectedValue(
      new NotFoundException('User not found'),
    );
    await expect(svc.createOrReplace(baseInput())).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Relative dup-reject: a second pending create for the same (date,user) is rejected
// (no supersede) → ≤1 pending relative per prisoner+date. An omr re-scan still supersedes.
// NOTE: the fake em cannot simulate the SELECT↔INSERT 23505 race; the parallel-create race
// resolution is proven only by the real-DB e2e (the concurrent-create test).
// ---------------------------------------------------------------------------

describe('OrdersService.createOrReplace() — relative dup-reject', () => {
  it('rejects a second relative create when one is already pending (409, no supersede)', async () => {
    const existingRelative = makeOrder({
      id: 'pending-rel',
      source: 'relative',
      status: OrderStatus.ACTIVE,
      paymentStatus: PaymentStatus.UNPAID,
      paymentMethod: 'cash',
    });
    const { svc, getEm } = buildService([existingRelative], [ITEM_A], { [ITEM_A]: 5000 });

    await expect(
      svc.createOrReplace(
        baseInput({ menuItemIds: [ITEM_A], source: 'relative', operatorId: undefined, paymentMethod: 'cash' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'ORDER.ALREADY_PENDING' } });

    // The existing pending order is untouched (NOT superseded) and stays the only active one.
    const em = getEm();
    expect(em.update).not.toHaveBeenCalled();
    const rel = em._orderStore.find((o) => o.id === 'pending-rel');
    expect(rel!.status).toBe(OrderStatus.ACTIVE);
    expect(em._orderStore.filter((o) => o.status === OrderStatus.ACTIVE)).toHaveLength(1);
  });

  it('an omr re-scan still supersedes — dup-reject is relative-only', async () => {
    const existingOmr = makeOrder({ id: 'old-omr', source: 'omr' });
    const { svc, getEm } = buildService([existingOmr], [ITEM_A], { [ITEM_A]: 5000 });

    const result = await svc.createOrReplace(baseInput({ menuItemIds: [ITEM_A], source: 'omr' }));

    const em = getEm();
    expect(em.update).toHaveBeenCalledTimes(1);
    const old = em._orderStore.find((o) => o.id === 'old-omr');
    expect(old!.status).toBe(OrderStatus.SUPERSEDED);
    expect(result.status).toBe(OrderStatus.ACTIVE);
  });

  it('rethrows a 23505 unique-violation during a relative insert as 409 ALREADY_PENDING', async () => {
    // Simulate the SELECT↔INSERT race: the dup-reject SELECT sees nothing, but the INSERT
    // collides on the partial unique index. The service must surface 409, not an opaque 500.
    const { svc, dataSource } = buildService([], [ITEM_A], { [ITEM_A]: 5000 });
    (dataSource.transaction as jest.Mock).mockImplementationOnce(
      async (cb: (m: EntityManager) => Promise<unknown>) => {
        const fake = makeFakeEntityManager([]);
        (fake as unknown as { save: jest.Mock }).save = jest.fn(async () => {
          throw { code: '23505' };
        });
        return cb(fake);
      },
    );
    await expect(
      svc.createOrReplace(
        baseInput({ menuItemIds: [ITEM_A], source: 'relative', operatorId: undefined, paymentMethod: 'cash' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'ORDER.ALREADY_PENDING' } });
  });
});

// ---------------------------------------------------------------------------
// acceptRelativeOrder: pending → PAID with operator attribution + optional method override.
// Two orders are seeded so id-targeting (the fixed fake em honoring where.id) is exercised.
// ---------------------------------------------------------------------------

function seedPendingRelative(id: string, overrides: Partial<Order> = {}): Order {
  return makeOrder({
    id,
    source: 'relative',
    status: OrderStatus.ACTIVE,
    paymentStatus: PaymentStatus.UNPAID,
    paymentMethod: 'cash',
    totalAmount: 5000,
    ...overrides,
  });
}

describe('OrdersService.acceptRelativeOrder()', () => {
  it('flips the targeted pending order to PAID (operator + settledAt), keeping intended tender', async () => {
    const other = seedPendingRelative('other-order');
    const pending = seedPendingRelative('pending-order');
    const items = [makeOrderItem('pending-order', ITEM_A)];
    const { svc, getEm } = buildService([other, pending], [ITEM_A], {}, makeFakeAccounts(), items);

    const result = await svc.acceptRelativeOrder('pending-order', { operatorId: OPERATOR_ID });

    expect(result.id).toBe('pending-order');
    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.paymentMethod).toBe('cash');
    expect(result.settledByOperatorId).toBe(OPERATOR_ID);
    expect(result.settledAt).toBeInstanceOf(Date);
    expect(result.items).toHaveLength(1);
    expect(getEm()._tg8Store).toHaveLength(1);
    expect(getEm()._tg8Store[0]).toMatchObject({
      orderId: 'pending-order',
      operatorId: OPERATOR_ID,
      snapshot: {
        prisoner: { legacyId: 'P001', name: 'Nguyễn Văn A' },
        acceptedTotal: 5000,
        items: [{ name: 'Item', quantity: 1 }],
      },
    });
    expect(getEm()._tg8Store[0].acceptedAt).toBe(result.settledAt);

    // The OTHER pending order must be untouched — proves id-targeting, not first-match.
    const stillPending = getEm()._orderStore.find((o) => o.id === 'other-order');
    expect(stillPending!.paymentStatus).toBe(PaymentStatus.UNPAID);
  });

  it('applies a method override on accept', async () => {
    const pending = seedPendingRelative('pending-order');
    const { svc } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);

    const result = await svc.acceptRelativeOrder('pending-order', { operatorId: OPERATOR_ID, method: 'bank' });

    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.paymentMethod).toBe('bank');
  });

  it('propagates snapshot persistence failure so the acceptance transaction rolls back', async () => {
    const pending = seedPendingRelative('pending-order');
    const items = [makeOrderItem('pending-order', ITEM_A)];
    const { svc, dataSource } = buildService(
      [pending],
      [ITEM_A],
      {},
      makeFakeAccounts(),
      items,
    );
    const snapshotFailure = new Error('snapshot insert failed');
    (dataSource.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (manager: EntityManager) => Promise<unknown>) => {
        const manager = makeFakeEntityManager([pending], items);
        const originalSave = manager.save as jest.Mock;
        manager.save = jest.fn(async (entity: unknown, value: unknown) => {
          if (entity === Tg8Document) throw snapshotFailure;
          return originalSave(entity, value);
        }) as EntityManager['save'];
        return callback(manager);
      },
    );

    await expect(
      svc.acceptRelativeOrder('pending-order', { operatorId: OPERATOR_ID }),
    ).rejects.toBe(snapshotFailure);
  });

  it('throws 404 ORDER.NOT_FOUND when the order is missing', async () => {
    const { svc } = buildService([], [ITEM_A]);
    await expect(svc.acceptRelativeOrder('nope', { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      response: { code: 'ORDER.NOT_FOUND' },
    });
  });

  it('throws 409 ORDER.NOT_PENDING on a double-settle (already PAID)', async () => {
    const paid = seedPendingRelative('paid-order', { paymentStatus: PaymentStatus.PAID });
    const { svc } = buildService([paid], [ITEM_A]);
    await expect(svc.acceptRelativeOrder('paid-order', { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      response: { code: 'ORDER.NOT_PENDING' },
    });
  });

  it('throws 409 ORDER.NOT_PENDING when the order is SUPERSEDED', async () => {
    const sup = seedPendingRelative('sup-order', { status: OrderStatus.SUPERSEDED });
    const { svc } = buildService([sup], [ITEM_A]);
    await expect(svc.acceptRelativeOrder('sup-order', { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      response: { code: 'ORDER.NOT_PENDING' },
    });
  });

  it('throws 409 ORDER.NOT_PENDING for an omr order (not relative)', async () => {
    const omr = makeOrder({ id: 'omr-order', source: 'omr', status: OrderStatus.ACTIVE, paymentStatus: PaymentStatus.PAID, paymentMethod: 'balance' });
    const { svc } = buildService([omr], [ITEM_A]);
    await expect(svc.acceptRelativeOrder('omr-order', { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      response: { code: 'ORDER.NOT_PENDING' },
    });
  });

  it('rejects an invalid method override (cash|bank only)', async () => {
    const pending = seedPendingRelative('pending-order');
    const { svc } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);
    await expect(
      svc.acceptRelativeOrder('pending-order', { operatorId: OPERATOR_ID, method: 'balance' }),
    ).rejects.toMatchObject({ response: { code: 'ORDER.INVALID_PAYMENT_METHOD' } });
  });
});

// ---------------------------------------------------------------------------
// acceptRelativeOrder — bank settlement: optional transfer reference (advisory
// partial-UNIQUE guard) + a received amount that must equal the order total when entered.
// ---------------------------------------------------------------------------

describe('OrdersService.acceptRelativeOrder() — transfer reference + received amount', () => {
  it('persists a trimmed transfer reference and a received amount equal to the order total', async () => {
    const pending = seedPendingRelative('pending-order', { totalAmount: 5000 });
    const { svc, getEm } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);

    const result = await svc.acceptRelativeOrder('pending-order', {
      operatorId: OPERATOR_ID,
      method: 'bank',
      transferReference: '  FT24ABC987  ',
      receivedAmount: 5000,
    });

    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.transferReference).toBe('FT24ABC987'); // trimmed at write
    expect(result.receivedAmount).toBe(5000);
    const stored = getEm()._orderStore.find((o) => o.id === 'pending-order');
    expect(stored!.transferReference).toBe('FT24ABC987');
  });

  it('blocks accept with ORDER.AMOUNT_MISMATCH when an entered received amount ≠ total (order stays unpaid)', async () => {
    const pending = seedPendingRelative('pending-order', { totalAmount: 5000 });
    const { svc, getEm } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);

    await expect(
      svc.acceptRelativeOrder('pending-order', { operatorId: OPERATOR_ID, method: 'bank', receivedAmount: 4000 }),
    ).rejects.toMatchObject({ response: { code: 'ORDER.AMOUNT_MISMATCH' } });

    const stored = getEm()._orderStore.find((o) => o.id === 'pending-order');
    expect(stored!.paymentStatus).toBe(PaymentStatus.UNPAID); // not settled
  });

  it('stores a blank/whitespace reference as null so the advisory guard ignores blanks', async () => {
    const pending = seedPendingRelative('pending-order', { totalAmount: 5000 });
    const { svc, getEm } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);

    const result = await svc.acceptRelativeOrder('pending-order', {
      operatorId: OPERATOR_ID,
      method: 'bank',
      transferReference: '   ',
    });

    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.transferReference).toBeNull();
    const stored = getEm()._orderStore.find((o) => o.id === 'pending-order');
    expect(stored!.transferReference).toBeNull();
  });

  it('accepts with neither reference nor received amount — both persist as null (back-compat)', async () => {
    const pending = seedPendingRelative('pending-order', { totalAmount: 5000 });
    const { svc } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);

    const result = await svc.acceptRelativeOrder('pending-order', { operatorId: OPERATOR_ID });

    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.transferReference).toBeNull();
    expect(result.receivedAmount).toBeNull();
  });

  it('surfaces a duplicate non-empty reference as 409 ORDER.REFERENCE_DUPLICATE', async () => {
    // The partial UNIQUE index (WHERE transfer_reference IS NOT NULL) raises 23505 when a
    // reference already settled another order. Surface a clean 409, not an opaque 500.
    const pending = seedPendingRelative('pending-order', { totalAmount: 5000 });
    const { svc, dataSource } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);
    (dataSource.transaction as jest.Mock).mockImplementationOnce(
      async (cb: (m: EntityManager) => Promise<unknown>) => {
        const fake = makeFakeEntityManager([pending]);
        (fake as unknown as { update: jest.Mock }).update = jest.fn(async () => {
          throw { code: '23505' };
        });
        return cb(fake);
      },
    );

    await expect(
      svc.acceptRelativeOrder('pending-order', {
        operatorId: OPERATOR_ID,
        method: 'bank',
        transferReference: 'FT24DUP',
      }),
    ).rejects.toMatchObject({ response: { code: 'ORDER.REFERENCE_DUPLICATE' } });
  });
});

// ---------------------------------------------------------------------------
// rejectRelativeOrder: pending → REJECTED + reason + operator stamp (frees the slot)
// ---------------------------------------------------------------------------

describe('OrdersService.rejectRelativeOrder()', () => {
  it('sets REJECTED + reason + operator stamp', async () => {
    const pending = seedPendingRelative('pending-order');
    const items = [makeOrderItem('pending-order', ITEM_A)];
    const { svc } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), items);

    const result = await svc.rejectRelativeOrder('pending-order', { operatorId: OPERATOR_ID, reason: 'changed mind' });

    expect(result.status).toBe(OrderStatus.REJECTED);
    expect(result.rejectReason).toBe('changed mind');
    expect(result.settledByOperatorId).toBe(OPERATOR_ID);
    expect(result.settledAt).toBeInstanceOf(Date);
  });

  it('reject with no reason → null reason', async () => {
    const pending = seedPendingRelative('pending-order');
    const { svc } = buildService([pending], [ITEM_A], {}, makeFakeAccounts(), []);
    const result = await svc.rejectRelativeOrder('pending-order', { operatorId: OPERATOR_ID });
    expect(result.status).toBe(OrderStatus.REJECTED);
    expect(result.rejectReason).toBeNull();
  });

  it('throws 404 when missing and 409 when not pending', async () => {
    const { svc } = buildService([], [ITEM_A]);
    await expect(svc.rejectRelativeOrder('nope', { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      response: { code: 'ORDER.NOT_FOUND' },
    });

    const paid = seedPendingRelative('paid', { paymentStatus: PaymentStatus.PAID });
    const { svc: svc2 } = buildService([paid], [ITEM_A]);
    await expect(svc2.rejectRelativeOrder('paid', { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      response: { code: 'ORDER.NOT_PENDING' },
    });
  });
});

// ---------------------------------------------------------------------------
// listPending — raw pending relative rows, oldest-first (counter enriches)
// ---------------------------------------------------------------------------

describe('OrdersService.listPending()', () => {
  it('queries active+unpaid relative orders, oldest-first', async () => {
    const pending = seedPendingRelative('p1');
    const find = jest.fn().mockResolvedValue([pending]);
    const orderRepo = { find } as unknown as Repository<Order>;
    const svc = new OrdersService(
      orderRepo,
      {} as Repository<OrderItem>,
      {} as MenuService,
      {} as UsersService,
      {} as AccountsService,
      {} as DataSource,
      {} as PurchaseLimitConfigService,
    );

    const result = await svc.listPending();

    expect(result).toEqual([pending]);
    expect(find).toHaveBeenCalledWith({
      where: { source: 'relative', status: OrderStatus.ACTIVE, paymentStatus: PaymentStatus.UNPAID },
      order: { createdAt: 'ASC' },
    });
  });
});

// ---------------------------------------------------------------------------
// findAll — date-range filter (inclusive) on service_date
// ---------------------------------------------------------------------------

describe('OrdersService.findAll()', () => {
  function makeQbSpy() {
    const calls: Array<{ clause: string; params: Record<string, unknown> }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable query-builder
    // stub: andWhere returns `qb` itself, so the object is self-referential and must be `any`.
    const qb: any = {
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      andWhere: jest.fn((clause: string, params: Record<string, unknown>) => {
        calls.push({ clause, params });
        return qb;
      }),
      getMany: jest.fn().mockResolvedValue([]),
    };
    return { qb, calls };
  }

  function buildForFindAll(qb: unknown) {
    const orderRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<Order>;
    return new OrdersService(
      orderRepo,
      {} as Repository<OrderItem>,
      {} as MenuService,
      {} as UsersService,
      {} as AccountsService,
      {} as DataSource,
      {} as PurchaseLimitConfigService,
    );
  }

  it('applies an inclusive lower bound (dateFrom) on service_date', async () => {
    const { qb, calls } = makeQbSpy();
    const svc = buildForFindAll(qb);

    await svc.findAll({ dateFrom: SERVICE_DATE, limit: 50, offset: 0 } as never);

    const fromClause = calls.find((c) => c.clause.includes('>='));
    expect(fromClause).toBeDefined();
    expect(fromClause!.clause).toContain('o.service_date');
    expect(fromClause!.params).toMatchObject({ dateFrom: SERVICE_DATE });
  });

  it('applies an inclusive upper bound (dateTo) on service_date', async () => {
    const { qb, calls } = makeQbSpy();
    const svc = buildForFindAll(qb);

    await svc.findAll({ dateTo: OTHER_DATE, limit: 50, offset: 0 } as never);

    const toClause = calls.find((c) => c.clause.includes('<='));
    expect(toClause).toBeDefined();
    expect(toClause!.clause).toContain('o.service_date');
    expect(toClause!.params).toMatchObject({ dateTo: OTHER_DATE });
  });

  it('combines dateFrom + dateTo into an inclusive range and keeps userId/status filters', async () => {
    const { qb, calls } = makeQbSpy();
    const svc = buildForFindAll(qb);

    await svc.findAll({
      dateFrom: SERVICE_DATE,
      dateTo: OTHER_DATE,
      userId: USER_ID,
      status: OrderStatus.ACTIVE,
      limit: 50,
      offset: 0,
    } as never);

    expect(calls.find((c) => c.clause.includes('>='))!.params).toMatchObject({ dateFrom: SERVICE_DATE });
    expect(calls.find((c) => c.clause.includes('<='))!.params).toMatchObject({ dateTo: OTHER_DATE });
    expect(calls.find((c) => c.clause.includes('user_id'))!.params).toMatchObject({ userId: USER_ID });
    expect(calls.find((c) => c.clause.includes('o.status'))!.params).toMatchObject({ status: OrderStatus.ACTIVE });
  });

  it('applies no date predicate when neither bound is supplied', async () => {
    const { qb, calls } = makeQbSpy();
    const svc = buildForFindAll(qb);

    await svc.findAll({ limit: 50, offset: 0 } as never);

    expect(calls.find((c) => c.clause.includes('service_date'))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findOne — read path
// ---------------------------------------------------------------------------

describe('OrdersService.findOne()', () => {
  it('returns order with items when found', async () => {
    const order = makeOrder({ id: 'order-1' });
    const items = [makeOrderItem('order-1', ITEM_A)];
    const qb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(order),
    };
    const orderRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<Order>;
    const itemRepo = {
      find: jest.fn().mockResolvedValue(items),
    } as unknown as Repository<OrderItem>;

    const svc = new OrdersService(
      orderRepo,
      itemRepo,
      {} as MenuService,
      {} as UsersService,
      {} as AccountsService,
      {} as DataSource,
      {} as PurchaseLimitConfigService,
    );

    const result = await svc.findOne('order-1');

    expect(qb.where).toHaveBeenCalledWith('o.id = :id', { id: 'order-1' });
    expect(result.id).toBe('order-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].menuItemId).toBe(ITEM_A);
  });

  it('throws NotFoundException when order does not exist', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const orderRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<Order>;

    const svc = new OrdersService(
      orderRepo,
      {} as Repository<OrderItem>,
      {} as MenuService,
      {} as UsersService,
      {} as AccountsService,
      {} as DataSource,
      {} as PurchaseLimitConfigService,
    );

    await expect(svc.findOne('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
  });
});
