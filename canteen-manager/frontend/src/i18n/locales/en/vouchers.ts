const vouchers = {
  // Page header
  pageTitle: 'Delivery Vouchers',
  pageSubtitle: 'Print a goods-delivery voucher per prisoner for the delivery date.',

  // Actions
  printVouchers: '⎙ Print vouchers',
  dateLabel: 'Delivery date',

  // Zone/Cell filter dropdowns
  filterZone: 'Zone',
  filterCell: 'Cell',
  allZones: 'All zones',
  allCells: 'All cells',

  // Sheet identity block
  labelZone: 'Zone',
  labelCell: 'Cell',
  prisonerId: 'Prisoner ID',

  // Sheet item table
  colItem: 'Item',
  colQty: 'Qty',

  // Sheet money
  totalAmount: 'Total',
  remainingBalance: 'Remaining balance (at {{time}})',

  // Signature lines
  signReceiver: 'Receiver',
  signDutyOfficer: 'Duty officer',
  signDeliveryOfficer: 'Delivery officer',

  // Empty state
  noData: 'No vouchers',
} as const;

export default vouchers;
