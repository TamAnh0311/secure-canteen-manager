const common = {
  language: 'Ngôn ngữ',
  vietnamese: 'Tiếng Việt',
  english: 'Tiếng Anh',

  // Navigation item labels (keyed by nav item id)
  nav: {
    dashboard: 'Tổng quan',
    'scan-monitor': 'Giám sát quét',
    'order-form': 'Phát hành phiếu',
    verify: 'Hàng chờ xét duyệt',
    orders: 'Đơn hàng',
    'kitchen-summary': 'Tổng kết bếp',
    counter: 'Quầy thu ngân',
    menu: 'Thực đơn',
    'form-print': 'In phiếu',
    audit: 'Kiểm toán số dư',
    'payment-config': 'Tài khoản ngân hàng',
    users: 'Phạm nhân',
    vouchers: 'Phiếu giao hàng',
    operators: 'Nhân viên vận hành',
  },

  // Navigation group labels (keyed by group id)
  navGroup: {
    Operations: 'Vận hành',
    Setup: 'Cài đặt',
  },

  // Accessible name for the primary side navigation landmark
  navAria: 'Điều hướng chính',

  // Status chip labels — used by status-display callers via t('status.*')
  status: {
    sheet: {
      pending: 'Chờ xử lý',
      processing: 'Đang xử lý',
      autoAccepted: 'Tự động chấp nhận',
      verified: 'Đã xác minh',
      flagged: 'Cần xét duyệt',
      rejected: 'Từ chối',
    },
    order: {
      active: 'Hoạt động',
      superseded: 'Đã thay thế',
      rejected: 'Đã từ chối',
    },
    sync: {
      running: 'Đang đồng bộ',
      success: 'Thành công',
      failed: 'Thất bại',
    },
  },

  // Date-range picker (shared filter on verify/orders/kitchen/dashboard/scan/form-print)
  dateRange: {
    label: 'Khoảng ngày',
    from: 'Từ ngày',
    to: 'Đến ngày',
    today: 'Hôm nay',
  },

  // Detention-status chip labels (shared by /audit and /prisoner)
  detentionTemporaryHold: 'Tạm giữ',
  detentionPreTrialDetention: 'Tạm giam',
  detentionConvicted: 'Phạm nhân',

  // Shared UI words
  noData: 'Không có dữ liệu',
  loading: 'Đang tải…',
  allDay: 'Cả ngày',
  airGapped: 'Mạng nội bộ',
  signOut: 'Đăng xuất',
  dismiss: 'Đóng',
  close: 'Đóng',
  cancel: 'Hủy',
  save: 'Lưu',
  edit: 'Sửa',
  assignedZoneScope: 'Khu vực được phân công: {{zone}}. Máy chủ giới hạn dữ liệu trên trang này theo khu vực đó.',
  assignedZoneMissing: 'Nhân viên vận hành này chưa được phân công khu vực. Không thể xem dữ liệu theo phạm vi cho đến khi quản trị viên phân công.',
  assignedZoneEmpty: 'Không có dữ liệu trong khu vực được phân công {{zone}}.',
} as const;

export default common;
