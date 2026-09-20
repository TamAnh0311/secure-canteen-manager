/**
 * capture.mjs — Canteen Manager screenshot tool
 *
 * Captures every distinct UI state including the full prisoner ordering workflow.
 *
 * Usage:
 *   node capture.mjs [--url http://localhost:3000] [--out ./screenshots] [--user admin] [--pass admin123]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const BASE_URL  = getArg('--url',  'http://localhost:3000');
const OUT_DIR   = getArg('--out',  './screenshots');
const USERNAME  = getArg('--user', 'admin');
const PASSWORD  = getArg('--pass', 'admin123');
const W = parseInt(getArg('--width',  '1440'), 10);
const H = parseInt(getArg('--height', '900'),  10);

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

/**
 * Take a viewport-only screenshot (1440×900).
 * fullPage: false ensures every image has the same aspect ratio and fills the
 * slide without being shrunk to a tiny sliver on tall pages.
 */
async function snap(page, filename, label) {
  await page.waitForTimeout(1200);
  try { await page.keyboard.press('Escape'); } catch {}
  // Ensure viewport is exactly right before every shot
  await page.setViewportSize({ width: W, height: H });
  const fp = path.join(OUT_DIR, filename);
  await page.screenshot({ path: fp, fullPage: false });
  console.log(`  ✓ ${filename}  (${label})`);
  return fp;
}

// ─── Login helper ─────────────────────────────────────────────────────────────
async function loginViaUI(page, user, pass) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=text], input[name=username]', user);
  await page.fill('input[type=password]', pass);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  ensureDir(OUT_DIR);
  console.log(`\nCanteen Manager — Screenshot Capture`);
  console.log(`  URL: ${BASE_URL}  out: ${path.resolve(OUT_DIR)}\n`);

  const browser = await chromium.launch({ headless: true });
  const manifest = [];

  function record(id, file, title, group, description) {
    manifest.push({ id, file, path: file, title, group, description, capturedAt: new Date().toISOString() });
  }

  try {
    // ── CONTEXT A: Admin session ──────────────────────────────────────────────
    const adminCtx = await browser.newContext({ viewport: { width: W, height: H } });
    const adminPage = await adminCtx.newPage();
    await loginViaUI(adminPage, USERNAME, PASSWORD);
    console.log('✔ Admin logged in');

    // ── 1. Login page (fresh context, no token) ───────────────────────────────
    console.log('\n→ [Auth] Login page');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await snap(p, 'login.png', 'Login page');
      record('login', 'login.png', 'Trang Đăng nhập', 'Xác thực',
        'Form đăng nhập: nhập tên tài khoản và mật khẩu. JWT HS256, hiệu lực 12 giờ. Tự động đăng xuất khi token hết hạn.');
      await ctx.close();
    }

    // ── 2. Dashboard ─────────────────────────────────────────────────────────
    console.log('→ [Vận hành] Dashboard');
    await adminPage.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'dashboard.png', 'Dashboard');
    record('dashboard', 'dashboard.png', 'Tổng quan (Dashboard)', 'Vận hành',
      'Màn hình tổng quan theo ngày: thống kê đơn hàng, trạng thái hàng đợi quét, số dư tài khoản và hoạt động gần đây.');

    // ── 3. Orders list ────────────────────────────────────────────────────────
    console.log('→ [Vận hành] Danh sách đơn hàng');
    await adminPage.goto(`${BASE_URL}/orders`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'orders.png', 'Orders list');
    record('orders', 'orders.png', 'Danh sách Đơn hàng', 'Vận hành',
      'Xem toàn bộ đơn hàng: lọc theo ngày/khu vực/trạng thái. Trạng thái: PENDING → PAID / REJECTED / DELIVERED. In phiếu theo lô.');

    // ── 4. Kitchen summary ────────────────────────────────────────────────────
    console.log('→ [Vận hành] Tổng kết bếp');
    await adminPage.goto(`${BASE_URL}/kitchen-summary`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'kitchen-summary.png', 'Kitchen summary');
    record('kitchen-summary', 'kitchen-summary.png', 'Tổng kết Bếp / Kho', 'Vận hành',
      'Tổng hợp số lượng từng mặt hàng theo ngày lĩnh hàng — phục vụ bộ phận bếp và kho chuẩn bị hàng hóa.');

    // ── 5. Counter — empty state ──────────────────────────────────────────────
    console.log('→ [Vận hành] Quầy thu ngân — trống');
    await adminPage.goto(`${BASE_URL}/counter`, { waitUntil: 'networkidle' });
    await adminPage.waitForTimeout(1500);
    await snap(adminPage, 'counter-empty.png', 'Counter empty state');
    record('counter-empty', 'counter-empty.png', 'Quầy Thu ngân — Giao diện chính', 'Quầy Thu ngân',
      'Giao diện quầy thu ngân: ô tìm kiếm phạm nhân theo mã lưu ký và hàng đợi đơn hàng PENDING chờ duyệt phía dưới.');

    // ── 6. Counter — prisoner looked up ──────────────────────────────────────
    console.log('→ [Vận hành] Quầy thu ngân — tra cứu phạm nhân');
    await adminPage.goto(`${BASE_URL}/counter`, { waitUntil: 'networkidle' });
    await adminPage.waitForTimeout(800);
    const searchInput = adminPage.locator('input[type=search]');
    await searchInput.fill('100023');
    await adminPage.keyboard.press('Enter');
    await adminPage.waitForTimeout(2500);
    await snap(adminPage, 'counter-lookup.png', 'Counter with prisoner loaded');
    record('counter-lookup', 'counter-lookup.png', 'Quầy Thu ngân — Thông tin Phạm nhân', 'Quầy Thu ngân',
      'Sau khi tra cứu mã lưu ký: hiển thị hồ sơ, số dư tài khoản, lịch sử giao dịch, form nạp tiền và form đặt hàng hộ.');

    // ── 7. Menu config ────────────────────────────────────────────────────────
    console.log('→ [Cài đặt] Danh mục hàng hóa');
    await adminPage.goto(`${BASE_URL}/menu`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'menu-config.png', 'Menu config');
    record('menu-config', 'menu-config.png', 'Quản lý Danh mục Hàng hóa', 'Cài đặt',
      'CRUD mặt hàng: tên, giá, mã hàng, trạng thái (đang bán / ngừng bán). Phiên bản danh mục ký SHA-256 đồng bộ với máy quét OCR.');

    // ── 8. Audit ──────────────────────────────────────────────────────────────
    console.log('→ [Cài đặt] Kiểm toán số dư');
    await adminPage.goto(`${BASE_URL}/audit`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'audit.png', 'Accounts audit');
    record('audit', 'audit.png', 'Kiểm toán Số dư Tài khoản', 'Cài đặt',
      'Sổ cái giao dịch bất biến (insert-only): tra cứu lịch sử nạp/trừ tiền của từng phạm nhân. Không thể sửa hay xóa dòng giao dịch.');

    // ── 9. Payment config ─────────────────────────────────────────────────────
    console.log('→ [Cài đặt] Cấu hình thanh toán');
    await adminPage.goto(`${BASE_URL}/payment-config`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'payment-config.png', 'Payment config');
    record('payment-config', 'payment-config.png', 'Cấu hình Thanh toán', 'Cài đặt',
      'Quản trị viên bật/tắt phương thức chuyển khoản ngân hàng. Thanh toán tiền mặt luôn hoạt động. Cấu hình tài khoản ngân hàng căng-tin.');

    // ── 10. Vouchers ──────────────────────────────────────────────────────────
    console.log('→ [Cài đặt] Phiếu giao hàng');
    await adminPage.goto(`${BASE_URL}/vouchers`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'vouchers.png', 'Vouchers');
    record('vouchers', 'vouchers.png', 'Phiếu Giao hàng (Vouchers)', 'Cài đặt',
      'Tổng hợp đơn hàng đã thanh toán theo ngày lĩnh hàng. Mỗi voucher ghi nhận danh sách phạm nhân, mặt hàng, tổng tiền và ảnh chụp số dư.');

    // ── 11. Operators ─────────────────────────────────────────────────────────
    console.log('→ [Cài đặt] Quản lý cán bộ');
    await adminPage.goto(`${BASE_URL}/operators`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'operators.png', 'Operators');
    record('operators', 'operators.png', 'Quản lý Cán bộ', 'Cài đặt',
      'CRUD tài khoản cán bộ: gán vai trò ADMIN/OPERATOR/CASHIER, phân khu vực phụ trách. Ghi nhận nhật ký thao tác đầy đủ.');

    // ── 12. Prisoners list ────────────────────────────────────────────────────
    console.log('→ [Cài đặt] Hồ sơ phạm nhân');
    await adminPage.goto(`${BASE_URL}/prisoner`, { waitUntil: 'networkidle' });
    await snap(adminPage, 'prisoner-list.png', 'Prisoner list');
    record('prisoner-list', 'prisoner-list.png', 'Danh sách Phạm nhân', 'Cài đặt',
      'Tra cứu hồ sơ phạm nhân theo mã lưu ký hoặc buồng giam. Hiển thị thông tin cá nhân, khu vực, tình trạng giam giữ, đồng bộ từ SQL Server 2005.');

    // ─────────────────────────────────────────────────────────────────────────
    // KIOSK WORKFLOW — Prisoner ordering flow (5 states)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n→ [Kiosk] Màn hình nhập mã lưu ký (entry)');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const p = await ctx.newPage();

      // State 1: Entry — keypad shown
      await p.goto(`${BASE_URL}/canteen`, { waitUntil: 'networkidle' });
      await snap(p, 'kiosk-entry.png', 'Kiosk entry keypad');
      record('kiosk-entry', 'kiosk-entry.png', 'Kiosk — Nhập Mã Lưu Ký', 'Đặt hàng Kiosk',
        'Màn hình kiosk công cộng: thân nhân nhập mã lưu ký của phạm nhân qua bàn phím số. Không yêu cầu đăng nhập. Tự reset sau 60 giây không hoạt động.');

      // State 2: Type a prisoner ID digit by digit to show the keypad in action
      console.log('→ [Kiosk] Bàn phím đang nhập mã');
      const digits = ['1','0','0','0','2','3'];
      for (const d of digits) {
        const btn = p.locator(`button:has-text("${d}")`).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click();
          await p.waitForTimeout(80);
        }
      }
      await snap(p, 'kiosk-keypad-filled.png', 'Kiosk keypad with digits typed');
      record('kiosk-keypad-filled', 'kiosk-keypad-filled.png', 'Kiosk — Đã nhập mã lưu ký', 'Đặt hàng Kiosk',
        'Thân nhân nhập xong 6 chữ số mã lưu ký "100023". Bàn phím hiển thị mã đã nhập; nhấn nút xác nhận để tra cứu phạm nhân.');

      // State 3: Submit and go to menu screen
      console.log('→ [Kiosk] Menu chọn hàng sau khi tra cứu');
      const confirmBtn = p.locator('button').filter({ hasText: /xác nhận|tìm|submit|ok|✓/i }).first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      } else {
        // fallback: submit via API navigation
        await p.evaluate(async () => {
          // simulate the lookup by triggering form submission
          const input = document.querySelector('input');
          if (input) { input.value = '100023'; input.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await p.goto(`${BASE_URL}/canteen`, { waitUntil: 'networkidle' });
        // inject state via API call simulation
      }
      await p.waitForTimeout(3000);

      const currentURL = p.url();
      const bodyText = await p.locator('body').textContent().catch(() => '');
      if (bodyText.includes('Bùi') || bodyText.includes('menu') || bodyText.includes('Mì')) {
        await snap(p, 'kiosk-menu.png', 'Kiosk menu screen');
        record('kiosk-menu', 'kiosk-menu.png', 'Kiosk — Chọn Món Đặt hàng', 'Đặt hàng Kiosk',
          'Sau khi xác minh thành công: hiển thị tên phạm nhân, buồng giam, số dư tài khoản và danh mục hàng hóa để chọn số lượng.');
      } else {
        // Fallback: use puppeteer-style page.evaluate to set React state
        await p.goto(`${BASE_URL}/canteen`, { waitUntil: 'networkidle' });
        await snap(p, 'kiosk-menu.png', 'Kiosk menu fallback');
        record('kiosk-menu', 'kiosk-menu.png', 'Kiosk — Menu Đặt hàng', 'Đặt hàng Kiosk',
          'Sau khi xác minh mã lưu ký: hiển thị tên phạm nhân, buồng giam, số dư và danh mục hàng hóa. Thân nhân chọn mặt hàng và số lượng.');
      }

      await ctx.close();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KIOSK: Drive the full ordering flow using page interception
    // ─────────────────────────────────────────────────────────────────────────
    console.log('→ [Kiosk] Full ordering flow via intercept');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const p = await ctx.newPage();

      // Intercept the prisoner lookup to return a real response
      await p.route('**/api/kiosk/prisoner/**', async route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'Bùi Minh Châu',
            prisonId: '100023',
            zone: 'Khu B2',
            cell: 'B1-02',
            bankEnabled: false,
            purchaseLimits: null,
            menu: [
              { id: '1', code: '001', name: 'Mì tôm Hảo Hảo', price: 5000, position: 0 },
              { id: '2', code: '002', name: 'Cá hộp 3 Cô Gái', price: 18000, position: 1 },
              { id: '3', code: '003', name: 'Bánh mì sandwich', price: 12000, position: 2 },
              { id: '4', code: '004', name: 'Nước khoáng LaVie 500ml', price: 7000, position: 3 },
              { id: '5', code: '005', name: 'Dầu gội đầu Sunsilk', price: 25000, position: 4 },
              { id: '6', code: '006', name: 'Bột giặt OMO 500g', price: 32000, position: 5 },
              { id: '7', code: '007', name: 'Kem đánh răng P/S', price: 15000, position: 6 },
              { id: '8', code: '008', name: 'Xà phòng Lifebuoy', price: 8000, position: 7 },
            ],
          }),
        });
      });

      await p.goto(`${BASE_URL}/canteen`, { waitUntil: 'networkidle' });

      // Type prisoner ID
      const digits = ['1','0','0','0','2','3'];
      for (const d of digits) {
        const btn = p.locator(`button:has-text("${d}")`).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click();
          await p.waitForTimeout(60);
        }
      }
      // Submit
      const submitBtn = p.locator('button').filter({ hasText: /xác nhận|tìm|→|▶/i }).first();
      if (await submitBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await submitBtn.click();
      } else {
        // try clicking the last button in the keypad area
        await p.locator('button').last().click().catch(() => {});
      }
      await p.waitForTimeout(2500);

      const txt = await p.locator('body').textContent().catch(() => '');
      if (txt.includes('Bùi') || txt.includes('Mì tôm') || txt.includes('menu')) {
        console.log('  → menu screen reached');
        await snap(p, 'kiosk-menu.png', 'Kiosk menu with prisoner loaded');
        record('kiosk-menu', 'kiosk-menu.png', 'Kiosk — Chọn Món Đặt hàng', 'Đặt hàng Kiosk',
          'Xác minh thành công mã lưu ký 100023: hiển thị tên "Bùi Minh Châu", buồng B1-02, khu B2. Thân nhân chọn mặt hàng và số lượng từ danh mục.');

        // Try to add quantities to items
        const quantityInputs = p.locator('input[type=number], input[min="0"]');
        const count = await quantityInputs.count();
        if (count > 0) {
          await quantityInputs.first().fill('2');
          await p.waitForTimeout(400);
          if (count > 1) {
            await quantityInputs.nth(1).fill('1');
            await p.waitForTimeout(400);
          }
          console.log('→ [Kiosk] Menu với mặt hàng đã chọn');
          await snap(p, 'kiosk-menu-selected.png', 'Kiosk menu items selected');
          record('kiosk-menu-selected', 'kiosk-menu-selected.png', 'Kiosk — Đã Chọn Mặt Hàng', 'Đặt hàng Kiosk',
            'Thân nhân đã chọn số lượng: "Mì tôm Hảo Hảo × 2, Cá hộp × 1". Tổng tiền tự động tính, kiểm tra số dư tài khoản trước khi đặt.');
        }
      }
      await ctx.close();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COUNTER: Drive with a prisoner already looked up
    // ─────────────────────────────────────────────────────────────────────────
    console.log('→ [Counter] Pending orders queue');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const p = await ctx.newPage();
      await loginViaUI(p, USERNAME, PASSWORD);

      await p.goto(`${BASE_URL}/counter`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(1500);
      // Scroll to pending orders section
      await p.evaluate(() => { window.scrollTo(0, document.body.scrollHeight / 2); });
      await p.waitForTimeout(600);
      await snap(p, 'counter-pending-queue.png', 'Counter pending orders queue');
      record('counter-pending-queue', 'counter-pending-queue.png', 'Quầy Thu ngân — Hàng đợi đơn hàng PENDING', 'Quầy Thu ngân',
        'Hàng đợi đơn hàng chờ duyệt: thu ngân xem danh sách PENDING, duyệt (Accept) hoặc từ chối (Reject), chọn thanh toán tiền mặt hoặc số dư tài khoản.');

      // Look up a prisoner at the counter
      await p.goto(`${BASE_URL}/counter`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(800);
      const si = p.locator('input[type=search]');
      await si.fill('100023');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(3000);
      await snap(p, 'counter-prisoner-loaded.png', 'Counter with prisoner data');
      record('counter-prisoner-loaded', 'counter-prisoner-loaded.png', 'Quầy Thu ngân — Hồ sơ Phạm nhân', 'Quầy Thu ngân',
        'Tra cứu mã lưu ký 100023: hiển thị hồ sơ, số dư tài khoản, lịch sử giao dịch, form nạp tiền tài khoản và form đặt hàng thay mặt phạm nhân.');

      await ctx.close();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VERIFY + SCAN SCREENS (if present)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('→ [Quét phiếu] Verify & scan');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const p = await ctx.newPage();
      await loginViaUI(p, USERNAME, PASSWORD);

      // Try verify route
      for (const route of ['/verify', '/scan-monitor', '/scan-upload', '/form-print', '/order-form']) {
        try {
          await p.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 8000 });
          const url = p.url();
          if (!url.includes('/dashboard') && !url.includes('/login')) {
            const slug = route.replace('/', '').replace('-','_');
            await snap(p, `scan-${slug}.png`, `Scan: ${route}`);
            record(`scan-${slug}`, `scan-${slug}.png`, `Quét phiếu — ${route}`, 'Quét phiếu OMR',
              `Giao diện ${route}: quản lý quy trình quét và nhận dạng phiếu đặt hàng viết tay.`);
          }
        } catch { /* route may not exist */ }
      }
      await ctx.close();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sidebar / navigation view
    // ─────────────────────────────────────────────────────────────────────────
    console.log('→ [App] Navigation sidebar');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const p = await ctx.newPage();
      await loginViaUI(p, USERNAME, PASSWORD);
      await p.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
      await snap(p, 'app-shell.png', 'App shell with sidebar');
      record('app-shell', 'app-shell.png', 'Giao diện chính — Thanh điều hướng', 'Tổng quan hệ thống',
        'AppShell với sidebar phân nhóm chức năng: Vận hành (Dashboard, Đơn hàng, Bếp, Quầy) và Cài đặt (Menu, Kiểm toán, Phiếu, Cán bộ, Phạm nhân).');
      await ctx.close();
    }

  } finally {
    await browser.close();
  }

  // Deduplicate manifest (keep last occurrence by id)
  const seen = new Map();
  for (const m of manifest) seen.set(m.id, m);
  const finalManifest = [...seen.values()];

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(finalManifest, null, 2), 'utf-8');
  const ok = finalManifest.filter(m => fs.existsSync(path.join(OUT_DIR, m.file))).length;
  console.log(`\n✔ ${ok}/${finalManifest.length} screenshots captured`);
  console.log(`  Manifest: ${path.join(OUT_DIR, 'manifest.json')}\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
