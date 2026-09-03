import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { KioskService } from '../kiosk.service';
import { UsersService } from '../../users/users.service';
import { MenuService } from '../../menu/menu.service';
import { OrdersService } from '../../orders/orders.service';
import { PaymentConfigService } from '../../payment-config/payment-config.service';
import { MenuItem } from '../../menu/menu-item.entity';
import { User } from '../../users/user.entity';
import { OrderWithItems } from '../../orders/orders.service';
import { PaymentConfig } from '../../payment-config/payment-config.entity';
import { confirmationCode } from '../../orders/order-confirmation-code';
import { tomorrowInDeployTz } from '../../common/today-in-tz';
import { PurchaseLimitConfigService } from '../../purchase-limit-config/purchase-limit-config.service';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';

const VISITOR_LIMITS = {
  food: { enabled: true, amount: 500_000 },
  essential: { enabled: false, amount: null },
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    legacyId: 'P001',
    name: 'Nguyen Van A',
    zone: 'Khu A1',
    cell: 'Buong 2',
    isActive: true,
    ...overrides,
  } as User;
}

function makeMenuItem(id: string, isActive = true): MenuItem {
  return {
    id,
    code: '01',
    name: `Item ${id}`,
    price: 1000,
    category: MenuItemCategory.FOOD,
    position: 0,
    isActive,
  } as MenuItem;
}

const CONFIGURED: PaymentConfig = {
  id: 'pc-1',
  singleton: true,
  bankBin: '970436',
  accountNumber: '1234567890',
  accountName: 'QUY CAN TIN',
  updatedAt: new Date(),
};

const UNCONFIGURED: PaymentConfig = {
  id: 'pc-1',
  singleton: true,
  bankBin: null,
  accountNumber: null,
  accountName: null,
  updatedAt: new Date(),
};

describe('KioskService', () => {
  let usersService: { findByLegacyId: jest.Mock };
  let menuService: { listAll: jest.Mock };
  let ordersService: { createOrReplace: jest.Mock };
  let paymentConfig: { getGlobal: jest.Mock; isConfigured: jest.Mock };
  let purchaseLimits: { getEffective: jest.Mock };
  let service: KioskService;

  beforeEach(() => {
    usersService = { findByLegacyId: jest.fn() };
    menuService = { listAll: jest.fn() };
    ordersService = { createOrReplace: jest.fn() };
    paymentConfig = { getGlobal: jest.fn(), isConfigured: jest.fn() };
    purchaseLimits = { getEffective: jest.fn().mockResolvedValue(VISITOR_LIMITS) };
    service = new KioskService(
      usersService as unknown as UsersService,
      menuService as unknown as MenuService,
      ordersService as unknown as OrdersService,
      paymentConfig as unknown as PaymentConfigService,
      purchaseLimits as unknown as PurchaseLimitConfigService,
    );
  });

  describe('prisonerView', () => {
    it('returns the global active menu plus bankEnabled when the account is configured', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      menuService.listAll.mockResolvedValue([
        makeMenuItem('a', true),
        makeMenuItem('b', false), // delisted — must not be surfaced
        makeMenuItem('c', true),
      ]);
      paymentConfig.isConfigured.mockResolvedValue(true);

      const view = await service.prisonerView('P001');

      expect(view).toEqual({
        name: 'Nguyen Van A',
        prisonId: 'P001',
        zone: 'Khu A1',
        cell: 'Buong 2',
        menu: [
          { id: 'a', name: 'Item a', price: 1000, category: 'food' },
          { id: 'c', name: 'Item c', price: 1000, category: 'food' },
        ],
        bankEnabled: true,
        purchaseLimits: VISITOR_LIMITS,
      });
      expect('sessions' in view).toBe(false);
      for (const forbidden of [
        'balance',
        'dateOfBirth',
        'hometown',
        'offense',
        'arrestDate',
        'detentionStatus',
        'orders',
      ]) {
        expect(view).not.toHaveProperty(forbidden);
      }
    });

    it('reports bankEnabled=false when no canteen account is configured', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      menuService.listAll.mockResolvedValue([makeMenuItem('a', true)]);
      paymentConfig.isConfigured.mockResolvedValue(false);

      const view = await service.prisonerView('P001');
      expect(view.bankEnabled).toBe(false);
    });

    it('404s for an unknown prisoner', async () => {
      usersService.findByLegacyId.mockResolvedValue(null);
      await expect(service.prisonerView('NOPE')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s (opaquely) for an inactive prisoner', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser({ isActive: false }));
      await expect(service.prisonerView('P001')).rejects.toBeInstanceOf(NotFoundException);
      expect(menuService.listAll).not.toHaveBeenCalled();
    });
  });

  describe('placeOrder', () => {
    it('creates a relative order dated tomorrow with source forced to relative', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockResolvedValue({ id: 'order-1', totalAmount: 1000 } as OrderWithItems);

      const result = await service.placeOrder({
        prisonId: 'P001',
        items: [{ menuItemId: 'a', quantity: 2 }],
        method: 'cash',
      });

      expect(ordersService.createOrReplace).toHaveBeenCalledTimes(1);
      const arg = ordersService.createOrReplace.mock.calls[0][0];
      expect(arg.serviceDate).toBe(tomorrowInDeployTz());
      expect(arg.source).toBe('relative');
      expect(arg.userId).toBe('user-uuid-1');
      // Per-item quantity is forwarded straight to the funnel — no shim, no flattening.
      expect(arg.items).toEqual([{ menuItemId: 'a', quantity: 2 }]);
      expect(arg.paymentMethod).toBe('cash');
      expect(result.orderId).toBe('order-1');
      expect(typeof result.confirmationCode).toBe('string');
    });

    it('cash order carries no bankTransfer and never reads the payment config for a QR', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockResolvedValue({ id: 'order-1', totalAmount: 1000 } as OrderWithItems);

      const result = await service.placeOrder({ prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'cash' });

      expect(result.bankTransfer).toBeUndefined();
      expect(paymentConfig.getGlobal).not.toHaveBeenCalled();
    });

    it('bank order + configured account returns a bankTransfer with the order amount and folded memo', async () => {
      const orderId = 'aabbccdd-1111-2222-3333-444455556666';
      usersService.findByLegacyId.mockResolvedValue(makeUser({ name: 'Nguyễn Văn Á' }));
      ordersService.createOrReplace.mockResolvedValue({ id: orderId, totalAmount: 50000 } as OrderWithItems);
      paymentConfig.getGlobal.mockResolvedValue(CONFIGURED);

      const result = await service.placeOrder({ prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'bank' });

      expect(result.bankTransfer).toBeDefined();
      const bt = result.bankTransfer!;
      expect(bt.amount).toBe(50000);
      expect(bt.accountName).toBe('QUY CAN TIN');
      expect(bt.accountNumber).toBe('1234567890');
      expect(bt.qrPayload.startsWith('000201')).toBe(true);
      // memo = 8-char confirmation code + folded name, within budget
      expect(bt.memo.startsWith(confirmationCode(orderId))).toBe(true);
      expect(bt.memo).toContain('NGUYEN VAN A');
      // amount is embedded in the QR (field 54)
      expect(bt.qrPayload).toContain('540550000');
    });

    it('bank order + UNconfigured account still creates the order but omits bankTransfer', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockResolvedValue({ id: 'order-1', totalAmount: 50000 } as OrderWithItems);
      paymentConfig.getGlobal.mockResolvedValue(UNCONFIGURED);

      const result = await service.placeOrder({ prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'bank' });

      expect(result.orderId).toBe('order-1');
      expect(result.bankTransfer).toBeUndefined();
    });

    it('never includes balance or ledger fields in the kiosk response', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockResolvedValue({
        id: 'aabbccdd-1111-2222-3333-444455556666',
        totalAmount: 50000,
      } as OrderWithItems);
      paymentConfig.getGlobal.mockResolvedValue(CONFIGURED);

      const result = await service.placeOrder({ prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'bank' });
      const keys = Object.keys(result).concat(Object.keys(result.bankTransfer ?? {}));
      expect(keys).not.toContain('balance');
      expect(keys).not.toContain('ledger');
    });

    it('propagates ORDER.ALREADY_PENDING when a same-day pending order exists', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockRejectedValue(
        new ConflictException({ message: 'already pending', code: 'ORDER.ALREADY_PENDING' }),
      );

      await expect(
        service.placeOrder({ prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'cash' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not construct bank transfer data when category validation rejects the order', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser());
      ordersService.createOrReplace.mockRejectedValue(new BadRequestException({
        code: 'ORDER.CATEGORY_LIMIT_EXCEEDED', audience: 'visitor', category: 'food',
        actualAmount: 500001, limitAmount: 500000,
      }));

      await expect(service.placeOrder({
        prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'bank',
      })).rejects.toMatchObject({ response: { code: 'ORDER.CATEGORY_LIMIT_EXCEEDED' } });
      expect(paymentConfig.getGlobal).not.toHaveBeenCalled();
    });

    it('404s for an inactive prisoner without touching orders', async () => {
      usersService.findByLegacyId.mockResolvedValue(makeUser({ isActive: false }));
      await expect(
        service.placeOrder({ prisonId: 'P001', items: [{ menuItemId: 'a', quantity: 1 }], method: 'cash' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ordersService.createOrReplace).not.toHaveBeenCalled();
    });
  });
});
