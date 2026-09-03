const kitchen = {
  // Page header
  pageTitle: 'Tổng kết bếp',
  pageSubtitle: 'Số lượng tổng hợp theo món ăn. Giao cho bếp.',

  // Actions
  printSummary: '⎙ In tổng kết',
  dateLabel: 'Ngày phục vụ',

  // Print area header
  summaryHeading: 'Tổng kết bếp',
  generatedAt: 'tạo lúc {{time}}',

  // Right-hand total
  totalOrdersLabel: 'Tổng đơn hàng',

  // Table headers
  colNumber: '#',
  colMenuItem: 'Món ăn',
  colPortions: 'Phần',

  // Table empty state
  noData: 'Không có dữ liệu',

  // Total row
  totalPortions: 'Tổng phần',

  // Footer note
  footerNote: 'Tổng phần có thể vượt quá số đơn khi mỗi phiếu chọn nhiều món. Phiếu từ chối được loại trừ.',
} as const;

export default kitchen;
