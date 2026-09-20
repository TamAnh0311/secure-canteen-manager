import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MenuItem } from './menu-item.entity';
import { ThresholdConfigService } from '../config/threshold-config.service';
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

export interface ScannerCatalogueItem {
  catalogueItemId: string;
  name: string;
  active: boolean;
}

export interface ScannerCatalogueExport {
  schemaVersion: 'scanner-catalogue-v1';
  version: string;
  items: ScannerCatalogueItem[];
}

// Postgres unique-violation SQLSTATE. TypeORM surfaces it on the error itself or its
// nested driverError depending on the failure path.
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

const LOCKED_AFTER_FORM = 'MENU.LOCKED_AFTER_FORM';
const MAX_CODE_RETRIES = 5;

// Menu codes are written by hand into a fixed run of code digit boxes on the OMR
// form; the box count and this width must agree or a printed sheet decodes to the
// wrong dish. The form draws CODE_DIGIT_COUNT boxes, so codes are zero-padded to
// exactly this width and a menu whose codes would overflow it is rejected before
// a form can be generated.
export const CODE_DIGIT_COUNT = 3;
export const OMR_CATALOG_ADVISORY_LOCK = 'canteen:omr-template-catalog:v1';

export interface CanonicalCatalogRow {
  menuItemId: string;
  codeSnapshot: string;
  shortLabelSnapshot: string;
  position: number;
  /** Integer VND price at snapshot time. */
  price: number;
}

/** Truncates a menu item name for the OMR form short label column. */
export function toOmrShortLabel(value: string, limit = 22): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const segments = Array.from(new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(normalized), ({ segment }) => segment);
  return segments.length <= limit ? normalized : `${segments.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

/** Acquires a catalog-level advisory lock. No-op on SQLite (WAL serializes writes). */
export async function acquireOmrCatalogLock(manager: EntityManager): Promise<void> {
  if (manager.connection.options.type === 'better-sqlite3') return;
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [OMR_CATALOG_ADVISORY_LOCK]);
}

/** Snapshots the active menu catalog for OMR template generation. */
export async function snapshotActiveCatalog(manager: EntityManager): Promise<CanonicalCatalogRow[]> {
  const items = await manager.find(MenuItem, { where: { isActive: true }, order: { position: 'ASC' } });
  return items.map((item) => ({
    menuItemId: item.id,
    codeSnapshot: item.code,
    shortLabelSnapshot: toOmrShortLabel(item.name),
    position: item.position,
    price: item.price,
  }));
}

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(MenuItem)
    private readonly repo: Repository<MenuItem>,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly dataSource: DataSource,
    private readonly zoneAccess?: OperatorZoneAccessService,
  ) {}

  listAll(): Promise<MenuItem[]> {
    return this.repo.find({ order: { position: 'ASC' } });
  }

  /** Exports the menu catalogue in the format consumed by the external scanner service. */
  async scannerCatalogueExport(): Promise<ScannerCatalogueExport> {
    const items = await this.repo.find({ order: { code: 'ASC' } });
    const snapshot = items.map((item) => ({
      catalogueItemId: item.code,
      name: item.name.normalize('NFC').trim().replace(/\s+/g, ' '),
      active: item.isActive,
    }));
    const version = createHash('sha256')
      .update(JSON.stringify(snapshot), 'utf8')
      .digest('hex');
    return { schemaVersion: 'scanner-catalogue-v1', version, items: snapshot };
  }

  /** Returns a locked snapshot of the active catalog for OMR template generation. */
  activeCatalogSnapshot(): Promise<CanonicalCatalogRow[]> {
    return this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      return snapshotActiveCatalog(manager);
    });
  }

  // Appends a new item at the next free slot. Position and code are derived from the MAX
  // over ALL rows (including soft-deleted, isActive=false), never from a count: a count would
  // reuse a position freed by a soft-delete and could then collide with an existing row.
  // Gaps left by deletes are expected.
  async addItem(dto: CreateMenuItemDto): Promise<MenuItem> {
    return this.withCatalogLock((manager) => this.addItemLocked(dto, manager));
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

  // Price and isActive are editable at any time. The name is the printed label:
  // once the form is generated, renaming would desync printed sheets, so name
  // edits are locked — regenerate + reprint to change a name.
  async updateItem(itemId: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    return this.withCatalogLock((manager) => this.updateItemLocked(itemId, dto, manager));
  }

  private async updateItemLocked(itemId: string, dto: UpdateMenuItemDto, manager: EntityManager): Promise<MenuItem> {
    const item = await this.findItemOrThrow(itemId, manager);

    if (dto.name !== undefined && dto.name !== item.name && (await this.isFormGenerated(manager))) {
      throw new BadRequestException({
        message: 'Menu item name cannot be changed after the form has been generated',
        code: LOCKED_AFTER_FORM,
      });
    }

    if (dto.name !== undefined) item.name = dto.name;
    if (dto.price !== undefined) item.price = dto.price;
    if (dto.category !== undefined) item.category = dto.category;
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    return manager.save(MenuItem, item);
  }

  // After the form is generated a position is a printed checkbox row and must stay bound to
  // its item forever, so removal is a soft-delete: keep the row + position, flip isActive
  // off, no reindex. Before any form exists positions are not yet printed, so hard-delete +
  // reindex keeps them contiguous.
  async removeItem(itemId: string): Promise<void> {
    return this.withCatalogLock((manager) => this.removeItemLocked(itemId, manager));
  }

  private async removeItemLocked(itemId: string, manager: EntityManager): Promise<void> {
    const item = await this.findItemOrThrow(itemId, manager);

    if (await this.isFormGenerated(manager)) {
      item.isActive = false;
      await manager.save(MenuItem, item);
      return;
    }

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

  // Reordering rewrites positions, which would remap printed checkbox rows to different
  // items — so it is blocked once the form is generated.
  async reorder(orderedItemIds: string[]): Promise<MenuItem[]> {
    return this.withCatalogLock((manager) => this.reorderLocked(orderedItemIds, manager));
  }

  private async reorderLocked(orderedItemIds: string[], manager: EntityManager): Promise<MenuItem[]> {
    if (await this.isFormGenerated(manager)) {
      throw new BadRequestException({
        message: 'Menu order cannot be changed after the form has been generated',
        code: LOCKED_AFTER_FORM,
      });
    }

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
  // CASE WHEN o.id IS NOT NULL guard is load-bearing: orders are LEFT JOINed with the active+date
  // predicate in the ON clause, so order_items of superseded/rejected/other-date orders survive
  // the join with a non-null oi.quantity but a NULL o.id. A bare SUM(oi.quantity) would add those
  // back in; the CASE guard sums only matched orders (the quantity-aware
  // equivalent of the prior COUNT(o.id)), and COALESCE keeps zero-order items at 0 rather than NULL.
  // Uses SUM(CASE WHEN ... THEN ... ELSE 0 END) instead of FILTER() for SQLite compatibility.
  async getSummary(
    serviceDate: string = tomorrowInDeployTz(),
    actor?: OperatorPublic,
  ): Promise<MenuItemSummary[]> {
    const operatorZone = actor ? this.zoneAccess!.requireOperatorZone(actor) : null;
    const authorizedOrder = operatorZone
      ? 'o.id IS NOT NULL AND TRIM(summary_user.zone) = :summaryOperatorZone'
      : 'o.id IS NOT NULL';
    const qb = this.dataSource
      .createQueryBuilder()
      .select('mi.id', 'menuItemId')
      .addSelect('mi.name', 'name')
      .addSelect('mi.position', 'position')
      .addSelect(`COALESCE(SUM(CASE WHEN ${authorizedOrder} THEN oi.quantity ELSE 0 END), 0)`, 'count')
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

  /**
   * Aggregated kitchen summary across a date range (inclusive).
   * Sums portions per menu item across all active orders in [dateFrom, dateTo].
   */
  async getSummaryRange(
    dateFrom: string,
    dateTo: string,
    actor?: OperatorPublic,
  ): Promise<MenuItemSummary[]> {
    const operatorZone = actor ? this.zoneAccess!.requireOperatorZone(actor) : null;
    const authorizedOrder = operatorZone
      ? 'o.id IS NOT NULL AND TRIM(summary_user.zone) = :summaryOperatorZone'
      : 'o.id IS NOT NULL';
    const qb = this.dataSource
      .createQueryBuilder()
      .select('mi.id', 'menuItemId')
      .addSelect('mi.name', 'name')
      .addSelect('mi.position', 'position')
      .addSelect(`COALESCE(SUM(CASE WHEN ${authorizedOrder} THEN oi.quantity ELSE 0 END), 0)`, 'count')
      .from('menu_items', 'mi')
      .leftJoin('order_items', 'oi', 'oi.menu_item_id = mi.id')
      .leftJoin(
        'orders',
        'o',
        'o.id = oi.order_id AND o.status = :status AND o.service_date >= :dateFrom AND o.service_date <= :dateTo',
        { status: OrderStatus.ACTIVE, dateFrom, dateTo },
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

  // True once an OMR form has been generated. Reads the signal from the global
  // threshold_config row and omr_form_templates. Fail-closed: any read error or
  // unexpected null is treated as LOCKED.
  private async isFormGenerated(manager: EntityManager): Promise<boolean> {
    try {
      const isSqlite = manager.connection.options.type === 'better-sqlite3';
      if (isSqlite) {
        // SQLite may not have the OMR tables; check threshold_config only if it exists.
        const tables: Array<{ name: string }> = await manager.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('threshold_config', 'omr_form_templates')`,
        );
        if (tables.length === 0) return false;
        const tableNames = new Set(tables.map((t) => t.name));
        const checks: string[] = [];
        if (tableNames.has('threshold_config')) {
          checks.push(`EXISTS (SELECT 1 FROM threshold_config WHERE roi_generated_at IS NOT NULL)`);
        }
        if (tableNames.has('omr_form_templates')) {
          checks.push(`EXISTS (SELECT 1 FROM omr_form_templates WHERE activated_at IS NOT NULL)`);
        }
        const rows: Array<{ generated: number }> = await manager.query(
          `SELECT (${checks.join(' OR ')}) AS generated`,
        );
        return rows[0]?.generated !== 0;
      }
      const rows: Array<{ generated: boolean }> = await manager.query(`
        SELECT (
          EXISTS (SELECT 1 FROM threshold_config WHERE roi_generated_at IS NOT NULL)
          OR EXISTS (SELECT 1 FROM omr_form_templates WHERE activated_at IS NOT NULL)
        ) AS generated
      `);
      return rows[0]?.generated !== false;
    } catch {
      return true;
    }
  }

  /** Throws if any existing code would not fit the form's fixed-width code boxes. */
  async assertCodesFitForm(): Promise<void> {
    const rows = await this.repo.find();
    for (const r of rows) {
      if (!/^[0-9]+$/.test(r.code) || r.code.length > CODE_DIGIT_COUNT) {
        throw new BadRequestException({
          message: `Menu code "${r.code}" does not fit the ${CODE_DIGIT_COUNT}-digit numeric width printable on the order form`,
          code: 'MENU.CODE_WIDTH_EXCEEDED',
        });
      }
    }
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

  private withCatalogLock<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await acquireOmrCatalogLock(manager);
      return operation(manager);
    });
  }
}
