const financialReport = {
  pageTitle: 'Báo cáo tài chính',
  pageSubtitle: 'Tổng hợp doanh thu, đơn hàng theo nguồn, hình thức thanh toán và danh mục.',
  print: '⎙ In báo cáo',

  preset_day: 'Ngày',
  preset_week: 'Tuần',
  preset_month: 'Tháng',
  preset_quarter: 'Quý',
  preset_year: 'Năm',

  comparePrevious: 'So sánh với kỳ trước',
  comparedWith: 'So với',

  // KPI
  paidRevenue: 'Doanh thu đã thanh toán',
  paidOrders: 'Đơn đã thanh toán',
  unpaidOrders: 'Đơn chưa thanh toán',
  unpaidAmount: 'Số tiền chưa thu',

  // Tables
  bySource: 'Doanh thu theo nguồn',
  byMethod: 'Doanh thu theo hình thức',
  byCategory: 'Doanh thu theo danh mục',
  dailyBreakdown: 'Chi tiết theo ngày',

  source: 'Nguồn',
  method: 'Hình thức',
  category: 'Danh mục',
  orders: 'Đơn hàng',
  revenue: 'Doanh thu',
  quantity: 'Số lượng',
  date: 'Ngày',
  noData: 'Không có dữ liệu',

  // Source labels
  source_omr: 'OMR (quét phiếu)',
  source_scanner: 'Máy quét',
  source_relative: 'Thân nhân',
  source_manual: 'Thủ công',

  // Method labels
  method_balance: 'Số dư tài khoản',
  method_cash: 'Tiền mặt',
  method_bank: 'Chuyển khoản',
  method_unknown: 'Không xác định',

  // Category labels
  cat_food: 'Thực phẩm',
  cat_essential: 'Đồ dùng thiết yếu',
} as const;

export default financialReport;
