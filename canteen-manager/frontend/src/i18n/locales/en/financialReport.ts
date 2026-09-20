const financialReport = {
  pageTitle: 'Financial Report',
  pageSubtitle: 'Revenue summary by source, payment method, and category.',
  print: '⎙ Print report',

  preset_day: 'Day',
  preset_week: 'Week',
  preset_month: 'Month',
  preset_quarter: 'Quarter',
  preset_year: 'Year',

  comparePrevious: 'Compare with previous period',
  comparedWith: 'Compared with',

  // KPI
  paidRevenue: 'Paid Revenue',
  paidOrders: 'Paid Orders',
  unpaidOrders: 'Unpaid Orders',
  unpaidAmount: 'Unpaid Amount',

  // Tables
  bySource: 'Revenue by Source',
  byMethod: 'Revenue by Payment Method',
  byCategory: 'Revenue by Category',
  dailyBreakdown: 'Daily Breakdown',

  source: 'Source',
  method: 'Method',
  category: 'Category',
  orders: 'Orders',
  revenue: 'Revenue',
  quantity: 'Quantity',
  date: 'Date',
  noData: 'No data',

  // Source labels
  source_omr: 'OMR (scanned form)',
  source_scanner: 'Scanner',
  source_relative: 'Relative (visitor)',
  source_manual: 'Manual',

  // Method labels
  method_balance: 'Account balance',
  method_cash: 'Cash',
  method_bank: 'Bank transfer',
  method_unknown: 'Unknown',

  // Category labels
  cat_food: 'Food',
  cat_essential: 'Essential items',
} as const;

export default financialReport;
