// Vietnamese strings for the anonymous relative kiosk (no auth, read-only).
// Source of truth — keep en/kiosk.ts key-for-key in sync.
const kiosk = {
  // Page title / welcome screen
  title: 'Căng-tin Trại Giam',
  welcome: 'Chào mừng! Vui lòng nhập mã phạm nhân để xem thực đơn.',

  // Prison-ID entry prompt
  enterPrisonId: 'Nhập mã phạm nhân',
  enterPrisonIdHint: 'Nhập mã số rồi nhấn Xác nhận',

  // Numeric keypad aria-labels
  keypadDigit: 'Chữ số {{digit}}',
  keypadClear: 'Xóa toàn bộ',
  keypadBackspace: 'Xóa ký tự cuối',
  keypadSubmit: 'Xác nhận',

  // Prisoner name confirmation header (shown after successful lookup)
  confirmName: 'Xác nhận người nhận',
  name: 'Họ tên',
  prisonId: 'Mã phạm nhân',
  zone: 'Khu giam',
  cell: 'Buồng giam',
  notAvailable: 'Chưa có thông tin',

  // Menu / price labels
  menuLabel: 'Thực đơn',
  noMenu: 'Hiện chưa có món ăn nào.',

  // Order builder
  pickItemsHint: 'Chọn món muốn đặt',
  qtyDecrease: 'Giảm số lượng {{item}}',
  qtyIncrease: 'Tăng số lượng {{item}}',
  subtotal: 'Tạm tính',
  chooseMethod: 'Chọn hình thức thanh toán',
  methodCash: 'Tiền mặt',
  methodBank: 'Chuyển khoản',
  placeOrder: 'Đặt món',
  submitting: 'Đang gửi…',
  orderError: 'Không thể đặt món. Vui lòng thử lại.',
  // Shown when a pending order already exists for this prisoner today (409).
  alreadyPending: 'Đã có đơn đang chờ cho người này hôm nay. Vui lòng đến quầy thu ngân.',

  // Confirmation screen
  orderPlaced: 'Đã đặt món thành công!',
  confirmationCode: 'Mã xác nhận',
  giveCodeToCashier: 'Vui lòng đưa mã này cho thu ngân để thanh toán.',
  newOrder: 'Đặt món mới',

  // Bank-transfer (offline VietQR) screen — shown after a bank order
  bankTransferTitle: 'Chuyển khoản ngân hàng',
  bankAccountName: 'Chủ tài khoản',
  bankAccountNumber: 'Số tài khoản',
  bankAmount: 'Số tiền',
  bankMemo: 'Nội dung chuyển khoản',
  bankInstruction:
    'Quét mã QR và chuyển đúng số tiền cùng nội dung phía trên, sau đó đưa mã xác nhận cho thu ngân.',

  // Clear / start over
  startOver: 'Bắt đầu lại',

  // Not-found message
  notFound: 'Không tìm thấy phạm nhân. Vui lòng kiểm tra lại mã số.',
  backToEntry: 'Nhập lại mã',

  // Loading state
  loading: 'Đang tải…',
  categoryFood: 'Đồ ăn',
  categoryEssential: 'Đồ thiết yếu',
  categorySummary: 'Giới hạn mua theo phân loại',
  categoryUnlimited: 'Không giới hạn',
  categoryRemaining: 'Còn {{amount}}',
  categoryExceeded: 'Vượt giới hạn {{amount}}',
  limitsChanged: 'Giới hạn đã thay đổi. Hãy cập nhật và kiểm tra đơn trước khi thử lại.',
  refreshLimits: 'Cập nhật giới hạn',
  toastBlockedCategoryLimit: 'Giảm tổng của phân loại vượt giới hạn trước khi đặt đơn.',
  categoryLimitWarning: 'Tổng {{category}} {{actualAmount}} vượt giới hạn {{limitAmount}}.',

} as const;

export default kiosk;
