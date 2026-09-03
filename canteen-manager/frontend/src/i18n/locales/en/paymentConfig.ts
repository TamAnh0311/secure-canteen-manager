// English strings for the admin "canteen bank account" config page.
// Must stay key-for-key in sync with vi/paymentConfig.ts — locale-parity.test.ts enforces it.
const paymentConfig = {
  pageTitle: 'Canteen Bank Account',
  pageSubtitle: 'The account that receives transfers, shown as a QR code at the kiosk.',

  // Configured-status chip
  configured: 'Configured',
  notConfigured: 'Not configured',

  // Form fields
  bankBinLabel: 'Bank code (BIN)',
  bankBinHelp: '6 digits, must be a NAPAS member bank.',
  accountNumberLabel: 'Account number',
  accountNumberHelp: '6–19 digits. Re-enter in full to change it.',
  currentMasked: 'Current: {{value}}',
  accountNameLabel: 'Account holder name',
  accountNameHelp: 'Will be folded to unaccented text on save.',

  // Actions
  save: 'Save',
  saving: 'Saving…',
  saveSuccess: 'Bank account saved.',

  // Loading / errors
  loadError: 'Could not load the account config.',
  saveError: 'Could not save. Please check the fields.',
  errorBinFormat: 'Bank code must be 6 digits.',
  errorAccountNumber: 'Account number must be 6–19 digits.',
  errorAccountName: 'Please enter the account holder name (max 140 characters).',
} as const;

export default paymentConfig;
