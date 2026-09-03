import { CounterService } from '../counter.service';
import { UsersService } from '../../users/users.service';
import { AccountsService } from '../../accounts/accounts.service';
import { OrdersService, OrderWithItems } from '../../orders/orders.service';
import { MenuService } from '../../menu/menu.service';
import { Order, OrderStatus, PaymentStatus } from '../../orders/order.entity';
import { MenuItem } from '../../menu/menu-item.entity';
import { User } from '../../users/user.entity';
import { tomorrowInDeployTz } from '../../common/today-in-tz';
import { PurchaseLimitConfigService } from '../../purchase-limit-config/purchase-limit-config.service';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    legacyId: 'P001',
    name: 'Nguyen Van A',
    isActive: true,
    ...overrides,
  } as User;
}

function makeMenuItem(id: string): MenuItem {
  return { id, code: '01', name: `Item ${id}`, price: 1000, position: 0, category: MenuItemCategory.FOOD, isActive: true } as MenuItem;
}

function makePendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    serviceDate: '2026-06-18',
    userId: 'user-uuid-1',
    source: 'relative',
    status: OrderStatus.ACTIVE,
    paymentStatus: PaymentStatus.UNPAID,
    paymentMethod: 'cash',
    totalAmount: 1000,
    createdAt: new Date('2026-06-18T01:00:00Z'),
    ...overrides,
  } as Order;
}

describe('CounterService', () => {
  let usersService: { findByLegacyId: jest.Mock; findById: jest.Mock; assertActive: jest.Mock };
  let accountsService: Record<string, jest.Mock>;
  let ordersService: {
    createOrReplace: jest.Mock;
    listPending: jest.Mock;
    findOne: jest.Mock;
    acceptRelativeOrder: jest.Mock;
  };
  let menuService: { listAll: jest.Mock };
  let purchaseLimits: { getEffective: jest.Mock };
  let service: CounterService;

  beforeEach(() => {
    usersService = {
      findByLegacyId: jest.fn(),
      findById: jest.fn(),
      assertActive: jest.fn(),
    };
    accountsService = {
      getBalance: jest.fn(),
      getLedger: jest.fn(),
      credit: jest.fn(),
    };
    ordersService = {
      createOrReplace: jest.fn(),
      listPending: jest.fn(),
      findOne: jest.fn(),
      acceptRelativeOrder: jest.fn(),
    };
    menuService = { listAll: jest.fn() };
    purchaseLimits = { getEffective: jest.fn().mockResolvedValue({ food: { enabled: true, amount: 500_000 }, essential: { enabled: false, amount: null } }) };
    service = new CounterService(
      usersService as unknown as UsersService,
      accountsService as unknown as AccountsService,
      ordersService as unknown as OrdersService,
      menuService as unknown as MenuService,
      purchaseLimits as unknown as PurchaseLimitConfigService,
    );
  });

  describe('relativeOrder', () => {
    it('creates a relative order dated tomorrow, no sessionId', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      usersService.assertActive.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockResolvedValue({ id: 'order-1' } as OrderWithItems);

      await service.relativeOrder({
        prisonId: 'P001',
        items: [{ menuItemId: 'a', quantity: 2 }],
        method: 'cash',
        operatorId: 'op-1',
      });

      const arg = ordersService.createOrReplace.mock.calls[0][0];
      expect(arg.serviceDate).toBe(tomorrowInDeployTz());
      expect(arg.source).toBe('relative');
      expect(arg.operatorId).toBe('op-1');
      // Per-item quantity is forwarded straight to the funnel — no shim, no flattening.
      expect(arg.items).toEqual([{ menuItemId: 'a', quantity: 2 }]);
      expect('sessionId' in arg).toBe(false);
    });
  });

  describe('listPendingOrders', () => {
    it('enriches each pending row with serviceDate (not a session object) and item names', async () => {
      const order = makePendingOrder();
      ordersService.listPending.mockResolvedValue([order]);
      usersService.findById.mockResolvedValue(makeUser());
      menuService.listAll.mockResolvedValue([makeMenuItem('a')]);
      ordersService.findOne.mockResolvedValue({
        ...order,
        items: [{ menuItemId: 'a', unitPrice: 1000, category: MenuItemCategory.FOOD }],
      } as unknown as OrderWithItems);

      const rows = await service.listPendingOrders();

      expect(rows).toHaveLength(1);
      const row = rows[0] as unknown as Record<string, unknown>;
      expect(row.serviceDate).toBe('2026-06-18');
      expect('session' in row).toBe(false);
      expect(rows[0].prisoner).toEqual({ legacyId: 'P001', name: 'Nguyen Van A' });
      expect(rows[0].items).toEqual([{ menuItemId: 'a', name: 'Item a', unitPrice: 1000, category: 'food' }]);
      // Global menu is read once, not per-session.
      expect(menuService.listAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('acceptOrder', () => {
    it('forwards the operator, method, transfer reference and received amount to the orders service', async () => {
      ordersService.acceptRelativeOrder.mockResolvedValue({ id: 'order-1' } as OrderWithItems);

      await service.acceptOrder('order-1', {
        operatorId: 'op-1',
        method: 'bank',
        transferReference: 'FT24ABC',
        receivedAmount: 1000,
      });

      expect(ordersService.acceptRelativeOrder).toHaveBeenCalledWith('order-1', {
        operatorId: 'op-1',
        method: 'bank',
        transferReference: 'FT24ABC',
        receivedAmount: 1000,
      });
    });
  });
});
