// Vietnamese strings for the admin balance/ledger audit view.
// Source of truth — keep en/accounts.ts key-for-key in sync.
const accounts = {
  // Page header
  pageTitle: 'Kiểm toán số dư',
  pageSubtitle: 'Tra cứu số dư và lịch sử giao dịch của phạm nhân (chỉ admin).',

  // Prisoner search
  searchPlaceholder: 'Nhập mã phạm nhân hoặc tên…',
  searchAriaLabel: 'Tìm kiếm phạm nhân để kiểm toán',
  searchResultsLabel: 'Kết quả tìm kiếm',
  searchNoMatch: 'Không tìm thấy phạm nhân phù hợp.',

  // Prisoner selection prompt
  selectPrisonerPrompt: 'Chọn phạm nhân để xem số dư và lịch sử giao dịch.',

  // Balance display
  balanceLabel: 'Số dư hiện tại',

  // Detainee profile (read-only)
  profileDob: 'Ngày sinh',
  profileHometown: 'Quê quán',
  profileOffense: 'Tội danh',
  profileArrestDate: 'Ngày bắt',
  profileDetention: 'Diện giam giữ',

  // Ledger table headers
  colDate: 'Ngày',
  colType: 'Loại',
  colAmount: 'Số tiền',
  colBalanceAfter: 'Số dư sau',
  colMethod: 'Phương thức',
  colRef: 'Tham chiếu',
  colOperator: 'Nhân viên vận hành',
  colNote: 'Ghi chú',

  // Transaction type labels
  typeTopup: 'Nạp tiền',
  typeOrderDebit: 'Trừ tiền đơn hàng',
  typeReversal: 'Hoàn tiền',

  // Pagination
  prev: '← Trước',
  next: 'Tiếp →',
  pageInfo: 'Trang {{page}}',

  // Empty / loading / error states
  ledgerEmpty: 'Chưa có giao dịch nào.',
  loading: 'Đang tải…',
  balanceError: 'Không thể tải số dư: {{message}}',
  ledgerError: 'Không thể tải lịch sử giao dịch: {{message}}',
} as const;

export default accounts;
