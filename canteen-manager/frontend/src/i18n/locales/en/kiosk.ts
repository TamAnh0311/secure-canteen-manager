// English strings for the anonymous relative kiosk (no auth, read-only).
// Must stay key-for-key in sync with vi/kiosk.ts — locale-parity.test.ts enforces this.
const kiosk = {
  // Page title / welcome screen
  title: 'Prison Canteen',
  welcome: 'Welcome! Please enter the prisoner ID to view the menu.',

  // Prison-ID entry prompt
  enterPrisonId: 'Enter Prisoner ID',
  enterPrisonIdHint: 'Type the ID then press Confirm',

  // Numeric keypad aria-labels
  keypadDigit: 'Digit {{digit}}',
  keypadClear: 'Clear all',
  keypadBackspace: 'Delete last character',
  keypadSubmit: 'Confirm',

  // Prisoner name confirmation header (shown after successful lookup)
  confirmName: 'Confirm Recipient',
  name: 'Name',
  prisonId: 'Prisoner ID',
  zone: 'Zone',
  cell: 'Cell',
  notAvailable: 'Not available',

  // Menu / price labels
  menuLabel: 'Menu',
  noMenu: 'No items available right now.',

  // Order builder
  pickItemsHint: 'Choose the items to order',
  qtyDecrease: 'Decrease quantity of {{item}}',
  qtyIncrease: 'Increase quantity of {{item}}',
  subtotal: 'Subtotal',
  chooseMethod: 'Choose payment method',
  methodCash: 'Cash',
  methodBank: 'Bank transfer',
  placeOrder: 'Place order',
  submitting: 'Submitting…',
  orderError: 'Could not place the order. Please try again.',
  // Shown when a pending order already exists for this prisoner today (409).
  alreadyPending: 'An order is already pending for this person today. Please see the cashier.',

  // Confirmation screen
  orderPlaced: 'Order placed successfully!',
  confirmationCode: 'Confirmation code',
  giveCodeToCashier: 'Please give this code to the cashier to pay.',
  newOrder: 'New order',

  // Bank-transfer (offline VietQR) screen — shown after a bank order
  bankTransferTitle: 'Bank transfer',
  bankAccountName: 'Account holder',
  bankAccountNumber: 'Account number',
  bankAmount: 'Amount',
  bankMemo: 'Transfer content',
  bankInstruction:
    'Scan the QR and transfer the exact amount and content above, then give the confirmation code to the cashier.',

  // Clear / start over
  startOver: 'Start over',

  // Not-found message
  notFound: 'Prisoner not found. Please check the ID and try again.',
  backToEntry: 'Re-enter ID',

  // Loading state
  loading: 'Loading…',
  categoryFood: 'Food',
  categoryEssential: 'Essential goods',
  categorySummary: 'Category purchase limits',
  categoryUnlimited: 'Unlimited',
  categoryRemaining: '{{amount}} remaining',
  categoryExceeded: 'Exceeds the limit by {{amount}}',
  limitsChanged: 'Limits changed. Refresh and review this order before trying again.',
  refreshLimits: 'Refresh limits',
  toastBlockedCategoryLimit: 'Reduce the exceeded category total before placing the order.',
  categoryLimitWarning: '{{category}} subtotal {{actualAmount}} exceeds the {{limitAmount}} limit.',

} as const;

export default kiosk;
