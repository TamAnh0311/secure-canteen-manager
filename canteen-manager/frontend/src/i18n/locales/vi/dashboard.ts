const dashboard = {
  title: 'Hôm nay · {{date}}',
  verifyQueue: 'Hàng chờ xét duyệt',

  // Date-range filter (drives the KPI counts below)
  dateRangeLabel: 'Khoảng ngày',

  // Menu / form status card
  menuStatusTitle: 'Thực đơn & phiếu',
  manageMenu: 'Quản lý thực đơn →',
  menuItemCount_one: '{{count}} món trong thực đơn',
  menuItemCount_other: '{{count}} món trong thực đơn',
  formGenerated: 'Đã tạo phiếu lúc {{time}}',
  formNotGenerated: 'Chưa tạo phiếu OMR',

  quickActions: 'Thao tác nhanh',
  printForms: '⎙ In phiếu OMR',
  openScanMonitor: '▦ Mở giám sát quét',
  kitchenSummary: '▥ Tổng kết bếp',
  viewOrders: '☰ Xem đơn hàng',
  kpi: {
    pending: 'Chờ xử lý',
    processing: 'Đang xử lý',
    autoAccepted: 'Tự động chấp nhận',
    flagged: 'Cần xét duyệt',
    rejected: 'Từ chối',
    verified: 'Đã xác minh',
  },
} as const;

export default dashboard;
