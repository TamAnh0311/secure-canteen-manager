const dashboard = {
  title: 'Hôm nay · {{date}}',

  // Date-range filter (drives the KPI counts below)
  dateRangeLabel: 'Khoảng ngày',

  // Menu / form status card
  menuStatusTitle: 'Thực đơn & phiếu',
  manageMenu: 'Quản lý thực đơn →',
  menuItemCount_one: '{{count}} món trong thực đơn',
  menuItemCount_other: '{{count}} món trong thực đơn',
  formGenerated: 'Đã tạo phiếu lúc {{time}}',
  formNotGenerated: 'Chưa tạo phiếu',

  quickActions: 'Thao tác nhanh',
  tabletConnection: 'Kết nối máy tính bảng',
  tabletHint: 'Quét mã QR bằng máy tính bảng để mở trang đặt hàng',
  kitchenSummary: '▥ Tổng kết bếp',
  viewOrders: '☰ Xem đơn hàng',
  openCanteen: '▦ Căn tin',
  openCounter: '▤ Quầy thu ngân',
  kpi: {
    totalOrders: 'Tổng đơn',
    pending: 'Chờ thanh toán',
    paidOrders: 'Đã thanh toán',
    revenue: 'Doanh thu',
  },
} as const;

export default dashboard;
