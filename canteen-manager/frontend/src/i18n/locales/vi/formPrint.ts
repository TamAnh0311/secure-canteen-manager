const formPrint = {
  // Page header
  pageTitle: 'Mẫu căn chỉnh OMR',
  pageSubtitle: 'Tạo và kiểm tra riêng từng hình học quét A5.',

  // Actions
  generateForm: 'Tạo mẫu căn chỉnh',
  regenerateForm: 'Tạo lại mẫu căn chỉnh',
  codeTitle: 'Mẫu nhập mã',
  codeGeometry: 'A5 dọc · 2 cột × 6 dòng',
  fullListTitle: 'Mẫu danh sách đầy đủ',
  fullListGeometry: 'A5 ngang · 4 cột × 13 dòng',
  generateCode: 'Tạo mẫu nhập mã',
  regenerateCode: 'Tạo lại mẫu nhập mã',
  generateFullList: 'Tạo mẫu danh sách đầy đủ',
  regenerateFullList: 'Tạo lại mẫu danh sách đầy đủ',

  // Status line
  formNotGenerated: 'Chưa tạo phiếu. Thực đơn vẫn có thể chỉnh sửa.',
  formGenerated: 'Đã tạo phiếu lúc {{time}} (phiên bản {{version}}). Thực đơn đã bị khoá.',
  templateNotGenerated: 'Chưa tạo mẫu đang hoạt động.',
  templateGenerated: 'Đã tạo mẫu đang hoạt động lúc {{time}} (phiên bản {{version}}).',
  templateUnavailableCapacity: 'Không khả dụng: {{count}} món đang hoạt động vượt quá sức chứa {{capacity}} món.',
  templateUnavailable: 'Không khả dụng với thực đơn hiện tại.',

  // Toast messages
  toastGenerated: 'Đã tạo phiếu — mẫu ROI đã lưu trên máy chủ.',
  toastGenerateFailed: 'Không thể tạo phiếu.',

  // PDF preview card
  pdfPreviewTitle: 'Xem trước PDF căn chỉnh',
  pdfPreviewModeTitle: 'Xem trước PDF căn chỉnh — {{mode}}',
  printButton: '⎙ In',
  downloadButton: '↓ Tải xuống',
  iframeTitle: 'Xem trước phiếu OMR',
  codeIframeTitle: 'Xem trước phiếu OMR nhập mã',
  fullListIframeTitle: 'Xem trước phiếu OMR danh sách đầy đủ',
  calibrationOnly: 'CHỈ DÙNG CĂN CHỈNH / KHÔNG DÙNG ĐẶT HÀNG. Phiếu thật phải được phát hành tại mục Phát hành phiếu.',
} as const;

export default formPrint;
