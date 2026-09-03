const scan = {
  // Page header
  pageTitle: 'Giám sát quét',
  pageSubtitle: 'Luồng phiếu trực tiếp · mới nhất trước',

  // Actions
  resumeFeed: 'Tiếp tục luồng',
  pauseFeed: 'Tạm dừng luồng',
  verifyFlagged: 'Xét duyệt cần xử lý ({{count}})',
  generateRecord: 'Tạo bản ghi OMR mẫu',
  uploadScans: 'Tải ảnh quét thật',
  uploadScansHint: 'Chọn một hoặc nhiều ảnh JPG/PNG thật và gửi qua luồng tiếp nhận chính thức.',
  showingSheet: 'Đang hiển thị phiếu {{sheetId}}',
  clearShowingSheet: 'Bỏ chọn',
  toastRecordGenerated: 'Đã tạo bản ghi OMR · vào hàng đợi xét duyệt',
  toastRecordFailed: 'Không thể tạo bản ghi OMR',

  // KPI labels
  kpiPendingEvidence: 'Chờ bằng chứng',
  kpiReady: 'Sẵn sàng xác nhận',
  kpiNeedsReview: 'Cần xét duyệt',
  kpiIntegrityFault: 'Lỗi toàn vẹn',
  kpiRejected: 'Từ chối',

  // Table card
  incomingSheets: 'Phiếu đến',
  feedPaused: '⏸ đã tạm dừng',
  feedAutoRefresh: '⟳ tự động làm mới',

  // Table columns
  colSheetId: 'Mã phiếu',
  colBatch: 'Lô',
  colSource: 'Nguồn',
  colAvgConf: 'Độ tin TB.',
  colStatus: 'Trạng thái',
  colTime: 'Thời gian',

  // Table body
  noSheetsYet: 'Chưa có phiếu',

  // Row action
  verifyButton: 'Xét duyệt',
  sourceOmr: 'OMR cũ',
  sourceScannerReady: 'Máy quét · sẵn sàng',
  sourceScannerReview: 'Máy quét · cần xem',

  // Live region announcement (interpolated)
  statusAnnouncement: '{{ready}} phiếu sẵn sàng xác nhận, {{needsReview}} phiếu cần xét duyệt, {{rejected}} từ chối',
} as const;

export default scan;
