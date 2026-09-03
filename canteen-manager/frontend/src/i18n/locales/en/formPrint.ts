const formPrint = {
  // Page header
  pageTitle: 'OMR Calibration Template',
  pageSubtitle: 'Generate and inspect each A5 scan geometry independently.',

  // Actions
  generateForm: 'Generate calibration template',
  regenerateForm: 'Regenerate calibration template',
  codeTitle: 'Code-entry template',
  codeGeometry: 'A5 portrait · 2 columns × 6 lines',
  fullListTitle: 'Full-list template',
  fullListGeometry: 'A5 landscape · 4 columns × 13 rows',
  generateCode: 'Generate code-entry template',
  regenerateCode: 'Regenerate code-entry template',
  generateFullList: 'Generate full-list template',
  regenerateFullList: 'Regenerate full-list template',

  // Status line
  formNotGenerated: 'No form generated yet. The menu can still be edited.',
  formGenerated: 'Form generated {{time}} (version {{version}}). The menu is now locked.',
  templateNotGenerated: 'No active template generated yet.',
  templateGenerated: 'Active template generated {{time}} (version {{version}}).',
  templateUnavailableCapacity: 'Unavailable: {{count}} active items exceeds the {{capacity}}-item capacity.',
  templateUnavailable: 'Unavailable for the current menu.',

  // Toast messages
  toastGenerated: 'Form generated — ROI template stored on server.',
  toastGenerateFailed: 'Failed to generate form.',

  // PDF preview card
  pdfPreviewTitle: 'Calibration PDF preview',
  pdfPreviewModeTitle: '{{mode}} calibration PDF preview',
  printButton: '⎙ Print',
  downloadButton: '↓ Download',
  iframeTitle: 'OMR form preview',
  codeIframeTitle: 'Code-entry OMR form preview',
  fullListIframeTitle: 'Full-list OMR form preview',
  calibrationOnly: 'CALIBRATION / NOT FOR ORDERS. Operational forms must be issued from Issue Order Form.',
} as const;

export default formPrint;
