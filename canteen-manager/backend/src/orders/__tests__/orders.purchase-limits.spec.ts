import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrdersService } from '../orders.service';
import { Order } from '../order.entity';
import { OrderItem } from '../order-item.entity';
import { MenuItem } from '../../menu/menu-item.entity';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { PurchaseLimitConfigService } from '../../purchase-limit-config/purchase-limit-config.service';
import { MenuService } from '../../menu/menu.service';
import { UsersService } from '../../users/users.service';
import { AccountsService } from '../../accounts/accounts.service';

const FOOD_ID = '00000000-0000-4000-8000-000000000001';
const ESSENTIAL_ID = '00000000-0000-4000-8000-000000000002';

function menuItem(id: string, price: number, category: MenuItemCategory): MenuItem {
  return {
    id,
    code: id === FOOD_ID ? '001' : '002',
    position: id === FOOD_ID ? 0 : 1,
    name: category,
    price,
    category,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as MenuItem;
}

function build(opts: {
  foodAmount?: number | null;
  foodEnabled?: boolean;
  essentialAmount?: number | null;
  essentialEnabled?: boolean;
} = {}) {
  const rows = [
    menuItem(FOOD_ID, 50_000, MenuItemCategory.FOOD),
    menuItem(ESSENTIAL_ID, 30_000, MenuItemCategory.ESSENTIAL),
  ];
  const saves: unknown[] = [];
  const em = {
    find: jest.fn(async (entity: unknown) => (entity === MenuItem ? rows : [])),
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: unknown) => ({ ...data as object })),
    save: jest.fn(async (_entity: unknown, value: unknown) => {
      saves.push(value);
      if (Array.isArray(value)) {
        return value.map((row, index) => ({ id: `line-${index}`, ...row as object }));
      }
      return { id: (value as { id?: string }).id ?? 'order-id', ...value as object };
    }),
    update: jest.fn(),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (manager: EntityManager) => Promise<unknown>) => cb(em)),
  } as unknown as DataSource;
  const accounts = {
    getOrCreate: jest.fn(async () => ({ balance: 1_000_000 })),
    debit: jest.fn(async () => 900_000),
    credit: jest.fn(async () => 1_000_000),
  } as unknown as AccountsService;
  const purchaseLimits = {
    getEffective: jest.fn(async () => ({
      food: { enabled: opts.foodEnabled ?? true, amount: opts.foodAmount ?? 100_000 },
      essential: {
        enabled: opts.essentialEnabled ?? false,
        amount: opts.essentialAmount ?? null,
      },
    })),
  } as unknown as PurchaseLimitConfigService;
  const service = new OrdersService(
    {} as Repository<Order>,
    {} as Repository<OrderItem>,
    {} as MenuService,
    { findById: jest.fn(async () => ({ id: 'user-id' })) } as unknown as UsersService,
    accounts,
    dataSource,
    purchaseLimits,
  );
  return { service, em, saves, accounts, purchaseLimits };
}

function input(source = 'omr', foodQuantity = 2) {
  return {
    serviceDate: '2026-07-16',
    userId: 'user-id',
    source,
    operatorId: source === 'omr' ? 'operator-id' : undefined,
    items: [{ menuItemId: FOOD_ID, quantity: foodQuantity }],
  };
}

describe('OrdersService category purchase limits', () => {
  it('allows equality and snapshots category from the locked menu row', async () => {
    const { service, em, purchaseLimits } = build({ foodAmount: 100_000 });

    const created = await service.createOrReplace(input());

    expect(created.totalAmount).toBe(100_000);
    expect(created.items[0]).toMatchObject({
      menuItemId: FOOD_ID,
      unitPrice: 50_000,
      quantity: 2,
      category: MenuItemCategory.FOOD,
    });
    expect(em.find).toHaveBeenCalledWith(
      MenuItem,
      expect.objectContaining({ lock: { mode: 'pessimistic_read' } }),
    );
    expect(purchaseLimits.getEffective).toHaveBeenCalledWith('prisoner', em);
  });

  it('rejects a prisoner subtotal strictly over its enabled limit before persistence or debit', async () => {
    const { service, saves, accounts, em } = build({ foodAmount: 99_999 });

    await expect(service.createOrReplace(input())).rejects.toMatchObject({
      response: {
        code: 'ORDER.CATEGORY_LIMIT_EXCEEDED',
        audience: 'prisoner',
        category: 'food',
        actualAmount: 100_000,
        limitAmount: 99_999,
      },
    });
    expect(saves).toHaveLength(0);
    expect(em.update).not.toHaveBeenCalled();
    expect(accounts.debit).not.toHaveBeenCalled();
  });

  it('aggregates duplicate lines before category validation', async () => {
    const { service } = build({ foodAmount: 75_000 });

    await expect(service.createOrReplace({
      ...input('relative', 1),
      items: [
        { menuItemId: FOOD_ID, quantity: 1 },
        { menuItemId: FOOD_ID, quantity: 1 },
      ],
      paymentMethod: 'cash',
    })).rejects.toMatchObject({
      response: { audience: 'visitor', actualAmount: 100_000 },
    });
  });

  it('treats a disabled rule as unlimited even when it retains an amount', async () => {
    const { service } = build({ foodEnabled: false, foodAmount: 1 });
    await expect(service.createOrReplace(input())).resolves.toMatchObject({ totalAmount: 100_000 });
  });

  it('enforces the visitor essential rule independently and allows equality', async () => {
    const equal = build({ essentialEnabled: true, essentialAmount: 60_000 });
    await expect(equal.service.createOrReplace({
      ...input('relative', 1),
      paymentMethod: 'cash',
      items: [{ menuItemId: ESSENTIAL_ID, quantity: 2 }],
    })).resolves.toMatchObject({ totalAmount: 60_000 });

    const exceeded = build({ essentialEnabled: true, essentialAmount: 60_000 });
    await expect(exceeded.service.createOrReplace({
      ...input('relative', 1),
      paymentMethod: 'cash',
      items: [{ menuItemId: ESSENTIAL_ID, quantity: 3 }],
    })).rejects.toMatchObject({
      response: { audience: 'visitor', category: 'essential', actualAmount: 90_000, limitAmount: 60_000 },
    });
  });

  it('explicitly leaves manual orders ungoverned', async () => {
    const { service, purchaseLimits } = build({ foodAmount: 1 });
    await expect(service.createOrReplace(input('manual'))).resolves.toMatchObject({ totalAmount: 100_000 });
    expect(purchaseLimits.getEffective).not.toHaveBeenCalled();
  });

  it('rejects unsupported sources before opening the transaction', async () => {
    const { service } = build();
    await expect(service.createOrReplace(input('unknown'))).rejects.toBeInstanceOf(BadRequestException);
  });
});
