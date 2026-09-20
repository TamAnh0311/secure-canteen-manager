/**
 * MVP demo seed — populates realistic Vietnamese data for pitch demos.
 * No OMR/scan dependencies. Idempotent: safe to re-run (resets demo data first).
 * All demo users have source='demo' so they can be wiped cleanly later.
 *
 * Standalone:  npx ts-node -r tsconfig-paths/register src/database/seeds/mvp-seed.ts
 * Or:          node dist/database/seeds/mvp-seed.js
 * From NestJS: import { seedMvpDemo } from './database/seeds/mvp-seed'; await seedMvpDemo(ds);
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Operator, OperatorRole } from '../../operators/operator.entity';
import { BCRYPT_COST } from '../../operators/operator-public';
import { User, DetentionStatus } from '../../users/user.entity';
import { normalizeCell } from '../../users/cell-normalization';
import { MenuItem } from '../../menu/menu-item.entity';
import { MenuItemCategory } from '../../menu/menu-item-category.enum';
import { Order, OrderStatus, PaymentStatus } from '../../orders/order.entity';
import { OrderItem } from '../../orders/order-item.entity';
import { PrisonerAccount } from '../../accounts/prisoner-account.entity';
import { AccountTransaction, AccountTransactionType } from '../../accounts/account-transaction.entity';
import { PurchaseLimitConfig } from '../../purchase-limit-config/purchase-limit-config.entity';
import { PaymentConfig } from '../../payment-config/payment-config.entity';

// ── Helpers ──

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Tomorrow in deploy timezone, as YYYY-MM-DD. */
function tomorrow(): string {
  const tz = process.env['APP_TZ'] ?? 'Asia/Saigon';
  const now = new Date();
  const tom = new Date(now.getTime() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tom);
}

/** Today in deploy timezone, as YYYY-MM-DD. */
function today(): string {
  const tz = process.env['APP_TZ'] ?? 'Asia/Saigon';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// ── Constants ──

const SURNAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const GIVEN = ['Văn An', 'Thị Bình', 'Minh Châu', 'Quốc Dũng', 'Thu Hà', 'Gia Hân', 'Hoàng Long', 'Khánh Linh', 'Tuấn Minh', 'Phương Nga', 'Hữu Phúc', 'Như Quỳnh', 'Thanh Sơn', 'Bảo Trâm', 'Anh Tú', 'Hải Yến', 'Đức Anh', 'Ngọc Bích', 'Công Danh', 'Mỹ Duyên'];
const ZONES = ['Khu A1', 'Khu A2', 'Khu A3', 'Khu B1', 'Khu B2', 'Khu B3'];
const CELLS = ['A1-01', 'A1-02', 'A1-03', 'A2-01', 'A2-02', 'B1-01', 'B1-02', 'B2-01'];
const HOMETOWNS = ['Hà Nội', 'Hải Phòng', 'Nghệ An', 'Thanh Hóa', 'Nam Định', 'Thái Bình', 'Bắc Giang', 'Quảng Ninh', 'Đà Nẵng', 'TP.HCM'];
const OFFENSES = ['Trộm cắp tài sản', 'Cố ý gây thương tích', 'Lừa đảo chiếm đoạt tài sản', 'Tàng trữ trái phép chất ma túy', 'Gây rối trật tự công cộng'];
const DETENTION_STATUSES = [DetentionStatus.TEMPORARY_HOLD, DetentionStatus.PRE_TRIAL_DETENTION, DetentionStatus.CONVICTED];

interface DemoMenuItem {
  code: string;
  position: number;
  name: string;
  price: number;
  category: MenuItemCategory;
}

const MENU: DemoMenuItem[] = [
  { code: '001', position: 0,  name: 'Mì tôm Hảo Hảo',     price: 15000, category: MenuItemCategory.FOOD },
  { code: '002', position: 1,  name: 'Xà phòng Lifebuoy',   price: 18000, category: MenuItemCategory.ESSENTIAL },
  { code: '003', position: 2,  name: 'Nước suối 500ml',      price: 8000,  category: MenuItemCategory.FOOD },
  { code: '004', position: 3,  name: 'Kem đánh răng P/S',    price: 26000, category: MenuItemCategory.ESSENTIAL },
  { code: '005', position: 4,  name: 'Sữa hộp Vinamilk',    price: 12000, category: MenuItemCategory.FOOD },
  { code: '006', position: 5,  name: 'Bàn chải đánh răng',   price: 14000, category: MenuItemCategory.ESSENTIAL },
  { code: '007', position: 6,  name: 'Bánh quy',             price: 20000, category: MenuItemCategory.FOOD },
  { code: '008', position: 7,  name: 'Dầu gội gói',          price: 5000,  category: MenuItemCategory.ESSENTIAL },
  { code: '009', position: 8,  name: 'Lạc rang',             price: 10000, category: MenuItemCategory.FOOD },
  { code: '010', position: 9,  name: 'Khăn mặt',             price: 25000, category: MenuItemCategory.ESSENTIAL },
  { code: '011', position: 10, name: 'Bánh mì ngọt',         price: 12000, category: MenuItemCategory.FOOD },
  { code: '012', position: 11, name: 'Giấy vệ sinh',         price: 16000, category: MenuItemCategory.ESSENTIAL },
  { code: '013', position: 12, name: 'Sữa đậu nành',         price: 10000, category: MenuItemCategory.FOOD },
  { code: '014', position: 13, name: 'Bột giặt gói',         price: 15000, category: MenuItemCategory.ESSENTIAL },
  { code: '015', position: 14, name: 'Kẹo lạc',              price: 10000, category: MenuItemCategory.FOOD },
  { code: '016', position: 15, name: 'Nước rửa tay',         price: 22000, category: MenuItemCategory.ESSENTIAL },
  { code: '017', position: 16, name: 'Bánh gạo',             price: 18000, category: MenuItemCategory.FOOD },
  { code: '018', position: 17, name: 'Lược nhựa',            price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '019', position: 18, name: 'Cà phê hòa tan',       price: 9000,  category: MenuItemCategory.FOOD },
  { code: '020', position: 19, name: 'Bấm móng tay',         price: 18000, category: MenuItemCategory.ESSENTIAL },
  { code: '021', position: 20, name: 'Trà túi lọc',          price: 15000, category: MenuItemCategory.FOOD },
  { code: '022', position: 21, name: 'Dép nhựa',             price: 55000, category: MenuItemCategory.ESSENTIAL },
  { code: '023', position: 22, name: 'Đường gói',            price: 12000, category: MenuItemCategory.FOOD },
  { code: '024', position: 23, name: 'Áo lót cotton',        price: 45000, category: MenuItemCategory.ESSENTIAL },
  { code: '025', position: 24, name: 'Muối lạc',             price: 12000, category: MenuItemCategory.FOOD },
  { code: '026', position: 25, name: 'Quần lót cotton',      price: 45000, category: MenuItemCategory.ESSENTIAL },
  { code: '027', position: 26, name: 'Chà bông',             price: 30000, category: MenuItemCategory.FOOD },
  { code: '028', position: 27, name: 'Khẩu trang vải',       price: 12000, category: MenuItemCategory.ESSENTIAL },
  { code: '029', position: 28, name: 'Cá hộp',               price: 28000, category: MenuItemCategory.FOOD },
  { code: '030', position: 29, name: 'Bút bi xanh',          price: 6000,  category: MenuItemCategory.ESSENTIAL },
  { code: '031', position: 30, name: 'Thịt hộp',             price: 35000, category: MenuItemCategory.FOOD },
  { code: '032', position: 31, name: 'Vở 100 trang',         price: 15000, category: MenuItemCategory.ESSENTIAL },
  { code: '033', position: 32, name: 'Ruốc cá',              price: 32000, category: MenuItemCategory.FOOD },
  { code: '034', position: 33, name: 'Phong bì thư',         price: 5000,  category: MenuItemCategory.ESSENTIAL },
  { code: '035', position: 34, name: 'Bánh đa',              price: 15000, category: MenuItemCategory.FOOD },
  { code: '036', position: 35, name: 'Pin tiểu AA',          price: 12000, category: MenuItemCategory.ESSENTIAL },
  { code: '037', position: 36, name: 'Mè rang',              price: 18000, category: MenuItemCategory.FOOD },
  { code: '038', position: 37, name: 'Kim chỉ may',          price: 12000, category: MenuItemCategory.ESSENTIAL },
  { code: '039', position: 38, name: 'Nước tăng lực',        price: 15000, category: MenuItemCategory.FOOD },
  { code: '040', position: 39, name: 'Túi đựng đồ',          price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '041', position: 40, name: 'Bánh đậu xanh',        price: 22000, category: MenuItemCategory.FOOD },
  { code: '042', position: 41, name: 'Cốc nhựa',             price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '043', position: 42, name: 'Hạt điều rang',         price: 35000, category: MenuItemCategory.FOOD },
  { code: '044', position: 43, name: 'Thìa nhựa',            price: 5000,  category: MenuItemCategory.ESSENTIAL },
  { code: '045', position: 44, name: 'Ngũ cốc gói',          price: 18000, category: MenuItemCategory.FOOD },
  { code: '046', position: 45, name: 'Hộp đựng xà phòng',    price: 10000, category: MenuItemCategory.ESSENTIAL },
  { code: '047', position: 46, name: 'Bánh cracker',          price: 16000, category: MenuItemCategory.FOOD },
  { code: '048', position: 47, name: 'Gương nhựa nhỏ',       price: 15000, category: MenuItemCategory.ESSENTIAL },
  { code: '049', position: 48, name: 'Nho khô',              price: 25000, category: MenuItemCategory.FOOD },
  { code: '050', position: 49, name: 'Dây phơi quần áo',     price: 20000, category: MenuItemCategory.ESSENTIAL },
];

const USER_COUNT = 30;
const SEED_TOPUPS = [150000, 300000, 220000, 480000, 350000, 120000, 260000, 400000, 500000, 180000];

// Order baskets: each is an array of [menuPosition, quantity] pairs.
const BASKETS: Array<Array<[number, number]>> = [
  [[0, 2], [2, 3]],                 // mì tôm x2, nước suối x3
  [[1, 1], [3, 1]],                 // xà phòng, kem đánh răng
  [[4, 5], [6, 2]],                 // sữa x5, bánh quy x2
  [[0, 3], [8, 2], [2, 2]],         // mì tôm x3, lạc rang x2, nước x2
  [[10, 2], [12, 3]],               // bánh mì x2, sữa đậu nành x3
  [[18, 5], [20, 2], [22, 1]],      // cà phê x5, trà x2, đường x1
  [[26, 1], [28, 1], [30, 1]],      // chà bông, cá hộp, thịt hộp
  [[5, 2], [7, 3], [9, 1]],         // bàn chải x2, dầu gội x3, khăn mặt
  [[0, 1], [4, 2], [6, 1], [8, 1]], // mixed basket
  [[14, 3], [16, 2], [34, 1]],      // kẹo lạc x3, bánh gạo x2, bánh đa
];

// ── Seed functions (all accept a DataSource) ──

/** Wipe demo users and related data. Safe to call on empty tables. */
async function resetDemoData(ds: DataSource): Promise<void> {
  const demoUserIds = `SELECT id FROM users WHERE source = 'demo'`;
  await ds.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${demoUserIds}))`);
  await ds.query(`DELETE FROM orders WHERE user_id IN (${demoUserIds})`);
  await ds.query(`DELETE FROM account_transactions WHERE user_id IN (${demoUserIds})`);
  await ds.query(`DELETE FROM prisoner_accounts WHERE user_id IN (${demoUserIds})`);
  await ds.query(`DELETE FROM users WHERE source = 'demo'`);
  await ds.query(`DELETE FROM menu_items`);
  console.log('Demo data reset.');
}

/** Create or find the admin operator. */
async function ensureAdmin(ds: DataSource, username: string, password: string): Promise<Operator> {
  const repo = ds.getRepository(Operator);
  let admin = await repo.findOne({ where: { username } });
  if (!admin) {
    admin = await repo.save(repo.create({
      username,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      displayName: 'Quản trị viên',
      role: OperatorRole.ADMIN,
      isActive: true,
    }));
    console.log(`Admin "${username}" created.`);
  }
  return admin;
}

/** Create or find a zone operator. */
async function ensureOperator(ds: DataSource): Promise<Operator> {
  const repo = ds.getRepository(Operator);
  const username = 'operator1';
  let op = await repo.findOne({ where: { username } });
  if (!op) {
    op = await repo.save(repo.create({
      username,
      passwordHash: await bcrypt.hash('operator123', BCRYPT_COST),
      displayName: 'Cán bộ Nguyễn',
      role: OperatorRole.OPERATOR,
      zone: 'Khu A1',
      isActive: true,
    }));
    console.log(`Operator "${username}" created.`);
  }
  return op;
}

/** Create or find a cashier. */
async function ensureCashier(ds: DataSource): Promise<Operator> {
  const repo = ds.getRepository(Operator);
  const username = 'cashier1';
  let op = await repo.findOne({ where: { username } });
  if (!op) {
    op = await repo.save(repo.create({
      username,
      passwordHash: await bcrypt.hash('cashier123', BCRYPT_COST),
      displayName: 'Thu ngân Trần',
      role: OperatorRole.CASHIER,
      isActive: true,
    }));
    console.log(`Cashier "${username}" created.`);
  }
  return op;
}

/** Seed all menu items. */
async function seedMenu(ds: DataSource): Promise<MenuItem[]> {
  const repo = ds.getRepository(MenuItem);
  return repo.save(MENU.map((item) => repo.create({ ...item, isActive: true })));
}

/** Seed demo prisoners. */
async function seedUsers(ds: DataSource): Promise<User[]> {
  const repo = ds.getRepository(User);
  const now = new Date();
  const rows = Array.from({ length: USER_COUNT }, (_, i) => {
    const cell = CELLS[i % CELLS.length];
    const nc = normalizeCell(cell);
    return repo.create({
      legacyId: String(100001 + i),
      name: `${SURNAMES[i % SURNAMES.length]} ${GIVEN[i % GIVEN.length]}`,
      zone: ZONES[i % ZONES.length],
      cell,
      normalizedCell: nc.value,
      cellNormalizationVersion: nc.version,
      dateOfBirth: ymd(1970 + (i % 30), (i % 12) + 1, (i % 28) + 1),
      hometown: HOMETOWNS[i % HOMETOWNS.length],
      offense: OFFENSES[i % OFFENSES.length],
      arrestDate: ymd(2020 + (i % 5), (i % 12) + 1, (i % 28) + 1),
      detentionStatus: DETENTION_STATUSES[i % DETENTION_STATUSES.length],
      isActive: true,
      source: 'demo',
      syncedAt: now,
    });
  });
  return repo.save(rows);
}

/** Seed prisoner accounts with starting balances and ledger entries. */
async function seedAccounts(ds: DataSource, users: User[], operatorId: string): Promise<void> {
  const accountRepo = ds.getRepository(PrisonerAccount);
  const ledgerRepo = ds.getRepository(AccountTransaction);
  for (let i = 0; i < users.length; i++) {
    const amount = SEED_TOPUPS[i % SEED_TOPUPS.length];
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

/** Seed demo orders: 20 paid today, 5 unpaid for tomorrow. */
async function seedOrders(ds: DataSource, users: User[], menu: MenuItem[], operatorId: string): Promise<void> {
  const orderRepo = ds.getRepository(Order);
  const itemRepo = ds.getRepository(OrderItem);
  const accountRepo = ds.getRepository(PrisonerAccount);
  const ledgerRepo = ds.getRepository(AccountTransaction);

  const serviceDate = today();

  for (let i = 0; i < 20; i++) {
    const user = users[i];
    const basket = BASKETS[i % BASKETS.length];
    const totalAmount = basket.reduce((sum, [pos, qty]) => sum + menu[pos].price * qty, 0);

    const order = await orderRepo.save(orderRepo.create({
      serviceDate,
      userId: user.id,
      source: 'omr',
      status: OrderStatus.ACTIVE,
      totalAmount,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: 'balance',
    }));

    await itemRepo.save(basket.map(([pos, qty]) => itemRepo.create({
      orderId: order.id,
      menuItemId: menu[pos].id,
      unitPrice: menu[pos].price,
      category: menu[pos].category,
      quantity: qty,
    })));

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
        note: 'Trừ tiền đặt hàng (demo)',
      }));
    }
  }

  const tomorrowDate = tomorrow();
  for (let i = 20; i < 25; i++) {
    const user = users[i];
    const basket = BASKETS[i % BASKETS.length];
    const totalAmount = basket.reduce((sum, [pos, qty]) => sum + menu[pos].price * qty, 0);

    const order = await orderRepo.save(orderRepo.create({
      serviceDate: tomorrowDate,
      userId: user.id,
      source: 'relative',
      status: OrderStatus.ACTIVE,
      totalAmount,
      paymentStatus: PaymentStatus.UNPAID,
      paymentMethod: 'cash',
    }));

    await itemRepo.save(basket.map(([pos, qty]) => itemRepo.create({
      orderId: order.id,
      menuItemId: menu[pos].id,
      unitPrice: menu[pos].price,
      category: menu[pos].category,
      quantity: qty,
    })));
  }
}

/** Seed purchase limit configuration. */
async function seedPurchaseLimits(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(PurchaseLimitConfig);
  let limits = await repo.findOne({ where: { singleton: true } });
  if (!limits) limits = repo.create({ singleton: true });
  limits.prisonerFoodEnabled = true;
  limits.prisonerFoodAmount = 200000;
  limits.prisonerEssentialEnabled = false;
  limits.prisonerEssentialAmount = 0;
  limits.visitorFoodEnabled = true;
  limits.visitorFoodAmount = 500000;
  limits.visitorEssentialEnabled = false;
  limits.visitorEssentialAmount = 0;
  await repo.save(limits);
}

/** Seed payment/banking configuration. */
async function seedPaymentConfig(ds: DataSource): Promise<void> {
  const repo = ds.getRepository(PaymentConfig);
  let config = await repo.findOne({ where: { singleton: true } });
  if (!config) config = repo.create({ singleton: true });
  config.bankBin = '970436';
  config.accountNumber = '1234567890';
  config.accountName = 'TRAI TAM GIAM XYZ';
  await repo.save(config);
}

// ── Public API ──

/**
 * Seed full MVP demo data into the given DataSource.
 * Resets existing demo data first, then creates operators, menu, prisoners,
 * accounts, orders, and config. Safe to call from NestJS bootstrap or standalone.
 */
export async function seedMvpDemo(ds: DataSource): Promise<void> {
  const adminUser = process.env['SEED_ADMIN_USERNAME'] ?? 'admin';
  const adminPass = process.env['SEED_ADMIN_PASSWORD'] ?? 'admin123';

  await resetDemoData(ds);
  const admin = await ensureAdmin(ds, adminUser, adminPass);
  await ensureOperator(ds);
  await ensureCashier(ds);
  const menu = await seedMenu(ds);
  const users = await seedUsers(ds);
  await seedAccounts(ds, users, admin.id);
  await seedOrders(ds, users, menu, admin.id);
  await seedPurchaseLimits(ds);
  await seedPaymentConfig(ds);

  console.log(`Demo seed complete: ${menu.length} menu items, ${users.length} prisoners, 25 orders.`);
}

// ── Standalone entry point ──

if (require.main === module) {
  (async () => {
    await AppDataSource.initialize();
    try {
      const pending = await AppDataSource.showMigrations();
      if (pending) {
        console.log('Running pending migrations...');
        await AppDataSource.runMigrations();
        console.log('Migrations complete.');
      }
      await seedMvpDemo(AppDataSource);

      console.log('\n--- MVP Demo Seed Complete ---');
      console.log('Đăng nhập (Login):');
      console.log(`  Admin:    ${process.env['SEED_ADMIN_USERNAME'] ?? 'admin'} / ${process.env['SEED_ADMIN_PASSWORD'] ?? 'admin123'}`);
      console.log('  Operator: operator1 / operator123');
      console.log('  Cashier:  cashier1 / cashier123');
    } finally {
      await AppDataSource.destroy();
    }
  })().catch((err: unknown) => {
    console.error('MVP seed failed:', err);
    process.exit(1);
  });
}
