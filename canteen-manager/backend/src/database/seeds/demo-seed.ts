/**
 * Demo seed — populates a realistic, Vietnamese, global-menu dataset so every operator
 * screen (Dashboard, Scan Monitor, Verify, Orders, Kitchen Summary) shows compelling data
 * on a laptop demo with NO scanner hardware.
 *
 * Global model (no sessions): one persistent menu, one threshold_config row owning the global
 * OMR form template, and orders/scans bucketed by the next collection day's service_date
 * (tomorrow) so they land under the same dashboards real scans do. Idempotent: a fixed
 * batch marker + source='demo' let it fully reset and re-run. Flagged-sheet warped images are
 * written into SCAN_STORAGE_DIR so the Verify screen serves real form images from cache — the
 * OMR service is never called.
 *
 * Run (inside the backend container, after migrations):
 *   node dist/database/seeds/demo-seed.js
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Operator, OperatorRole } from '../../operators/operator.entity';
import { BCRYPT_COST } from '../../operators/operator-public';
import { User, DetentionStatus } from '../../users/user.entity';
import { normalizeCell } from '../../users/cell-normalization';
import { MenuItem } from '../../menu/menu-item.entity';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { PurchaseLimitConfig } from '../../purchase-limit-config/purchase-limit-config.entity';
import { ThresholdConfig } from '../../config/threshold-config.entity';
import {
  OmrOperationalFormMode,
  ScanAdmissionSource,
  Sheet,
} from '../../scans/sheet.entity';
import { SheetStatus } from '../../scans/sheet-status.enum';
import { Order, OrderStatus, PaymentStatus } from '../../orders/order.entity';
import { OrderItem } from '../../orders/order-item.entity';
import { PrisonerAccount } from '../../accounts/prisoner-account.entity';
import { AccountTransaction, AccountTransactionType } from '../../accounts/account-transaction.entity';
import { OrderLineResult } from '../../omr/omr-client.service';
import { DEMO_ROI_TEMPLATE, DEMO_FORM_PNG_BASE64 } from './demo-assets';
import { tomorrowInDeployTz } from '../../common/today-in-tz';
import { EXPECTED_ROI_VERSION } from '../../config/threshold-config.service';
import {
  IssuedOmrForm,
  IssuedOmrFormStatus,
} from '../../omr-forms/issued-omr-form.entity';
import {
  OmrFormMode,
  OmrFormOrientation,
  OmrFormTemplate,
} from '../../omr-forms/omr-form-template.entity';
import { canonicalGeometryHash } from '../../omr-forms/omr-form-templates.service';

// Stable ids so re-runs target the same rows. The flagged ids double as the warped cache
// filename stem (warped/<id>__<ROI_VERSION>.png). Must be valid UUID v4 — list DTOs validate
// ids with @IsUUID('4').
const ROI_VERSION = EXPECTED_ROI_VERSION;
const DEMO_TEMPLATE_REVISION = 'a4-code-v3';
const DEMO_BATCH = 'DEMO';
const SYNTHETIC_BYPASS_FLAG = 'DEMO_SYNTHETIC_BYPASS';
const FLAGGED_SHEET_IDS = [
  '3d398ea1-3046-4d50-aabf-19c18ab69457',
  '528afd9e-7b5a-4f79-92f1-2c028b8d21d1',
  'fdae41aa-dd05-4995-ae06-140b1b97cbd4',
  '8835abd9-70dc-43d5-9038-8c07fdde113d',
  '272272b2-4294-422c-9aa9-2e7c972ee5af',
  '63e3f6af-6fc2-44e5-b5f1-9f6f4b61c6e9',
  '8b13d16d-7163-4a40-9fd8-2f6c6f4b2f7a',
  'c0d9e5f4-5ca4-4ee8-9b25-9a75f2be4cf1',
  'e6f64b2a-4241-4a9c-bd2d-7d91ccfba7e4',
];

const SURNAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const GIVEN = ['Văn An', 'Thị Bình', 'Minh Châu', 'Quốc Dũng', 'Thu Hà', 'Gia Hân', 'Hoàng Long', 'Khánh Linh', 'Tuấn Minh', 'Phương Nga', 'Hữu Phúc', 'Như Quỳnh', 'Thanh Sơn', 'Bảo Trâm', 'Anh Tú', 'Hải Yến', 'Đức Anh', 'Ngọc Bích', 'Công Danh', 'Mỹ Duyên'];
const ZONES = ['Khu A1', 'Khu A2', 'Khu A3', 'Khu B1', 'Khu B2', 'Khu B3'];
const CELLS = ['A1', 'A2', 'A3'];
// Detainee-profile sample values, cycled per prisoner index so every demo detainee is fully
// populated (no NULL profile fields in the demo dataset).
const HOMETOWNS = ['Hà Nội', 'Hải Phòng', 'Nghệ An', 'Thanh Hóa', 'Nam Định', 'Thái Bình', 'Bắc Giang', 'Quảng Ninh'];
const OFFENSES = ['Trộm cắp tài sản', 'Cố ý gây thương tích', 'Lừa đảo chiếm đoạt tài sản', 'Tàng trữ trái phép chất ma túy', 'Gây rối trật tự công cộng'];
const DETENTION_STATUSES = [DetentionStatus.TEMPORARY_HOLD, DetentionStatus.PRE_TRIAL_DETENTION, DetentionStatus.CONVICTED];
interface DemoMenuRecord {
  code: string;
  position: number;
  name: string;
  price: number;
  category: MenuItemCategory;
}

// One deterministic record list avoids the silent drift possible with parallel code/name/price
// arrays. Categories alternate so the small demo baskets below exercise both policies.
const MENU: DemoMenuRecord[] = [
  { code: '001', position: 0, name: 'Mì tôm Hảo Hảo', price: 15000, category: MenuItemCategory.FOOD },
  { code: '002', position: 1, name: 'Xà phòng Lifebuoy', price: 18000, category: MenuItemCategory.ESSENTIAL },
  { code: '003', position: 2, name: 'Nước suối 500ml', price: 8000, category: MenuItemCategory.FOOD },
  { code: '004', position: 3, name: 'Kem đánh răng P/S', price: 26000, category: MenuItemCategory.ESSENTIAL },
  { code: '005', position: 4, name: 'Sữa hộp Vinamilk', price: 12000, category: MenuItemCategory.FOOD },
  { code: '006', position: 5, name: 'Bàn chải đánh răng', price: 14000, category: MenuItemCategory.ESSENTIAL },
  { code: '007', position: 6, name: 'Bánh quy', price: 20000, category: MenuItemCategory.FOOD },
  { code: '008', position: 7, name: 'Dầu gội gói', price: 5000, category: MenuItemCategory.ESSENTIAL },
  { code: '009', position: 8, name: 'Lạc rang', price: 10000, category: MenuItemCategory.FOOD },
  { code: '010', position: 9, name: 'Khăn mặt', price: 25000, category: MenuItemCategory.ESSENTIAL },
  { code: '011', position: 10, name: 'Bánh mì ngọt', price: 12000, category: MenuItemCategory.FOOD },
  { code: '012', position: 11, name: 'Giấy vệ sinh', price: 16000, category: MenuItemCategory.ESSENTIAL },
  { code: '013', position: 12, name: 'Sữa đậu nành', price: 10000, category: MenuItemCategory.FOOD },
  { code: '014', position: 13, name: 'Bột giặt gói', price: 15000, category: MenuItemCategory.ESSENTIAL },
  { code: '015', position: 14, name: 'Kẹo lạc', price: 10000, category: MenuItemCategory.FOOD },
  { code: '016', position: 15, name: 'Nước rửa tay', price: 22000, category: MenuItemCategory.ESSENTIAL },
  { code: '017', position: 16, name: 'Bánh gạo', price: 18000, category: MenuItemCategory.FOOD },
  { code: '018', position: 17, name: 'Lược nhựa', price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '019', position: 18, name: 'Cà phê hòa tan', price: 9000, category: MenuItemCategory.FOOD },
  { code: '020', position: 19, name: 'Bấm móng tay', price: 18000, category: MenuItemCategory.ESSENTIAL },
  { code: '021', position: 20, name: 'Trà túi lọc', price: 15000, category: MenuItemCategory.FOOD },
  { code: '022', position: 21, name: 'Dép nhựa', price: 55000, category: MenuItemCategory.ESSENTIAL },
  { code: '023', position: 22, name: 'Đường gói', price: 12000, category: MenuItemCategory.FOOD },
  { code: '024', position: 23, name: 'Áo lót cotton', price: 45000, category: MenuItemCategory.ESSENTIAL },
  { code: '025', position: 24, name: 'Muối lạc', price: 12000, category: MenuItemCategory.FOOD },
  { code: '026', position: 25, name: 'Quần lót cotton', price: 45000, category: MenuItemCategory.ESSENTIAL },
  { code: '027', position: 26, name: 'Chà bông', price: 30000, category: MenuItemCategory.FOOD },
  { code: '028', position: 27, name: 'Khẩu trang vải', price: 12000, category: MenuItemCategory.ESSENTIAL },
  { code: '029', position: 28, name: 'Cá hộp', price: 28000, category: MenuItemCategory.FOOD },
  { code: '030', position: 29, name: 'Bút bi xanh', price: 6000, category: MenuItemCategory.ESSENTIAL },
  { code: '031', position: 30, name: 'Thịt hộp', price: 35000, category: MenuItemCategory.FOOD },
  { code: '032', position: 31, name: 'Vở 100 trang', price: 15000, category: MenuItemCategory.ESSENTIAL },
  { code: '033', position: 32, name: 'Ruốc cá', price: 32000, category: MenuItemCategory.FOOD },
  { code: '034', position: 33, name: 'Phong bì thư', price: 5000, category: MenuItemCategory.ESSENTIAL },
  { code: '035', position: 34, name: 'Bánh đa', price: 15000, category: MenuItemCategory.FOOD },
  { code: '036', position: 35, name: 'Pin tiểu AA', price: 12000, category: MenuItemCategory.ESSENTIAL },
  { code: '037', position: 36, name: 'Mè rang', price: 18000, category: MenuItemCategory.FOOD },
  { code: '038', position: 37, name: 'Kim chỉ may', price: 12000, category: MenuItemCategory.ESSENTIAL },
  { code: '039', position: 38, name: 'Nước tăng lực', price: 15000, category: MenuItemCategory.FOOD },
  { code: '040', position: 39, name: 'Túi đựng đồ', price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '041', position: 40, name: 'Bánh đậu xanh', price: 22000, category: MenuItemCategory.FOOD },
  { code: '042', position: 41, name: 'Cốc nhựa', price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '043', position: 42, name: 'Hạt điều rang', price: 35000, category: MenuItemCategory.FOOD },
  { code: '044', position: 43, name: 'Thìa nhựa', price: 5000, category: MenuItemCategory.ESSENTIAL },
  { code: '045', position: 44, name: 'Ngũ cốc gói', price: 18000, category: MenuItemCategory.FOOD },
  { code: '046', position: 45, name: 'Hộp đựng xà phòng', price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '047', position: 46, name: 'Bánh cracker', price: 16000, category: MenuItemCategory.FOOD },
  { code: '048', position: 47, name: 'Gương nhựa nhỏ', price: 15000, category: MenuItemCategory.ESSENTIAL },
  { code: '049', position: 48, name: 'Nho khô', price: 25000, category: MenuItemCategory.FOOD },
  { code: '050', position: 49, name: 'Dây phơi quần áo', price: 20000, category: MenuItemCategory.ESSENTIAL },
];
if (
  DEMO_ROI_TEMPLATE.roi_version !== ROI_VERSION ||
  DEMO_ROI_TEMPLATE.digit_boxes.length !== 0
) {
  throw new Error('Demo ROI asset must use the v3 form-authoritative layout');
}

// Deterministic order baskets (menu item positions) → stable, believable kitchen counts.
// Each basket is a list of menu item positions ordered for that prisoner.
const BASKETS = [[0], [1], [2], [0, 1], [4], [3], [2, 5], [6], [7, 8], [9]];

const USER_COUNT = 40;
const ACCEPTED_COUNT = 25;
// A few visitor (relative) orders left UNPAID — awaiting a cashier and deliberately excluded
// from delivery vouchers (PAID-only). Users [25..29] are disjoint from accepted (0..24) and
// flagged (30..38), so a prisoner never carries both states at once.
const UNPAID_RELATIVE_COUNT = 5;
const UNPAID_RELATIVE_START = 25;

// Believable, varied starting commissary balances (integer VND). Indexed per prisoner
// so re-runs are deterministic. Each becomes one 'topup' ledger row attributed to admin.
const SEED_TOPUPS = [150000, 300000, 220000, 480000, 350000, 120000, 260000, 400000];

// Keep a few flagged demo prisoners deliberately under-funded so Verify can exercise the
// real ACCOUNT.INSUFFICIENT_FUNDS response. These users have no seeded orders, so the
// override is stable across reruns and does not affect voucher examples.
const DEMO_BALANCE_OVERRIDES: Record<number, number> = {
  33: 5_000,
  35: 150_000,
  37: 100_000,
  38: 50_000,
};

async function resetDemoData(manager: EntityManager): Promise<void> {
  // Demo sheets and issued forms reference each other. Clear only their demo-owned
  // bindings first, then delete both sides before users/operators are considered.
  const demoUserIds = "SELECT id FROM users WHERE source = 'demo'";
  await manager.createQueryBuilder().update(Sheet)
    .set({ issuedFormId: null })
    .where('batch = :b', { b: DEMO_BATCH }).execute();
  await manager.createQueryBuilder().update(IssuedOmrForm)
    .set({ reservedSheetId: null, consumedSheetId: null })
    .where(`user_id IN (${demoUserIds})`).execute();
  await manager.createQueryBuilder().delete().from(Sheet)
    .where('batch = :b', { b: DEMO_BATCH }).execute();
  await manager.createQueryBuilder().delete().from(IssuedOmrForm)
    .where(`user_id IN (${demoUserIds})`).execute();
  // Orders RESTRICT users, so all orders for demo-owned users must be cleared. Scoping
  // by user prevents a demo reset from deleting real OMR orders.
  await manager.createQueryBuilder().delete().from(Order)
    .where(`user_id IN (${demoUserIds})`).execute();
  await manager.createQueryBuilder().delete().from(MenuItem).execute();
  await manager.createQueryBuilder().delete().from(AccountTransaction)
    .where(`user_id IN (${demoUserIds})`).execute();
  await manager.createQueryBuilder().delete().from(PrisonerAccount)
    .where(`user_id IN (${demoUserIds})`).execute();
  await manager.createQueryBuilder().delete().from(User)
    .where("source = 'demo'").execute();
}

const ADMIN_USERNAME = process.env['SEED_ADMIN_USERNAME'] ?? 'admin';
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'admin12345';

async function ensureAdmin(): Promise<Operator> {
  const repo = AppDataSource.getRepository(Operator);
  const username = ADMIN_USERNAME;
  let admin = await repo.findOne({ where: { username } });
  if (!admin) {
    const password = ADMIN_PASSWORD;
    admin = await repo.save(repo.create({
      username,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      displayName: 'System Admin',
      role: OperatorRole.ADMIN,
      isActive: true,
    }));
    console.log(`Admin "${username}" created.`);
  }
  return admin;
}

// Build a guaranteed-valid 'YYYY-MM-DD' string. Day clamped to ≤28 and month to 1–12 so no
// produced date overflows a short month (e.g. Feb 30) and trips the DATE column on insert.
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

async function seedUsers(): Promise<User[]> {
  const repo = AppDataSource.getRepository(User);
  const now = new Date();
  const rows = Array.from({ length: USER_COUNT }, (_, i) => {
    const cell = CELLS[i % CELLS.length];
    const normalizedCell = normalizeCell(cell);
    return repo.create({
      legacyId: String(100001 + i),
      name: `${SURNAMES[i % SURNAMES.length]} ${GIVEN[i % GIVEN.length]}`,
      zone: ZONES[i % ZONES.length],
      cell,
      normalizedCell: normalizedCell.value,
      cellNormalizationVersion: normalizedCell.version,
      // Every demo detainee fully populated, deterministic per index.
      dateOfBirth: ymd(1970 + (i % 30), (i % 12) + 1, (i % 28) + 1),
      hometown: HOMETOWNS[i % HOMETOWNS.length],
      offense: OFFENSES[i % OFFENSES.length],
      arrestDate: ymd(2020 + (i % 6), (i % 12) + 1, (i % 28) + 1),
      detentionStatus: DETENTION_STATUSES[i % DETENTION_STATUSES.length],
      isActive: true,
      source: 'demo',
      syncedAt: now,
    });
  });
  return repo.save(rows);
}

// Give each demo prisoner a starting balance: one prisoner_accounts row plus a mirroring
// append-only topup ledger row, so /prisoner, /counter and /audit all show real money.
// This is the opening balance; seedAcceptedOrders later debits it for each paid omr order,
// so the final balance = topup − that prisoner's order total.
async function seedAccounts(users: User[], operatorId: string): Promise<void> {
  const accountRepo = AppDataSource.getRepository(PrisonerAccount);
  const ledgerRepo = AppDataSource.getRepository(AccountTransaction);
  for (let i = 0; i < users.length; i++) {
    const amount = DEMO_BALANCE_OVERRIDES[i] ?? SEED_TOPUPS[i % SEED_TOPUPS.length];
    await accountRepo.save(accountRepo.create({ userId: users[i].id, balance: amount }));
    await ledgerRepo.save(ledgerRepo.create({
      userId: users[i].id,
      type: AccountTransactionType.TOPUP,
      amount,
      balanceAfter: amount,
      method: 'cash',
      operatorId,
      note: 'Số dư khởi tạo (demo)',
    }));
  }
}

// Seed the one global threshold_config row (owns the global OMR form template) and the
// global persistent menu. The singleton column means a second config insert would 23505,
// so we upsert the single row in place.
async function seedConfigAndMenu(): Promise<MenuItem[]> {
  const configRepo = AppDataSource.getRepository(ThresholdConfig);
  let config = await configRepo.findOne({ where: { singleton: true } });
  if (!config) {
    config = configRepo.create({
      singleton: true,
      icrThreshold: 0.85,
      omrEmptyMax: 0.3,
      omrTickedMin: 0.7,
      digitBoxCount: 6,
    });
  }
  config.roiTemplate = DEMO_ROI_TEMPLATE as object;
  config.roiVersion = ROI_VERSION;
  config.roiGeneratedAt = new Date();
  await configRepo.save(config);

  const limitRepo = AppDataSource.getRepository(PurchaseLimitConfig);
  let limits = await limitRepo.findOne({ where: { singleton: true } });
  if (!limits) limits = limitRepo.create({ singleton: true });
  limits.prisonerFoodEnabled = true;
  limits.prisonerFoodAmount = 100000;
  limits.prisonerEssentialEnabled = false;
  limits.prisonerEssentialAmount = null;
  limits.visitorFoodEnabled = true;
  limits.visitorFoodAmount = 500000;
  limits.visitorEssentialEnabled = false;
  limits.visitorEssentialAmount = null;
  await limitRepo.save(limits);

  const menuRepo = AppDataSource.getRepository(MenuItem);
  const menu = await menuRepo.save(
    MENU.map((item) => menuRepo.create({ ...item, isActive: true })),
  );
  return menu;
}

async function ensureDemoTemplate(): Promise<OmrFormTemplate> {
  const repo = AppDataSource.getRepository(OmrFormTemplate);
  const geometryHash = canonicalGeometryHash(DEMO_ROI_TEMPLATE);
  const existing = await repo.findOne({ where: { revision: DEMO_TEMPLATE_REVISION } });
  if (existing) {
    const matchesBundledAsset =
      existing.mode === OmrFormMode.CODE &&
      existing.paperSize === 'A4' &&
      existing.orientation === OmrFormOrientation.PORTRAIT &&
      !existing.isActive &&
      existing.activatedAt !== null &&
      existing.retiredAt !== null &&
      canonicalGeometryHash(existing.geometry) === geometryHash;
    if (!matchesBundledAsset) {
      throw new Error(
        `Seed check: ${DEMO_TEMPLATE_REVISION} does not match the bundled immutable demo form`,
      );
    }
    return existing;
  }

  const conflictingGeometry = await repo.findOne({ where: { geometryHash } });
  if (conflictingGeometry) {
    throw new Error(
      `Seed check: bundled demo geometry is already owned by template ${conflictingGeometry.revision}`,
    );
  }

  const now = new Date();
  return repo.save(repo.create({
    revision: DEMO_TEMPLATE_REVISION,
    mode: OmrFormMode.CODE,
    paperSize: 'A4',
    orientation: OmrFormOrientation.PORTRAIT,
    geometry: DEMO_ROI_TEMPLATE,
    geometryHash,
    catalogHash: null,
    isActive: false,
    activatedAt: now,
    retiredAt: now,
  }));
}

async function seedAcceptedOrders(
  users: User[],
  menu: MenuItem[],
  operatorId: string,
  template: OmrFormTemplate,
): Promise<void> {
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  const accountRepo = AppDataSource.getRepository(PrisonerAccount);
  const ledgerRepo = AppDataSource.getRepository(AccountTransaction);
  const now = new Date();
  const serviceDate = tomorrowInDeployTz();

  for (let i = 0; i < ACCEPTED_COUNT; i++) {
    const user = users[i];
    const positions = BASKETS[i % BASKETS.length];

    const totalAmount = positions.reduce((sum, p) => sum + menu[p].price, 0);
    // omr is paid from balance on create (mirrors orders.service): PAID + 'balance' tender,
    // which is what makes these orders eligible for a delivery voucher (PAID-only filter).
    const order = await orderRepo.save(orderRepo.create({
      serviceDate, userId: user.id, source: 'omr', status: OrderStatus.ACTIVE, totalAmount,
      paymentStatus: PaymentStatus.PAID, paymentMethod: 'balance',
    }));
    await itemRepo.save(
      positions.map((p) => itemRepo.create({ orderId: order.id, menuItemId: menu[p].id, unitPrice: menu[p].price, category: menu[p].category })),
    );

    // Debit the prisoner's commissary balance + append an order_debit ledger row, so the
    // voucher's "remaining balance" snapshot reflects real spending (opening topup − total).
    if (totalAmount > 0) {
      const account = await accountRepo.findOne({ where: { userId: user.id } });
      if (account) {
        const balanceAfter = account.balance - totalAmount;
        account.balance = balanceAfter;
        await accountRepo.save(account);
        await ledgerRepo.save(ledgerRepo.create({
          userId: user.id,
          type: AccountTransactionType.ORDER_DEBIT,
          amount: -totalAmount,
          balanceAfter,
          relatedOrderId: order.id,
          operatorId,
          note: 'Trừ tiền suất ăn (demo)',
        }));
      }
    }

    const sheetId = randomUUID();
    const formToken = randomUUID();
    const sheet = await AppDataSource.transaction(async (manager) => {
      const form = manager.create(IssuedOmrForm, {
        token: formToken,
        userId: user.id,
        serviceDate,
        roiVersion: template.revision,
        templateId: template.id,
        formMode: template.mode,
        issuedBy: operatorId,
        status: IssuedOmrFormStatus.CONSUMED,
        reservedSheetId: null,
        consumedSheetId: null,
        consumedAt: now,
        voidReason: null,
        voidedAt: null,
      });
      await manager.save(IssuedOmrForm, form);

      const acceptedSheet = await manager.save(Sheet, manager.create(Sheet, {
        id: sheetId,
        sheetId: `S-${String(1000 + i)}`,
        batch: DEMO_BATCH,
        serviceDate,
        admittedAt: now,
        admissionSource: ScanAdmissionSource.BROWSER,
        admittedMode: OmrOperationalFormMode.ISSUED,
        admittedGeneration: 'issued-v1',
        admittedBy: operatorId,
        checksum: `demo-acc-${i}`,
        imagePath: `demo/acc-${i}.jpg`,
        status: SheetStatus.AUTO_ACCEPTED,
        avgConfidence: 0.95 + (i % 5) * 0.008,
        recognizedId: null,
        matchedUserId: user.id,
        issuedFormId: formToken,
        orderId: order.id,
        flags: [SYNTHETIC_BYPASS_FLAG],
        resultJson: buildResult(positions, 0.96),
        processedAt: now,
      }));

      form.reservedSheetId = sheetId;
      form.consumedSheetId = sheetId;
      await manager.save(IssuedOmrForm, form);
      return acceptedSheet;
    });
    order.sheetId = sheet.id;
    await orderRepo.save(order);
  }
}

// Visitor (relative) orders created UNPAID, like the real kiosk/counter flow before a cashier
// settles them. They show in the Orders queue but never on a delivery voucher (PAID-only),
// demonstrating the "ordered, not yet on a voucher" state beside the paid omr sheets. No
// balance is touched — relative orders are paid by cash/bank at the counter, not from balance.
async function seedUnpaidRelativeOrders(users: User[], menu: MenuItem[]): Promise<void> {
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  const serviceDate = tomorrowInDeployTz();

  for (let i = 0; i < UNPAID_RELATIVE_COUNT; i++) {
    const user = users[UNPAID_RELATIVE_START + i];
    const positions = BASKETS[i % BASKETS.length];
    const totalAmount = positions.reduce((sum, p) => sum + menu[p].price, 0);
    const order = await orderRepo.save(orderRepo.create({
      serviceDate, userId: user.id, source: 'relative', status: OrderStatus.ACTIVE,
      totalAmount, paymentStatus: PaymentStatus.UNPAID, paymentMethod: 'cash',
    }));
    await itemRepo.save(
      positions.map((p) => itemRepo.create({ orderId: order.id, menuItemId: menu[p].id, unitPrice: menu[p].price, category: menu[p].category })),
    );
  }
}

// V3 carries only order-line evidence. Identity comes from the bound issued form.
interface DemoOrderLineSpec {
  position: number;
  quantity?: number;
}

function buildResult(
  orderedPositions: Array<number | DemoOrderLineSpec>,
  conf: number,
): { order_lines: OrderLineResult[] } {
  const order_lines: OrderLineResult[] = orderedPositions.map((entry, line_index) => {
    const position = typeof entry === 'number' ? entry : entry.position;
    const quantity = typeof entry === 'number' ? 1 : (entry.quantity ?? 1);
    const code = MENU[position].code;
    return {
      line_index,
      code,
      qty: quantity,
      code_digits: code.split('').map((c, index) => ({ index, value: Number(c), confidence: conf })),
      qty_digits: [{ index: 0, value: quantity, confidence: conf }],
      flags: [],
    };
  });
  return { order_lines };
}

function storageDir(): string {
  return process.env['SCAN_STORAGE_DIR'] ?? './data/scans';
}

// Pre-populate the warped image cache so Verify serves the real form with no OMR call.
function safeCachePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function writeWarpedImage(sheetId: string, template: OmrFormTemplate): string {
  const warpedDir = path.join(storageDir(), 'warped');
  fs.mkdirSync(warpedDir, { recursive: true, mode: 0o700 });
  const cacheKey = `${template.id}:${template.geometryHash}`;
  const rel = path.join(
    'warped',
    `${safeCachePart(sheetId)}__${safeCachePart(cacheKey)}.png`,
  );
  fs.writeFileSync(path.join(storageDir(), rel), Buffer.from(DEMO_FORM_PNG_BASE64, 'base64'), { mode: 0o600 });
  // Raw fallback so getWarpedImage never 500s even if the cache file is removed.
  fs.writeFileSync(path.join(storageDir(), `${sheetId}.png`), Buffer.from(DEMO_FORM_PNG_BASE64, 'base64'), { mode: 0o600 });
  return rel;
}

async function seedFlaggedSheets(
  users: User[],
  operatorId: string,
  template: OmrFormTemplate,
): Promise<void> {
  const now = new Date();
  const serviceDate = tomorrowInDeployTz();
  const specs = [
    { user: users[30], conf: 0.71, flags: ['LOW_CONF_CODE_LINE_0'], ordered: [0] },
    { user: users[31], conf: 0.68, flags: ['LOW_CONF_QTY_LINE_0'], ordered: [1] },
    { user: users[32], conf: 0.74, flags: ['LOW_CONF_CODE_LINE_1'], ordered: [0, 2] },
    // Insufficient balance: 15,000 order against a 5,000 balance. Confirm remains
    // pressable so the backend's atomic debit rejection can be demonstrated.
    { user: users[33], conf: 0.66, flags: ['LOW_CONF_CODE_LINE_1', 'DEMO_INSUFFICIENT_FUNDS'], ordered: [0] },
    // Existing funded low-confidence example.
    { user: users[34], conf: 0.55, flags: ['LOW_CONF_CODE_LINE_0'], ordered: [2] },
    // Food subtotal exactly at the 100,000 prisoner limit: 4 x 15,000 + 2 x 20,000.
    { user: users[35], conf: 0.72, flags: ['DEMO_LIMIT_AT_BOUNDARY'], ordered: [{ position: 0, quantity: 4 }, { position: 6, quantity: 2 }] },
    // Food subtotal over the 100,000 limit while the balance is sufficient. Verify hard-blocks
    // the confirm action and the backend independently returns ORDER.CATEGORY_LIMIT_EXCEEDED.
    { user: users[36], conf: 0.63, flags: ['LOW_CONF_QTY_LINE_0', 'DEMO_LIMIT_EXCEEDED'], ordered: [{ position: 0, quantity: 7 }] },
    // Essential items are unlimited by default, so this demonstrates a pure insufficient-
    // balance rejection without also tripping the food policy.
    { user: users[37], conf: 0.61, flags: ['DEMO_INSUFFICIENT_FUNDS'], ordered: [{ position: 3, quantity: 5 }] },
    // Both conditions are present: the UI surfaces the purchase-limit hard block first, while
    // the server still rechecks both policy and balance inside the same confirmation TX.
    { user: users[38], conf: 0.58, flags: ['LOW_CONF_CODE_LINE_0', 'DEMO_LIMIT_EXCEEDED', 'DEMO_INSUFFICIENT_FUNDS'], ordered: [{ position: 0, quantity: 8 }] },
  ];

  for (let i = 0; i < FLAGGED_SHEET_IDS.length; i++) {
    const id = FLAGGED_SHEET_IDS[i];
    const s = specs[i];
    writeWarpedImage(id, template);
    const formToken = randomUUID();
    await AppDataSource.transaction(async (manager) => {
      const form = manager.create(IssuedOmrForm, {
        token: formToken,
        userId: s.user.id,
        serviceDate,
        roiVersion: template.revision,
        templateId: template.id,
        formMode: template.mode,
        issuedBy: operatorId,
        status: IssuedOmrFormStatus.ISSUED,
        reservedSheetId: null,
        consumedSheetId: null,
        consumedAt: null,
        voidReason: null,
        voidedAt: null,
      });
      await manager.save(IssuedOmrForm, form);
      await manager.save(Sheet, manager.create(Sheet, {
        id,
        sheetId: `S-${String(2000 + i)}`,
        batch: DEMO_BATCH,
        serviceDate,
        admittedAt: now,
        admissionSource: ScanAdmissionSource.BROWSER,
        admittedMode: OmrOperationalFormMode.ISSUED,
        admittedGeneration: 'issued-v1',
        admittedBy: operatorId,
        checksum: `demo-flag-${i}`,
        imagePath: `${id}.png`,
        status: SheetStatus.FLAGGED,
        avgConfidence: s.conf,
        recognizedId: null,
        matchedUserId: s.user.id,
        issuedFormId: formToken,
        flags: [SYNTHETIC_BYPASS_FLAG, ...s.flags],
        resultJson: buildResult(s.ordered, s.conf),
        processedAt: now,
      }));
      form.reservedSheetId = id;
      await manager.save(IssuedOmrForm, form);
    });
  }
}

async function seedMiscSheets(operatorId: string): Promise<void> {
  const sheetRepo = AppDataSource.getRepository(Sheet);
  const now = new Date();
  const serviceDate = tomorrowInDeployTz();
  const rows: Partial<Sheet>[] = [];
  for (let i = 0; i < 2; i++) {
    rows.push({
      sheetId: `S-${3000 + i}`, batch: DEMO_BATCH, serviceDate,
      admittedAt: now, admissionSource: ScanAdmissionSource.BROWSER,
      admittedMode: OmrOperationalFormMode.ISSUED, admittedGeneration: 'issued-v1',
      admittedBy: operatorId,
      checksum: `demo-rej-${i}`, imagePath: `demo/rej-${i}.jpg`, status: SheetStatus.REJECTED,
      avgConfidence: 0.3, flags: ['REJECTED'], processedAt: now,
    });
  }
  for (let i = 0; i < 2; i++) {
    rows.push({
      sheetId: `S-${4000 + i}`, batch: DEMO_BATCH, serviceDate,
      admittedAt: now, admissionSource: ScanAdmissionSource.BROWSER,
      admittedMode: OmrOperationalFormMode.ISSUED, admittedGeneration: 'issued-v1',
      admittedBy: operatorId,
      checksum: `demo-pend-${i}`, imagePath: `demo/pend-${i}.jpg`, status: SheetStatus.PENDING,
    });
  }
  await sheetRepo.save(rows.map((r) => sheetRepo.create(r)));
}

// Seed acceptance: confirm the global model landed — a global menu, exactly one
// threshold_config row, and no leftover meal_sessions table.
async function assertSeedShape(menu: MenuItem[], template: OmrFormTemplate): Promise<void> {
  if (menu.length !== MENU.length) {
    throw new Error(`Seed check: expected ${MENU.length} menu items, got ${menu.length}`);
  }
  const categoryCounts = menu.reduce<Record<MenuItemCategory, number>>(
    (counts, item) => ({ ...counts, [item.category]: counts[item.category] + 1 }),
    { [MenuItemCategory.FOOD]: 0, [MenuItemCategory.ESSENTIAL]: 0 },
  );
  if (categoryCounts.food !== 25 || categoryCounts.essential !== 25) {
    throw new Error(`Seed check: expected 25 food and 25 essential items, got ${categoryCounts.food}/${categoryCounts.essential}`);
  }
  for (let position = 0; position < 50; position++) {
    const item = menu[position];
    const expectedCode = String(position + 1).padStart(3, '0');
    if (item.position !== position || item.code !== expectedCode) {
      throw new Error(`Seed check: expected code/position ${expectedCode}/${position}, got ${item.code}/${item.position}`);
    }
  }
  const configRows: Array<{ n: string }> = await AppDataSource.query(
    `SELECT count(*) AS n FROM threshold_config`,
  );
  if (Number(configRows[0].n) !== 1) {
    throw new Error(`Seed check: expected exactly 1 threshold_config row, got ${configRows[0].n}`);
  }
  const limitRows: Array<{
    prisoner_food_enabled: boolean; prisoner_food_amount: string;
    prisoner_essential_enabled: boolean; prisoner_essential_amount: string | null;
    visitor_food_enabled: boolean; visitor_food_amount: string;
    visitor_essential_enabled: boolean; visitor_essential_amount: string | null;
  }> = await AppDataSource.query(
    `SELECT prisoner_food_enabled, prisoner_food_amount,
            prisoner_essential_enabled, prisoner_essential_amount,
            visitor_food_enabled, visitor_food_amount,
            visitor_essential_enabled, visitor_essential_amount
       FROM purchase_limit_config`,
  );
  const limits = limitRows[0];
  if (limitRows.length !== 1 || !limits.prisoner_food_enabled || Number(limits.prisoner_food_amount) !== 100000 ||
      limits.prisoner_essential_enabled || limits.prisoner_essential_amount !== null ||
      !limits.visitor_food_enabled || Number(limits.visitor_food_amount) !== 500000 ||
      limits.visitor_essential_enabled || limits.visitor_essential_amount !== null) {
    throw new Error('Seed check: purchase-limit singleton does not match the approved defaults');
  }
  const missingSnapshots: Array<{ n: string }> = await AppDataSource.query(
    `SELECT count(*) AS n FROM order_items WHERE category IS NULL`,
  );
  if (Number(missingSnapshots[0].n) !== 0) {
    throw new Error(`Seed check: ${missingSnapshots[0].n} order items are missing category snapshots`);
  }
  const sessionTable: Array<{ exists: boolean }> = await AppDataSource.query(
    `SELECT to_regclass('public.meal_sessions') IS NOT NULL AS exists`,
  );
  if (sessionTable[0].exists) {
    throw new Error('Seed check: meal_sessions table must not exist in the global model');
  }
  const incoherentAuthority: Array<{ n: string }> = await AppDataSource.query(
    `SELECT count(*) AS n
       FROM sheets s
       LEFT JOIN issued_omr_forms f ON f.token = s.issued_form_id
      WHERE s.batch = $1
        AND s.status IN ('flagged', 'auto_accepted')
        AND (
          f.token IS NULL
          OR s.matched_user_id IS DISTINCT FROM f.user_id
          OR s.service_date IS DISTINCT FROM f.service_date
          OR f.roi_version <> $2
          OR f.template_id IS DISTINCT FROM $3
          OR f.form_mode <> $4
          OR s.recognized_id IS NOT NULL
          OR s.result_json IS NULL
          OR jsonb_typeof(s.result_json) <> 'object'
          OR NOT (s.result_json ? 'order_lines')
          OR EXISTS (
            SELECT 1
              FROM jsonb_object_keys(s.result_json) AS result_key
             WHERE result_key <> 'order_lines'
          )
          OR COALESCE(s.flags, '[]'::jsonb) @> '["NOT_MATCHED"]'::jsonb
          OR NOT (COALESCE(s.flags, '[]'::jsonb) @> '["DEMO_SYNTHETIC_BYPASS"]'::jsonb)
          OR f.reserved_sheet_id IS DISTINCT FROM s.id
          OR (s.status = 'flagged' AND f.status <> 'issued')
          OR (s.status = 'auto_accepted' AND (
            f.status <> 'consumed' OR f.consumed_sheet_id IS DISTINCT FROM s.id
          ))
        )`,
    [DEMO_BATCH, template.revision, template.id, template.mode],
  );
  if (Number(incoherentAuthority[0].n) !== 0) {
    throw new Error(`Seed check: ${incoherentAuthority[0].n} confirmable/accepted sheets lack coherent v3 form authority`);
  }
}

export async function runDemoSeed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (manager) => {
      await resetDemoData(manager);
    });
    const admin = await ensureAdmin();
    const users = await seedUsers();
    await seedAccounts(users, admin.id);
    const menu = await seedConfigAndMenu();
    const template = await ensureDemoTemplate();
    await seedAcceptedOrders(users, menu, admin.id, template);
    await seedUnpaidRelativeOrders(users, menu);
    await seedFlaggedSheets(users, admin.id, template);
    await seedMiscSheets(admin.id);
    await assertSeedShape(menu, template);
    console.log('--- Demo seed complete ---');
    console.log(`ĐĂNG NHẬP (login):  ${ADMIN_USERNAME}  /  ${ADMIN_PASSWORD}`);
    console.log(`Global menu: ${menu.length} items  |  users: ${USER_COUNT}  |  service_date: ${tomorrowInDeployTz()}`);
    console.log(`Accounts: ${USER_COUNT} prisoners seeded with starting balances (paid omr orders debited)`);
    console.log(`Orders: ${ACCEPTED_COUNT} paid omr (on vouchers), ${UNPAID_RELATIVE_COUNT} unpaid relative (not on vouchers)`);
    console.log(`Sheets: ${ACCEPTED_COUNT} auto-accepted, ${FLAGGED_SHEET_IDS.length} flagged, 2 rejected, 2 pending`);
    console.log('Review cases: 3 insufficient-funds (1 combined), 1 at-limit, 2 over-limit (1 combined), 4 confidence-only');
    console.log(`Storage: ${path.resolve(storageDir())}/warped/`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  runDemoSeed().catch((err: unknown) => {
    console.error('Demo seed failed:', err);
    process.exit(1);
  });
}
