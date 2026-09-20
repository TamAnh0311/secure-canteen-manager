const dashboard = {
  title: 'Today · {{date}}',

  // Date-range filter (drives the KPI counts below)
  dateRangeLabel: 'Date range',

  // Menu / form status card
  menuStatusTitle: 'Menu & form',
  manageMenu: 'Manage menu →',
  menuItemCount_one: '{{count}} item in the menu',
  menuItemCount_other: '{{count}} items in the menu',
  formGenerated: 'Form generated at {{time}}',
  formNotGenerated: 'No form generated yet',

  quickActions: 'Quick actions',
  tabletConnection: 'Tablet connection',
  tabletHint: 'Scan the QR code from a tablet to open the ordering page',
  kitchenSummary: '▥ Kitchen summary',
  viewOrders: '☰ View orders',
  openCanteen: '▦ Canteen',
  openCounter: '▤ Cashier counter',
  kpi: {
    totalOrders: 'Total Orders',
    pending: 'Pending',
    paidOrders: 'Paid',
    revenue: 'Revenue',
  },
} as const;

export default dashboard;
