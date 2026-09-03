import { Sheet } from '../sheet.entity';
import { User } from '../../users/user.entity';
import { MenuItem } from '../../menu/menu-item.entity';
import { DigitResult, OrderLineResult } from '../../omr/omr-client.service';
import { resolveCode, ResolvedItem } from './resolve-order-line';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { EffectivePurchaseLimits } from '../../purchase-limit-config/purchase-limit-config.service';
import { ScannerArtifactJobState } from '../webhook/scanner-artifact-job.entity';
import { ScannerReviewEvaluation } from '../scanner-review-state';

export interface OrderLineQueueItem {
  lineIndex: number;
  code: string | null;
  qty: number | null;
  codeDigits: DigitResult[];
  qtyDigits: DigitResult[];
  /** Min of all digit confidences on this line; 0 when no digits are present. */
  confidence: number;
  flags: string[];
  itemConfidence?: number;
  quantityConfidence?: number;
  itemFlags?: string[];
  quantityFlags?: string[];
  resolved: ResolvedItem | null;
  mappingAuthority: 'code' | 'template_row';
}

export interface ExistingOrderSummary {
  items: { menuItemId: string; name: string; quantity: number; unitPrice: number; category: MenuItemCategory }[];
  total: number;
}

export interface QueueSheetItem {
  id: string;
  sheetId: string;
  status: string;
  avgConfidence: number | null;
  identity: { id: string; legacyId: string; name: string; zone: string | null; cell: string | null } | null;
  /** Commissary balance (VND) of the matched prisoner; null when no prisoner is matched. */
  balance: number | null;
  form: { serial: string; revision: string; serviceDate: string };
  template: { id: string; mode: 'code' | 'full_list'; geometryHash: string } | null;
  orderLines: OrderLineQueueItem[];
  flags: string[];
  warpedImageUrl: string | null;
  source: 'omr' | 'scanner';
  scannerEvidence: {
    outcome: 'accepted' | 'needs_review';
    resultId: string | null;
    documentId: string | null;
    revision: number | null;
    warnings: unknown[];
    artifacts: Array<{
      artifactId: string;
      kind: string;
      mediaType: string;
      fieldId: string | null;
      rowIndex: number | null;
      state: ScannerArtifactJobState;
      url: string | null;
    }>;
    items: Array<{
      rowIndex: number;
      itemRawText: string | null;
      quantityRawText: string | null;
      catalogueItemId: string | null;
      itemCandidates: Array<{ catalogueItemId: string; value: string | null; confidence: number | null }>;
      quantityCandidates: Array<{ value: number | null; confidence: number | null }>;
    }>;
    requiresIdentityReason: boolean;
    catalogueDrift: boolean;
    reviewState: ScannerReviewEvaluation['state'];
    blockers: string[];
  } | null;
  /** Existing active OMR order for this prisoner+serviceDate that a confirm would REPLACE.
   *  null when no prior OMR order exists for this prisoner+date. */
  existingOrder: ExistingOrderSummary | null;
  bindingKind: 'issued' | 'generic' | 'scanner';
  identityEvidence: Array<{
    field: 'name' | 'cell' | 'prisoner_id';
    status: 'recognized' | 'blank' | 'abstained' | 'error';
    rawText: string | null;
    flags: string[];
  }>;
  rankedCandidates: Array<{
    userId: string;
    legacyId: string;
    name: string;
    zone: string | null;
    cell: string | null;
    score: number;
    reasons: string[];
  }>;
}

export interface FullMenuItem {
  id: string;
  code: string;
  position: number;
  name: string;
  /** Integer VND unit price */
  price: number;
  isActive: boolean;
  category: MenuItemCategory;
}

export interface VerifyQueueResponse {
  workflow: {
    scannerConfirmationEnabled: boolean;
    omrConfirmationEnabled: boolean;
  };
  sheets: QueueSheetItem[];
  /** ROI template dims + order_line coords from the global form config */
  roiTemplate: object | null;
  roiTemplates: Record<string, object>;
  /** All menu items (active + inactive) so the line editor can resolve any code including
   *  inactive ones (omr path resolves inactive by design). */
  menuItems: FullMenuItem[];
  purchaseLimits: EffectivePurchaseLimits;
}

interface QueueFormContext {
  userId?: string | null;
  serial: string;
  revision: string;
  serviceDate: string;
  template?: { id: string; mode: 'code' | 'full_list'; geometryHash: string } | null;
}

interface QueueIdentityContext {
  bindingKind?: 'issued' | 'generic' | 'scanner';
  evidence?: QueueSheetItem['identityEvidence'];
  candidates?: QueueSheetItem['rankedCandidates'];
  scannerArtifacts?: NonNullable<QueueSheetItem['scannerEvidence']>['artifacts'];
  scannerRequiresIdentityReason?: boolean;
  currentScannerCatalogueVersion?: string;
  scannerReview?: ScannerReviewEvaluation;
}

// Stored resultJson shape from /process-scan; cast from the opaque object column.
interface StoredResult {
  order_lines?: OrderLineResult[];
  result_id?: string;
  document_id?: string;
  revision?: number;
  outcome?: 'accepted' | 'needs_review';
  warnings?: unknown[];
  artifacts?: unknown[];
  items?: unknown[];
  versions?: Record<string, unknown>;
}

/** Min confidence across all digit results on a line; returns 0 for an empty list. */
function lineConfidence(line: OrderLineResult): number {
  const all = [...line.code_digits, ...line.qty_digits];
  if (all.length === 0) return 0;
  return all.reduce((min, d) => Math.min(min, d.confidence), Infinity);
}

export function assembleQueueItem(
  sheet: Sheet,
  userMap: Map<string, User>,
  balanceMap: Map<string, number>,
  menuItems: MenuItem[],
  existingOrder: ExistingOrderSummary | null,
  form: QueueFormContext = {
    serial: sheet.issuedFormId?.slice(0, 8).toUpperCase() ?? '—',
    revision: 'v3',
    serviceDate: sheet.serviceDate,
  },
  identityContext: QueueIdentityContext = {},
): QueueSheetItem {
  const result = (sheet.resultJson ?? {}) as StoredResult;
  const isScanner = sheet.admittedMode === 'scanner';

  let identity: QueueSheetItem['identity'] = null;
  let balance: number | null = null;
  const authoritativeUserId = form.userId ?? null;
  if (authoritativeUserId) {
    const u = userMap.get(authoritativeUserId);
    if (u) {
      identity = {
        id: u.id,
        legacyId: u.legacyId,
        name: u.name,
        zone: u.zone,
        cell: u.cell,
      };
      balance = balanceMap.get(authoritativeUserId) ?? 0;
    }
  }

  const rawLines: OrderLineResult[] = result.order_lines ?? [];
  const orderLines: OrderLineQueueItem[] = rawLines.map((line) => ({
    lineIndex: line.line_index,
    code: line.code_snapshot ?? line.code,
    qty: line.qty,
    codeDigits: line.code_digits,
    qtyDigits: line.qty_digits,
    confidence: lineConfidence(line),
    flags: line.flags,
    resolved: line.menu_item_id
      ? (() => {
          const item = menuItems.find((candidate) => candidate.id === line.menu_item_id);
          return item ? {
            menuItemId: item.id,
            name: line.name_snapshot ?? item.name,
            unitPrice: item.price,
            inactive: !item.isActive,
            category: item.category,
          } : null;
        })()
      : resolveCode(line.code, menuItems),
    mappingAuthority: line.menu_item_id ? 'template_row' : 'code',
  }));
  if (isScanner && orderLines.length === 0 && Array.isArray(result.items)) {
    for (const [index, raw] of result.items.entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const itemField = item.item && typeof item.item === 'object' ? item.item as Record<string, unknown> : {};
      const quantityField = item.quantity && typeof item.quantity === 'object'
        ? item.quantity as Record<string, unknown>
        : {};
      const code = typeof item.catalogue_item_id === 'string' ? item.catalogue_item_id : null;
      const qty = typeof quantityField.value === 'number' ? quantityField.value : null;
      const warnings = [
        ...(Array.isArray(itemField.warnings) ? itemField.warnings : []),
        ...(Array.isArray(quantityField.warnings) ? quantityField.warnings : []),
      ];
      const confidenceValues = [itemField.confidence, quantityField.confidence]
        .filter((value): value is number => typeof value === 'number');
      const resolved = code ? resolveCode(code, menuItems) : null;
      orderLines.push({
        lineIndex: typeof item.row_index === 'number' ? item.row_index : index,
        code,
        qty,
        codeDigits: [],
        qtyDigits: [],
        confidence: confidenceValues.length > 0 ? Math.min(...confidenceValues) : 0,
        flags: warnings.flatMap((warning) => {
          if (!warning || typeof warning !== 'object') return [];
          const codeValue = (warning as Record<string, unknown>).code;
          return typeof codeValue === 'string' ? [codeValue] : [];
        }),
        itemConfidence: typeof itemField.confidence === 'number' ? itemField.confidence : 0,
        quantityConfidence: typeof quantityField.confidence === 'number' ? quantityField.confidence : 0,
        itemFlags: warningCodes(itemField.warnings),
        quantityFlags: warningCodes(quantityField.warnings),
        resolved,
        mappingAuthority: 'code',
      });
    }
  }

  return {
    id: sheet.id,
    sheetId: sheet.sheetId,
    status: sheet.status,
    avgConfidence: sheet.avgConfidence,
    identity,
    balance,
    form: {
      serial: form.serial,
      revision: form.revision,
      serviceDate: form.serviceDate,
    },
    template: form.template ?? null,
    orderLines,
    flags: sheet.flags ?? [],
    warpedImageUrl: isScanner ? null : `/scans/verify/${sheet.id}/warped-image`,
    source: isScanner ? 'scanner' : 'omr',
    scannerEvidence: isScanner ? {
      outcome: result.outcome ?? 'needs_review',
      resultId: result.result_id ?? null,
      documentId: result.document_id ?? null,
      revision: typeof result.revision === 'number' ? result.revision : null,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      artifacts: identityContext.scannerArtifacts ?? [],
      items: Array.isArray(result.items) ? result.items.slice(0, 12).flatMap((raw, index) => {
        if (!raw || typeof raw !== 'object') return [];
        const row = raw as Record<string, unknown>;
        const itemField = row.item && typeof row.item === 'object'
          ? row.item as Record<string, unknown>
          : {};
        const itemCandidates = Array.isArray(itemField.candidates)
          ? itemField.candidates.slice(0, 10).flatMap((candidate) => {
              if (!candidate || typeof candidate !== 'object') return [];
              const value = candidate as Record<string, unknown>;
              return typeof value.catalogue_item_id === 'string' ? [{
                catalogueItemId: value.catalogue_item_id,
                value: typeof value.value === 'string' ? value.value : null,
                confidence: typeof value.confidence === 'number' ? value.confidence : null,
              }] : [];
            })
          : [];
        const quantityField = row.quantity && typeof row.quantity === 'object'
          ? row.quantity as Record<string, unknown>
          : {};
        const quantityCandidates = Array.isArray(quantityField.candidates)
          ? quantityField.candidates.slice(0, 10).flatMap((candidate) => {
              if (!candidate || typeof candidate !== 'object') return [];
              const value = candidate as Record<string, unknown>;
              return [{
                value: typeof value.value === 'number' ? value.value : null,
                confidence: typeof value.confidence === 'number' ? value.confidence : null,
              }];
            })
          : [];
        return [{
          rowIndex: typeof row.row_index === 'number' ? row.row_index : index,
          itemRawText: typeof itemField.raw_text === 'string' ? itemField.raw_text.slice(0, 500) : null,
          quantityRawText: typeof quantityField.raw_text === 'string' ? quantityField.raw_text.slice(0, 500) : null,
          catalogueItemId: typeof row.catalogue_item_id === 'string' ? row.catalogue_item_id : null,
          itemCandidates,
          quantityCandidates,
        }];
      }) : [],
      requiresIdentityReason: identityContext.scannerRequiresIdentityReason ?? true,
      catalogueDrift: typeof result.versions?.catalogue !== 'string' ||
        result.versions.catalogue !== identityContext.currentScannerCatalogueVersion,
      reviewState: identityContext.scannerReview?.state ?? 'needs_review',
      blockers: identityContext.scannerReview?.blockers ?? ['SCANNER.IDENTITY_UNRESOLVED'],
    } : null,
    existingOrder,
    bindingKind: identityContext.bindingKind ?? (isScanner ? 'scanner' : 'issued'),
    identityEvidence: identityContext.evidence ?? [],
    rankedCandidates: identityContext.candidates ?? [],
  };
}

function warningCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((warning) => {
    if (!warning || typeof warning !== 'object') return [];
    const code = (warning as Record<string, unknown>).code;
    return typeof code === 'string' ? [code] : [];
  });
}

/** Returns all menu items (active + inactive) for the verify queue.
 *  The UI must be able to display/resolve inactive items — a code written on a form that was
 *  printed when the item was active must still decode after the item is retired. */
export function assembleMenuItems(items: MenuItem[]): FullMenuItem[] {
  return items.map((m) => ({
    id: m.id,
    code: m.code,
    position: m.position,
    name: m.name,
    price: m.price,
    isActive: m.isActive,
    category: m.category,
  }));
}
