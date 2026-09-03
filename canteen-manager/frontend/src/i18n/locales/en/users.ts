const users = {
  // Page header
  pageTitle: 'Prisoners',
  pageSubtitle: 'Read-only · synced from legacy SQL Server 2005 (HR DB).',

  // Search / filter
  searchPlaceholder: 'Search ID / name…',
  searchAriaLabel: 'Search prisoners',
  zonePlaceholder: 'Zone…',
  zoneAriaLabel: 'Filter by zone',

  // Sync button
  syncNow: '↻ Sync now',

  // Sync status banner
  lastSync: 'Last sync',
  syncRowCount: '· {{n}} prisoners',
  syncRunning: '· running…',

  // Sync error banner
  syncError: 'Sync error: {{message}}',
  syncStatusError: 'Could not load sync status: {{message}}',

  // Toast messages
  toastSyncSkipped: 'Sync skipped: {{reason}}',
  toastSyncSuccess: 'Sync triggered successfully.',
  toastSyncFailed: 'Sync failed.',

  // Card header
  directoryTitle: 'Directory · {{count}} prisoners',
  directoryHint: 'Read-only mirror — edits happen in the HR system.',

  // Table columns
  colEmpId: 'Prisoner ID',
  colName: 'Name',
  colZone: 'Zone',
  colBalance: 'Balance',
  colStatus: 'Status',
  colDetention: 'Detention status',
  colDob: 'DOB',
  colSynced: 'Synced',

  // User active status chips
  statusActive: 'active',
  statusInactive: 'inactive',

  // Empty row
  emptySearch: 'No prisoners match your search.',
  emptyDefault: 'No prisoners found.',
} as const;

export default users;
