const users = {
  // Page header
  pageTitle: 'Phạm nhân',
  pageSubtitle: 'Chỉ đọc · đồng bộ từ SQL Server 2005 cũ (CSDL nhân sự).',

  // Search / filter
  searchPlaceholder: 'Tìm mã / tên…',
  searchAriaLabel: 'Tìm kiếm phạm nhân',
  zonePlaceholder: 'Khu giam…',
  zoneAriaLabel: 'Lọc theo khu giam',

  // Sync button
  syncNow: '↻ Đồng bộ ngay',

  // Sync status banner
  lastSync: 'Đồng bộ lần cuối',
  syncRowCount: '· {{n}} phạm nhân',
  syncRunning: '· đang chạy…',

  // Sync error banner
  syncError: 'Lỗi đồng bộ: {{message}}',
  syncStatusError: 'Không thể tải trạng thái đồng bộ: {{message}}',

  // Toast messages
  toastSyncSkipped: 'Bỏ qua đồng bộ: {{reason}}',
  toastSyncSuccess: 'Đã kích hoạt đồng bộ thành công.',
  toastSyncFailed: 'Đồng bộ thất bại.',

  // Card header
  directoryTitle: 'Danh bạ · {{count}} phạm nhân',
  directoryHint: 'Chỉ đọc — chỉnh sửa trong hệ thống nhân sự.',

  // Table columns
  colEmpId: 'Mã phạm nhân',
  colName: 'Tên',
  colZone: 'Khu giam',
  colBalance: 'Số dư',
  colStatus: 'Trạng thái',
  colDetention: 'Diện giam giữ',
  colDob: 'Ngày sinh',
  colSynced: 'Đồng bộ',

  // User active status chips
  statusActive: 'hoạt động',
  statusInactive: 'ngừng hoạt động',

  // Empty row
  emptySearch: 'Không tìm thấy phạm nhân phù hợp.',
  emptyDefault: 'Không tìm thấy phạm nhân.',
} as const;

export default users;
