CÔNG TY ………………………
-----✵-----




HƯỚNG DẪN SỬ DỤNG
PHẦN MỀM QUẢN LÝ CĂNG-TIN
TẠI CÁC TRẠI TẠM GIAM, NHÀ TẠM GIỮ
CÔNG AN CÁC ĐƠN VỊ, ĐỊA PHƯƠNG




HÀ NỘI, NĂM 2026


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MỤC LỤC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I. Giới thiệu về phần mềm .................................................. 3
II. Đăng nhập hệ thống ...................................................... 3
III. Bảng điều khiển tổng quan (Dashboard) .............................. 4
1. Quản lý đơn hàng ......................................................... 5
   1.1. Danh sách đơn hàng .................................................. 5
      1.1.1. Tìm kiếm ........................................................ 5
      1.1.2. Xem chi tiết đơn hàng .......................................... 6
   1.2. Phiếu giao nhận hàng hóa (Delivery Vouchers) .................... 6
   1.3. Tổng hợp bếp (Kitchen Summary) .................................... 7
2. Quầy thu ngân (Counter) .................................................. 8
   2.1. Tra cứu thông tin can phạm nhân .................................... 8
   2.2. Nạp tiền tài khoản lưu ký .......................................... 9
   2.3. Duyệt đơn hàng chờ .................................................. 10
   2.4. Đặt hàng từ thân nhân .............................................. 11
3. Quản lý danh mục hàng hóa (Menu) ....................................... 12
   3.1. Danh sách hàng hóa ................................................. 12
   3.2. Thêm mới mặt hàng ................................................. 13
   3.3. Sửa mặt hàng ....................................................... 13
   3.4. Vô hiệu hóa mặt hàng .............................................. 14
4. Quản lý tài khoản lưu ký (Accounts) .................................... 14
5. Xác minh phiếu quét (Verify) ........................................... 15
   5.1. Danh sách phiếu cần xác minh ...................................... 15
   5.2. Xác minh danh tính ................................................. 16
   5.3. Xác nhận mặt hàng ................................................. 16
6. Giám sát quét phiếu (Scan Monitor) ..................................... 17
7. Tải phiếu quét lên (Scan Upload) ....................................... 17
8. Quản lý biểu mẫu OMR (Form Print) ..................................... 18
9. Nhập đơn hàng thủ công (Order Form) .................................... 19
10. Quản lý cán bộ (Operators) ............................................ 20
11. Cấu hình thanh toán (Payment Config) .................................. 21
12. Cấu hình hạn mức mua hàng (Purchase Limit Config) .................... 22
13. Kiosk – Đặt hàng tự phục vụ .......................................... 22
IV. Ứng dụng Desktop (Electron) ............................................ 23


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NỘI DUNG CHI TIẾT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


I. Giới thiệu về phần mềm

Phần mềm "Quản lý Căng-tin Trại tạm giam" (Canteen Manager) là hệ thống quản lý hoạt động mua bán lương thực, thực phẩm, đồ dùng sinh hoạt tại các Trại tạm giam, Nhà tạm giữ Công an các đơn vị, địa phương. Phần mềm hỗ trợ toàn bộ quy trình từ tiếp nhận đơn hàng (qua phiếu quét OMR, kiosk, nhập thủ công, đặt từ thân nhân), quản lý tài khoản lưu ký, thanh toán, in phiếu giao nhận, đến tổng hợp đơn hàng cho bếp và báo cáo thống kê.

Phần mềm hỗ trợ 02 hình thức triển khai:
- Hình thức 1 – Máy chủ (Docker): Dành cho cơ sở có hạ tầng máy chủ, sử dụng cơ sở dữ liệu PostgreSQL, triển khai qua Docker Compose.
- Hình thức 2 – Cài đặt cá nhân (Electron): Dành cho cơ sở nhỏ hoặc điểm xa, cài đặt trực tiếp trên máy tính Windows, sử dụng cơ sở dữ liệu SQLite.

Sử dụng các trình duyệt Chrome, Firefox, Edge (phiên bản mới nhất) để truy cập phần mềm theo địa chỉ mạng nội bộ do quản trị viên cung cấp.

Yêu cầu hệ thống tối thiểu:
- Máy chủ: Ubuntu 20.04+, RAM 4GB, HDD 50GB, Docker Engine
- Máy cá nhân (Electron): Windows 10/11 64-bit, RAM 4GB, HDD 10GB
- Máy trạm: Trình duyệt Chrome/Firefox/Edge phiên bản mới nhất


II. Đăng nhập hệ thống

Bước 1: Mở trình duyệt web, nhập địa chỉ phần mềm do quản trị viên cung cấp (ví dụ: http://192.168.1.100:3000).

Bước 2: Màn hình hiển thị giao diện đăng nhập. Anh/Chị nhập:
- Tên đăng nhập: tài khoản được cấp phát (ví dụ: admin, operator01, cashier01)
- Mật khẩu: mật khẩu tương ứng

Bước 3: Click nút "Đăng nhập" để truy cập hệ thống.

Lưu ý:
- Phiên đăng nhập có hiệu lực trong 12 giờ. Sau 12 giờ, hệ thống sẽ tự động đăng xuất và yêu cầu đăng nhập lại.
- Tùy theo vai trò được phân quyền (ADMIN/OPERATOR/CASHIER), giao diện sẽ hiển thị các chức năng tương ứng.
- Cán bộ được phân vùng theo khu giam; chỉ có thể xem và thao tác với dữ liệu trong phạm vi khu giam được phân công.


III. Bảng điều khiển tổng quan (Dashboard)

Sau khi đăng nhập thành công, hệ thống hiển thị màn hình Bảng điều khiển tổng quan (Dashboard).

Bảng điều khiển hiển thị các thông tin chính:
- Tổng số đơn hàng
- Số đơn hàng chờ duyệt (Pending)
- Số đơn hàng đã thanh toán (Paid)
- Tổng doanh thu

Thanh điều hướng bên trái hiển thị các danh mục chức năng tùy theo vai trò:

Vai trò ADMIN (Quản trị viên):
- Dashboard (Bảng điều khiển)
- Orders (Quản lý đơn hàng)
- Delivery Vouchers (Phiếu giao nhận)
- Kitchen Summary (Tổng hợp bếp)
- Counter (Quầy thu ngân)
- Menu Config (Quản lý danh mục)
- Accounts (Tài khoản lưu ký)
- Verify (Xác minh phiếu quét)
- Scan Monitor (Giám sát quét)
- Scan Upload (Tải phiếu quét)
- Form Print (In biểu mẫu OMR)
- Order Form (Nhập đơn thủ công)
- Operators (Quản lý cán bộ)
- Payment Config (Cấu hình thanh toán)

Vai trò OPERATOR (Cán bộ nghiệp vụ):
- Dashboard, Orders, Kitchen Summary, Verify, Scan Monitor, Scan Upload, Order Form

Vai trò CASHIER (Thu ngân):
- Dashboard, Counter


1. Quản lý đơn hàng

Danh mục "Quản lý đơn hàng" bao gồm các chức năng con:
- Danh sách đơn hàng (Orders)
- Phiếu giao nhận hàng hóa (Delivery Vouchers)
- Tổng hợp bếp (Kitchen Summary)

1.1. Danh sách đơn hàng

1.1.1. Tìm kiếm

Bước 1: Tại thanh menu, anh/chị chọn "Orders" (Đơn hàng). Hệ thống hiển thị màn hình danh sách đơn hàng.

Bước 2: Anh/Chị có thể lọc danh sách theo các tiêu chí:
- Khoảng thời gian (ngày bắt đầu – ngày kết thúc)
- Trạng thái đơn hàng: ACTIVE (Đang hoạt động), SUPERSEDED (Đã thay thế), REJECTED (Đã từ chối)
- Trạng thái thanh toán: PAID (Đã thanh toán), UNPAID (Chưa thanh toán)
- Nguồn đặt hàng: omr (quét phiếu), scanner (máy quét), relative (thân nhân), manual (nhập thủ công)

Bước 3: Click nút "Tìm kiếm" để hiển thị kết quả.

Danh sách đơn hàng hiển thị các thông tin:
- Mã đơn hàng
- Họ tên can phạm nhân
- Mã lưu ký
- Buồng giam / Khu giam
- Ngày giao hàng (Service Date)
- Nguồn đặt hàng
- Tổng tiền
- Trạng thái đơn hàng
- Trạng thái thanh toán

1.1.2. Xem chi tiết đơn hàng

Bước 1: Tại danh sách đơn hàng, anh/chị click vào đơn hàng cần xem.

Bước 2: Hệ thống hiển thị màn hình chi tiết đơn hàng bao gồm:
- Thông tin can phạm nhân: Họ tên, Mã lưu ký, Buồng giam, Khu giam
- Thông tin đơn hàng: Mã đơn, Ngày tạo, Ngày giao hàng, Nguồn đặt hàng, Trạng thái
- Danh sách mặt hàng: STT, Tên hàng hóa, Mã hàng, Số lượng, Đơn giá, Thành tiền
- Tổng cộng tiền đơn hàng
- Thông tin thanh toán: Phương thức, Cán bộ duyệt, Thời gian duyệt
- Lịch sử thay thế (nếu đơn hàng đã bị thay thế bởi đơn mới)

1.2. Phiếu giao nhận hàng hóa (Delivery Vouchers)

Chức năng này cho phép tạo và in phiếu giao nhận hàng hóa (tương đương biểu mẫu TG8) để sử dụng khi giao hàng cho can phạm nhân.

Bước 1: Tại thanh menu, anh/chị chọn "Delivery Vouchers" (Phiếu giao nhận).

Bước 2: Chọn ngày giao hàng cần tạo phiếu. Hệ thống tổng hợp tất cả đơn hàng đã thanh toán (PAID) của ngày đó.

Bước 3: Hệ thống hiển thị danh sách phiếu giao nhận, mỗi phiếu bao gồm:
- Thông tin can phạm nhân: Họ tên, Mã lưu ký, Buồng giam, Khu giam
- Danh sách mặt hàng: Tên hàng, Số lượng, Đơn giá, Thành tiền
- Tổng tiền đơn hàng
- Số dư tài khoản còn lại (tại thời điểm tạo phiếu)
- Thời gian tạo phiếu

Bước 4: Anh/Chị click "In phiếu" để in phiếu giao nhận. Hệ thống tự động tải file về máy tính, anh/chị có thể xem, chỉnh sửa và in.

1.3. Tổng hợp bếp (Kitchen Summary)

Chức năng này tổng hợp toàn bộ đơn hàng đã thanh toán theo ngày giao hàng, hiển thị số lượng từng mặt hàng cần chuẩn bị cho bộ phận bếp.

Bước 1: Tại thanh menu, anh/chị chọn "Kitchen Summary" (Tổng hợp bếp).

Bước 2: Chọn ngày giao hàng cần tổng hợp.

Bước 3: Hệ thống hiển thị bảng tổng hợp:
- STT
- Tên mặt hàng
- Mã hàng
- Phân loại (Thực phẩm / Đồ dùng thiết yếu)
- Tổng số lượng cần chuẩn bị
- Đơn giá
- Tổng thành tiền

Bước 4: Anh/Chị có thể in bảng tổng hợp để chuyển cho bộ phận bếp.


2. Quầy thu ngân (Counter)

Phân hệ Quầy thu ngân (Counter) dành cho cán bộ có vai trò CASHIER hoặc ADMIN, thực hiện các nghiệp vụ: tra cứu thông tin can phạm nhân, nạp tiền lưu ký, duyệt đơn hàng, đặt hàng từ thân nhân.

2.1. Tra cứu thông tin can phạm nhân

Bước 1: Tại thanh menu, anh/chị chọn "Counter" (Quầy thu ngân).

Bước 2: Tại ô tìm kiếm, nhập mã lưu ký (prisoner ID) của can phạm nhân cần tra cứu.

Bước 3: Click "Tìm kiếm" hoặc nhấn Enter. Hệ thống hiển thị thông tin:
- Họ tên can phạm nhân
- Mã lưu ký
- Buồng giam / Khu giam
- Số dư tài khoản hiện tại (VND)
- Hạn mức chi tiêu còn lại trong tháng
- Lịch sử giao dịch gần đây (5 giao dịch mới nhất)

2.2. Nạp tiền tài khoản lưu ký

Sau khi tra cứu thông tin can phạm nhân (mục 2.1):

Bước 1: Anh/Chị click nút "Nạp tiền" (Top-up).

Bước 2: Hệ thống hiển thị hộp thoại "Nạp tiền tài khoản lưu ký":
- Họ tên can phạm nhân (tự động hiển thị)
- Mã lưu ký (tự động hiển thị)
- Số dư hiện tại (tự động hiển thị)
- Số tiền nạp (*): Nhập số tiền cần nạp (VND)

Bước 3: Anh/Chị nhập số tiền nạp và click "Xác nhận".

Bước 4: Hệ thống thông báo "Thao tác thành công":
- Giao dịch TOPUP được ghi vào sổ cái
- Số dư tài khoản được cập nhật tự động
- Thông tin cán bộ thực hiện được ghi nhận

Lưu ý: Giao dịch nạp tiền sau khi xác nhận không thể sửa hoặc xóa (mô hình sổ cái bất biến). Nếu nạp sai, cán bộ cần thực hiện giao dịch hoàn tiền (REFUND) riêng.

2.3. Duyệt đơn hàng chờ

Bước 1: Tại giao diện Counter, anh/chị chọn tab "Đơn hàng chờ duyệt" (Pending Orders).

Bước 2: Hệ thống hiển thị danh sách đơn hàng có trạng thái UNPAID, bao gồm:
- Mã đơn hàng
- Họ tên can phạm nhân
- Mã lưu ký
- Danh sách mặt hàng (tên, số lượng, đơn giá)
- Tổng tiền
- Nguồn đặt hàng (omr/scanner/kiosk/manual)
- Thời gian tạo đơn

Bước 3: Anh/Chị chọn đơn hàng cần duyệt, hệ thống hiển thị chi tiết.

Bước 4: Anh/Chị chọn thao tác:

a) Duyệt đơn hàng – Click "Duyệt" (Approve):
- Chọn phương thức thanh toán:
  + "Trừ số dư" (Balance): Tự động trừ tiền từ tài khoản lưu ký. Hệ thống kiểm tra số dư đủ trước khi duyệt.
  + "Tiền mặt" (Cash): Ghi nhận thanh toán tiền mặt.
  + "Chuyển khoản" (Bank): Nhập mã giao dịch chuyển khoản và số tiền nhận được.
- Hệ thống cập nhật trạng thái đơn hàng thành PAID, ghi nhận giao dịch ORDER_DEBIT vào sổ cái.

b) Từ chối đơn hàng – Click "Từ chối" (Reject):
- Nhập lý do từ chối (tùy chọn).
- Hệ thống cập nhật trạng thái đơn hàng thành REJECTED.
- Nếu đã trừ tiền trước đó, hệ thống tự động tạo giao dịch ORDER_REVERSAL hoàn tiền.

2.4. Đặt hàng từ thân nhân

Chức năng này cho phép tạo đơn hàng tại quầy khi thân nhân can phạm nhân đến mua hộ.

Bước 1: Tại giao diện Counter, anh/chị click "Đặt hàng từ thân nhân" (Relative Order).

Bước 2: Nhập mã lưu ký của can phạm nhân. Hệ thống tự động hiển thị thông tin.

Bước 3: Chọn mặt hàng và số lượng từ danh mục hàng hóa:
- Danh sách mặt hàng đang bán được hiển thị
- Anh/Chị click "+" để thêm mặt hàng vào đơn, nhập số lượng
- Tổng tiền được tính tự động

Bước 4: Chọn phương thức thanh toán:
- Tiền mặt (Cash): Thân nhân thanh toán tiền mặt tại quầy
- Chuyển khoản (Bank): Thân nhân chuyển khoản; anh/chị nhập mã giao dịch và số tiền nhận

Bước 5: Click "Tạo đơn và thanh toán" (Create & Pay). Hệ thống:
- Tạo đơn hàng với trạng thái ACTIVE, nguồn "relative"
- Ghi nhận thanh toán, cập nhật trạng thái PAID
- Ghi nhận giao dịch vào sổ cái

Lưu ý: Đối với đặt hàng từ thân nhân, tiền không trừ từ tài khoản lưu ký mà do thân nhân thanh toán trực tiếp (tiền mặt hoặc chuyển khoản).


3. Quản lý danh mục hàng hóa (Menu Config)

Chức năng này cho phép Quản trị viên (ADMIN) quản lý danh mục mặt hàng căng-tin.

3.1. Danh sách hàng hóa

Bước 1: Tại thanh menu, anh/chị chọn "Menu Config" (Quản lý danh mục).

Bước 2: Hệ thống hiển thị danh sách mặt hàng bao gồm:
- STT (vị trí hiển thị)
- Mã hàng (tự động gán, duy nhất, không tái sử dụng)
- Tên mặt hàng
- Phân loại: FOOD (Thực phẩm) / ESSENTIAL (Đồ dùng thiết yếu)
- Giá bán (VND)
- Trạng thái: Đang bán (Active) / Ngừng bán (Inactive)

3.2. Thêm mới mặt hàng

Bước 1: Anh/Chị click "Thêm mới" (Add New). Hệ thống hiển thị hộp thoại "Thêm mới mặt hàng".

Bước 2: Nhập thông tin mặt hàng:
- Tên mặt hàng (*): Tên hàng hóa
- Phân loại (*): Chọn FOOD hoặc ESSENTIAL
- Giá bán (*): Nhập giá (VND)
- Vị trí hiển thị: Thứ tự hiển thị trên danh mục (tự động gán nếu để trống)

Bước 3: Click "Lưu" để thêm mặt hàng. Hệ thống thông báo "Thao tác thành công", mã hàng được tự động gán.

Lưu ý: Mã hàng được gán tự động theo thứ tự tăng dần (001, 002, 003…) và không bao giờ tái sử dụng, kể cả khi mặt hàng bị xóa.

3.3. Sửa mặt hàng

Bước 1: Tại danh sách hàng hóa, anh/chị click biểu tượng "Sửa" (Edit) trên dòng mặt hàng cần chỉnh sửa.

Bước 2: Hệ thống hiển thị hộp thoại "Cập nhật mặt hàng" với thông tin hiện tại.

Bước 3: Anh/Chị chỉnh sửa thông tin cần thay đổi (tên, giá, phân loại, vị trí).

Bước 4: Click "Cập nhật" để lưu. Hệ thống thông báo "Thao tác thành công".

Lưu ý: Mã hàng không thể thay đổi sau khi được gán.

3.4. Vô hiệu hóa mặt hàng

Bước 1: Tại danh sách hàng hóa, anh/chị click biểu tượng "Ngừng bán" trên mặt hàng cần vô hiệu hóa.

Bước 2: Hệ thống thông báo xác nhận. Click "Xác nhận" để ngừng bán.

Bước 3: Mặt hàng chuyển sang trạng thái Inactive, không hiển thị trên kiosk và danh mục đặt hàng.

Lưu ý: Mặt hàng bị vô hiệu hóa vẫn còn trong hệ thống và có thể kích hoạt lại. Các đơn hàng cũ có chứa mặt hàng này vẫn giữ nguyên.


4. Quản lý tài khoản lưu ký (Accounts)

Bước 1: Tại thanh menu, anh/chị chọn "Accounts" (Tài khoản lưu ký).

Bước 2: Nhập mã lưu ký hoặc họ tên can phạm nhân để tìm kiếm.

Bước 3: Hệ thống hiển thị thông tin tài khoản:
- Thông tin can phạm nhân: Họ tên, Mã lưu ký, Buồng giam, Khu giam
- Số dư hiện tại (VND)
- Lịch sử giao dịch (sổ cái – ledger) bao gồm:
  + Ngày giờ giao dịch
  + Loại giao dịch: TOPUP (Nạp tiền), ORDER_DEBIT (Trừ tiền đơn hàng), ORDER_REVERSAL (Hoàn tiền đơn hàng), REFUND (Hoàn tiền thủ công)
  + Số tiền giao dịch
  + Số dư sau giao dịch
  + Cán bộ thực hiện
  + Mã đơn hàng liên quan (nếu có)

Lưu ý: Sổ cái hoạt động theo mô hình chỉ thêm (insert-only). Không có giao dịch nào bị sửa hoặc xóa. Số dư tài khoản luôn bằng tổng các giao dịch.


5. Xác minh phiếu quét (Verify)

Chức năng này dành cho cán bộ xác minh các phiếu đặt hàng đã quét mà hệ thống đánh dấu cần kiểm tra (FLAGGED).

5.1. Danh sách phiếu cần xác minh

Bước 1: Tại thanh menu, anh/chị chọn "Verify" (Xác minh).

Bước 2: Hệ thống hiển thị danh sách phiếu quét có trạng thái FLAGGED, bao gồm:
- Ảnh phiếu gốc
- Kết quả nhận dạng tự động (mã lưu ký, buồng giam, mặt hàng, số lượng)
- Độ tin cậy nhận dạng
- Nguồn nạp (trình duyệt/máy quét/agent)

5.2. Xác minh danh tính

Bước 1: Anh/Chị chọn phiếu cần xác minh. Hệ thống hiển thị:
- Ảnh phiếu gốc (bên trái)
- Danh sách ứng viên được xếp hạng theo độ tin cậy (bên phải)

Bước 2: Anh/Chị chọn một trong các cách:
a) Chọn ứng viên từ danh sách đề xuất: Click vào ứng viên phù hợp.
b) Tìm kiếm thủ công: Nhập mã lưu ký hoặc họ tên để tìm đúng can phạm nhân.

Bước 3: Click "Xác nhận danh tính" để ghi nhận.

5.3. Xác nhận mặt hàng

Sau khi xác minh danh tính:

Bước 1: Hệ thống hiển thị danh sách mặt hàng nhận dạng được từ phiếu:
- Tên mặt hàng (kết quả nhận dạng)
- Mặt hàng đối chiếu trong danh mục
- Số lượng nhận dạng
- Độ tin cậy

Bước 2: Anh/Chị kiểm tra, chỉnh sửa nếu cần (sửa mặt hàng, số lượng).

Bước 3: Chọn thao tác:
a) "Phê duyệt" (Approve): Tạo đơn hàng từ kết quả xác minh, trạng thái chuyển sang APPROVED.
b) "Từ chối" (Reject): Hủy phiếu, trạng thái chuyển sang REJECTED.

Lưu ý: Hệ thống phát hiện phiếu trùng lặp qua mã băm SHA-256 của ảnh. Nếu phiếu đã được xử lý trước đó, hệ thống sẽ cảnh báo.


6. Giám sát quét phiếu (Scan Monitor)

Bước 1: Tại thanh menu, anh/chị chọn "Scan Monitor" (Giám sát quét).

Bước 2: Hệ thống hiển thị bảng điều khiển realtime:
- Số phiếu đang chờ (PENDING)
- Số phiếu đang xử lý (PROCESSING)
- Số phiếu đã duyệt (APPROVED)
- Số phiếu cần kiểm tra (FLAGGED)
- Số phiếu bị từ chối (REJECTED)
- Danh sách phiếu gần đây với trạng thái và thời gian cập nhật


7. Tải phiếu quét lên (Scan Upload)

Chức năng này cho phép tải ảnh phiếu đặt hàng lên hệ thống để xử lý nhận dạng.

Bước 1: Tại thanh menu, anh/chị chọn "Scan Upload" (Tải phiếu quét).

Bước 2: Click "Chọn file" hoặc kéo thả file ảnh vào vùng tải lên.
- Định dạng hỗ trợ: JPG, PNG, PDF
- Có thể tải nhiều file cùng lúc

Bước 3: Click "Tải lên" (Upload). Hệ thống:
- Kiểm tra trùng lặp (checksum SHA-256)
- Tạo phiếu quét mới với trạng thái PENDING
- Chuyển vào hàng đợi xử lý nhận dạng

Bước 4: Theo dõi tiến trình tại "Scan Monitor".


8. Quản lý biểu mẫu OMR (Form Print)

Chức năng này cho phép Quản trị viên tạo và in phiếu đặt hàng dạng OMR (Optical Mark Recognition) cho can phạm nhân.

Bước 1: Tại thanh menu, anh/chị chọn "Form Print" (In biểu mẫu OMR).

Bước 2: Chọn mẫu phiếu với các tùy chọn:
- Chế độ hiển thị:
  + CODE: Chỉ hiển thị mã hàng (phiếu gọn, phù hợp khi can phạm nhân đã quen danh mục)
  + FULL_LIST: Hiển thị mã hàng kèm tên hàng (phiếu chi tiết)
- Khổ giấy: A4 / A5
- Hướng giấy: Dọc (Portrait) / Ngang (Landscape)

Bước 3: Chọn can phạm nhân cần in phiếu (có thể chọn nhiều người).

Bước 4: Click "In phiếu". Hệ thống tạo phiếu OMR cho từng can phạm nhân được chọn:
- Phiếu chứa thông tin: Mã lưu ký, Họ tên, Buồng giam
- Danh sách mặt hàng với ô đánh dấu số lượng
- Mã QR/Barcode định danh phiếu (nếu có)

Bước 5: Hệ thống ghi nhận phiếu đã phát hành (Issued OMR Form) để theo dõi.

Lưu ý:
- Khi danh mục hàng hóa thay đổi (thêm/sửa/xóa mặt hàng), hệ thống sẽ cảnh báo cần tạo phiên bản biểu mẫu mới.
- Các phiên bản cũ được lưu trữ để đối chiếu khi xử lý phiếu quét.


9. Nhập đơn hàng thủ công (Order Form)

Chức năng này cho phép cán bộ nhập đơn hàng thủ công khi không sử dụng phiếu quét hoặc kiosk.

Bước 1: Tại thanh menu, anh/chị chọn "Order Form" (Nhập đơn thủ công).

Bước 2: Nhập mã lưu ký của can phạm nhân. Hệ thống tự động hiển thị thông tin.

Bước 3: Chọn ngày giao hàng (Service Date).

Bước 4: Chọn mặt hàng và nhập số lượng:
- Danh sách mặt hàng đang bán được hiển thị
- Click "+" để thêm mặt hàng, nhập số lượng
- Tổng tiền được tính tự động

Bước 5: Click "Tạo đơn hàng" (Create Order). Hệ thống:
- Tạo đơn hàng với trạng thái ACTIVE, nguồn "manual"
- Trạng thái thanh toán: UNPAID (chờ thanh toán tại quầy)
- Kiểm tra trùng lặp: nếu đã có đơn hàng cùng ngày, cùng nguồn, hệ thống cảnh báo và cho phép thay thế (đơn cũ chuyển sang SUPERSEDED)

Lưu ý: Đơn hàng nhập thủ công cần được duyệt và thanh toán tại quầy thu ngân (Counter).


10. Quản lý cán bộ (Operators)

Chức năng này dành cho Quản trị viên (ADMIN) quản lý tài khoản cán bộ sử dụng hệ thống.

Bước 1: Tại thanh menu, anh/chị chọn "Operators" (Quản lý cán bộ).

Bước 2: Hệ thống hiển thị danh sách cán bộ:
- Tên đăng nhập
- Họ tên
- Vai trò: ADMIN / OPERATOR / CASHIER
- Khu giam phụ trách
- Trạng thái: Active / Inactive

Thêm mới cán bộ:

Bước 1: Click "Thêm mới" (Add New).

Bước 2: Nhập thông tin:
- Tên đăng nhập (*): Duy nhất trong hệ thống
- Họ tên (*)
- Mật khẩu (*): Tối thiểu 8 ký tự
- Vai trò (*): Chọn ADMIN, OPERATOR, hoặc CASHIER
- Khu giam phụ trách: Chọn khu giam (bắt buộc đối với OPERATOR và CASHIER)

Bước 3: Click "Lưu". Hệ thống thông báo thành công, mật khẩu được mã hóa bcrypt.

Sửa thông tin cán bộ:

Bước 1: Click biểu tượng "Sửa" trên dòng cán bộ cần chỉnh sửa.

Bước 2: Chỉnh sửa thông tin (họ tên, vai trò, khu giam, mật khẩu mới nếu cần).

Bước 3: Click "Cập nhật" để lưu.

Vô hiệu hóa cán bộ:

Click biểu tượng "Khóa" trên dòng cán bộ → Xác nhận → Tài khoản chuyển sang Inactive, không thể đăng nhập.


11. Cấu hình thanh toán (Payment Config)

Bước 1: Tại thanh menu, anh/chị chọn "Payment Config" (Cấu hình thanh toán).

Bước 2: Hệ thống hiển thị các tùy chọn:

- Cho phép chuyển khoản ngân hàng: Bật/Tắt
  + Khi bật: Quầy thu ngân có thể chọn phương thức "Chuyển khoản" khi duyệt đơn
  + Khi tắt: Chỉ cho phép thanh toán bằng số dư hoặc tiền mặt

- Cho phép thanh toán tiền mặt: Bật/Tắt
  + Khi bật: Quầy thu ngân có thể chọn phương thức "Tiền mặt"
  + Khi tắt: Chỉ cho phép thanh toán bằng số dư hoặc chuyển khoản

Bước 3: Click "Lưu" để áp dụng cấu hình.


12. Cấu hình hạn mức mua hàng (Purchase Limit Config)

Bước 1: Tại thanh menu, anh/chị chọn "Purchase Limit Config" (Hạn mức mua hàng).

Bước 2: Cấu hình hạn mức chi tiêu hàng tháng cho can phạm nhân (VND).

Bước 3: Click "Lưu". Hệ thống sẽ kiểm tra hạn mức khi duyệt đơn hàng:
- Nếu tổng chi tiêu trong tháng + đơn hàng mới vượt hạn mức → Cảnh báo
- Hiển thị banner thông báo vượt hạn mức trên giao diện Counter

Lưu ý: Hạn mức được tính theo tháng dương lịch, tự động reset đầu tháng mới.


13. Kiosk – Đặt hàng tự phục vụ

Giao diện Kiosk dành cho can phạm nhân tự đặt hàng, không yêu cầu đăng nhập.

Bước 1: Truy cập địa chỉ kiosk (ví dụ: http://192.168.1.100:3000/canteen).

Bước 2: Nhập mã lưu ký.

Bước 3: Hệ thống hiển thị danh sách mặt hàng đang bán:
- Tên mặt hàng
- Phân loại
- Giá bán (VND)

Bước 4: Chọn mặt hàng và số lượng.

Bước 5: Xác nhận đơn hàng. Hệ thống tạo đơn hàng PENDING, chờ duyệt tại quầy thu ngân.

Lưu ý: Giao diện kiosk không yêu cầu đăng nhập, phù hợp triển khai trên máy tính bảng hoặc màn hình cảm ứng tại khu giam.


IV. Ứng dụng Desktop (Electron)

Ứng dụng Desktop dành cho các cơ sở nhỏ hoặc điểm xa, cài đặt trực tiếp trên máy tính Windows mà không cần hạ tầng máy chủ.

1. Cài đặt

Bước 1: Chạy file cài đặt "Canteen Manager Setup.exe" trên máy tính Windows 10/11 64-bit.

Bước 2: Làm theo hướng dẫn cài đặt.

Bước 3: Sau khi cài đặt, ứng dụng tự động khởi động.

2. Thiết lập lần đầu (First Launch)

Lần đầu khởi động, ứng dụng yêu cầu thiết lập:

Bước 1: Nhập thông tin tài khoản quản trị viên:
- Tên đăng nhập (mặc định: admin)
- Mật khẩu (mặc định: admin123 – khuyến nghị đổi ngay)

Bước 2: Cấu hình múi giờ (mặc định: Asia/Saigon).

Bước 3: Hệ thống tự động:
- Tạo khóa bảo mật JWT ngẫu nhiên
- Tạo cơ sở dữ liệu SQLite tại thư mục ứng dụng
- Chạy migration tạo cấu trúc dữ liệu
- Khởi động máy chủ backend

Bước 4: Trình duyệt tự động mở giao diện phần mềm. Đăng nhập bằng tài khoản vừa thiết lập.

3. Sử dụng hàng ngày

- Ứng dụng chạy ở khay hệ thống (System Tray). Click đúp biểu tượng để mở giao diện.
- Backend tự động khởi động khi mở ứng dụng, tự động dừng khi đóng.
- Các máy tính khác trong cùng mạng LAN có thể truy cập phần mềm qua địa chỉ IP hiển thị trên giao diện ứng dụng.

4. Cấu hình nâng cao (tùy chọn)

- Kết nối hệ thống cũ (Legacy Sync): Nhập thông tin kết nối SQL Server 2005 để đồng bộ dữ liệu can phạm nhân từ phần mềm C11 hiện có.
- Thay đổi cổng mạng: Ứng dụng tự động chọn cổng khả dụng nếu cổng 3000 bị chiếm.

Lưu ý:
- Dữ liệu được lưu tại: %APPDATA%/Canteen Manager/
- Khuyến nghị sao lưu thư mục này định kỳ.
- Nếu ứng dụng bị tắt đột ngột, lần khởi động tiếp theo sẽ tự động dọn dẹp tiến trình cũ.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHỤ LỤC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A. Bảng vai trò và quyền hạn

┌────────────────────────────┬───────┬──────────┬─────────┐
│ Chức năng                  │ ADMIN │ OPERATOR │ CASHIER │
├────────────────────────────┼───────┼──────────┼─────────┤
│ Dashboard                  │  ✓    │    ✓     │   ✓     │
│ Orders (Đơn hàng)         │  ✓    │    ✓     │         │
│ Delivery Vouchers          │  ✓    │          │         │
│ Kitchen Summary            │  ✓    │    ✓     │         │
│ Counter (Thu ngân)         │  ✓    │          │   ✓     │
│ Menu Config                │  ✓    │          │         │
│ Accounts (Tài khoản)      │  ✓    │          │         │
│ Verify (Xác minh)         │  ✓    │    ✓     │         │
│ Scan Monitor               │  ✓    │    ✓     │         │
│ Scan Upload                │  ✓    │    ✓     │         │
│ Form Print (OMR)           │  ✓    │          │         │
│ Order Form (Nhập thủ công) │  ✓    │    ✓     │         │
│ Operators (Quản lý CB)    │  ✓    │          │         │
│ Payment Config             │  ✓    │          │         │
│ Purchase Limit Config      │  ✓    │          │         │
│ Kiosk (Không cần đăng nhập)│  -    │    -     │   -     │
└────────────────────────────┴───────┴──────────┴─────────┘

B. Bảng trạng thái đơn hàng

┌─────────────┬────────────────────────────────────────────┐
│ Trạng thái  │ Mô tả                                     │
├─────────────┼────────────────────────────────────────────┤
│ ACTIVE      │ Đơn hàng đang hoạt động                    │
│ SUPERSEDED  │ Đã bị thay thế bởi đơn mới (quét lại)     │
│ REJECTED    │ Đã bị từ chối bởi cán bộ thu ngân         │
├─────────────┼────────────────────────────────────────────┤
│ PAID        │ Đã thanh toán                               │
│ UNPAID      │ Chưa thanh toán (chờ duyệt tại quầy)      │
└─────────────┴────────────────────────────────────────────┘

C. Bảng loại giao dịch tài khoản lưu ký

┌─────────────────┬────────────────────────────────────────┐
│ Loại giao dịch  │ Mô tả                                 │
├─────────────────┼────────────────────────────────────────┤
│ TOPUP           │ Nạp tiền từ thân nhân gửi              │
│ ORDER_DEBIT     │ Trừ tiền thanh toán đơn hàng           │
│ ORDER_REVERSAL  │ Hoàn tiền khi đơn hàng bị hủy/thay thế│
│ REFUND          │ Hoàn tiền thủ công bởi cán bộ          │
└─────────────────┴────────────────────────────────────────┘

D. Bảng trạng thái phiếu quét

┌────────────┬─────────────────────────────────────────────┐
│ Trạng thái │ Mô tả                                      │
├────────────┼─────────────────────────────────────────────┤
│ PENDING    │ Đang chờ xử lý                              │
│ PROCESSING │ Đang nhận dạng (OCR)                        │
│ FLAGGED    │ Cần xác minh thủ công (độ tin cậy thấp)     │
│ APPROVED   │ Đã phê duyệt, đơn hàng được tạo            │
│ REJECTED   │ Đã từ chối                                  │
└────────────┴─────────────────────────────────────────────┘
