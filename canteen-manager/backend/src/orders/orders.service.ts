import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { sqliteSafeLock } from '../common/sqlite-safe-lock';
import { Order, OrderStatus, PaymentStatus } from './order.entity';
import { OrderItem } from './order-item.entity';
import { MenuService } from '../menu/menu.service';
import { UsersService } from '../users/users.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountTransactionType } from '../accounts/account-transaction.entity';
import { ListOrdersDto } from './dto/list-orders.dto';
import { todayInDeployTz } from '../common/today-in-tz';
import { MenuItem } from '../menu/menu-item.entity';
import { MenuItemCategory } from '../menu/menu-item-category.enum';
import {
  PurchaseLimitAudience,
  PurchaseLimitConfigService,
} from '../purchase-limit-config/purchase-limit-config.service';
import { createSnapshotAtAcceptance } from './tg8-snapshot';
import { OperatorPublic } from '../operators/operator-public';
import { OperatorZoneAccessService } from '../auth/operator-zone-access.service';
import { GetStatsDto } from './dto/get-stats.dto';

// One requested order line: a menu item and how many portions of it. Duplicates of the same
// menuItemId are aggregated (quantities summed) downstream. quantity is validated as an integer
// in [1,99] inside createOrReplace — see the trust-boundary note there.
export interface OrderLineInput {
  menuItemId: string;
  quantity: number;
}

export interface CreateOrReplaceInput {
  // Calendar date this order belongs to (YYYY-MM-DD), server-stamped at ingestion. Plain
  // string to match the DATE column + string-typed entity field — no Date object, no TZ drift.
  serviceDate: string;
  userId: string;
  items: OrderLineInput[];
  sheetId?: string;
  source?: string;
  // Required for the warden (omr) money path: the confirming operator that the
  // resulting order_debit / reversal ledger rows are attributed to.
  operatorId?: string;
  // Counter-paid relative orders: 'cash' | 'bank'. Marks the order paid without
  // touching the balance. Forbidden on the omr path (which always pays from balance).
  paymentMethod?: string;
  // When provided, replacement permission is checked only after the canonical account
  // lock is held. Omit for callers whose workflow permits automatic replacement.
  replacementAcknowledged?: boolean;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface CreateOrReplaceOutcome {
  order: OrderWithItems;
  replaced: boolean;
}

// One merged signed delivery sheet per prisoner for a collection date: identity + location,
// items aggregated across all of the prisoner's PAID active orders (qty = sum of per-line
// quantities across those orders), summed total, the balance snapshot at print time, and the
// capture timestamp rendered on the sheet so the signed document is auditable rather than
// silently stale.
export interface DeliveryVoucher {
  userId: string;
  name: string;
  legacyId: string; // prisoner ID
  zone: string | null; // Khu giam
  cell: string | null; // Buồng giam
  items: { name: string; qty: number }[];
  totalAmount: number; // Σ order.total_amount across the prisoner's PAID active orders for date
  remainingBalance: number; // prisoner_accounts.balance snapshot at capture time (0 if no account)
  printedAt: string; // ISO timestamp the balance/voucher was captured
}

/** Dashboard aggregate stats returned by GET /api/orders/stats. */
export interface DashboardStats {
  totalOrders: number;
  pendingOrders: number;
  paidOrders: number;
  totalRevenue: number;
}

// Null-last ascending string compare, so prisoners without a zone/cell sort after those with one.
function nullableCompare(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

// Postgres unique-violation SQLSTATE. TypeORM wraps the driver error; the code surfaces on the
// error itself or its nested driverError depending on the failure path.
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly itemRepo: Repository<OrderItem>,
    private readonly menuService: MenuService,
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly dataSource: DataSource,
    private readonly purchaseLimits: PurchaseLimitConfigService,
    private readonly zoneAccess?: OperatorZoneAccessService,
  ) {}

  // Atomically creates an active order or supersedes an existing one of the SAME origin.
  // Re-scan scenario: if (service_date, user, source) already has an active order it is
  // marked superseded and a new active order is inserted — full audit trail retained.
  // Orders of a different origin (e.g. a warden omr order vs a relative order) coexist,
  // as do orders on different service dates.
  //
  // Warden (source='omr') orders are paid from the prisoner balance: the order debits
  // total_amount in the SAME transaction (paid/balance), and a re-scan supersede first
  // reverses the prior order's stored debit then debits the new total — so a replay nets
  // to zero even if menu prices changed between attempts. An insufficient balance throws
  // and rolls the whole thing back (no order, no supersede).
  //
  // Pass `em` to compose inside a caller's transaction (e.g. verify confirm folds the
  // sheet finalisation into the same TX); omit it to run standalone.
  async createOrReplace(input: CreateOrReplaceInput, em?: EntityManager): Promise<OrderWithItems> {
    return (await this.createOrReplaceWithOutcome(input, em)).order;
  }

  async createOrReplaceWithOutcome(
    input: CreateOrReplaceInput,
    em?: EntityManager,
  ): Promise<CreateOrReplaceOutcome> {
    // All read-only validation happens before the transaction to keep the TX short
    await this.usersService.findById(input.userId); // throws NotFoundException if missing

    if (input.items.length === 0) {
      throw new BadRequestException({ message: 'Order must contain at least one menu item', code: 'ORDER.EMPTY_ITEMS' });
    }

    // Quantity trust boundary: the funnel — not the DTO — is the authoritative gate. The verify
    // (omr) path builds items[] server-side from a scanned sheet and never passes through a
    // class-validator DTO, so per-line integer/range validation MUST live here, before any money
    // math, or a bad quantity would silently mis-price the order and mis-debit the balance.
    for (const line of input.items) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
        throw new BadRequestException({
          message: 'Item quantity must be an integer between 1 and 99',
          code: 'ORDER.INVALID_QUANTITY',
        });
      }
    }

    const source = input.source ?? 'omr';
    const isScanned = source === 'omr' || source === 'scanner';
    const audience = this.sourceAudience(source);

    // Aggregate duplicate menuItemIds into one row, summing their quantities. The DB unique
    // index UNIQUE(order, menu_item) also enforces single-row-per-item; summing here keeps the
    // order well-formed (a visitor tapping an item twice means "2 portions", not a collision).
    const qtyById = new Map<string, number>();
    for (const line of input.items) {
      qtyById.set(line.menuItemId, (qtyById.get(line.menuItemId) ?? 0) + line.quantity);
    }

    // Invariant: payment_method='balance' ⇔ source is a scanned origin. The scanned
    // money path needs an operator to attribute its ledger rows to; reject early.
    if (isScanned && !input.operatorId) {
      throw new BadRequestException({
        message: 'operatorId is required for a warden (omr) order',
        code: 'ORDER.OPERATOR_REQUIRED',
      });
    }

    // Scanned orders always settle from balance; counter-paid relative orders may only
    // be cash or bank.
    if (isScanned && input.paymentMethod) {
      throw new BadRequestException({
        message: 'A warden (omr) order is paid from balance and takes no payment method',
        code: 'ORDER.INVALID_PAYMENT_METHOD',
      });
    }
    if (!isScanned && input.paymentMethod && !['cash', 'bank'].includes(input.paymentMethod)) {
      throw new BadRequestException({
        message: 'Relative order payment method must be cash or bank',
        code: 'ORDER.INVALID_PAYMENT_METHOD',
      });
    }

    const run = async (m: EntityManager): Promise<CreateOrReplaceOutcome> => {
      // Lock the account row FIRST (canonical lock order: account before order rows)
      // so concurrent warden/cashier ops on the same prisoner serialize and can't oversell.
      if (isScanned) {
        await this.accountsService.getOrCreate(input.userId, m);
      }

      // Authoritative catalog resolution lives inside the transaction. Lock rows in stable id
      // order so category/price validation and the persisted snapshots cannot split across an
      // admin edit. Relative/manual/scanner paths reject inactive rows; legacy OMR accepts
      // them because an issued paper form may outlive menu retirement.
      const selectedIds = [...qtyById.keys()].sort();
      const menuItems = await m.find(MenuItem, {
        where: { id: In(selectedIds) },
        order: { id: 'ASC' },
        ...sqliteSafeLock('pessimistic_read'),
      });
      const menuById = new Map(menuItems.map((item) => [item.id, item]));
      for (const id of selectedIds) {
        const item = menuById.get(id);
        if (!item || (source !== 'omr' && !item.isActive)) {
          throw new BadRequestException({
            message: `Menu item ${id} is not in the menu`,
            code: 'ORDER.ITEM_NOT_IN_MENU',
          });
        }
      }

      const subtotals: Record<MenuItemCategory, number> = {
        [MenuItemCategory.FOOD]: 0,
        [MenuItemCategory.ESSENTIAL]: 0,
      };
      for (const [id, quantity] of qtyById) {
        const item = menuById.get(id)!;
        subtotals[item.category] += item.price * quantity;
      }
      const totalAmount = subtotals.food + subtotals.essential;

      if (audience) {
        const policy = await this.purchaseLimits.getEffective(audience, m);
        for (const category of [MenuItemCategory.FOOD, MenuItemCategory.ESSENTIAL]) {
          const rule = policy[category];
          const actualAmount = subtotals[category];
          if (rule.enabled && rule.amount !== null && actualAmount > rule.amount) {
            throw new BadRequestException({
              message: `${category} subtotal ${actualAmount} exceeds limit ${rule.amount}`,
              code: 'ORDER.CATEGORY_LIMIT_EXCEEDED',
              audience,
              category,
              actualAmount,
              limitAmount: rule.amount,
            });
          }
        }
      }

      // Pre-generate the new order's UUID so the superseded row can back-reference it
      // before the INSERT — this lets us supersede FIRST, then insert, avoiding a
      // transient duplicate on the partial unique index (non-deferrable).
      const newId = randomUUID();

      // Step (a): supersede the existing active scanned order BEFORE inserting the
      // replacement. OMR and scanner share one logical scanned channel; relative orders
      // remain independent. The shared partial index is the database backstop.
      let existing = await m.findOne(Order, {
        where: { serviceDate: input.serviceDate, userId: input.userId, source, status: OrderStatus.ACTIVE },
      });
      if (!existing && isScanned) {
        existing = await m.findOne(Order, {
          where: {
            serviceDate: input.serviceDate,
            userId: input.userId,
            source: source === 'omr' ? 'scanner' : 'omr',
            status: OrderStatus.ACTIVE,
          },
        });
      }
      if (existing) {
        if (input.replacementAcknowledged === false) {
          throw new ConflictException({
            message: 'Acknowledge replacement of the existing OMR order',
            code: 'VERIFY.REPLACEMENT_ACK_REQUIRED',
          });
        }
        if (source === 'relative') {
          // A relative (visitor) order is settled manually by a cashier, never auto-superseded.
          // A second create while one is still pending would silently overwrite the visitor's
          // order or collide on the partial unique index — reject it so there is at most one
          // pending relative order per prisoner+date (the cashier disambiguates by name).
          throw new ConflictException({
            message: 'An order is already pending for this prisoner today',
            code: 'ORDER.ALREADY_PENDING',
          });
        }
        await m.update(Order, existing.id, {
          status: OrderStatus.SUPERSEDED,
          supersededAt: new Date(),
          supersededByOrderId: newId,
        });
      }

      // Step (b): insert the new active order with the pre-generated id.
      const newOrder = m.create(Order, {
        id: newId,
        serviceDate: input.serviceDate,
        userId: input.userId,
        source,
        sheetId: input.sheetId ?? null,
        status: OrderStatus.ACTIVE,
        totalAmount,
        // Scanned orders pay from balance on create. A relative order is created UNPAID —
        // there is no auto-pay; the cashier flips it to paid on accept. The chosen tender is
        // still stored up front as the intended method.
        paymentStatus: isScanned ? PaymentStatus.PAID : PaymentStatus.UNPAID,
        paymentMethod: isScanned ? 'balance' : (input.paymentMethod ?? null),
      });
      let savedOrder: Order;
      try {
        savedOrder = await m.save(Order, newOrder);
      } catch (e) {
        // Race between the dup-reject SELECT above and this INSERT: a concurrent relative
        // create can win the partial unique index slot first. Surface the same 409 instead
        // of an opaque 23505/500. (omr supersedes within its own txn, so this is relative-only.)
        if (source === 'relative' && isUniqueViolation(e)) {
          throw new ConflictException({
            message: 'An order is already pending for this prisoner today',
            code: 'ORDER.ALREADY_PENDING',
          });
        }
        throw e;
      }

      // Step (c): insert order_items atomically with the order, snapshotting unit_price and
      // the aggregated quantity per item.
      const orderItems = [...qtyById.entries()].map(([menuItemId, quantity]) =>
        m.create(OrderItem, {
          orderId: savedOrder.id,
          menuItemId,
          unitPrice: menuById.get(menuItemId)!.price,
          category: menuById.get(menuItemId)!.category,
          quantity,
        }),
      );
      const savedItems = await m.save(OrderItem, orderItems);

      // Step (d): settle the balance for the omr money path. Reversal of the prior
      // debit uses the SUPERSEDED order's stored total (not a recomputed price) so a
      // replay nets to zero across menu price changes. Amounts of 0 (free order) skip
      // the ledger write since a balance mutation must be strictly positive.
      if (isScanned) {
        const operatorId = input.operatorId!;
        if (existing && existing.totalAmount > 0) {
          await this.accountsService.credit(
            {
              userId: input.userId,
              amount: existing.totalAmount,
              type: AccountTransactionType.REVERSAL,
              operatorId,
              relatedOrderId: existing.id,
            },
            m,
          );
        }
        if (totalAmount > 0) {
          // Throws ACCOUNT.INSUFFICIENT_FUNDS → whole TX rolls back (no order, no supersede).
          await this.accountsService.debit(
            {
              userId: input.userId,
              amount: totalAmount,
              type: AccountTransactionType.ORDER_DEBIT,
              operatorId,
              relatedOrderId: newId,
            },
            m,
          );
        }
      }

      return {
        order: { ...savedOrder, items: savedItems },
        replaced: existing !== null,
      };
    };

    return em ? run(em) : this.dataSource.transaction(run);
  }

  private sourceAudience(source: string): PurchaseLimitAudience | null {
    switch (source) {
      case 'omr':
      case 'scanner':
        return 'prisoner';
      case 'relative':
        return 'visitor';
      case 'manual':
        return null;
      default:
        throw new BadRequestException({
          message: `Unsupported order source ${source}`,
          code: 'ORDER.INVALID_SOURCE',
        });
    }
  }

  // Cashier accepts a pending relative order → flips it to PAID with operator attribution and
  // an optional tender override. Money never touches the balance (relative orders are paid by
  // cash/bank at the counter). A pessimistic_write row lock + status guard serialize concurrent
  // accepts so only one wins; the loser sees ORDER.NOT_PENDING (409).
  //
  // Bank settlement adds two OPTIONAL fields for manual reconciliation against the canteen bank
  // app: a free-text transfer reference and the received amount. A received amount, when entered,
  // MUST equal the order total or the accept is rejected (strict integrity). The reference is
  // trimmed and blank→null; a non-empty reference reused on another order trips the partial
  // UNIQUE index and surfaces as 409 ORDER.REFERENCE_DUPLICATE (advisory double-spend guard).
  async acceptRelativeOrder(
    orderId: string,
    opts: { operatorId: string; method?: string; transferReference?: string; receivedAmount?: number },
  ): Promise<OrderWithItems> {
    if (opts.method && !['cash', 'bank'].includes(opts.method)) {
      throw new BadRequestException({
        message: 'Relative order payment method must be cash or bank',
        code: 'ORDER.INVALID_PAYMENT_METHOD',
      });
    }
    // Trim the reference and treat blank as absent so multiple blank refs never collide on the
    // partial UNIQUE index — only a deliberately-entered reference participates in the guard.
    const trimmedRef = opts.transferReference?.trim();
    const reference = trimmedRef ? trimmedRef : null;
    return this.dataSource.transaction(async (m) => {
      const order = await m.findOne(Order, {
        where: { id: orderId },
        ...sqliteSafeLock('pessimistic_write'),
      });
      this.assertPending(order);
      // Strict amount integrity: a mismatched entered amount blocks the accept (the order stays
      // pending). A blank amount still settles — entry is optional, equality is enforced only
      // when the cashier types a value.
      if (opts.receivedAmount != null && opts.receivedAmount !== order.totalAmount) {
        throw new BadRequestException({
          message: 'Received amount must equal the order total',
          code: 'ORDER.AMOUNT_MISMATCH',
        });
      }
      const acceptedAt = new Date();
      try {
        await m.update(Order, orderId, {
          paymentStatus: PaymentStatus.PAID,
          paymentMethod: opts.method ?? order.paymentMethod,
          settledByOperatorId: opts.operatorId,
          settledAt: acceptedAt,
          transferReference: reference,
          receivedAmount: opts.receivedAmount ?? null,
        });
      } catch (e) {
        // Two orders settled with the same non-empty reference collide on the partial UNIQUE
        // index — surface a clean 409 instead of an opaque 23505/500.
        if (isUniqueViolation(e)) {
          throw new ConflictException({
            message: 'This transfer reference has already settled another order',
            code: 'ORDER.REFERENCE_DUPLICATE',
          });
        }
        throw e;
      }
      await createSnapshotAtAcceptance(m, order, acceptedAt, opts.operatorId);
      return this.loadWithItems(m, orderId);
    });
  }

  // Cashier rejects a pending relative order → terminal REJECTED + reason + operator stamp.
  // Non-active, so it frees the one-active-per-(service_date,user,source) slot for a fresh order.
  async rejectRelativeOrder(
    orderId: string,
    opts: { operatorId: string; reason?: string },
  ): Promise<OrderWithItems> {
    return this.dataSource.transaction(async (m) => {
      const order = await m.findOne(Order, {
        where: { id: orderId },
        ...sqliteSafeLock('pessimistic_write'),
      });
      this.assertPending(order);
      await m.update(Order, orderId, {
        status: OrderStatus.REJECTED,
        rejectReason: opts.reason ?? null,
        settledByOperatorId: opts.operatorId,
        settledAt: new Date(),
      });
      return this.loadWithItems(m, orderId);
    });
  }

  // Pending relative orders awaiting a cashier decision, oldest-first (FIFO queue order).
  // Raw rows only — the counter layer enriches with prisoner/items context.
  listPending(): Promise<Order[]> {
    return this.orderRepo.find({
      where: {
        source: 'relative',
        status: OrderStatus.ACTIVE,
        paymentStatus: PaymentStatus.UNPAID,
      },
      order: { createdAt: 'ASC' },
    });
  }

  // A relative order is settleable only while still pending: active + unpaid + relative origin.
  // Anything else (already accepted/rejected/superseded, or an omr order) is a 409.
  private assertPending(order: Order | null): asserts order is Order {
    if (!order) {
      throw new NotFoundException({ message: 'Order not found', code: 'ORDER.NOT_FOUND' });
    }
    if (
      order.source !== 'relative' ||
      order.status !== OrderStatus.ACTIVE ||
      order.paymentStatus !== PaymentStatus.UNPAID
    ) {
      throw new ConflictException({ message: 'Order is not pending', code: 'ORDER.NOT_PENDING' });
    }
  }

  private async loadWithItems(m: EntityManager, orderId: string): Promise<OrderWithItems> {
    const order = await m.findOne(Order, { where: { id: orderId } });
    const items = await m.find(OrderItem, { where: { orderId } });
    return { ...(order as Order), items };
  }

  async findAll(filter: ListOrdersDto, actor?: OperatorPublic): Promise<(Order & { userName?: string; userLegacyId?: string })[]> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .orderBy('o.created_at', 'DESC')
      .take(filter.limit)
      .skip(filter.offset);
    if (actor) this.zoneAccess!.scopeByUserId(qb, actor, 'o.user_id');

    if (filter.dateFrom) qb.andWhere('o.service_date >= :dateFrom', { dateFrom: filter.dateFrom });
    if (filter.dateTo) qb.andWhere('o.service_date <= :dateTo', { dateTo: filter.dateTo });
    if (filter.userId) qb.andWhere('o.user_id = :userId', { userId: filter.userId });
    if (filter.status) qb.andWhere('o.status = :status', { status: filter.status });

    const orders = await qb.getMany();
    if (orders.length === 0) return [];

    // Batch-fetch user names for display.
    const userIds = [...new Set(orders.map((o) => o.userId))];
    const users = await this.dataSource.query(
      `SELECT id, name, legacy_id FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
      userIds,
    ) as { id: string; name: string; legacy_id: string }[];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return orders.map((order) => ({
      ...order,
      userName: userMap.get(order.userId)?.name,
      userLegacyId: userMap.get(order.userId)?.legacy_id,
    }));
  }

  // Builds the delivery vouchers for a collection date: one merged sheet per prisoner over
  // that date's PAID active orders (any source). PAID-only excludes unpaid/pending relative
  // orders (a relative order is delivered only once a cashier accepts it); active-only excludes
  // superseded/rejected. No server-side zone/cell filter — ADMIN prints every zone and the UI
  // builds its location dropdowns from the full set.
  async getDeliveryVouchers(params: { date?: string }): Promise<DeliveryVoucher[]> {
    const date = params.date ?? todayInDeployTz();

    // PAID active orders for the date, joined to the prisoner identity/location. Raw join by
    // table name keeps the users table out of OrdersModule.forFeature (the service boundary owns it).
    const orderRows = await this.orderRepo
      .createQueryBuilder('o')
      .leftJoin('users', 'u', 'u.id = o.user_id')
      .select('o.id', 'orderId')
      .addSelect('o.user_id', 'userId')
      .addSelect('o.total_amount', 'totalAmount')
      .addSelect('u.name', 'name')
      .addSelect('u.legacy_id', 'legacyId')
      .addSelect('u.zone', 'zone')
      .addSelect('u.cell', 'cell')
      .where('o.service_date = :date', { date })
      .andWhere('o.status = :status', { status: OrderStatus.ACTIVE })
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .getRawMany<{
        orderId: string;
        userId: string;
        totalAmount: string;
        name: string;
        legacyId: string;
        zone: string | null;
        cell: string | null;
      }>();

    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((r) => r.orderId);

    // Merge items across the prisoner's orders. order_items has UNIQUE(order,menuItem) so an item
    // is at most 1 row per order; SUM(oi.quantity) across the prisoner's orders gives the true
    // delivered quantity (intra-order quantity × however many of the prisoner's orders list it).
    const itemRows = await this.itemRepo
      .createQueryBuilder('oi')
      .innerJoin('orders', 'o', 'o.id = oi.order_id')
      .innerJoin('menu_items', 'mi', 'mi.id = oi.menu_item_id')
      .select('o.user_id', 'userId')
      .addSelect('mi.name', 'name')
      .addSelect('SUM(oi.quantity)', 'qty')
      .where('oi.order_id IN (:...orderIds)', { orderIds })
      .groupBy('o.user_id')
      .addGroupBy('mi.id')
      .addGroupBy('mi.name')
      .orderBy('mi.name', 'ASC')
      .getRawMany<{ userId: string; name: string; qty: string }>();

    const userIds = [...new Set(orderRows.map((r) => r.userId))];
    const balances = await this.accountsService.getBalances(userIds);

    // One capture timestamp for the whole batch — rendered on every sheet (audit + TOCTOU note).
    const printedAt = new Date().toISOString();

    const itemsByUser = new Map<string, { name: string; qty: number }[]>();
    for (const r of itemRows) {
      const list = itemsByUser.get(r.userId) ?? [];
      list.push({ name: r.name, qty: Number(r.qty) });
      itemsByUser.set(r.userId, list);
    }

    const voucherByUser = new Map<string, DeliveryVoucher>();
    for (const r of orderRows) {
      let voucher = voucherByUser.get(r.userId);
      if (!voucher) {
        voucher = {
          userId: r.userId,
          name: r.name,
          legacyId: r.legacyId,
          zone: r.zone,
          cell: r.cell,
          items: itemsByUser.get(r.userId) ?? [],
          totalAmount: 0,
          remainingBalance: balances.get(r.userId) ?? 0,
          printedAt,
        };
        voucherByUser.set(r.userId, voucher);
      }
      voucher.totalAmount += Number(r.totalAmount);
    }

    return [...voucherByUser.values()].sort(
      (a, b) =>
        nullableCompare(a.zone, b.zone) ||
        nullableCompare(a.cell, b.cell) ||
        a.name.localeCompare(b.name),
    );
  }

  async findOne(id: string, actor?: OperatorPublic): Promise<OrderWithItems & { userName?: string; userLegacyId?: string }> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.id = :id', { id });
    if (actor) this.zoneAccess!.scopeByUserId(qb, actor, 'o.user_id');
    const order = await qb.getOne();
    if (!order) throw new NotFoundException({ message: 'Order not found', code: 'ORDER.NOT_FOUND' });

    // Fetch user name.
    const userRows = await this.dataSource.query(
      'SELECT name, legacy_id FROM users WHERE id = ?',
      [order.userId],
    ) as { name: string; legacy_id: string }[];

    // Fetch items with menu item names.
    const items = await this.itemRepo.find({ where: { orderId: id } });
    const menuIds = [...new Set(items.map((i) => i.menuItemId))];
    let menuMap = new Map<string, string>();
    if (menuIds.length > 0) {
      const menuRows = await this.dataSource.query(
        `SELECT id, name FROM menu_items WHERE id IN (${menuIds.map(() => '?').join(',')})`,
        menuIds,
      ) as { id: string; name: string }[];
      menuMap = new Map(menuRows.map((m) => [m.id, m.name]));
    }

    return {
      ...order,
      items: items.map((item) => ({ ...item, menuItemName: menuMap.get(item.menuItemId) })),
      userName: userRows[0]?.name,
      userLegacyId: userRows[0]?.legacy_id,
    };
  }

  /**
   * Aggregate dashboard stats for a service-date range.
   * Returns order counts by payment status and total revenue from paid orders.
   */
  async getStats(filter: GetStatsDto): Promise<DashboardStats> {
    const dateFrom = filter.dateFrom ?? todayInDeployTz();
    const dateTo = filter.dateTo ?? dateFrom;

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.status = :status', { status: OrderStatus.ACTIVE })
      .andWhere('o.service_date >= :dateFrom', { dateFrom })
      .andWhere('o.service_date <= :dateTo', { dateTo });

    const totalOrders = await qb.getCount();

    const pendingOrders = await qb
      .clone()
      .andWhere('o.payment_status = :unpaid', { unpaid: PaymentStatus.UNPAID })
      .getCount();

    const paidOrders = await qb
      .clone()
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .getCount();

    const revenueResult = await qb
      .clone()
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .select('COALESCE(SUM(o.total_amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    const totalRevenue = Number(revenueResult?.total ?? 0);

    return { totalOrders, pendingOrders, paidOrders, totalRevenue };
  }

  /**
   * Financial report: revenue breakdown by source, payment method, and category
   * across a date range. Admin-only.
   */
  async getFinancialReport(dateFrom: string, dateTo: string): Promise<FinancialReport> {
    const base = this.orderRepo
      .createQueryBuilder('o')
      .where('o.status = :status', { status: OrderStatus.ACTIVE })
      .andWhere('o.service_date >= :dateFrom', { dateFrom })
      .andWhere('o.service_date <= :dateTo', { dateTo });

    // Revenue by source
    const bySource = await base.clone()
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .select('o.source', 'source')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'orderCount')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .groupBy('o.source')
      .getRawMany<{ source: string; orderCount: string; revenue: string }>();

    // Revenue by payment method
    const byMethod = await base.clone()
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .select('o.payment_method', 'method')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'orderCount')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .groupBy('o.payment_method')
      .getRawMany<{ method: string | null; orderCount: string; revenue: string }>();

    // Revenue by category (join order_items)
    const byCategory = await this.itemRepo
      .createQueryBuilder('oi')
      .innerJoin('orders', 'o', 'o.id = oi.order_id')
      .where('o.status = :status', { status: OrderStatus.ACTIVE })
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .andWhere('o.service_date >= :dateFrom', { dateFrom })
      .andWhere('o.service_date <= :dateTo', { dateTo })
      .select('oi.category', 'category')
      .addSelect('CAST(SUM(oi.quantity) AS INTEGER)', 'totalQuantity')
      .addSelect('COALESCE(SUM(oi.unit_price * oi.quantity), 0)', 'revenue')
      .groupBy('oi.category')
      .getRawMany<{ category: string; totalQuantity: string; revenue: string }>();

    // Daily revenue totals
    const daily = await base.clone()
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .select('o.service_date', 'date')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'orderCount')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .groupBy('o.service_date')
      .orderBy('o.service_date', 'ASC')
      .getRawMany<{ date: string; orderCount: string; revenue: string }>();

    // Overall totals
    const totalPaid = await base.clone()
      .andWhere('o.payment_status = :paid', { paid: PaymentStatus.PAID })
      .select('CAST(COUNT(*) AS INTEGER)', 'count')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'revenue')
      .getRawOne<{ count: string; revenue: string }>();

    const totalUnpaid = await base.clone()
      .andWhere('o.payment_status = :unpaid', { unpaid: PaymentStatus.UNPAID })
      .select('CAST(COUNT(*) AS INTEGER)', 'count')
      .addSelect('COALESCE(SUM(o.total_amount), 0)', 'amount')
      .getRawOne<{ count: string; amount: string }>();

    return {
      dateFrom,
      dateTo,
      totals: {
        paidOrders: Number(totalPaid?.count ?? 0),
        paidRevenue: Number(totalPaid?.revenue ?? 0),
        unpaidOrders: Number(totalUnpaid?.count ?? 0),
        unpaidAmount: Number(totalUnpaid?.amount ?? 0),
      },
      bySource: bySource.map((r) => ({
        source: r.source,
        orderCount: Number(r.orderCount),
        revenue: Number(r.revenue),
      })),
      byMethod: byMethod.map((r) => ({
        method: r.method ?? 'unknown',
        orderCount: Number(r.orderCount),
        revenue: Number(r.revenue),
      })),
      byCategory: byCategory.map((r) => ({
        category: r.category,
        totalQuantity: Number(r.totalQuantity),
        revenue: Number(r.revenue),
      })),
      daily: daily.map((r) => ({
        date: r.date,
        orderCount: Number(r.orderCount),
        revenue: Number(r.revenue),
      })),
    };
  }
}

/** Financial report shape returned by getFinancialReport. */
export interface FinancialReport {
  dateFrom: string;
  dateTo: string;
  totals: {
    paidOrders: number;
    paidRevenue: number;
    unpaidOrders: number;
    unpaidAmount: number;
  };
  bySource: Array<{ source: string; orderCount: number; revenue: number }>;
  byMethod: Array<{ method: string; orderCount: number; revenue: number }>;
  byCategory: Array<{ category: string; totalQuantity: number; revenue: number }>;
  daily: Array<{ date: string; orderCount: number; revenue: number }>;
}
