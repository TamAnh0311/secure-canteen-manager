const common = {
  language: 'Language',
  vietnamese: 'Vietnamese',
  english: 'English',

  // Navigation item labels (keyed by nav item id)
  nav: {
    dashboard: 'Dashboard',
    'scan-monitor': 'Scan Monitor',
    'order-form': 'Issue Order Form',
    verify: 'Verify Queue',
    orders: 'Orders',
    'kitchen-summary': 'Kitchen Summary',
    counter: 'Cashier Counter',
    menu: 'Shared Menu',
    'form-print': 'Print Forms',
    audit: 'Balance Audit',
    'payment-config': 'Bank Account',
    users: 'Users',
    vouchers: 'Delivery Vouchers',
    operators: 'Operators',
  },

  // Navigation group labels (keyed by group id)
  navGroup: {
    Operations: 'Operations',
    Setup: 'Setup',
  },

  // Accessible name for the primary side navigation landmark
  navAria: 'Primary navigation',

  // Status chip labels — used by status-display callers via t('status.*')
  status: {
    sheet: {
      pending: 'Pending',
      processing: 'Processing',
      autoAccepted: 'Auto-accepted',
      verified: 'Verified',
      flagged: 'Flagged',
      rejected: 'Rejected',
    },
    order: {
      active: 'Active',
      superseded: 'Superseded',
      rejected: 'Rejected',
    },
    sync: {
      running: 'Running',
      success: 'Success',
      failed: 'Failed',
    },
  },

  // Date-range picker (shared filter on verify/orders/kitchen/dashboard/scan/form-print)
  dateRange: {
    label: 'Date range',
    from: 'From',
    to: 'To',
    today: 'Today',
  },

  // Detention-status chip labels (shared by /audit and /prisoner)
  detentionTemporaryHold: 'Temporary hold',
  detentionPreTrialDetention: 'Pre-trial detention',
  detentionConvicted: 'Convicted',

  // Shared UI words
  noData: 'No data',
  loading: 'Loading…',
  allDay: 'All day',
  airGapped: 'Air-gapped',
  signOut: 'Sign out',
  dismiss: 'Dismiss',
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',
  edit: 'Edit',
  assignedZoneScope: 'Assigned zone: {{zone}}. Results on this page are limited by the server to this zone.',
  assignedZoneMissing: 'No zone is assigned to this operator. Scoped records are unavailable until an administrator assigns one.',
  assignedZoneEmpty: 'No records are available in assigned zone {{zone}}.',
} as const;

export default common;
