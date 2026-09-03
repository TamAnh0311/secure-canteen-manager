import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentConfigService } from '../payment-config/payment-config.service';
import { confirmationCode } from '../orders/order-confirmation-code';
import { buildVietQrPayload } from '../common/vietqr-payload';
import { bankMemo } from './bank-memo';
import { tomorrowInDeployTz } from '../common/today-in-tz';
import {
  EffectivePurchaseLimits,
  PurchaseLimitConfigService,
} from '../purchase-limit-config/purchase-limit-config.service';
import { MenuItemCategory } from '../menu/menu-item-category.enum';

// Display-only menu entry — deliberately just id/name/price, no internal fields.
export interface KioskMenuItem {
  id: string;
  name: string;
  price: number;
  category: MenuItemCategory;
}

// What a relative sees at the kiosk: the prisoner's name (to confirm the right person)
// plus the single global active menu. NEVER balance, ledger, or order history — money is
// staffed-counter-only, and omitting it removes the roster-balance-harvesting vector.
// bankEnabled gates the bank tender: false (no account configured) → the kiosk hides the bank
// button so no bank order is ever created without a QR to pay it.
export interface KioskPrisonerView {
  name: string;
  prisonId: string;
  zone: string | null;
  cell: string | null;
  menu: KioskMenuItem[];
  bankEnabled: boolean;
  purchaseLimits: EffectivePurchaseLimits;
}

// Offline VietQR transfer details attached to a bank order. Built locally (no network); the
// amount lives ONLY here (KioskOrderResult has no top-level amount). Balance is never present.
export interface KioskBankTransfer {
  qrPayload: string;
  accountName: string;
  accountNumber: string;
  amount: number;
  memo: string;
}

// What the kiosk returns after a visitor places an order: the order id plus a display-only
// confirmation code for visitor reassurance. The cashier settles by prisoner name, not this code.
// bankTransfer is present only for a bank order placed while the canteen account is configured.
export interface KioskOrderResult {
  orderId: string;
  confirmationCode: string;
  bankTransfer?: KioskBankTransfer;
}

export interface PlaceKioskOrderInput {
  prisonId: string;
  items: { menuItemId: string; quantity: number }[];
  method: string;
}

@Injectable()
export class KioskService {
  constructor(
    private readonly usersService: UsersService,
    private readonly menuService: MenuService,
    private readonly ordersService: OrdersService,
    private readonly paymentConfig: PaymentConfigService,
    private readonly purchaseLimits: PurchaseLimitConfigService,
  ) {}

  async prisonerView(prisonId: string): Promise<KioskPrisonerView> {
    const user = await this.usersService.findByLegacyId(prisonId);
    // Same 404 for unknown and inactive: released inmates are never surfaced, and not
    // distinguishing the two avoids leaking which IDs map to a real (deactivated) record.
    if (!user || !user.isActive) {
      throw new NotFoundException({ message: 'Prisoner not found', code: 'USER.NOT_FOUND' });
    }

    // The menu is a single global list; the kiosk only shows orderable (active) items so a
    // delisted dish is never offered to a visitor.
    const menu = (await this.menuService.listAll())
      .filter((item) => item.isActive)
      .map((item) => ({ id: item.id, name: item.name, price: item.price, category: item.category }));

    // Bank tender is only offered when a canteen account is configured (a bank order with no
    // account would produce no QR and an indistinguishable bank-no-QR row in the cashier queue).
    const [bankEnabled, purchaseLimits] = await Promise.all([
      this.paymentConfig.isConfigured(),
      this.purchaseLimits.getEffective('visitor'),
    ]);

    return {
      name: user.name,
      prisonId: user.legacyId,
      zone: user.zone,
      cell: user.cell,
      menu,
      bankEnabled,
      purchaseLimits,
    };
  }

  // A visitor places a pending order from the public kiosk. The order is created ACTIVE/UNPAID
  // with source forced to 'relative' here (never from the request body) — so it can never reach
  // the balance-paying omr branch. A cashier later accepts (→ paid) or rejects it.
  async placeOrder(input: PlaceKioskOrderInput): Promise<KioskOrderResult> {
    const user = await this.usersService.findByLegacyId(input.prisonId);
    // Same opaque 404 as prisonerView for unknown OR released (inactive) prisoners: createOrReplace
    // resolves by user id and does NOT re-check isActive, so the active guard must live here, and it
    // must not leak whether an inactive id maps to a real (deactivated) record.
    if (!user || !user.isActive) {
      throw new NotFoundException({ message: 'Prisoner not found', code: 'USER.NOT_FOUND' });
    }

    // The order buckets to the next collection day's deploy-TZ date. Item-in-menu + isActive
    // filtering, the per-line 1..99 quantity bound, duplicate-line aggregation, and the ≤1-pending
    // dup-reject (409 ORDER.ALREADY_PENDING) all live in createOrReplace and propagate to the caller.
    const order = await this.ordersService.createOrReplace({
      serviceDate: tomorrowInDeployTz(),
      userId: user.id,
      items: input.items,
      source: 'relative',
      paymentMethod: input.method,
    });

    const result: KioskOrderResult = {
      orderId: order.id,
      confirmationCode: confirmationCode(order.id),
    };

    // For a bank order, attach offline VietQR transfer details when the canteen account is
    // configured. If unconfigured the order is still created — the FE degrades to "see cashier"
    // — so a transient config gap never loses a placed order. Cash orders carry no bankTransfer.
    if (input.method === 'bank') {
      const cfg = await this.paymentConfig.getGlobal();
      if (cfg.bankBin && cfg.accountNumber && cfg.accountName) {
        const memo = bankMemo(order.id, user.name);
        result.bankTransfer = {
          qrPayload: buildVietQrPayload(
            { bankBin: cfg.bankBin, accountNumber: cfg.accountNumber },
            order.totalAmount,
            memo,
          ),
          accountName: cfg.accountName,
          accountNumber: cfg.accountNumber,
          amount: order.totalAmount,
          memo,
        };
      }
    }

    return result;
  }
}
