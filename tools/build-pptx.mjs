/**
 * build-pptx.mjs
 *
 * Reads manifest.json + PNG screenshots produced by capture.mjs and builds a
 * PowerPoint (.pptx) presentation.
 *
 * Usage:
 *   node build-pptx.mjs [--screenshots ./screenshots] [--out ./CANTEEN-DEMO.pptx] [--title "Canteen Manager"]
 *
 * Slide structure:
 *   Slide 1  — Cover / Title
 *   Slide 2  — Table of Contents (auto-generated from groups)
 *   Slides 3+ — One slide per group header (section divider)
 *               followed by one slide per screenshot in that group
 *   Last slide — Thank you / contacts
 */

import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const SCREENSHOTS_DIR = getArg('--screenshots', './screenshots');
const OUT_FILE        = getArg('--out',          './CANTEEN-DEMO.pptx');
const PRESENTATION_TITLE = getArg('--title', 'Phần mềm Quản lý Căn-teen Trại Giam');

// ─── Design tokens ───────────────────────────────────────────────────────────
const COLORS = {
  navy:      '1F3864',
  blue:      '2E74B5',
  lightBlue: 'DEEAF1',
  white:     'FFFFFF',
  offWhite:  'F5F7FA',
  dark:      '1A1A2E',
  gray:      '595959',
  lightGray: 'D9D9D9',
  accent:    'C00000',
  green:     '375623',
};

const FONT_TITLE  = 'Times New Roman';
const FONT_BODY   = 'Times New Roman';
// LAYOUT_WIDE = 12192000 × 6858000 EMU = 13.333... × 7.5 inches
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return true if a screenshot file exists for the given manifest entry.
 * @param {object} entry
 * @returns {boolean}
 */
function hasImage(entry) {
  if (!entry.file) return false;
  return fs.existsSync(path.join(SCREENSHOTS_DIR, entry.file));
}

/**
 * Get the absolute path to a screenshot.
 * @param {string} filename
 */
function imgPath(filename) {
  return path.resolve(path.join(SCREENSHOTS_DIR, filename));
}

/**
 * Add a consistent header bar to a slide.
 * @param {import('pptxgenjs').Slide} slide
 * @param {string} label  small label shown in the header
 */
function addHeader(slide, label = '') {
  const H = 0.55 / 7.5 * SLIDE_H;
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: H, fill: { color: COLORS.navy } });
  if (label) {
    slide.addText(label, {
      x: 0.3, y: 0.08 / 7.5 * SLIDE_H, w: SLIDE_W - 0.6, h: H - 0.08 / 7.5 * SLIDE_H,
      fontSize: 10, color: COLORS.lightBlue, fontFace: FONT_BODY, italic: true,
    });
  }
}

function addFooter(slide, note = '') {
  const h = 0.38 / 7.5 * SLIDE_H;
  slide.addShape('rect', { x: 0, y: SLIDE_H - h, w: SLIDE_W, h, fill: { color: COLORS.navy } });
  slide.addText(
    `Hệ thống Quản lý Căn-teen Trại Giam${note ? '   |   ' + note : ''}`,
    { x: 0.2, y: SLIDE_H - h + 0.03, w: SLIDE_W - 0.4, h: h - 0.03, fontSize: 8, color: COLORS.lightBlue, fontFace: FONT_BODY, align: 'center' },
  );
}

// ─── Slide builders ───────────────────────────────────────────────────────────

/**
 * Slide 1 — Cover.
 * @param {import('pptxgenjs').PptxGenJS} prs
 */
function buildCoverSlide(prs) {
  const slide = prs.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: COLORS.navy } });
  slide.addShape('rect', { x: 0, y: SLIDE_H * 0.67, w: SLIDE_W, h: SLIDE_H * 0.33, fill: { color: COLORS.blue }, transparency: 30 });
  slide.addShape('rect', { x: SLIDE_W * 0.045, y: SLIDE_H * 0.18, w: SLIDE_W * 0.006, h: SLIDE_H * 0.46, fill: { color: COLORS.accent } });

  slide.addText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
    x: SLIDE_W * 0.07, y: SLIDE_H * 0.12, w: SLIDE_W * 0.86, h: SLIDE_H * 0.1,
    fontSize: 14, bold: true, color: COLORS.white, fontFace: FONT_TITLE,
  });
  slide.addText('Độc lập – Tự do – Hạnh phúc', {
    x: SLIDE_W * 0.07, y: SLIDE_H * 0.22, w: SLIDE_W * 0.86, h: SLIDE_H * 0.08,
    fontSize: 12, italic: true, color: COLORS.lightBlue, fontFace: FONT_TITLE,
  });
  slide.addText(PRESENTATION_TITLE, {
    x: SLIDE_W * 0.07, y: SLIDE_H * 0.32, w: SLIDE_W * 0.86, h: SLIDE_H * 0.28,
    fontSize: 36, bold: true, color: COLORS.white, fontFace: FONT_TITLE, wrap: true,
  });
  slide.addText('Tài liệu Giới thiệu Chức năng – Phiên bản 1.0', {
    x: SLIDE_W * 0.07, y: SLIDE_H * 0.62, w: SLIDE_W * 0.86, h: SLIDE_H * 0.1,
    fontSize: 16, italic: true, color: COLORS.lightBlue, fontFace: FONT_BODY,
  });
  slide.addText('Tháng 9 năm 2026   |   BẢO MẬT NỘI BỘ', {
    x: SLIDE_W * 0.07, y: SLIDE_H * 0.73, w: SLIDE_W * 0.86, h: SLIDE_H * 0.08,
    fontSize: 12, color: COLORS.lightGray, fontFace: FONT_BODY,
  });
  addFooter(slide);
}

/**
 * Slide 2 — Table of Contents.
 * @param {import('pptxgenjs').PptxGenJS} prs
 * @param {Array<{group:string, items:object[]}>} groups
 */
function buildTocSlide(prs, groups) {
  const slide = prs.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: COLORS.offWhite } });
  addHeader(slide, 'Mục lục');

  const headerH = 0.55 / 7.5 * SLIDE_H;
  slide.addText('Nội dung Trình bày', {
    x: SLIDE_W * 0.04, y: headerH + SLIDE_H * 0.05, w: SLIDE_W * 0.92, h: SLIDE_H * 0.1,
    fontSize: 28, bold: true, color: COLORS.navy, fontFace: FONT_TITLE,
  });
  slide.addShape('line', {
    x: SLIDE_W * 0.04, y: headerH + SLIDE_H * 0.165, w: SLIDE_W * 0.92, h: 0,
    line: { color: COLORS.blue, width: 2 },
  });

  const itemsPerCol = Math.ceil(groups.length / 2);
  groups.forEach((g, i) => {
    const col = Math.floor(i / itemsPerCol);
    const row = i % itemsPerCol;
    const x   = col === 0 ? SLIDE_W * 0.04 : SLIDE_W * 0.52;
    const y   = headerH + SLIDE_H * 0.2 + row * (SLIDE_H * 0.62 / itemsPerCol);
    const bw  = SLIDE_W * 0.045;
    const bh  = bw;

    slide.addShape('ellipse', { x, y, w: bw, h: bh, fill: { color: COLORS.blue } });
    slide.addText(String(i + 1), {
      x, y, w: bw, h: bh,
      fontSize: 11, bold: true, color: COLORS.white, fontFace: FONT_BODY, align: 'center', valign: 'middle',
    });
    slide.addText(g.group, {
      x: x + bw + 0.1, y, w: SLIDE_W * 0.42, h: bh * 0.55,
      fontSize: 14, bold: true, color: COLORS.dark, fontFace: FONT_TITLE,
    });
    const screenList = g.items.map(s => s.title).join('  ·  ');
    slide.addText(screenList, {
      x: x + bw + 0.1, y: y + bh * 0.52, w: SLIDE_W * 0.42, h: bh * 0.48,
      fontSize: 9, color: COLORS.gray, fontFace: FONT_BODY,
    });
  });
  addFooter(slide);
}

function buildSectionSlide(prs, groupName, groupIndex, totalGroups) {
  const slide = prs.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: COLORS.blue } });
  slide.addText(`0${groupIndex}`, {
    x: SLIDE_W * 0.04, y: SLIDE_H * 0.05, w: SLIDE_W * 0.25, h: SLIDE_H * 0.55,
    fontSize: 120, bold: true, color: COLORS.white, fontFace: FONT_TITLE, transparency: 70,
  });
  slide.addShape('rect', { x: 0, y: SLIDE_H * 0.48, w: SLIDE_W * 0.008, h: SLIDE_H * 0.38, fill: { color: COLORS.accent } });
  slide.addText('Nhóm chức năng', {
    x: SLIDE_W * 0.025, y: SLIDE_H * 0.48, w: SLIDE_W * 0.9, h: SLIDE_H * 0.1,
    fontSize: 13, color: COLORS.lightBlue, fontFace: FONT_BODY, italic: true,
  });
  slide.addText(groupName, {
    x: SLIDE_W * 0.025, y: SLIDE_H * 0.58, w: SLIDE_W * 0.9, h: SLIDE_H * 0.28,
    fontSize: 40, bold: true, color: COLORS.white, fontFace: FONT_TITLE,
  });
  slide.addText(`${groupIndex} / ${totalGroups}`, {
    x: SLIDE_W * 0.88, y: SLIDE_H * 0.86, w: SLIDE_W * 0.1, h: SLIDE_H * 0.08,
    fontSize: 11, color: COLORS.lightBlue, fontFace: FONT_BODY, align: 'right',
  });
  addFooter(slide);
}

/**
 * Feature slide — full-bleed screenshot layout.
 *
 * The screenshot fills the entire slide (10 × 5.63 in).
 * A semi-transparent navy bar at the bottom carries the title, description,
 * route badge and bullet points — overlaid on top of the image so nothing
 * is cropped or shrunk.
 *
 * @param {import('pptxgenjs').PptxGenJS} prs
 * @param {object} entry   manifest entry
 * @param {boolean} hasImg  whether the PNG file exists
 */
function buildFeatureSlide(prs, entry, hasImg) {
  const slide = prs.addSlide();

  // ── Full-bleed screenshot ──────────────────────────────────────────────────
  if (hasImg) {
    slide.addImage({
      path: imgPath(entry.file),
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      sizing: { type: 'cover', w: SLIDE_W, h: SLIDE_H },
    });
  } else {
    slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: COLORS.offWhite } });
    slide.addText('(Màn hình chưa được chụp)', {
      x: 1, y: 2.2, w: 8, h: 1, fontSize: 16, italic: true,
      color: COLORS.lightGray, fontFace: FONT_BODY, align: 'center',
    });
  }

  // ── Overlay: thin top label bar ────────────────────────────────────────────
  const topH = SLIDE_H * 0.075;
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: topH, fill: { color: COLORS.navy, transparency: 15 } });
  slide.addText(`${entry.group}  ›  ${entry.title}`, {
    x: SLIDE_W * 0.015, y: topH * 0.1, w: SLIDE_W * 0.97, h: topH * 0.8,
    fontSize: 12, bold: true, color: COLORS.white, fontFace: FONT_TITLE,
  });

  // ── Overlay: bottom info panel ─────────────────────────────────────────────
  const PANEL_H = SLIDE_H * 0.27;
  const panelY  = SLIDE_H - PANEL_H;

  slide.addShape('rect', { x: 0, y: panelY, w: SLIDE_W, h: PANEL_H, fill: { color: '000000', transparency: 28 } });

  const leftW  = SLIDE_W * 0.62;
  const padX   = SLIDE_W * 0.018;
  const padY   = PANEL_H * 0.06;
  const descH  = PANEL_H * 0.52;
  const routeH = PANEL_H * 0.22;

  slide.addText(entry.description || '', {
    x: padX, y: panelY + padY, w: leftW - padX, h: descH,
    fontSize: 11, color: COLORS.white, fontFace: FONT_BODY, wrap: true, valign: 'top',
  });

  slide.addShape('rect', {
    x: padX, y: panelY + padY + descH + PANEL_H * 0.03,
    w: leftW - padX * 2, h: routeH,
    fill: { color: COLORS.navy, transparency: 20 }, rounding: '0.04',
  });
  slide.addText(entry.path, {
    x: padX * 1.5, y: panelY + padY + descH + PANEL_H * 0.04,
    w: leftW - padX * 3, h: routeH,
    fontSize: 10, color: COLORS.lightBlue, fontFace: 'Courier New',
  });

  const bullets = getBullets(entry.id);
  const rxStart = leftW + SLIDE_W * 0.02;
  const rxW     = SLIDE_W - rxStart - SLIDE_W * 0.015;
  const lineH   = PANEL_H * 0.28;
  bullets.slice(0, 3).forEach((b, i) => {
    slide.addText(`▸ ${b}`, {
      x: rxStart, y: panelY + padY + i * lineH, w: rxW, h: lineH,
      fontSize: 10.5, color: COLORS.lightBlue, fontFace: FONT_BODY, wrap: true, valign: 'middle',
    });
  });
}

/**
 * Architecture overview slide (text-only).
 * @param {import('pptxgenjs').PptxGenJS} prs
 */
function buildArchSlide(prs) {
  const slide = prs.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: COLORS.offWhite } });
  addHeader(slide, 'Kiến trúc hệ thống');

  const headerH = 0.55 / 7.5 * SLIDE_H;
  slide.addText('Kiến trúc Tổng thể Hệ thống', {
    x: SLIDE_W * 0.03, y: headerH + SLIDE_H * 0.04, w: SLIDE_W * 0.94, h: SLIDE_H * 0.1,
    fontSize: 26, bold: true, color: COLORS.navy, fontFace: FONT_TITLE,
  });
  slide.addShape('line', {
    x: SLIDE_W * 0.03, y: headerH + SLIDE_H * 0.155, w: SLIDE_W * 0.94, h: 0,
    line: { color: COLORS.blue, width: 2 },
  });

  const colW = SLIDE_W / 4.4;
  const boxW = colW * 0.88;
  const boxH = SLIDE_H * 0.19;
  const cols = [SLIDE_W*0.03, SLIDE_W*0.27, SLIDE_W*0.51, SLIDE_W*0.75];
  const row1Y = headerH + SLIDE_H * 0.19;
  const row2Y = row1Y + boxH + SLIDE_H * 0.1;

  const components = [
    { col:0, row:0, label:'Frontend\n(React + Nginx)', port:':8080', color: COLORS.blue },
    { col:1, row:0, label:'Backend\n(NestJS)', port:':3000', color: COLORS.navy },
    { col:2, row:0, label:'PostgreSQL 16', port:':5432', color: COLORS.green },
    { col:3, row:0, label:'OMR Service\n(Python/ONNX)', port:':8000', color: COLORS.blue },
    { col:0, row:1, label:'Order Scanner\n(PaddleOCR)', port:'Systemd', color: COLORS.accent },
    { col:1, row:1, label:'Scan Agent\n(File bridge)', port:'Docker', color: COLORS.gray },
    { col:2, row:1, label:'Electron App\n(Windows)', port:'Desktop', color: COLORS.navy },
    { col:3, row:1, label:'Samba Share\n(Scanner HW)', port:':445', color: COLORS.gray },
  ];

  components.forEach(c => {
    const cx = cols[c.col];
    const cy = c.row === 0 ? row1Y : row2Y;
    slide.addShape('rect', { x: cx, y: cy, w: boxW, h: boxH, fill: { color: c.color }, rounding: '0.08' });
    slide.addText(c.label, {
      x: cx + 0.05, y: cy + 0.04, w: boxW - 0.1, h: boxH * 0.7,
      fontSize: 10, bold: true, color: COLORS.white, fontFace: FONT_BODY, align: 'center', valign: 'middle',
    });
    slide.addText(c.port, {
      x: cx + 0.05, y: cy + boxH * 0.72, w: boxW - 0.1, h: boxH * 0.25,
      fontSize: 9, color: COLORS.white, fontFace: 'Courier New', align: 'center', italic: true,
    });
  });

  // Arrows row 1
  for (let i = 0; i < 3; i++) {
    slide.addShape('line', {
      x: cols[i] + boxW, y: row1Y + boxH / 2, w: cols[i+1] - (cols[i] + boxW), h: 0,
      line: { color: COLORS.blue, width: 1.5, endArrowType: 'arrow' },
    });
  }

  slide.addText('⚡ Triển khai hoàn toàn cách ly mạng (air-gapped) — không kết nối Internet', {
    x: SLIDE_W * 0.03, y: row2Y + boxH + SLIDE_H * 0.03, w: SLIDE_W * 0.94, h: SLIDE_H * 0.07,
    fontSize: 11, italic: true, color: COLORS.accent, fontFace: FONT_BODY, align: 'center',
  });

  addFooter(slide, 'Kiến trúc hệ thống');
}

/**
 * Return up to 3 short bullet points for a given screen ID.
 * @param {string} id
 * @returns {string[]}
 */
function getBullets(id) {
  const map = {
    'login':                    ['JWT HS256, hiệu lực 12 giờ', 'Tự động đăng xuất khi token hết hạn (401)', 'Mã hóa mật khẩu bcrypt'],
    'app-shell':                ['Sidebar phân nhóm: Vận hành & Cài đặt', 'Phân vùng theo khu vực phụ trách (Zone Scoping)', 'Đa ngôn ngữ Tiếng Việt / English'],
    'dashboard':                ['Thống kê đơn hàng theo ngày', 'Trạng thái hàng đợi phiếu quét', 'Hoạt động gần nhất của cán bộ'],
    'orders':                   ['Lọc: ngày, khu vực, trạng thái, mã phạm nhân', 'Luồng trạng thái: PENDING → PAID / REJECTED', 'In phiếu đặt hàng từng đơn hoặc theo lô'],
    'kitchen-summary':          ['Tổng hợp số lượng từng mặt hàng', 'Lọc theo ngày lĩnh hàng (collection date)', 'Phục vụ bộ phận bếp / kho chuẩn bị hàng'],
    'counter-empty':            ['Ô tìm kiếm phạm nhân theo mã lưu ký', 'Hàng đợi PENDING hiển thị phía dưới', 'Giao diện quầy thu ngân & nạp tiền'],
    'counter-lookup':           ['Tra cứu mã 100023 → hiển thị hồ sơ đầy đủ', 'Thấy số dư tài khoản và lịch sử giao dịch', 'Form nạp tiền và đặt hàng hộ phạm nhân'],
    'counter-pending-queue':    ['Danh sách đơn PENDING chờ duyệt', 'Duyệt (Accept): chọn thanh toán tiền mặt / số dư', 'Từ chối (Reject): nhập lý do, chuyển → REJECTED'],
    'counter-prisoner-loaded':  ['Hồ sơ phạm nhân: tên, buồng, khu vực', 'Số dư tài khoản và nhật ký giao dịch', 'Cán bộ đặt hàng hộ hoặc nạp tiền tài khoản'],
    'menu-config':              ['CRUD mặt hàng: tên, giá, mã, trạng thái', 'Phiên bản danh mục ký SHA-256', 'Đồng bộ tự động với máy quét OCR'],
    'audit':                    ['Sổ cái bất biến (insert-only ledger)', 'Lịch sử đầy đủ debit / credit, không thể sửa', 'Tra cứu theo phạm nhân, ngày, loại giao dịch'],
    'payment-config':           ['Bật / tắt thanh toán ngân hàng toàn hệ thống', 'Cấu hình tài khoản ngân hàng căng-tin', 'Thanh toán tiền mặt luôn được kích hoạt'],
    'vouchers':                 ['Tổng hợp đơn đã thanh toán theo ngày lĩnh', 'Ảnh chụp số dư tại thời điểm tạo voucher', 'In phiếu giao hàng chuẩn cho cán bộ kho ký nhận'],
    'operators':                ['CRUD tài khoản cán bộ', 'Gán vai trò ADMIN / OPERATOR / CASHIER', 'Phân khu vực phụ trách, nhật ký thao tác'],
    'prisoner-list':            ['Tra cứu theo mã lưu ký hoặc buồng giam', 'Tình trạng: tạm giam / chấp hành án', 'Đồng bộ từ hệ thống SQL Server 2005 (tùy chọn)'],
    'kiosk-entry':              ['Màn hình công cộng — không cần đăng nhập', 'Thân nhân nhập mã lưu ký của phạm nhân', 'Tự reset sau 60 giây không hoạt động'],
    'kiosk-keypad-filled':      ['Bàn phím số nhập 6 chữ số mã lưu ký', 'Nút xóa từng chữ số hoặc xóa toàn bộ', 'Nhấn Xác nhận để tra cứu phạm nhân'],
    'kiosk-menu':               ['Xác minh danh tính: tên, buồng, khu vực', 'Danh mục hàng hóa với giá niêm yết', 'Chọn số lượng — tổng tiền tự động cập nhật'],
    'kiosk-menu-selected':      ['Đã chọn: Mì tôm × 2, Cá hộp × 1', 'Kiểm tra số dư tài khoản trước khi đặt', 'Xác nhận → mã xác nhận in cho thu ngân'],
  };
  return map[id] || [];
}

/**
 * Final "Thank you" slide.
 * @param {import('pptxgenjs').PptxGenJS} prs
 */
function buildEndSlide(prs) {
  const slide = prs.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: COLORS.navy } });
  slide.addShape('rect', { x: 0, y: SLIDE_H * 0.6, w: SLIDE_W, h: SLIDE_H * 0.4, fill: { color: COLORS.blue }, transparency: 40 });
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W * 0.009, h: SLIDE_H, fill: { color: COLORS.accent } });

  slide.addText('Cảm ơn quý vị đã theo dõi', {
    x: SLIDE_W * 0.04, y: SLIDE_H * 0.22, w: SLIDE_W * 0.92, h: SLIDE_H * 0.18,
    fontSize: 40, bold: true, color: COLORS.white, fontFace: FONT_TITLE, align: 'center',
  });
  slide.addText(PRESENTATION_TITLE, {
    x: SLIDE_W * 0.04, y: SLIDE_H * 0.42, w: SLIDE_W * 0.92, h: SLIDE_H * 0.12,
    fontSize: 18, italic: true, color: COLORS.lightBlue, fontFace: FONT_BODY, align: 'center',
  });
  slide.addShape('line', {
    x: SLIDE_W * 0.2, y: SLIDE_H * 0.57, w: SLIDE_W * 0.6, h: 0,
    line: { color: COLORS.blue, width: 1.5 },
  });
  slide.addText('Tài liệu mang tính bảo mật nội bộ.\nNghiêm cấm sao chép, phát tán khi chưa được phép.', {
    x: SLIDE_W * 0.04, y: SLIDE_H * 0.62, w: SLIDE_W * 0.92, h: SLIDE_H * 0.15,
    fontSize: 11, color: COLORS.lightGray, fontFace: FONT_BODY, align: 'center',
  });
  addFooter(slide);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Load manifest
  const manifestPath = path.join(SCREENSHOTS_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`✗ Manifest not found: ${manifestPath}`);
    console.error('  Run capture.mjs first to take screenshots.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Group entries by their group field, preserving order
  const groupMap = new Map();
  for (const entry of manifest) {
    if (!groupMap.has(entry.group)) groupMap.set(entry.group, []);
    groupMap.get(entry.group).push(entry);
  }
  const groups = [...groupMap.entries()].map(([group, items]) => ({ group, items }));

  console.log(`\nBuilding PowerPoint presentation`);
  console.log(`  Screenshots : ${path.resolve(SCREENSHOTS_DIR)}`);
  console.log(`  Output      : ${path.resolve(OUT_FILE)}`);
  console.log(`  Slides      : ${2 + groups.length * 2 + manifest.length + 2} (approx)\n`);

  const prs = new PptxGenJS();

  // LAYOUT_WIDE = 13.333 × 7.5 inches — must match SLIDE_W/SLIDE_H constants above
  prs.layout    = 'LAYOUT_WIDE';
  prs.author    = 'Bộ Công An – Cục Quản lý Trại Giam';
  prs.company   = 'Canteen Management System';
  prs.subject   = 'Tài liệu Giới thiệu Chức năng';
  prs.title     = PRESENTATION_TITLE;
  prs.revision  = '1';

  // Slide 1 — Cover
  buildCoverSlide(prs);

  // Slide 2 — TOC
  buildTocSlide(prs, groups);

  // Slide 3 — Architecture
  buildArchSlide(prs);

  // Slides per group
  let groupIdx = 1;
  for (const { group, items } of groups) {
    buildSectionSlide(prs, group, groupIdx++, groups.length);
    for (const entry of items) {
      buildFeatureSlide(prs, entry, hasImage(entry));
    }
  }

  // Final slide
  buildEndSlide(prs);

  // Write output
  await prs.writeFile({ fileName: path.resolve(OUT_FILE) });

  const stat = fs.statSync(path.resolve(OUT_FILE));
  console.log(`✔ Presentation saved: ${path.resolve(OUT_FILE)}`);
  console.log(`  File size: ${(stat.size / 1024).toFixed(1)} KB\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
