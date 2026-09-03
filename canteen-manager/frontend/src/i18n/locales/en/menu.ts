// English strings for the global menu configuration screen.
// Must stay key-for-key in sync with vi/menu.ts — locale-parity.test.ts enforces this.
const menu = {
  // Page header
  pageTitle: 'Shared menu',
  pageSubtitle: 'Manage the item list applied to every order.',

  // Lock notice — shown once the OMR form has been generated. Reorder, rename,
  // and hard-delete are permanently disabled; only soft-toggling active stays.
  lockedNotice:
    'The menu is locked after the OMR form was generated. Renaming, reordering, and deleting are disabled; price, category, and active status remain editable.',

  // Table columns
  colCode: 'Code',
  colName: 'Item',
  colPrice: 'Price',
  colCategory: 'Category',
  colActive: 'Active',
  colPosition: '#',
  colActions: '',

  // Empty state
  noItems: 'No items yet.',

  // Row controls
  active: 'On',
  off: 'Off',
  moveUp: 'Move up',
  moveDown: 'Move down',
  edit: 'Edit',
  remove: 'Remove',

  // Add form
  addLabel: 'Item name',
  addPlaceholder: 'Enter item name…',
  addPriceLabel: 'Price (₫)',
  addPricePlaceholder: '0',
  addCategoryLabel: 'Category',
  addButton: '+ Add item',

  // Edit dialog
  editTitle: 'Edit item',
  editNameLabel: 'Item name',
  editPriceLabel: 'Price (₫)',
  editCategoryLabel: 'Category',
  editSave: 'Save',
  editCancel: 'Cancel',

  // Delete dialog
  deleteTitle: 'Remove item',
  deleteConfirm: 'Remove "{{name}}" from the menu?',
  deleteConfirmButton: 'Remove',
  deleteCancel: 'Cancel',

  // Generate form action
  generateForm: 'Generate & print form',
  formGenerated: 'Form generated at {{time}}',
  formNotGenerated: 'No form generated yet',

  // Toasts
  toastCreated: 'Item added.',
  toastUpdated: 'Item updated.',
  toastRemoved: 'Item removed.',
  toastReordered: 'Menu reordered.',
  toastToggled: 'Item toggled.',
  toastError: 'Action failed. Please try again.',
  categoryFood: 'Food',
  categoryEssential: 'Essential goods',
  purchaseLimitsTitle: 'Purchase limits per order',
  purchaseLimitsHelp: 'Set independent category limits for prisoner and visitor orders.',
  audiencePrisoner: 'Prisoner order',
  audienceVisitor: 'Visitor order',
  enableLimit: 'Enable {{audience}} {{category}} limit',
  limitAmount: '{{category}} limit (₫)',
  limitInvalid: 'Enter a positive whole-number amount.',
  saveLimits: 'Save limits',
  toastLimitsSaved: 'Purchase limits saved.',
  limitsLoadError: 'Could not load purchase limits.',
} as const;

export default menu;
