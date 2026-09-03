import { DataSource, Repository } from 'typeorm';
import { OrdersService } from '../orders.service';
import { Order, OrderStatus, PaymentStatus } from '../order.entity';
import { OrderItem } from '../order-item.entity';
import { MenuService } from '../../menu/menu.service';
import { UsersService } from '../../users/users.service';
import { AccountsService } from '../../accounts/accounts.service';
import { PurchaseLimitConfigService } from '../../purchase-limit-config/purchase-limit-config.service';
import { todayInDeployTz } from '../../common/today-in-tz';

// getDeliveryVouchers aggregates a date's PAID active orders into one signed sheet per
// prisoner. The DB filtering (status/payment_status) is exercised end-to-end by the e2e
// spec (a mocked query builder can't filter); here we mock the two raw query builders and
// the bulk balance lookup, asserting the assembly contract: per-prisoner merge, qty count,
// summed total, balance snapshot, printedAt stamp, and zone→cell→name ordering — plus that
// the orders query is scoped to active+paid (locking the SQL contract a regression would break).

const DATE = '2026-06-21';

// A chainable raw-query-builder double. Records every where/andWhere clause so a test can
// assert the orders query is scoped to status=active AND payment_status=paid.
function makeRawQb(rows: unknown[]) {
  const wheres: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential chainable stub
  const qb: any = {
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn((clause: string, params?: Record<string, unknown>) => {
      wheres.push({ clause, params });
      return qb;
    }),
    andWhere: jest.fn((clause: string, params?: Record<string, unknown>) => {
      wheres.push({ clause, params });
      return qb;
    }),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
    _wheres: wheres,
  };
  return qb;
}

function buildService(opts: {
  orderRows?: unknown[];
  itemRows?: unknown[];
  balances?: Map<string, number>;
}) {
  const orderQb = makeRawQb(opts.orderRows ?? []);
  const itemQb = makeRawQb(opts.itemRows ?? []);

  const orderRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(orderQb),
  } as unknown as Repository<Order>;
  const itemRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(itemQb),
  } as unknown as Repository<OrderItem>;

  const accountsService = {
    getBalances: jest.fn().mockResolvedValue(opts.balances ?? new Map<string, number>()),
  } as unknown as AccountsService;

  const svc = new OrdersService(
    orderRepo,
    itemRepo,
    {} as MenuService,
    {} as UsersService,
    accountsService,
    {} as DataSource,
    {} as PurchaseLimitConfigService,
  );

  return { svc, orderQb, itemQb, accountsService };
}

describe('OrdersService.getDeliveryVouchers()', () => {
  it('merges a prisoner\'s PAID active orders into one voucher: qty across orders, summed total, balance, printedAt', async () => {
    // Prisoner A: an omr order (item X) + a relative order (items X + Y) on the same date.
    const orderRows = [
      { orderId: 'o-omr', userId: 'A', totalAmount: '35000', name: 'Alpha', legacyId: 'P-A', zone: 'Khu 1', cell: 'Buong 1' },
      { orderId: 'o-rel', userId: 'A', totalAmount: '75000', name: 'Alpha', legacyId: 'P-A', zone: 'Khu 1', cell: 'Buong 1' },
    ];
    // X appears in both orders → qty 2; Y once → qty 1.
    const itemRows = [
      { userId: 'A', name: 'X', qty: '2' },
      { userId: 'A', name: 'Y', qty: '1' },
    ];
    const { svc } = buildService({ orderRows, itemRows, balances: new Map([['A', 120000]]) });

    const result = await svc.getDeliveryVouchers({ date: DATE });

    expect(result).toHaveLength(1);
    const v = result[0];
    expect(v.userId).toBe('A');
    expect(v.name).toBe('Alpha');
    expect(v.legacyId).toBe('P-A');
    expect(v.zone).toBe('Khu 1');
    expect(v.cell).toBe('Buong 1');
    expect(v.totalAmount).toBe(110000); // 35000 + 75000
    expect(v.remainingBalance).toBe(120000);
    expect(v.items).toEqual([
      { name: 'X', qty: 2 },
      { name: 'Y', qty: 1 },
    ]);
    expect(typeof v.printedAt).toBe('string');
    expect(() => new Date(v.printedAt).toISOString()).not.toThrow();
  });

  it('returns one voucher per prisoner, sorted zone → cell → name', async () => {
    const orderRows = [
      { orderId: 'o3', userId: 'C', totalAmount: '10000', name: 'Zed', legacyId: 'P-C', zone: 'Khu 1', cell: 'Buong 2' },
      { orderId: 'o1', userId: 'A', totalAmount: '10000', name: 'Ann', legacyId: 'P-A', zone: 'Khu 1', cell: 'Buong 1' },
      { orderId: 'o2', userId: 'B', totalAmount: '10000', name: 'Bob', legacyId: 'P-B', zone: 'Khu 2', cell: 'Buong 1' },
    ];
    const { svc } = buildService({
      orderRows,
      itemRows: [],
      balances: new Map([['A', 0], ['B', 0], ['C', 0]]),
    });

    const result = await svc.getDeliveryVouchers({ date: DATE });

    expect(result.map((v) => v.userId)).toEqual(['A', 'C', 'B']); // Khu1/Buong1, Khu1/Buong2, Khu2/Buong1
  });

  it('scopes the orders query to status=active AND payment_status=paid for the date', async () => {
    const { svc, orderQb } = buildService({ orderRows: [], itemRows: [] });

    await svc.getDeliveryVouchers({ date: DATE });

    const clauses = orderQb._wheres.map((w: { clause: string }) => w.clause).join(' | ');
    expect(clauses).toContain('service_date');
    // active-only excludes superseded/rejected; paid-only excludes unpaid pending relative orders.
    const paramVals = Object.assign({}, ...orderQb._wheres.map((w: { params?: object }) => w.params ?? {}));
    expect(paramVals.date).toBe(DATE);
    expect(paramVals.status).toBe(OrderStatus.ACTIVE);
    expect(paramVals.paid).toBe(PaymentStatus.PAID);
  });

  it('returns an empty array and skips the item + balance lookups when no paid active orders exist', async () => {
    const orderQb = makeRawQb([]);
    const orderRepo = { createQueryBuilder: jest.fn().mockReturnValue(orderQb) } as unknown as Repository<Order>;
    const itemRepo = { createQueryBuilder: jest.fn() } as unknown as Repository<OrderItem>;
    const accounts = { getBalances: jest.fn() } as unknown as AccountsService;
    const svc = new OrdersService(
      orderRepo,
      itemRepo,
      {} as MenuService,
      {} as UsersService,
      accounts,
      {} as DataSource,
      {} as PurchaseLimitConfigService,
    );

    const result = await svc.getDeliveryVouchers({ date: DATE });

    expect(result).toEqual([]);
    expect(itemRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(accounts.getBalances).not.toHaveBeenCalled();
  });

  it('defaults the date to today (deploy tz) when none is supplied', async () => {
    const { svc, orderQb } = buildService({ orderRows: [], itemRows: [] });

    await svc.getDeliveryVouchers({});

    const paramVals = Object.assign({}, ...orderQb._wheres.map((w: { params?: object }) => w.params ?? {}));
    expect(paramVals.date).toBe(todayInDeployTz());
  });

  it('falls back to 0 balance when the bulk lookup has no entry for a prisoner', async () => {
    const orderRows = [
      { orderId: 'o1', userId: 'A', totalAmount: '10000', name: 'Ann', legacyId: 'P-A', zone: null, cell: null },
    ];
    const { svc } = buildService({ orderRows, itemRows: [], balances: new Map() });

    const result = await svc.getDeliveryVouchers({ date: DATE });

    expect(result[0].remainingBalance).toBe(0);
    expect(result[0].zone).toBeNull();
    expect(result[0].cell).toBeNull();
  });
});
