import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AccountsService } from '../accounts/accounts.service';
import { OrdersService, OrderWithItems } from '../orders/orders.service';
import { MenuService } from '../menu/menu.service';
import { confirmationCode } from '../orders/order-confirmation-code';
import { tomorrowInDeployTz } from '../common/today-in-tz';
import {
  AccountTransaction,
  AccountTransactionType,
} from '../accounts/account-transaction.entity';
import { User } from '../users/user.entity';
import {
  EffectivePurchaseLimits,
  PurchaseLimitConfigService,
} from '../purchase-limit-config/purchase-limit-config.service';
import { MenuItemCategory } from '../menu/menu-item-category.enum';

export interface PrisonerPublic {
  id: string;
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
  isActive: boolean;
}

export interface PrisonerLookup {
  user: PrisonerPublic;
  balance: number;
  ledger: AccountTransaction[];
  purchaseLimits: EffectivePurchaseLimits;
}

export interface TopupInput {
  prisonId: string;
  amount: number;
  method: string;
  ref?: string;
  operatorId: string;
}

export interface RelativeOrderInput {
  prisonId: string;
  items: { menuItemId: string; quantity: number }[];
  method: string;
  operatorId: string;
}

// One row in the cashier's pending-approval queue: the order plus the context a cashier needs to
// match it to the visitor at the counter (prisoner name, service date, item names).
export interface PendingOrderItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
  category: MenuItemCategory;
}

export interface PendingOrderRow {
  orderId: string;
  confirmationCode: string;
  prisoner: { legacyId: string; name: string };
  serviceDate: string;
  items: PendingOrderItem[];
  totalAmount: number;
  paymentMethod: string | null;
  createdAt: Date;
}

export interface AcceptOrderInput {
  operatorId: string;
  method?: string;
  // Bank settlement extras (both optional). The received amount, when present, must equal the
  // order total or the accept is rejected downstream.
  transferReference?: string;
  receivedAmount?: number;
}

export interface RejectOrderInput {
  operatorId: string;
  reason?: string;
}

// Thin orchestration over Users/Accounts/Orders for the staffed counter. The financial
// invariants (amount bounds, atomic ledger writes, operator attribution, account-first lock)
// live in the services this composes — never duplicated here.
@Injectable()
export class CounterService {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly ordersService: OrdersService,
    private readonly menuService: MenuService,
    private readonly purchaseLimits: PurchaseLimitConfigService,
  ) {}

  // Read-only cashier lookup before any action. Returns the prisoner even when inactive
  // so the UI can show status and disable the money panels; the write paths below re-check.
  async lookup(prisonId: string): Promise<PrisonerLookup> {
    const user = await this.findOr404(prisonId);
    const [balance, ledger, purchaseLimits] = await Promise.all([
      this.accountsService.getBalance(user.id),
      this.accountsService.getLedger(user.id, { limit: 20, offset: 0 }),
      this.purchaseLimits.getEffective('visitor'),
    ]);
    return { user: this.toPublic(user), balance, ledger, purchaseLimits };
  }

  // Credit the balance and append a 'topup' ledger row stamped to the cashier. Amount
  // bounds and the atomic balance+ledger write are enforced inside AccountsService.credit.
  async topup(input: TopupInput): Promise<{ userId: string; balance: number }> {
    const user = await this.resolveActive(input.prisonId);
    const balance = await this.accountsService.credit({
      userId: user.id,
      amount: input.amount,
      type: AccountTransactionType.TOPUP,
      operatorId: input.operatorId,
      method: input.method,
      ref: input.ref ?? null,
    });
    return { userId: user.id, balance };
  }

  // Create a relative's order at the counter — balance untouched, coexisting with any warden
  // (omr) order for the same prisoner+date. The order buckets to the next collection day's
  // deploy-TZ date and is created PENDING (ACTIVE/UNPAID) with the chosen tender stored as the
  // intended method; a cashier must then Accept it in the queue to flip it to paid (uniform flow
  // + full audit). The
  // cashier accepting their own counter order is expected — staff are told the order looks unpaid
  // until that second step.
  async relativeOrder(input: RelativeOrderInput): Promise<OrderWithItems> {
    const user = await this.resolveActive(input.prisonId);
    // Per-item quantity flows straight through to the funnel, which re-checks the 1..99 bound
    // and aggregates duplicate lines before the price math.
    return this.ordersService.createOrReplace({
      serviceDate: tomorrowInDeployTz(),
      userId: user.id,
      items: input.items,
      source: 'relative',
      paymentMethod: input.method,
      operatorId: input.operatorId,
    });
  }

  // Cashier's pending-approval queue, oldest-first (FIFO). Each raw pending order is enriched with
  // the prisoner name/legacyId, its service date, and item names so the cashier can match it to the
  // visitor. The menu is global, so item names are resolved once from a single lookup. Pending
  // volume is small (single canteen), so per-order enrichment is acceptable.
  async listPendingOrders(): Promise<PendingOrderRow[]> {
    const pending = await this.ordersService.listPending();
    const menuNameById = new Map((await this.menuService.listAll()).map((m) => [m.id, m.name]));
    const rows: PendingOrderRow[] = [];

    for (const order of pending) {
      const user = await this.usersService.findById(order.userId);
      const full = await this.ordersService.findOne(order.id);
      rows.push({
        orderId: order.id,
        confirmationCode: confirmationCode(order.id),
        prisoner: { legacyId: user.legacyId, name: user.name },
        serviceDate: order.serviceDate,
        items: full.items.map((it) => ({
          menuItemId: it.menuItemId,
          name: menuNameById.get(it.menuItemId) ?? 'Unknown item',
          unitPrice: it.unitPrice,
          category: it.category,
        })),
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
      });
    }
    return rows;
  }

  // Accept a pending relative order → paid, attributed to the cashier, optional tender override.
  // Already-settled/rejected orders 409 (ORDER.NOT_PENDING).
  async acceptOrder(orderId: string, input: AcceptOrderInput): Promise<OrderWithItems> {
    return this.ordersService.acceptRelativeOrder(orderId, {
      operatorId: input.operatorId,
      method: input.method,
      transferReference: input.transferReference,
      receivedAmount: input.receivedAmount,
    });
  }

  // Reject a pending relative order → terminal REJECTED + reason, freeing the slot for a new
  // order. Already-settled/rejected orders 409 (ORDER.NOT_PENDING).
  async rejectOrder(orderId: string, input: RejectOrderInput): Promise<OrderWithItems> {
    return this.ordersService.rejectRelativeOrder(orderId, {
      operatorId: input.operatorId,
      reason: input.reason,
    });
  }

  private async findOr404(prisonId: string): Promise<User> {
    const user = await this.usersService.findByLegacyId(prisonId);
    if (!user) {
      throw new NotFoundException({ message: 'Prisoner not found', code: 'USER.NOT_FOUND' });
    }
    return user;
  }

  // Money paths reject released/transferred-out prisoners (USER.INACTIVE).
  private async resolveActive(prisonId: string): Promise<User> {
    const user = await this.findOr404(prisonId);
    return this.usersService.assertActive(user.id);
  }

  private toPublic(u: User): PrisonerPublic {
    return {
      id: u.id,
      legacyId: u.legacyId,
      name: u.name,
      zone: u.zone,
      cell: u.cell,
      isActive: u.isActive,
    };
  }
}
