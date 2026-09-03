const counter = {
  // Page header
  pageTitle: 'Cashier Counter',
  pageSubtitle: 'Top up balances and create relative orders at the counter.',

  // Prisoner search
  searchPlaceholder: 'Enter prison ID…',
  searchAriaLabel: 'Look up prisoner by ID',
  searchButton: 'Look up',

  // Not-found / error banners
  notFound: 'No prisoner found with this ID.',
  lookupError: 'Lookup error: {{message}}',

  // Prisoner card
  cardTitle: 'Prisoner Information',
  labelId: 'ID',
  labelName: 'Name',
  labelZone: 'Zone',
  labelBalance: 'Current Balance',
  statusActive: 'Active',
  statusInactive: 'Inactive',
  inactiveNotice: 'This prisoner is inactive. Transactions are not allowed.',

  // Ledger table
  ledgerTitle: 'Transaction History',
  colDate: 'Date',
  colType: 'Type',
  colAmount: 'Amount',
  colBalance: 'Balance After',
  colMethod: 'Method',
  colRef: 'Reference',
  ledgerEmpty: 'No transactions yet.',

  // Transaction type labels
  typeTopup: 'Top-up',
  typeOrderDebit: 'Order Debit',
  typeReversal: 'Reversal',

  // Top-up form
  topupTitle: 'Top Up',
  topupAmountLabel: 'Amount (VND)',
  topupAmountPlaceholder: 'Enter amount…',
  topupMethodLabel: 'Method',
  methodCash: 'Cash',
  methodBank: 'Bank Transfer',
  topupRefLabel: 'Reference (optional)',
  topupRefPlaceholder: 'Bank transaction ID…',
  topupSubmit: 'Top Up',

  // Top-up validation
  topupAmountRequired: 'Please enter an amount.',
  topupAmountMin: 'Amount must be greater than 0.',
  topupAmountMax: 'Amount must not exceed 1,000,000,000 VND.',
  topupAmountInteger: 'Amount must be an integer.',

  // Top-up success / error
  topupSuccess: 'Top-up successful. New balance: {{balance}}',

  // Relative order form
  orderTitle: 'Relative Order',
  orderMenuLabel: 'Select Items',
  orderMenuLoading: 'Loading menu…',
  orderMenuEmpty: 'No items in the menu yet.',
  qtyDecrease: 'Decrease quantity of {{item}}',
  qtyIncrease: 'Increase quantity of {{item}}',
  orderRunningTotal: 'Total: {{amount}}',
  orderMethodLabel: 'Payment Method',
  orderSubmit: 'Create Order',

  // Relative order validation
  orderItemRequired: 'Please select at least one item.',
  orderMethodRequired: 'Please select a payment method.',

  // Relative order success / error
  orderSuccess: 'Order sent to the pending queue.',
  // Persistent reminder shown after a counter create: the order is NOT paid yet —
  // it must be accepted in the queue to collect payment.
  orderPendingNotice: 'Order sent to the pending queue. Accept it there to collect payment.',

  // Pending-approval queue
  pendingQueue: 'Pending Orders',
  pendingQueueHint: 'Relative orders awaiting your approval.',
  noPending: 'No pending orders.',
  pendingError: 'Could not load pending orders.',
  codeLabel: 'Code',
  waitingSince: 'Submitted {{time}}',
  intendedMethodLabel: 'Intended',
  accept: 'Accept',
  reject: 'Reject',
  overrideMethod: 'Collect via',
  bankBadgeLabel: 'Verify bank transfer',
  transferRefLabel: 'Transfer reference (optional)',
  transferRefPlaceholder: 'Bank transaction ID…',
  receivedAmountLabel: 'Received amount (optional)',
  receivedAmountPlaceholder: 'Enter the amount received…',
  confirmAccept: 'Confirm payment',
  rejectReasonLabel: 'Reason (optional)',
  rejectReasonPlaceholder: 'Why is this order rejected?',
  confirmReject: 'Confirm reject',
  cancel: 'Cancel',
  acceptSuccess: 'Order accepted and marked paid.',
  rejectSuccess: 'Order rejected.',
  alreadyHandled: 'This order was already handled on another device.',
  categoryFood: 'Food',
  categoryEssential: 'Essential goods',
  categorySummary: 'Category purchase limits',
  categoryUnlimited: 'Unlimited',
  categoryRemaining: '{{amount}} remaining',
  categoryExceeded: 'Exceeds the limit by {{amount}}',
  toastBlockedCategoryLimit: 'Reduce the exceeded category total before submitting.',
  categoryLimitWarning: '{{category}} subtotal {{actualAmount}} exceeds the {{limitAmount}} limit.',
  limitsChanged: 'Limits changed. Refresh and review this order before trying again.',
  refreshLimits: 'Refresh limits',
} as const;

export default counter;
