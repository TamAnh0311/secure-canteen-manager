const orders = {
  // Page header
  pageTitle: 'Orders',
  pageSubtitle: 'Created from accepted and verified sheets.',

  // Status filter
  filterAll: 'All statuses',
  filterActive: 'Active',
  filterSuperseded: 'Superseded',
  filterRejected: 'Rejected',
  filterAriaLabel: 'Status filter',

  // Card header (count)
  orderCount_one: '{{count}} order',
  orderCount_other: '{{count}} orders',

  // Table columns
  colOrderId: 'Order ID',
  colUserId: 'User ID',
  colSource: 'Source',
  colSheet: 'Sheet',
  colTotal: 'Total',
  colStatus: 'Status',
  colCreated: 'Created',

  // Detail dialog
  dialogTitle: 'Order · {{id}}',
  dialogSource: 'Source: {{source}}',
  dialogSourceSheet: 'Source: {{source}} · sheet {{sheetId}}',
  dialogItemsLabel: 'Items',
  dialogNoItems: 'No items',
  dialogTotalLabel: 'Total',
  dialogPaymentLabel: 'Payment: {{status}}',
  paymentPaid: 'Paid',
  paymentUnpaid: 'Unpaid',
  dialogCreated: 'Created: {{ts}}',
  dialogSuperseded: 'Superseded: {{ts}}',
  dialogUpdated: 'Updated: {{ts}}',
  dialogClose: 'Close',
} as const;

export default orders;
