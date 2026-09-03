// Vietnamese strings for the admin "canteen bank account" config page.
// Keep en/paymentConfig.ts key-for-key in sync — locale-parity.test.ts enforces it.
const paymentConfig = {
  pageTitle: 'Tài khoản ngân hàng căng-tin',
  pageSubtitle: 'Tài khoản nhận chuyển khoản, hiển thị dưới dạng mã QR tại kiosk.',

  // Configured-status chip
  configured: 'Đã cấu hình',
  notConfigured: 'Chưa cấu hình',

  // Form fields
  bankBinLabel: 'Mã ngân hàng (BIN)',
  bankBinHelp: '6 chữ số, thuộc danh sách thành viên NAPAS.',
  accountNumberLabel: 'Số tài khoản',
  accountNumberHelp: '6–19 chữ số. Nhập lại đầy đủ để thay đổi.',
  currentMasked: 'Hiện tại: {{value}}',
  accountNameLabel: 'Tên chủ tài khoản',
  accountNameHelp: 'Sẽ được chuyển sang chữ không dấu khi lưu.',

  // Actions
  save: 'Lưu',
  saving: 'Đang lưu…',
  saveSuccess: 'Đã lưu tài khoản ngân hàng.',

  // Loading / errors
  loadError: 'Không thể tải cấu hình tài khoản.',
  saveError: 'Không thể lưu. Vui lòng kiểm tra lại.',
  errorBinFormat: 'Mã ngân hàng phải gồm 6 chữ số.',
  errorAccountNumber: 'Số tài khoản phải gồm 6–19 chữ số.',
  errorAccountName: 'Vui lòng nhập tên chủ tài khoản (tối đa 140 ký tự).',
} as const;

export default paymentConfig;
