const scan = {
  // Page header
  pageTitle: 'Scan monitor',
  pageSubtitle: 'Live sheet feed · newest first',

  // Actions
  resumeFeed: 'Resume feed',
  pauseFeed: 'Pause feed',
  verifyFlagged: 'Verify flagged ({{count}})',
  generateRecord: 'Generate demo OMR record',
  uploadScans: 'Upload real scans',
  uploadScansHint: 'Select one or more real JPG/PNG scans and send them through the production ingestion path.',
  showingSheet: 'Showing uploaded sheet {{sheetId}}',
  clearShowingSheet: 'Clear selection',
  toastRecordGenerated: 'OMR record generated · added to verify queue',
  toastRecordFailed: 'Could not generate OMR record',

  // KPI labels
  kpiPendingEvidence: 'Pending evidence',
  kpiReady: 'Ready to confirm',
  kpiNeedsReview: 'Needs review',
  kpiIntegrityFault: 'Integrity faults',
  kpiRejected: 'Rejected',

  // Table card
  incomingSheets: 'Incoming sheets',
  feedPaused: '⏸ paused',
  feedAutoRefresh: '⟳ auto-refresh',

  // Table columns
  colSheetId: 'Sheet ID',
  colBatch: 'Batch',
  colSource: 'Source',
  colAvgConf: 'Avg conf.',
  colStatus: 'Status',
  colTime: 'Time',

  // Table body
  noSheetsYet: 'No sheets yet',

  // Row action
  verifyButton: 'Verify',
  sourceOmr: 'Legacy OMR',
  sourceScannerReady: 'Scanner · ready',
  sourceScannerReview: 'Scanner · review',

  // Live region announcement (interpolated)
  statusAnnouncement: '{{ready}} ready to confirm, {{needsReview}} needing review, {{rejected}} rejected',
} as const;

export default scan;
