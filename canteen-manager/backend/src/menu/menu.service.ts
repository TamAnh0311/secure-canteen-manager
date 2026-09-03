import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MenuItem } from './menu-item.entity';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { OrderStatus } from '../orders/order.entity';
import { tomorrowInDeployTz } from '../common/today-in-tz';
import { MenuItemCategory } from './menu-item-category.enum';
import { OperatorPublic } from '../operators/operator-public';
import { OperatorZoneAccessService } from '../auth/operator-zone-access.service';

export interface MenuItemSummary {
  menuItemId: string;
  name: string;
  position: number;
  count: number;
}

// Postgres unique-violation SQLSTATE. TypeORM surfaces it on the error itself or its
// nested driverError depending on the failure path.
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

const MAX_CODE_RETRIES = 5;

// Menu codes are zero-padded numeric strings of fixed width. The digit count defines
// the maximum number of distinct menu items that can be assigned codes.
const CODE_DIGIT_COUNT = 3;

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(MenuItem)
    private readonly repo: Repository<MenuItem>,
    private readonly dataSource: DataSource,
    private readonly zoneAccess?: OperatorZoneAccessService,
  ) {}

  listAll(): Promise<MenuItem[]> {
    return this.repo.find({ order: { position: 'ASC' } });
  }

  // Appends a new item at the next free slot. Position and code are derived from the MAX
  // over ALL rows (including soft-deleted, isActive=false), never from a count: a count would
  // reuse a position freed by a soft-delete and could then collide with an existing row.
  // Gaps left by deletes are expected.
  async addItem(dto: CreateMenuItemDto): Promise<MenuItem> {
    return this.withTransaction((manager) => this.addItemLocked(dto, manager));
  }

  private async addItemLocked(dto: CreateMenuItemDto, manager: EntityManager): Promise<MenuItem> {
    const nextPosition = (await this.maxPosition(manager)) + 1;

    // Codes are monotonic and globally unique. Concurrent admin adds could race on the
    // numeric MAX and collide on the unique index — retry on 23505, recomputing each pass.
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      const nextCode = (await this.maxCode(manager)) + 1 + attempt;
      if (nextCode > (10 ** CODE_DIGIT_COUNT) - 1) {
        throw new BadRequestException({
          message: `Menu code capacity is limited to ${CODE_DIGIT_COUNT} digits`,
          code: 'MENU.CODE_WIDTH_EXCEEDED',
        });
      }
      const code = this.formatCode(nextCode);
      const item = manager.create(MenuItem, {
        code,
        name: dto.name,
        price: dto.price,
        category: dto.category,
        position: nextPosition,
        isActive: true,
      });
      try {
        return await manager.save(MenuItem, item);
      } catch (e) {
        if (isUniqueViolation(e)) continue;
        throw e;
      }
    }
    throw new BadRequestException({
      message: 'Could not assign a unique menu code after several attempts',
      code: 'MENU.CODE_ASSIGN_FAILED',
    });
  }

  // Price, category, and isActive are editable at any time. Name edits are always
  // permitted since there is no longer a printed form that would become stale.
  async updateItem(itemId: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    return this.withTransaction((manager) => this.updateItemLocked(itemId, dto, manager));
  }

  private async updateItemLocked(itemId: string, dto: UpdateMenuItemDto, manager: EntityManager): Promise<MenuItem> {
    const item = await this.findItemOrThrow(itemId, manager);

    if (dto.name !== undefined) item.name = dto.name;
    if (dto.price !== undefined) item.price = dto.price;
    if (dto.category !== undefined) item.category = dto.category;
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    return manager.save(MenuItem, item);
  }

  // Hard-deletes the item and reindexes remaining positions to keep them contiguous.
  async removeItem(itemId: string): Promise<void> {
    return this.withTransaction((manager) => this.removeItemLocked(itemId, manager));
  }

  private async removeItemLocked(itemId: string, manager: EntityManager): Promise<void> {
    const item = await this.findItemOrThrow(itemId, manager);

    await manager.remove(MenuItem, item);

    const remaining = await manager.find(MenuItem, { order: { position: 'ASC' } });
    if (remaining.length === 0) return;

    // Two-phase write avoids transient collisions on the non-deferrable unique position
    // index. Phase 1: shift everything into a non-colliding range; Phase 2: assign final
    // contiguous 0..N-1 positions.
    const OFFSET = 1000;
    for (const r of remaining) r.position += OFFSET;
    await manager.save(MenuItem, remaining);
    for (let i = 0; i < remaining.length; i++) remaining[i].position = i;
    await manager.save(MenuItem, remaining);
  }

  async reorder(orderedItemIds: string[]): Promise<MenuItem[]> {
    return this.withTransaction((manager) => this.reorderLocked(orderedItemIds, manager));
  }

  private async reorderLocked(orderedItemIds: string[], manager: EntityManager): Promise<MenuItem[]> {
    const items = await manager.find(MenuItem, { order: { position: 'ASC' } });
    const itemMap = new Map(items.map((it) => [it.id, it]));

    if (orderedItemIds.length !== items.length) {
      throw new BadRequestException({
        message: `orderedItemIds must contain exactly ${items.length} item IDs (all menu items)`,
        code: 'MENU.REORDER_COUNT_MISMATCH',
      });
    }
    for (const id of orderedItemIds) {
      if (!itemMap.has(id)) {
        throw new BadRequestException({
          message: `Item ${id} is not a menu item`,
          code: 'MENU.ITEM_NOT_FOUND',
        });
      }
    }

    const OFFSET = 1000;
    const phase1 = items.map((it) => ({ ...it, position: it.position + OFFSET }));
    await manager.save(MenuItem, phase1);

    const phase2 = orderedItemIds.map((id, index) => ({ ...itemMap.get(id)!, position: index }));
    return manager.save(MenuItem, phase2);
  }

  // Aggregates active-order portions per menu item for the kitchen view, scoped to a single
  // service date. The date is REQUIRED (defaulted to tomorrow, the next collection day orders
  // are stamped for) — summing across all dates would over-count the kitchen prep.
  // Superseded/rejected orders are excluded.
  //
  // count = total portions = SUM(oi.quantity) over the matched (active, this-date) orders. The
  // FILTER on o.id IS NOT NULL is load-bearing: orders are LEFT JOINed with the active+date
  // predicate in the ON clause, so order_items of superseded/rejected/other-date orders survive
  // the join with a non-null oi.quantity but a NULL o.id. A bare SUM(oi.quantity) would add those
  // back in; FILTER(WHERE o.id IS NOT NULL) sums only matched orders (the quantity-aware
  // equivalent of the prior COUNT(o.id)), and COALESCE keeps zero-order items at 0 rather than NULL.
  async getSummary(
    serviceDate: string = tomorrowInDeployTz(),
    actor?: OperatorPublic,
  ): Promise<MenuItemSummary[]> {
    const operatorZone = actor ? this.zoneAccess!.requireOperatorZone(actor) : null;
    const authorizedOrder = operatorZone
      ? 'o.id IS NOT NULL AND BTRIM(summary_user.zone) = :summaryOperatorZone'
      : 'o.id IS NOT NULL';
    const qb = this.dataSource
      .createQueryBuilder()
      .select('mi.id', 'menuItemId')
      .addSelect('mi.name', 'name')
      .addSelect('mi.position', 'position')
      .addSelect(`COALESCE(SUM(oi.quantity) FILTER (WHERE ${authorizedOrder}), 0)`, 'count')
      .from('menu_items', 'mi')
      .leftJoin('order_items', 'oi', 'oi.menu_item_id = mi.id')
      .leftJoin(
        'orders',
        'o',
        'o.id = oi.order_id AND o.status = :status AND o.service_date = :serviceDate',
        { status: OrderStatus.ACTIVE, serviceDate },
      )
      .leftJoin('users', 'summary_user', 'summary_user.id = o.user_id')
      .groupBy('mi.id')
      .addGroupBy('mi.name')
      .addGroupBy('mi.position')
      .orderBy('mi.position', 'ASC');
    if (operatorZone) qb.setParameter('summaryOperatorZone', operatorZone);
    const rows = await qb.getRawMany<{
      menuItemId: string;
      name: string;
      position: string;
      count: string;
    }>();

    return rows.map((r) => ({
      menuItemId: r.menuItemId,
      name: r.name,
      position: Number(r.position),
      count: Number(r.count),
    }));
  }

  // MAX over ALL rows (active + soft-deleted). The menu is a small admin-managed list, so a
  // full scan is cheap and keeps the monotonic-position invariant obvious in one place.
  private async maxPosition(manager: EntityManager): Promise<number> {
    const rows = await manager.find(MenuItem);
    return rows.reduce((max, r) => Math.max(max, r.position), -1);
  }

  // Highest numeric code across ALL rows (codes are zero-padded numeric strings). Returns 0 when
  // empty so the first code becomes 1 → "001". Non-numeric codes parse to NaN and are skipped
  // so one bad row cannot poison the max and brick code assignment.
  private async maxCode(manager: EntityManager): Promise<number> {
    const rows = await manager.find(MenuItem);
    return rows.reduce((max, r) => {
      const n = Number(r.code);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
  }

  private formatCode(n: number): string {
    return String(n).padStart(CODE_DIGIT_COUNT, '0');
  }

  private async findItemOrThrow(itemId: string, manager: EntityManager): Promise<MenuItem> {
    const item = await manager.findOne(MenuItem, { where: { id: itemId } });
    if (!item) throw new NotFoundException({ message: 'Menu item not found', code: 'MENU.ITEM_NOT_FOUND' });
    return item;
  }

  private withTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(operation);
  }
}
