// English strings for the admin balance/ledger audit view.
// Must stay key-for-key in sync with vi/accounts.ts — locale-parity.test.ts enforces this.
const accounts = {
  // Page header
  pageTitle: 'Balance Audit',
  pageSubtitle: 'Look up any prisoner\'s balance and full ledger (admin only).',

  // Prisoner search
  searchPlaceholder: 'Enter prisoner ID or name…',
  searchAriaLabel: 'Search prisoners for audit',
  searchResultsLabel: 'Search results',
  searchNoMatch: 'No matching prisoners found.',

  // Prisoner selection prompt
  selectPrisonerPrompt: 'Select a prisoner to view their balance and transaction history.',

  // Balance display
  balanceLabel: 'Current Balance',

  // Detainee profile (read-only)
  profileDob: 'Date of birth',
  profileHometown: 'Hometown',
  profileOffense: 'Offense',
  profileArrestDate: 'Arrest date',
  profileDetention: 'Detention status',

  // Ledger table headers
  colDate: 'Date',
  colType: 'Type',
  colAmount: 'Amount',
  colBalanceAfter: 'Balance After',
  colMethod: 'Method',
  colRef: 'Reference',
  colOperator: 'Operator',
  colNote: 'Note',

  // Transaction type labels
  typeTopup: 'Top-up',
  typeOrderDebit: 'Order Debit',
  typeReversal: 'Reversal',

  // Pagination
  prev: '← Prev',
  next: 'Next →',
  pageInfo: 'Page {{page}}',

  // Empty / loading / error states
  ledgerEmpty: 'No transactions yet.',
  loading: 'Loading…',
  balanceError: 'Could not load balance: {{message}}',
  ledgerError: 'Could not load ledger: {{message}}',
} as const;

export default accounts;
