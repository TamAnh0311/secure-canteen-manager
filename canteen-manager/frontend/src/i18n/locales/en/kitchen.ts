const kitchen = {
  // Page header
  pageTitle: 'Kitchen Summary',
  pageSubtitle: 'Aggregated counts per menu item. Hand to kitchen.',

  // Actions
  printSummary: '⎙ Print summary',
  dateFrom: 'From',
  dateTo: 'To',

  // Preset buttons
  preset_shift: 'Shift',
  preset_day: 'Day',
  preset_week: 'Week',
  preset_month: 'Month',
  preset_quarter: 'Quarter',
  preset_year: 'Year',

  // Compare
  comparePrevious: 'Compare with previous period',
  comparedWith: 'Compared with',

  // Print area header
  summaryHeading: 'Kitchen Summary',
  generatedAt: 'generated {{time}}',

  // Right-hand total
  totalOrdersLabel: 'Total portions',

  // Table headers
  colNumber: '#',
  colMenuItem: 'Menu item',
  colPortions: 'Portions',
  colDelta: 'Change',

  // Table empty state
  noData: 'No data',

  // Total row
  totalPortions: 'Total portions',

  // Footer note
  footerNote: 'Total portions may exceed orders when multiple items are selected per sheet. Rejected sheets excluded.',
} as const;

export default kitchen;
