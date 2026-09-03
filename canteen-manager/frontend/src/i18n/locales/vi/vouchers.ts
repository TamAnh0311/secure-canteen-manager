const vouchers = {
  // Page header
  pageTitle: 'Phiếu giao hàng',
  pageSubtitle: 'In phiếu giao hàng cho từng phạm nhân theo ngày giao.',

  // Actions
  printVouchers: '⎙ In phiếu',
  dateLabel: 'Ngày giao',

  // Zone/Cell filter dropdowns
  filterZone: 'Khu giam',
  filterCell: 'Buồng giam',
  allZones: 'Tất cả khu',
  allCells: 'Tất cả buồng',

  // Sheet identity block
  labelZone: 'Khu giam',
  labelCell: 'Buồng giam',
  prisonerId: 'Mã phạm nhân',

  // Sheet item table
  colItem: 'Món ăn',
  colQty: 'Số lượng',

  // Sheet money
  totalAmount: 'Thành tiền',
  remainingBalance: 'Số dư còn lại (lúc {{time}})',

  // Signature lines
  signReceiver: 'Người nhận',
  signDutyOfficer: 'Cán bộ trực',
  signDeliveryOfficer: 'Cán bộ giao hàng',

  // Empty state
  noData: 'Không có phiếu giao',
} as const;

export default vouchers;
