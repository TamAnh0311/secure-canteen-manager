// Vietnamese strings for the global menu configuration screen.
// Source of truth — keep en/menu.ts key-for-key in sync (locale-parity.test.ts).
const menu = {
  // Page header
  pageTitle: 'Thực đơn dùng chung',
  pageSubtitle: 'Quản lý danh sách món áp dụng cho mọi đơn hàng.',

  // Lock notice — shown once the OMR form has been generated. Reorder, rename,
  // and hard-delete are permanently disabled; only soft-toggling active stays.
  lockedNotice:
    'Thực đơn đã khóa sau khi tạo phiếu OMR. Không thể sửa tên, sắp xếp hay xóa món; vẫn có thể sửa giá, phân loại và trạng thái.',

  // Table columns
  colCode: 'Mã',
  colName: 'Tên món',
  colPrice: 'Giá',
  colCategory: 'Phân loại',
  colActive: 'Hoạt động',
  colPosition: '#',
  colActions: '',

  // Empty state
  noItems: 'Chưa có món nào.',

  // Row controls
  active: 'Đang bật',
  off: 'Đã tắt',
  moveUp: 'Chuyển lên',
  moveDown: 'Chuyển xuống',
  edit: 'Sửa',
  remove: 'Xóa',

  // Add form
  addLabel: 'Tên món',
  addPlaceholder: 'Nhập tên món…',
  addPriceLabel: 'Giá (₫)',
  addPricePlaceholder: '0',
  addCategoryLabel: 'Phân loại',
  addButton: '+ Thêm món',

  // Edit dialog
  editTitle: 'Sửa món',
  editNameLabel: 'Tên món',
  editPriceLabel: 'Giá (₫)',
  editCategoryLabel: 'Phân loại',
  editSave: 'Lưu',
  editCancel: 'Hủy',

  // Delete dialog
  deleteTitle: 'Xóa món',
  deleteConfirm: 'Xóa món "{{name}}" khỏi thực đơn?',
  deleteConfirmButton: 'Xóa',
  deleteCancel: 'Hủy',

  // Generate form action
  generateForm: 'Tạo & in phiếu',
  formGenerated: 'Đã tạo phiếu lúc {{time}}',
  formNotGenerated: 'Chưa tạo phiếu',

  // Toasts
  toastCreated: 'Đã thêm món.',
  toastUpdated: 'Đã cập nhật món.',
  toastRemoved: 'Đã xóa món.',
  toastReordered: 'Đã sắp xếp lại thực đơn.',
  toastToggled: 'Đã đổi trạng thái món.',
  toastError: 'Thao tác thất bại. Vui lòng thử lại.',
  categoryFood: 'Đồ ăn',
  categoryEssential: 'Đồ thiết yếu',
  purchaseLimitsTitle: 'Giới hạn mua mỗi đơn',
  purchaseLimitsHelp: 'Đặt giới hạn độc lập theo phân loại cho đơn phạm nhân và đơn người thân.',
  audiencePrisoner: 'Đơn phạm nhân',
  audienceVisitor: 'Đơn người thân',
  enableLimit: 'Bật giới hạn {{category}} cho {{audience}}',
  limitAmount: 'Giới hạn {{category}} (₫)',
  limitInvalid: 'Nhập số tiền nguyên lớn hơn 0.',
  saveLimits: 'Lưu giới hạn',
  toastLimitsSaved: 'Đã lưu giới hạn mua.',
  limitsLoadError: 'Không thể tải giới hạn mua.',
} as const;

export default menu;
