const orders = {
  // Page header
  pageTitle: 'Đơn hàng',
  pageSubtitle: 'Được tạo từ phiếu đã chấp nhận và xác minh.',

  // Status filter
  filterAll: 'Tất cả trạng thái',
  filterActive: 'Hoạt động',
  filterSuperseded: 'Đã thay thế',
  filterRejected: 'Đã từ chối',
  filterAriaLabel: 'Lọc trạng thái',

  // Card header (count)
  orderCount_one: '{{count}} đơn hàng',
  orderCount_other: '{{count}} đơn hàng',

  // Table columns
  colOrderId: 'Mã đơn',
  colUserId: 'Mã người dùng',
  colSource: 'Nguồn',
  colSheet: 'Phiếu',
  colTotal: 'Tổng tiền',
  colStatus: 'Trạng thái',
  colCreated: 'Ngày tạo',

  // Detail dialog
  dialogTitle: 'Đơn hàng · {{id}}',
  dialogSource: 'Nguồn: {{source}}',
  dialogSourceSheet: 'Nguồn: {{source}} · phiếu {{sheetId}}',
  dialogItemsLabel: 'Mặt hàng',
  dialogNoItems: 'Không có mặt hàng',
  dialogTotalLabel: 'Tổng cộng',
  dialogPaymentLabel: 'Thanh toán: {{status}}',
  paymentPaid: 'Đã thanh toán',
  paymentUnpaid: 'Chưa thanh toán',
  dialogCreated: 'Ngày tạo: {{ts}}',
  dialogSuperseded: 'Đã thay thế: {{ts}}',
  dialogUpdated: 'Cập nhật: {{ts}}',
  dialogClose: 'Đóng',
} as const;

export default orders;
