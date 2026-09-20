const scan = {
  // Page header
  pageTitle: 'Scan Monitor',
  pageSubtitle: 'Phone scan activity · newest first',

  // Actions
  resumeFeed: 'Resume feed',
  pauseFeed: 'Pause feed',
  openPhoneScan: 'Open Phone Scanner',
  openPhoneScanHint: 'Open the phone camera scanner in a new tab to scan OMR forms.',

  // KPI labels
  kpiTotalScans: 'Total scans',
  kpiOrdersCreated: 'Orders created',
  kpiOrdersPaid: 'Orders paid',
  kpiTotalRevenue: 'Total revenue',

  // Table card
  scanHistory: 'Scan history',
  feedPaused: '⏸ paused',
  feedAutoRefresh: '⟳ auto-refresh',

  // Table columns
  colOrderId: 'Order ID',
  colServiceDate: 'Service date',
  colAmount: 'Amount',
  colStatus: 'Status',
  colPayment: 'Payment',
  colTime: 'Time',

  // Table body
  noScansYet: 'No scans yet',

  // Payment status
  paid: 'Paid',
  unpaid: 'Unpaid',
} as const;

export default scan;
