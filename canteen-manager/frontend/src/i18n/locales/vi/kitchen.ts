const kitchen = {
  // Page header
  pageTitle: 'Tổng kết bếp',
  pageSubtitle: 'Số lượng tổng hợp theo món ăn. Giao cho bếp.',

  // Actions
  printSummary: '⎙ In tổng kết',
  dateFrom: 'Từ ngày',
  dateTo: 'Đến ngày',

  // Preset buttons
  preset_shift: 'Ca',
  preset_day: 'Ngày',
  preset_week: 'Tuần',
  preset_month: 'Tháng',
  preset_quarter: 'Quý',
  preset_year: 'Năm',

  // Compare
  comparePrevious: 'So sánh với kỳ trước',
  comparedWith: 'So với',

  // Print area header
  summaryHeading: 'Tổng kết bếp',
  generatedAt: 'tạo lúc {{time}}',

  // Right-hand total
  totalOrdersLabel: 'Tổng phần',

  // Table headers
  colNumber: '#',
  colMenuItem: 'Món ăn',
  colPortions: 'Phần',
  colDelta: 'Thay đổi',

  // Table empty state
  noData: 'Không có dữ liệu',

  // Total row
  totalPortions: 'Tổng phần',

  // Footer note
  footerNote: 'Tổng phần có thể vượt quá số đơn khi mỗi phiếu chọn nhiều món. Phiếu từ chối được loại trừ.',
} as const;

export default kitchen;
