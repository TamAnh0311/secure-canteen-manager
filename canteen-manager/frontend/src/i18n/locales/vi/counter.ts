const counter = {
  // Page header
  pageTitle: 'Quầy thu ngân',
  pageSubtitle: 'Nạp tiền và tạo đơn hàng người thân tại quầy.',

  // Prisoner search
  searchPlaceholder: 'Nhập mã phạm nhân…',
  searchAriaLabel: 'Tra cứu phạm nhân theo mã',
  searchButton: 'Tra cứu',

  // Not-found / error banners
  notFound: 'Không tìm thấy phạm nhân với mã này.',
  lookupError: 'Lỗi tra cứu: {{message}}',

  // Prisoner card
  cardTitle: 'Thông tin đối tượng tạm giữ, tạm giam, phạm nhân',
  labelId: 'Mã',
  labelName: 'Họ tên',
  labelZone: 'Khu giam',
  labelBalance: 'Số dư hiện tại',
  statusActive: 'Đang hoạt động',
  statusInactive: 'Ngừng hoạt động',
  inactiveNotice: 'Phạm nhân này không còn hoạt động. Không thể thực hiện giao dịch.',

  // Ledger table
  ledgerTitle: 'Lịch sử giao dịch',
  colDate: 'Ngày',
  colType: 'Loại',
  colAmount: 'Số tiền',
  colBalance: 'Số dư sau',
  colMethod: 'Phương thức',
  colRef: 'Tham chiếu',
  ledgerEmpty: 'Chưa có giao dịch nào.',

  // Transaction type labels
  typeTopup: 'Nạp tiền',
  typeOrderDebit: 'Trừ tiền đơn hàng',
  typeReversal: 'Hoàn tiền',

  // Top-up form
  topupTitle: 'Nạp tiền',
  topupAmountLabel: 'Số tiền (VNĐ)',
  topupAmountPlaceholder: 'Nhập số tiền…',
  topupMethodLabel: 'Phương thức',
  methodCash: 'Tiền mặt',
  methodBank: 'Chuyển khoản',
  topupRefLabel: 'Mã tham chiếu (tùy chọn)',
  topupRefPlaceholder: 'Mã giao dịch ngân hàng…',
  topupSubmit: 'Nạp tiền',

  // Top-up validation
  topupAmountRequired: 'Vui lòng nhập số tiền.',
  topupAmountMin: 'Số tiền phải lớn hơn 0.',
  topupAmountMax: 'Số tiền không được vượt quá 1.000.000.000 VNĐ.',
  topupAmountInteger: 'Số tiền phải là số nguyên.',

  // Top-up success / error
  topupSuccess: 'Nạp tiền thành công. Số dư mới: {{balance}}',

  // Relative order form
  orderTitle: 'Đơn hàng người thân',
  orderMenuLabel: 'Chọn món',
  orderMenuLoading: 'Đang tải thực đơn…',
  orderMenuEmpty: 'Hiện chưa có món nào trong thực đơn.',
  qtyDecrease: 'Giảm số lượng {{item}}',
  qtyIncrease: 'Tăng số lượng {{item}}',
  orderRunningTotal: 'Tổng cộng: {{amount}}',
  orderMethodLabel: 'Phương thức thanh toán',
  orderSubmit: 'Tạo đơn hàng',

  // Relative order validation
  orderItemRequired: 'Vui lòng chọn ít nhất một món.',
  orderMethodRequired: 'Vui lòng chọn phương thức thanh toán.',

  // Relative order success / error
  orderSuccess: 'Đơn đã được gửi vào hàng chờ duyệt.',
  // Nhắc cố định sau khi tạo đơn tại quầy: đơn CHƯA thanh toán — phải duyệt trong
  // hàng chờ để thu tiền.
  orderPendingNotice: 'Đơn đã được gửi vào hàng chờ. Hãy duyệt tại đó để thu tiền.',

  // Hàng chờ duyệt
  pendingQueue: 'Đơn chờ duyệt',
  pendingQueueHint: 'Đơn của thân nhân đang chờ bạn duyệt.',
  noPending: 'Không có đơn nào đang chờ.',
  pendingError: 'Không thể tải danh sách đơn chờ.',
  codeLabel: 'Mã',
  waitingSince: 'Gửi lúc {{time}}',
  intendedMethodLabel: 'Dự kiến',
  accept: 'Duyệt',
  reject: 'Từ chối',
  overrideMethod: 'Thu bằng',
  bankBadgeLabel: 'Đối chiếu chuyển khoản',
  transferRefLabel: 'Mã giao dịch (không bắt buộc)',
  transferRefPlaceholder: 'Mã giao dịch ngân hàng…',
  receivedAmountLabel: 'Số tiền nhận được (không bắt buộc)',
  receivedAmountPlaceholder: 'Nhập số tiền đã nhận…',
  confirmAccept: 'Xác nhận thu tiền',
  rejectReasonLabel: 'Lý do (không bắt buộc)',
  rejectReasonPlaceholder: 'Vì sao từ chối đơn này?',
  confirmReject: 'Xác nhận từ chối',
  cancel: 'Hủy',
  acceptSuccess: 'Đã duyệt đơn và ghi nhận thanh toán.',
  rejectSuccess: 'Đã từ chối đơn.',
  alreadyHandled: 'Đơn này đã được xử lý trên thiết bị khác.',
  categoryFood: 'Đồ ăn',
  categoryEssential: 'Đồ thiết yếu',
  categorySummary: 'Giới hạn mua theo phân loại',
  categoryUnlimited: 'Không giới hạn',
  categoryRemaining: 'Còn {{amount}}',
  categoryExceeded: 'Vượt giới hạn {{amount}}',
  toastBlockedCategoryLimit: 'Giảm tổng của phân loại vượt giới hạn trước khi gửi.',
  categoryLimitWarning: 'Tổng {{category}} {{actualAmount}} vượt giới hạn {{limitAmount}}.',
  limitsChanged: 'Giới hạn đã thay đổi. Hãy cập nhật và kiểm tra đơn trước khi thử lại.',
  refreshLimits: 'Cập nhật giới hạn',
} as const;

export default counter;
