const dashboard = {
  title: 'Today · {{date}}',
  verifyQueue: 'Verify queue',

  // Date-range filter (drives the KPI counts below)
  dateRangeLabel: 'Date range',

  // Menu / form status card
  menuStatusTitle: 'Menu & form',
  manageMenu: 'Manage menu →',
  menuItemCount_one: '{{count}} item in the menu',
  menuItemCount_other: '{{count}} items in the menu',
  formGenerated: 'Form generated at {{time}}',
  formNotGenerated: 'No OMR form generated yet',

  quickActions: 'Quick actions',
  printForms: '⎙ Print OMR forms',
  openScanMonitor: '▦ Open scan monitor',
  kitchenSummary: '▥ Kitchen summary',
  viewOrders: '☰ View orders',
  kpi: {
    pending: 'Pending',
    processing: 'Processing',
    autoAccepted: 'Auto-accepted',
    flagged: 'Flagged',
    rejected: 'Rejected',
    verified: 'Verified',
  },
} as const;

export default dashboard;
