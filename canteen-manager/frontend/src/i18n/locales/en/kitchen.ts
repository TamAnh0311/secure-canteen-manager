const kitchen = {
  // Page header
  pageTitle: 'Kitchen summary',
  pageSubtitle: 'Aggregated counts per menu item. Hand to kitchen.',

  // Actions
  printSummary: '⎙ Print summary',
  dateLabel: 'Service date',

  // Print area header
  summaryHeading: 'Kitchen Summary',
  generatedAt: 'generated {{time}}',

  // Right-hand total
  totalOrdersLabel: 'Total orders',

  // Table headers
  colNumber: '#',
  colMenuItem: 'Menu item',
  colPortions: 'Portions',

  // Table empty state
  noData: 'No data',

  // Total row
  totalPortions: 'Total portions',

  // Footer note
  footerNote: 'Total portions may exceed orders when multiple items are selected per sheet. Rejected sheets excluded.',
} as const;

export default kitchen;
