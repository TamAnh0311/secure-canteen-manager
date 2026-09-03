// ── String-literal union aliases ────────────────────────────────────────────

export type Role = 'admin' | 'operator' | 'cashier';
// Collapsed custody classification: pre-charge hold, pre-trial detention, post-conviction.
export type DetentionStatus = 'temporary_hold' | 'pre_trial_detention' | 'convicted';
export type OrderStatus = 'active' | 'superseded' | 'rejected';
export type OrderSource = 'omr' | 'scanner' | 'manual' | 'relative';
export type PaymentStatus = 'paid' | 'unpaid';
export type PaymentMethod = 'cash' | 'bank' | 'balance';
export type SheetStatus =
  | 'pending'
  | 'processing'
  | 'auto_accepted'
  | 'flagged'
  | 'rejected'
  | 'verified';
export type SyncStatus = 'running' | 'success' | 'failed';
export type ItemCategory = 'food' | 'essential';
export type PurchaseLimitAudience = 'prisoner' | 'visitor';
export type FormTemplateMode = 'code' | 'full_list';
export type FormTemplateOrientation = 'portrait' | 'landscape';

export interface PurchaseLimitRule {
  enabled: boolean;
  amount: number | null;
}

export type PurchaseLimits = Record<ItemCategory, PurchaseLimitRule>;
export type PurchaseLimitConfiguration = Record<PurchaseLimitAudience, PurchaseLimits>;

// ── Domain types ─────────────────────────────────────────────────────────────

export interface Operator {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  zone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItem {
  id: string;
  // Auto-generated label-only code, monotonic and never reused.
  code: string;
  // Zero-based, immutable after form generation; maps to one OMR checkbox row.
  position: number;
  name: string;
  // Integer VND.
  price: number;
  category: ItemCategory;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Form-generation status read from GET /menu/form. generatedAt non-null means the
// menu is locked: reorder, rename, and hard-delete are permanently disabled.
export interface MenuFormStatus {
  generatedAt: string | null;
  version: string | null;
  // Additive during the A5 rollout so existing menu-lock consumers can keep
  // reading the legacy top-level fields across a coordinated deployment.
  templates?: Record<FormTemplateMode, MenuFormTemplateStatus>;
}

export interface MenuFormTemplateStatus {
  mode: FormTemplateMode;
  generatedAt: string | null;
  version: string | null;
  orientation: FormTemplateOrientation;
  available: boolean;
  unavailableReason: string | null;
  activeItemCount: number;
  capacity: number | null;
}

export interface Order {
  id: string;
  // Date bucket (YYYY-MM-DD), server-stamped at ingestion in the deploy TZ.
  serviceDate: string;
  userId: string;
  source: OrderSource;
  sheetId: string | null;
  status: OrderStatus;
  // Integer VND = Σ snapshotted unit_price × quantity.
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  supersededAt: string | null;
  supersededByOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  // Integer VND snapshot at order-create time.
  unitPrice: number;
  category: ItemCategory;
  // Portions ordered for this line; line total = unitPrice × quantity.
  quantity: number;
  createdAt: string;
}

export type OrderWithItems = Order & { items: OrderItem[] };

// One merged delivery voucher per prisoner for a service date — the printed sheet
// a prisoner signs on receipt. Aggregates all the prisoner's PAID active orders:
// identity, zone/cell, merged items+qty, total VND, balance snapshot, capture time.
export interface DeliveryVoucher {
  userId: string;
  name: string;
  legacyId: string; // prisoner ID
  zone: string | null; // Khu giam
  cell: string | null; // Buồng giam
  items: { name: string; qty: number }[];
  // Integer VND = Σ of the prisoner's PAID active order totals for the date.
  totalAmount: number;
  // prisoner_accounts.balance snapshot at capture time. Integer VND, 0 if no account.
  remainingBalance: number;
  // ISO timestamp the balance/voucher was captured — rendered on the sheet so the
  // signed document is timestamped and auditable.
  printedAt: string;
}

// One row of the cashier's pending-approval queue (relative orders awaiting a
// decision). Carries the context a cashier needs to match an order to the
// visitor at the counter: prisoner, service date, item names, intended tender.
export interface PendingOrderItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
}

export interface PendingOrder {
  orderId: string;
  confirmationCode: string;
  prisoner: { legacyId: string; name: string };
  // Date bucket (YYYY-MM-DD) the order was stamped to at create time.
  serviceDate: string;
  items: PendingOrderItem[];
  totalAmount: number;
  // Intended tender chosen at create; cash/bank only (never balance).
  paymentMethod: 'cash' | 'bank' | null;
  // ISO timestamp (Date serialized over the wire).
  createdAt: string;
}

export interface Sheet {
  id: string;
  sheetId: string;
  batch: string | null;
  // Date bucket (YYYY-MM-DD), server-stamped at ingestion in the deploy TZ.
  serviceDate: string;
  status: SheetStatus;
  source: 'omr' | 'scanner';
  scannerOutcome: 'accepted' | 'needs_review' | null;
  scannerReviewState: 'ready' | 'needs_review' | 'evidence_pending' | 'evidence_fault' | null;
  scannerReviewBlockers: string[];
  avgConfidence: number | null;
  matchedUserId: string | null;
  orderId: string | null;
  // Server returns string[] but may be null when no flags present.
  flags: string[] | null;
  rejectionCode: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface User {
  id: string;
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
  // Read-only detainee profile, synced from legacy (or demo-seeded). All nullable.
  // Birth/arrest are calendar-date strings ('YYYY-MM-DD'), not ISO timestamps.
  dateOfBirth: string | null;
  hometown: string | null;
  offense: string | null;
  arrestDate: string | null;
  detentionStatus: DetentionStatus | null;
  isActive: boolean;
  source: 'sql2005';
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

// A prisoner directory row with the current commissary balance joined in.
// Returned by GET /users (list/search); integer VND, 0 when no account exists yet.
export interface UserListItem extends User {
  balance: number;
}

export interface ThresholdConfig {
  id: string;
  icrThreshold: number;
  omrEmptyMax: number;
  omrTickedMin: number;
  digitBoxCount: number;
  updatedAt: string;
}

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  rowCount: number | null;
  status: SyncStatus;
  trigger: 'cron' | 'manual';
  error: string | null;
  createdAt: string;
}

export interface KpiCounts {
  pending: number;
  processing: number;
  autoAccepted: number;
  flagged: number;
  rejected: number;
  verified: number;
  ready: number;
  needsReview: number;
  integrityFault: number;
}

// One row of the kitchen summary for a single service date: total portions of this
// menu item across active orders (sum of per-line quantities). position orders the
// rows to match the printed form.
export interface MenuItemSummary {
  menuItemId: string;
  name: string;
  position: number;
  count: number;
}

// ── Verify queue (hero) types ──────────────────────────────────────────────────

// One recognized digit cell. value === null means the model could not read it.
export interface DigitResult {
  index: number;
  value: number | null;
  // 0..1 fraction.
  confidence: number;
}

// One recognized order line from the OMR scan. code/qty may be null when the
// model could not decode them. resolved is populated server-side against the
// full menu (active + inactive); null when no exact code match was found.
export interface OrderLineQueueItem {
  lineIndex: number;
  code: string | null;
  qty: number | null;
  codeDigits: DigitResult[];
  qtyDigits: DigitResult[];
  // min digit confidence across all digits on the line; 0 when no digits present.
  confidence: number;
  flags: string[];
  itemConfidence?: number;
  quantityConfidence?: number;
  itemFlags?: string[];
  quantityFlags?: string[];
  resolved: {
    menuItemId: string;
    name: string;
    unitPrice: number;
    inactive: boolean;
    category: ItemCategory;
  } | null;
  // Absent on legacy queue fixtures/responses and therefore treated as code mode.
  // Template-row authority binds item identity to the immutable printed row.
  mappingAuthority?: 'code' | 'template_row';
}

// Active OMR order that a confirm would REPLACE (one order per prisoner per day).
// Shown to the operator as a blocking supersede warning before confirm fires.
export interface ExistingOrderSummary {
  items: {
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    category?: ItemCategory;
  }[];
  total: number;
}

// The user a sheet was auto-matched to; null in the not-matched hero case.
export interface MatchedUser {
  id: string;
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
}

export interface IdentityEvidence {
  field: 'name' | 'cell' | 'prisoner_id';
  status: 'recognized' | 'blank' | 'abstained' | 'error';
  rawText: string | null;
  flags: string[];
}

export interface RankedIdentityCandidate {
  userId: string;
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
  score: number;
  reasons: string[];
}

export interface IdentityCandidate {
  id: string;
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
}

export interface IdentityPreview {
  user: MatchedUser;
  balance: number;
  existingOrder: ExistingOrderSummary | null;
}

export interface QueueSheetItem {
  id: string;
  sheetId: string;
  status: string;
  // 0..1 fraction; null when no aggregate is available.
  avgConfidence: number | null;
  identity: MatchedUser | null;
  // Commissary balance (integer VND) of the matched prisoner; null when none matched.
  balance: number | null;
  form: { serial: string; revision: string; serviceDate: string };
  template?: { id: string; mode: FormTemplateMode; geometryHash: string } | null;
  // Per-line OMR order recognition results (replaces checkboxes).
  orderLines: OrderLineQueueItem[];
  // Non-null when an active OMR order already exists for this prisoner+date.
  existingOrder: ExistingOrderSummary | null;
  flags: string[];
  // /api-relative path WITHOUT the /api prefix; needs auth headers to fetch.
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
      state: 'pending' | 'processing' | 'retrying' | 'available' | 'missing' | 'permanent_failed' | 'integrity_fault' | 'purged';
      url: string | null;
    }>;
    items: Array<{
      rowIndex: number;
      itemRawText: string | null;
      quantityRawText: string | null;
      catalogueItemId: string | null;
      itemCandidates: Array<{
        catalogueItemId: string;
        value: string | null;
        confidence: number | null;
      }>;
      quantityCandidates: Array<{
        value: number | null;
        confidence: number | null;
      }>;
    }>;
    requiresIdentityReason: boolean;
    catalogueDrift: boolean;
    reviewState: 'ready' | 'needs_review' | 'evidence_pending' | 'evidence_fault';
    blockers: string[];
  } | null;
  bindingKind: 'issued' | 'generic' | 'scanner';
  identityEvidence: IdentityEvidence[];
  rankedCandidates: RankedIdentityCandidate[];
}

// Snake_case ROI geometry — pixel coordinates in the warped template space, so
// boxes map directly onto the warped image scaled by renderedSize/templateSize.
export interface RoiBox {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoiTemplate {
  roi_version: string;
  paper_size: string;
  dpi: number;
  template_width_px: number;
  template_height_px: number;
  fiducials: { x: number; y: number }[];
  digit_boxes: RoiBox[];
  order_lines?: Array<{ line_index: number; code_boxes: RoiBox[]; qty_boxes: RoiBox[] }>;
  entry_regions?: Array<{ line_index: number; code_boxes: RoiBox[]; qty_boxes: RoiBox[] }>;
}

// Full menu entry (active + inactive). code is the 3-width numeric string used
// for exact OMR resolution. isActive false = inactive but still resolvable on
// the OMR path (operator sees an inactive badge in the line editor).
export interface FullMenuItem {
  id: string;
  // 3-width zero-padded numeric string e.g. '001'.
  code: string;
  position: number;
  name: string;
  price: number;
  category: ItemCategory;
  isActive: boolean;
}


export interface VerifyQueueResponse {
  workflow: {
    scannerConfirmationEnabled: boolean;
    omrConfirmationEnabled: boolean;
  };
  sheets: QueueSheetItem[];
  roiTemplate: RoiTemplate | null;
  roiTemplates?: Record<string, RoiTemplate>;
  // All items (active + inactive) so the line editor can resolve inactive codes.
  menuItems: FullMenuItem[];
  purchaseLimits: PurchaseLimits;
}

export interface ConfirmScanResponse {
  // true = an existing active OMR order for the issued identity/date was superseded.
  replaced: boolean;
}

export interface VerifyActionResponse {
  status: SheetStatus;
}

// ── Counter / ledger types ────────────────────────────────────────────────────

// Signed integer VND; topup is positive, order_debit is negative, reversal adjusts.
export type AccountTransactionType = 'topup' | 'order_debit' | 'reversal';

export interface AccountTransaction {
  id: string;
  userId: string;
  // Positive = credit, negative = debit. Integer VND.
  type: AccountTransactionType;
  // Signed integer VND (negative for debits).
  amount: number;
  // Running balance after this transaction. Integer VND.
  balanceAfter: number;
  method: string | null;
  ref: string | null;
  relatedOrderId: string | null;
  operatorId: string;
  note: string | null;
  createdAt: string;
}

// Shape returned by GET /counter/prisoner/:prisonId
export interface PrisonerLookup {
  user: {
    id: string;
    legacyId: string;
    name: string;
    zone: string | null;
    cell: string | null;
    isActive: boolean;
  };
  // Current balance. Integer VND.
  balance: number;
  ledger: AccountTransaction[];
  purchaseLimits: PurchaseLimits;
}

// ── Relative kiosk (public, read-only menu view) ────────────────────────────

export interface KioskMenuItem {
  id: string;
  name: string;
  // Integer VND.
  price: number;
  category: ItemCategory;
}

// What a relative sees at the kiosk: the prisoner's name (to confirm the right
// person) plus the single global active menu. bankEnabled is false when no canteen
// account is configured — the kiosk then hides the bank tender (no QR could be shown).
export interface KioskPrisonerView {
  name: string;
  prisonId: string;
  zone: string | null;
  cell: string | null;
  menu: KioskMenuItem[];
  bankEnabled: boolean;
  purchaseLimits: PurchaseLimits;
}

// ── Request body shapes ───────────────────────────────────────────────────────

export interface UpdateThresholdBody {
  icrThreshold?: number;
  omrEmptyMax?: number;
  omrTickedMin?: number;
  digitBoxCount?: number;
}

// One item in a confirm-scan payload. quantity is a positive integer [1,99].
export interface OrderLineItemDto {
  menuItemId: string;
  quantity: number;
}

export interface ConfirmScanBody {
  // At least one item required; the backend rejects an empty list.
  items: OrderLineItemDto[];
  replacementAck?: boolean;
}

export interface ConfirmGenericScanBody extends ConfirmScanBody {
  userId: string;
  replacementAck?: boolean;
  reason?: string;
}

export interface SubmitScanBody {
  sheetId: string;
  batch?: string;
  checksum: string;
  imageBase64: string;
}

export interface SubmitScanResult {
  id: string;
  sheetId: string;
  status: SheetStatus;
}
