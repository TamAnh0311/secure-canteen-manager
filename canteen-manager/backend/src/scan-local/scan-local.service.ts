import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OmrFormTemplate, OmrFormMode } from '../omr-forms/omr-form-template.entity';
import { Order, OrderStatus, PaymentStatus } from '../orders/order.entity';
import { ThresholdConfigService } from '../config/threshold-config.service';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';
import { todayInDeployTz, tomorrowInDeployTz } from '../common/today-in-tz';
import { pageLayout, registrationMarks, fullListGrid } from '../omr/local-form-layout';
import { processImage, findRegistrationMarks } from './image-processor';
import { readFormQr } from './qr-reader';
import { readFullListBubbles } from './bubble-reader';

/** Result returned by the scan processing pipeline. */
export interface ScanProcessResult {
  formToken: string | null;
  mode: string | null;
  items: Array<{ menuItemId: string; code: string; name: string; quantity: number }>;
  orderId: string | null;
  status: 'created' | 'review_required' | 'no_items';
  warnings: string[];
}

/** A single scan history entry (an order created via the scanner source). */
export interface ScanHistoryItem {
  id: string;
  serviceDate: string;
  userId: string;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
}

/** Aggregate KPIs for scanner-originated orders. */
export interface ScanStats {
  totalScans: number;
  ordersCreated: number;
  ordersPaid: number;
  totalRevenue: number;
}

@Injectable()
export class ScanLocalService {
  private readonly logger = new Logger(ScanLocalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly menuService: MenuService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Runs the full local scan pipeline: image decode, QR read, registration mark
   * detection, OMR bubble recognition, menu enrichment, and optional order creation.
   *
   * @param imageBase64 Base64-encoded scan image.
   * @param operatorId  ID of the operator triggering the scan.
   * @returns Structured scan result including detected items and pipeline status.
   */
  async processScan(imageBase64: string, operatorId: string): Promise<ScanProcessResult> {
    const warnings: string[] = [];

    // Step 1: Find the active OMR form template.
    const template = await this.dataSource
      .getRepository(OmrFormTemplate)
      .findOne({
        where: { isActive: true },
        relations: { rows: true },
        order: { activatedAt: 'DESC' },
      });

    if (!template) {
      throw new NotFoundException({
        message: 'No active OMR form template found',
        code: 'SCAN.NO_ACTIVE_TEMPLATE',
      });
    }

    // Step 2: Get page geometry and process the image.
    const layout = pageLayout(template.paperSize);
    const processed = await processImage(imageBase64, layout.width, layout.height);

    // Step 3: Read QR code from RGBA buffer.
    const rgbaTyped = new Uint8ClampedArray(
      processed.rgba.buffer,
      processed.rgba.byteOffset,
      processed.rgba.byteLength,
    );
    const qrData = readFormQr(rgbaTyped, processed.width, processed.height);
    const formToken = qrData?.token ?? null;
    const mode = qrData?.mode ?? null;

    if (!qrData) {
      warnings.push('QR code not found or unreadable — form identity unverified');
    }

    // Step 4: Find registration marks (optional — warn but continue if not found).
    const marks = registrationMarks(layout);
    const markCentroids = findRegistrationMarks(
      processed.grayscale,
      processed.width,
      processed.height,
      marks,
      processed.pxPerPt,
    );
    if (!markCentroids) {
      warnings.push('Registration marks not detected — bubble coordinates are uncorrected');
    }

    // Step 5: Resolve thresholds and detect bubbles (full_list mode only).
    const thresholds = await this.thresholdConfig.resolve();

    if (template.mode !== OmrFormMode.FULL_LIST) {
      // Code mode: not implemented in this MVP.
      return {
        formToken,
        mode: template.mode,
        items: [],
        orderId: null,
        status: 'review_required',
        warnings: [...warnings, 'Code mode scanning is not yet implemented in the local MVP'],
      };
    }

    // Build bubble descriptors from template rows + layout coordinates.
    const sortedRows = [...template.rows].sort((a, b) => a.rowIndex - b.rowIndex);
    const catalogInput = sortedRows.map((row) => ({
      row_index: row.rowIndex,
      menu_item_id: row.menuItemId,
      code_snapshot: row.codeSnapshot,
      short_label: row.shortLabelSnapshot,
    }));
    const gridRows = fullListGrid(layout, catalogInput);
    const rowByIndex = new Map(gridRows.map((r) => [r.rowIndex, r]));
    const templateRowByIndex = new Map(sortedRows.map((r) => [r.rowIndex, r]));

    // Expand into per-bubble descriptors (quantities 1–5 per row).
    const bubbles: Array<{
      row_index: number;
      menu_item_id: string;
      quantity: number;
      cx: number;
      cy: number;
      r: number;
    }> = [];

    for (const [rowIndex, gridRow] of rowByIndex) {
      const templateRow = templateRowByIndex.get(rowIndex);
      if (!templateRow) continue;
      gridRow.bubbles.forEach((bubble, qtyIdx) => {
        bubbles.push({
          row_index: rowIndex,
          menu_item_id: templateRow.menuItemId,
          quantity: qtyIdx + 1, // quantities 1–5
          cx: bubble.cx,
          cy: bubble.cy,
          r: bubble.r,
        });
      });
    }

    const { detections, warnings: bubbleWarnings } = readFullListBubbles(
      processed.grayscale,
      processed.width,
      bubbles,
      processed.pxPerPt,
      thresholds,
    );
    warnings.push(...bubbleWarnings);

    if (detections.length === 0) {
      return { formToken, mode, items: [], orderId: null, status: 'no_items', warnings };
    }

    // Step 6: Enrich detections with menu item details.
    const menuItems = await this.menuService.listAll();
    const menuById = new Map(menuItems.map((m) => [m.id, m]));
    const menuByCode = new Map(menuItems.map((m) => [m.code, m]));

    const enrichedItems: ScanProcessResult['items'] = [];
    for (const det of detections) {
      const menuItem = menuById.get(det.menu_item_id);
      if (!menuItem) {
        warnings.push(`Detected item ${det.menu_item_id} not found in current menu — skipped`);
        continue;
      }
      // Use codeSnapshot from template row if available, fall back to live code.
      const templateRow = sortedRows.find((r) => r.menuItemId === det.menu_item_id);
      const code = templateRow?.codeSnapshot ?? menuItem.code;
      enrichedItems.push({
        menuItemId: det.menu_item_id,
        code,
        name: menuItem.name,
        quantity: det.quantity,
      });
      void menuByCode; // suppress unused warning
    }

    if (enrichedItems.length === 0) {
      return { formToken, mode, items: [], orderId: null, status: 'no_items', warnings };
    }

    // Step 7: Create order if all detections are high-confidence and no warnings.
    const allHighConfidence = detections.every((d) => d.confidence === 'high');
    const hasWarnings = warnings.length > 0;

    if (!allHighConfidence || hasWarnings) {
      return { formToken, mode, items: enrichedItems, orderId: null, status: 'review_required', warnings };
    }

    // userId is empty for scan-submitted forms in this MVP — prisoners are not yet identified
    // by the scan pipeline. The order is attributed to the operator instead.
    const serviceDate = tomorrowInDeployTz();
    let orderId: string | null = null;

    try {
      const order = await this.ordersService.createOrReplace({
        serviceDate,
        userId: '', // Scan forms do not identify the prisoner in this MVP
        items: enrichedItems.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
        })),
        source: 'scanner',
        operatorId,
      });
      orderId = order.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Order creation failed: ${message}`);
      return { formToken, mode, items: enrichedItems, orderId: null, status: 'review_required', warnings };
    }

    return { formToken, mode, items: enrichedItems, orderId, status: 'created', warnings };
  }

  /**
   * Returns recent orders created via the scanner source within a date range.
   *
   * @param dateFrom Inclusive start date (YYYY-MM-DD). Defaults to today.
   * @param dateTo   Inclusive end date (YYYY-MM-DD). Defaults to today.
   * @returns Array of scan history items ordered newest-first.
   */
  async getHistory(dateFrom?: string, dateTo?: string): Promise<ScanHistoryItem[]> {
    const from = dateFrom ?? todayInDeployTz();
    const to = dateTo ?? todayInDeployTz();

    const orders = await this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .where('o.source IN (:...sources)', { sources: ['scanner'] })
      .andWhere('o.service_date >= :from', { from })
      .andWhere('o.service_date <= :to', { to })
      .orderBy('o.created_at', 'DESC')
      .limit(100)
      .getMany();

    return orders.map((o) => ({
      id: o.id,
      serviceDate: o.serviceDate,
      userId: o.userId,
      totalAmount: o.totalAmount,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt.toISOString(),
    }));
  }

  /**
   * Returns aggregate KPIs for scanner-originated orders within a date range.
   *
   * @param dateFrom Inclusive start date (YYYY-MM-DD). Defaults to today.
   * @param dateTo   Inclusive end date (YYYY-MM-DD). Defaults to today.
   * @returns Aggregate scan statistics.
   */
  async getStats(dateFrom?: string, dateTo?: string): Promise<ScanStats> {
    const from = dateFrom ?? todayInDeployTz();
    const to = dateTo ?? todayInDeployTz();

    const orders = await this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .where('o.source IN (:...sources)', { sources: ['scanner'] })
      .andWhere('o.service_date >= :from', { from })
      .andWhere('o.service_date <= :to', { to })
      .getMany();

    const active = orders.filter((o) => o.status === OrderStatus.ACTIVE);
    const paid = active.filter((o) => o.paymentStatus === PaymentStatus.PAID);
    const revenue = paid.reduce((sum, o) => sum + o.totalAmount, 0);

    return {
      totalScans: orders.length,
      ordersCreated: active.length,
      ordersPaid: paid.length,
      totalRevenue: revenue,
    };
  }
}
