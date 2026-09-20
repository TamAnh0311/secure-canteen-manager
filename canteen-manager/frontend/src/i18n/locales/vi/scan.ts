const scan = {
  // Page header
  pageTitle: 'Giám sát quét',
  pageSubtitle: 'Hoạt động quét điện thoại · mới nhất trước',

  // Actions
  resumeFeed: 'Tiếp tục luồng',
  pauseFeed: 'Tạm dừng luồng',
  openPhoneScan: 'Mở quét điện thoại',
  openPhoneScanHint: 'Mở camera điện thoại để quét phiếu OMR trong tab mới.',

  // KPI labels
  kpiTotalScans: 'Tổng lượt quét',
  kpiOrdersCreated: 'Đơn hàng tạo',
  kpiOrdersPaid: 'Đơn đã thanh toán',
  kpiTotalRevenue: 'Tổng doanh thu',

  // Table card
  scanHistory: 'Lịch sử quét',
  feedPaused: '⏸ đã tạm dừng',
  feedAutoRefresh: '⟳ tự động làm mới',

  // Table columns
  colOrderId: 'Mã đơn',
  colServiceDate: 'Ngày phục vụ',
  colAmount: 'Số tiền',
  colStatus: 'Trạng thái',
  colPayment: 'Thanh toán',
  colTime: 'Thời gian',

  // Table body
  noScansYet: 'Chưa có lượt quét',

  // Payment status
  paid: 'Đã thanh toán',
  unpaid: 'Chưa thanh toán',
} as const;

export default scan;
