"""Generate Document 1: Thuyet minh phan mem Canteen as .docx"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from docx import Document
from docx.shared import Pt, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from lxml import etree

BORDER_NONE = (
    '<w:tcBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
    '</w:tcBorders>'
)

def remove_table_borders(table):
    """Remove all borders from a table."""
    for row in table.rows:
        for cell in row.cells:
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
            tcPr.append(etree.fromstring(BORDER_NONE))

def set_cell_font(cell, size=13):
    """Set font for all paragraphs in a cell."""
    for p in cell.paragraphs:
        for run in p.runs:
            run.font.name = 'Times New Roman'
            run.font.size = Pt(size)

def add_run_tnr(paragraph, text, bold=False, italic=False, size=13):
    """Add a run with Times New Roman font."""
    run = paragraph.add_run(text)
    run.font.name = 'Times New Roman'
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    return run

def add_centered(doc, text, bold=False, size=13, space_after=0, space_before=0):
    """Add centered paragraph."""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    add_run_tnr(p, text, bold=bold, size=size)
    return p

def add_para(doc, text, bold=False, size=13, indent=0, space_after=6, space_before=0, italic=False):
    """Add a paragraph."""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    if indent > 0:
        p.paragraph_format.first_line_indent = Cm(indent)
    add_run_tnr(p, text, bold=bold, italic=italic, size=size)
    return p

def add_heading_custom(doc, text, level=1):
    """Add custom heading."""
    if level == 1:
        add_para(doc, text, bold=True, size=14, space_before=12, space_after=6)
    elif level == 2:
        add_para(doc, text, bold=True, size=13, space_before=8, space_after=4, indent=0.5)
    elif level == 3:
        add_para(doc, text, bold=True, size=13, space_before=6, space_after=4, indent=1)

def add_bullet(doc, text, indent_cm=1):
    """Add a bullet point."""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Cm(indent_cm)
    add_run_tnr(p, '- ' + text)
    return p

def add_labeled_para(doc, label, desc, indent_cm=1):
    """Add paragraph with bold label and normal description."""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.left_indent = Cm(indent_cm)
    add_run_tnr(p, '- ' + label, bold=True)
    add_run_tnr(p, ' ' + desc)

def main():
    """Generate the document."""
    doc = Document()

    # Page margins
    for section in doc.sections:
        section.top_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(3)
        section.right_margin = Cm(2)

    style = doc.styles['Normal']
    style.font.name = 'Times New Roman'
    style.font.size = Pt(13)

    # ===== HEADER =====
    header_table = doc.add_table(rows=1, cols=2)
    header_table.alignment = WD_TABLE_ALIGNMENT.CENTER

    # Left cell
    left_cell = header_table.cell(0, 0)
    left_cell.width = Inches(3)
    p = left_cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p, 'BỘ CÔNG AN', size=12)
    p2 = left_cell.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p2, 'CỤC CẢNH SÁT QUẢN LÝ\nTRẠI GIAM, CƠ SỞ GIÁO DỤC\nBẮT BUỘC, TRƯỜNG GIÁO DƯỠNG (C10)', bold=True, size=12)
    p3 = left_cell.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p3, '\nSố:          /C10', size=12)

    # Right cell
    right_cell = header_table.cell(0, 1)
    right_cell.width = Inches(3.5)
    p = right_cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', bold=True, size=12)
    p2 = right_cell.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p2, 'Độc lập - Tự do - Hạnh phúc', bold=True, size=12)
    p3 = right_cell.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p3, '\nHà Nội, ngày      tháng     năm 2026', italic=True, size=12)

    remove_table_borders(header_table)
    doc.add_paragraph()

    # ===== TITLE =====
    add_centered(doc, 'THUYẾT MINH SƠ BỘ PHÁT TRIỂN PHẦN MỀM', bold=True, size=16, space_after=12, space_before=12)

    # ===== I. THÔNG TIN CHUNG =====
    add_heading_custom(doc, 'I. THÔNG TIN CHUNG')

    info_items = [
        ('1. Tên sản phẩm phần mềm:', 'Phần mềm "Quản lý Căng-tin Trại tạm giam" (Canteen Manager).'),
        ('2. Thể loại:', 'Xây dựng mới phần mềm "Quản lý Căng-tin Trại tạm giam".'),
        ('3. Đơn vị chủ đầu tư:', 'Cục C10 \u2013 Bộ Công an.'),
        ('4. Đơn vị chủ trì thực hiện:', 'Cục C10 phối hợp Cục Công nghệ thông tin (C06) \u2013 Bộ Công an.'),
        ('5. Đơn vị quản lý, sử dụng phần mềm (đơn vị thụ hưởng):', 'Các Trại tạm giam, Nhà tạm giữ Công an các đơn vị, địa phương.'),
        ('6. Đơn vị xây dựng, phát triển phần mềm (dự kiến):', ''),
        ('7. Các đơn vị phối hợp:', 'Cục C06, Cục C10, Công an các tỉnh/thành phố trực thuộc Trung ương.'),
        ('8. Địa điểm thực hiện:', 'Cục C10 \u2013 Bộ Công an và các Trại tạm giam thí điểm.'),
        ('9. Kinh phí thực hiện:', '\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026'),
        ('10. Thời gian thực hiện:', ''),
    ]
    for label, value in info_items:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.left_indent = Cm(0.5)
        add_run_tnr(p, label, bold=True)
        add_run_tnr(p, ' ' + value)

    # ===== II. NỘI DUNG =====
    add_heading_custom(doc, 'II. NỘI DUNG')
    add_heading_custom(doc, '1. Mục đích, yêu cầu và phạm vi ứng dụng của phần mềm', level=2)
    add_heading_custom(doc, '1.1. Căn cứ đề xuất', level=3)

    bases = [
        'Luật Thi hành tạm giữ, tạm giam số 94/2015/QH13 ngày 25/11/2015 và các văn bản hướng dẫn thi hành, trong đó quy định về chế độ ăn, mua lương thực, thực phẩm, đồ dùng sinh hoạt của người bị tạm giữ, tạm giam;',
        'Nghị quyết số 57-NQ/TW ngày 22/11/2024 của Bộ Chính trị về đột phá phát triển khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số quốc gia;',
        'Thông tư số 36/2017/TT-BCA ngày 19/9/2017 của Bộ trưởng Bộ Công an quy định về chế độ quản lý, ăn, mặc, sinh hoạt, chăm sóc y tế đối với người bị tạm giữ, tạm giam;',
        'Đề án chuyển đổi số ngành Công an giai đoạn 2025\u20132030 của Bộ Công an;',
        'Yêu cầu thực tế trong công tác quản lý hoạt động căng-tin, mua bán lương thực, thực phẩm, đồ dùng sinh hoạt tại các Trại tạm giam, Nhà tạm giữ Công an các đơn vị, địa phương.',
    ]
    for b in bases:
        add_bullet(doc, b)

    add_heading_custom(doc, '1.2. Mục đích, yêu cầu', level=3)
    add_heading_custom(doc, '1.2.1. Mục đích', level=3)

    purposes = [
        ('Chuẩn hóa và số hóa quy trình quản lý căng-tin:',
         'Tập trung toàn bộ thông tin về đơn hàng, tài khoản lưu ký, danh mục hàng hóa, phiếu giao nhận trên một nền tảng duy nhất; Đảm bảo dữ liệu chính xác \u2013 thống nhất \u2013 minh bạch theo quy định; Giảm phụ thuộc vào sổ sách giấy và tính toán thủ công.'),
        ('Nâng cao hiệu quả công tác quản lý tại trại tạm giam:',
         'Rút ngắn thời gian xử lý đơn hàng từ tiếp nhận đến giao trả; Kiểm soát chặt chẽ số dư tài khoản lưu ký của can phạm nhân, đảm bảo không chi vượt hạn mức; Hỗ trợ tự động hóa quy trình duyệt đơn, thanh toán, in phiếu giao hàng (TG8); Cung cấp số liệu thống kê, báo cáo phục vụ công tác chỉ huy, điều hành.'),
        ('Giảm tải giấy tờ, tối ưu quy trình làm việc:',
         'Số hóa phiếu đặt hàng bằng công nghệ nhận dạng quang học (OMR/OCR); Tự động tạo phiếu giao nhận, biên lai, tổng hợp bếp; Từng bước xây dựng môi trường làm việc không giấy tờ trong quản lý căng-tin.'),
        ('Tăng cường tính minh bạch, giám sát:',
         'Mọi giao dịch tài chính đều được ghi nhận theo mô hình sổ cái bất biến, không thể sửa xóa; Nhật ký kiểm toán đầy đủ cho mọi thao tác của cán bộ; Phân quyền chặt chẽ theo vai trò: Quản trị viên, Cán bộ nghiệp vụ, Thu ngân.'),
    ]
    for label, desc in purposes:
        add_labeled_para(doc, label, desc)

    add_heading_custom(doc, '1.2.2. Yêu cầu', level=3)
    add_para(doc, 'Để đạt được các mục đích trên, phần mềm "Quản lý Căng-tin Trại tạm giam" cần hỗ trợ toàn diện các khâu trong quy trình quản lý hoạt động căng-tin, bao gồm: quản lý danh mục hàng hóa, tiếp nhận và xử lý đơn hàng (qua nhiều kênh: quét phiếu OMR, kiosk, nhập thủ công, đặt hàng từ thân nhân), quản lý tài khoản lưu ký, thanh toán, in phiếu giao nhận, tổng hợp đơn hàng cho bếp, và báo cáo thống kê.', indent=0.5)

    add_heading_custom(doc, '1.3. Phạm vi triển khai', level=3)
    add_para(doc, 'Trước mắt sẽ thử nghiệm tại 01 Trại tạm giam thuộc Công an TP \u2026\u2026\u2026\u2026 và tiến tới mở rộng cho các Trại tạm giam, Nhà tạm giữ Công an các đơn vị, địa phương trên toàn quốc.', indent=0.5)

    # 2. Sự cần thiết
    add_heading_custom(doc, '2. Sự cần thiết', level=2)
    add_para(doc, 'Hiện nay, quá trình quản lý hoạt động căng-tin tại các Trại tạm giam, Nhà tạm giữ đặt ra nhiều yêu cầu ngày càng cao về tốc độ, độ chính xác và tính minh bạch, tuy nhiên quy trình hiện tại còn nhiều bất cập:', indent=0.5)

    issues = [
        'Việc tiếp nhận đơn hàng chủ yếu thực hiện bằng phiếu giấy viết tay, cán bộ phải đọc và nhập liệu thủ công cho hàng trăm phiếu/ngày, tốn nhiều thời gian, dễ nhầm lẫn và sai sót trong quá trình tổng hợp.',
        'Quản lý tài khoản lưu ký (tiền gửi mua hàng) của can phạm nhân được ghi chép trên sổ sách, khó kiểm soát số dư thực tế, dễ phát sinh sai lệch giữa sổ ghi và thực tế giao dịch, thiếu tính minh bạch.',
        'Quy trình thanh toán và đối soát chưa có công cụ hỗ trợ tự động, phụ thuộc hoàn toàn vào tính toán thủ công của cán bộ, khó phát hiện sai sót kịp thời.',
        'Việc tổng hợp đơn hàng cho bếp, in phiếu giao nhận hàng hóa (biểu mẫu TG8, TG9) thực hiện bằng tay, mất nhiều công sức và không đảm bảo tính chính xác khi số lượng can phạm nhân lớn.',
        'Thiếu hệ thống báo cáo, thống kê tập trung phục vụ công tác giám sát, kiểm tra của các cấp lãnh đạo; khó truy xuất lịch sử giao dịch khi có yêu cầu thanh tra, kiểm toán.',
        'Việc quản lý hạn mức mua hàng theo quy định (giới hạn chi tiêu hàng tháng) chưa được kiểm soát tự động, dẫn đến nguy cơ vi phạm quy định.',
    ]
    for issue in issues:
        add_bullet(doc, issue)

    # 3. Yêu cầu hạ tầng
    add_heading_custom(doc, '3. Các yêu cầu hạ tầng kỹ thuật công nghệ thông tin', level=2)
    add_heading_custom(doc, '3.1. Yêu cầu tiêu chuẩn kỹ thuật', level=3)

    tech_reqs = [
        'Sử dụng các công nghệ và nền tảng tiên tiến, hiện đại, mã nguồn mở, phù hợp với xu hướng phát triển hiện nay của công nghệ thông tin.',
        'Có khả năng mở rộng, nâng cấp dễ dàng khi tăng cường thêm module chức năng mà không làm thay đổi logic cốt lõi của hệ thống.',
        'Đảm bảo tuân thủ các chuẩn về công nghệ thông tin cũng như các chuẩn về thiết bị sử dụng trong hệ thống.',
        'Đảm bảo khả năng quản trị dễ dàng, cho phép bộ phận quản lý có thể thực hiện các thao tác quản trị tập trung: quản lý tài khoản cán bộ, cấu hình hệ thống, quản lý danh mục hàng hóa.',
        'Hệ thống phải hoạt động trong môi trường mạng nội bộ cách ly, không yêu cầu kết nối Internet, đảm bảo an toàn thông tin tuyệt đối.',
        'Hệ thống phải chống lại được các hiện tượng lấy cắp hay thay đổi thông tin. Các biện pháp bảo mật phải được áp dụng đồng bộ trên nhiều mức: mức mạng, mức hệ điều hành, mức cơ sở dữ liệu, mức ứng dụng.',
        'Dữ liệu tài chính phải được bảo vệ toàn vẹn theo mô hình sổ cái chỉ ghi thêm, không cho phép sửa/xóa giao dịch đã ghi nhận.',
        'Thông số kỹ thuật phù hợp Thông tư số 39/2017/TT-BTTTT ngày 15/12/2017 của Bộ Thông tin và Truyền thông.',
        'Bảo đảm an toàn thông tin theo Thông tư số 86/2021/TT-BCA ngày 01/9/2021; Thông tư số 12/2022/TT-BTTTT ngày 12/8/2022.',
    ]
    for t in tech_reqs:
        add_bullet(doc, t)

    add_heading_custom(doc, '3.2. Yêu cầu phần cứng, hạ tầng mạng, bảo mật', level=3)
    hw_reqs = [
        'Thiết bị phần cứng: Hỗ trợ 02 mô hình: (a) Máy chủ với Docker Compose cho cơ sở lớn; (b) Cài đặt Electron trên máy tính cá nhân cho cơ sở nhỏ.',
        'Hạ tầng mạng: Mạng nội bộ cách ly; Không yêu cầu kết nối Internet.',
        'Lưu trữ: PostgreSQL 16 (máy chủ) và SQLite 3 (máy cá nhân).',
        'Sao lưu: Tự động định kỳ; sao lưu ra thiết bị ngoại vi.',
        'Bảo mật: Xác thực JWT (HS256); Mã hóa mật khẩu bcrypt; Phân quyền theo vai trò (Quản trị viên / Cán bộ nghiệp vụ / Thu ngân) và theo khu giam; An toàn thông tin cấp độ 2.',
    ]
    for h in hw_reqs:
        add_bullet(doc, h)

    # 4. Giải pháp kỹ thuật - Table
    add_heading_custom(doc, '4. Giải pháp kỹ thuật, công nghệ lựa chọn', level=2)

    tech_table = doc.add_table(rows=1, cols=3)
    tech_table.style = 'Table Grid'
    tech_table.alignment = WD_TABLE_ALIGNMENT.CENTER

    hdr = tech_table.rows[0].cells
    for i, text in enumerate(['Thành phần', 'Công nghệ', 'Phiên bản']):
        hdr[i].paragraphs[0].text = ''
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_run_tnr(p, text, bold=True, size=11)

    tech_rows = [
        ('Máy chủ - Nền tảng', 'Node.js', '22'),
        ('Máy chủ - Khung phần mềm', 'NestJS (TypeScript)', '11'),
        ('Cơ sở dữ liệu (máy chủ)', 'PostgreSQL', '16'),
        ('Cơ sở dữ liệu (máy cá nhân)', 'SQLite', '3'),
        ('Ánh xạ đối tượng - CSDL', 'TypeORM', '0.3'),
        ('Xác thực', 'JWT + Passport.js + bcrypt', '-'),
        ('Giao diện - Khung phần mềm', 'React', '18'),
        ('Giao diện - Đóng gói', 'Vite', '6'),
        ('Giao diện - Thư viện UI', 'Radix UI + TailwindCSS', '3.4'),
        ('Đa ngôn ngữ', 'i18next', 'VI + EN'),
        ('Ứng dụng máy tính', 'Electron', '36'),
        ('Dịch vụ quét phiếu - Nền tảng', 'Python', '3.11+'),
        ('Dịch vụ quét phiếu - OCR', 'PaddleOCR (PP-OCRv6)', '3.7'),
        ('Dịch vụ quét phiếu - Xử lý ảnh', 'OpenCV + NumPy + Pillow', '-'),
        ('Triển khai', 'Docker Compose', '-'),
    ]
    for comp, tech, ver in tech_rows:
        row = tech_table.add_row().cells
        for j, val in enumerate([comp, tech, ver]):
            row[j].paragraphs[0].text = ''
            add_run_tnr(row[j].paragraphs[0], val, size=11)

    doc.add_paragraph()

    # 5. Mô tả chức năng
    add_heading_custom(doc, '5. Mô tả các chức năng, yêu cầu của phần mềm', level=2)
    add_para(doc, 'Phần mềm hỗ trợ 02 hình thức truy cập: Ứng dụng Web (Chrome, Firefox, Edge) và Ứng dụng Desktop (Windows 10/11 64-bit).', indent=0.5)

    sections = [
        ('A. PHÂN HỆ QUẢN TRỊ & VẬN HÀNH (Dành cho cán bộ quản lý)', [
            ('(1) Tổng quan:', 'Hiển thị số liệu thống kê: tổng đơn hàng, đơn chờ duyệt, đơn đã thanh toán, doanh thu; Biểu đồ trực quan theo thời gian.'),
            ('(2) Quản lý danh mục hàng hóa:', 'Thêm, sửa, xóa mặt hàng; Phân loại: Thực phẩm, Đồ dùng thiết yếu; Quản lý giá bán, mã hàng tự động, thứ tự hiển thị.'),
            ('(3) Quản lý đơn hàng:', 'Danh sách với bộ lọc ngày, trạng thái, nguồn; Chi tiết đơn hàng; Vòng đời: Đang hoạt động \u2192 Đã thay thế / Đã từ chối; Trạng thái: Đã thanh toán / Chưa thanh toán.'),
            ('(4) Quản lý tài khoản lưu ký:', 'Sổ cái giao dịch bất biến; Số dư tài khoản; Các loại giao dịch: Nạp tiền, Trừ tiền đơn hàng, Hoàn tiền hủy đơn, Hoàn tiền thủ công; Mô hình chỉ ghi thêm.'),
            ('(5) Tổng hợp bếp:', 'Tổng hợp đơn hàng theo ngày giao; Số lượng từng mặt hàng cần chuẩn bị; In danh sách cho bếp.'),
            ('(6) Phiếu giao nhận:', 'Tạo phiếu TG8 cho từng can phạm nhân; Tổng hợp mặt hàng, số lượng, tổng tiền, số dư; In phiếu.'),
            ('(7) Quản lý cán bộ:', 'Thêm, sửa, xóa tài khoản; Phân quyền: Quản trị viên / Cán bộ nghiệp vụ / Thu ngân; Phân vùng theo khu giam.'),
            ('(8) Cấu hình thanh toán:', 'Bật/tắt chuyển khoản ngân hàng; Bật/tắt tiền mặt; Hạn mức chi tiêu hàng tháng.'),
            ('(9) Quản lý biểu mẫu OMR:', 'Tạo mẫu OMR: chế độ mã hàng / danh sách đầy đủ, A4/A5, Dọc/Ngang; In phiếu cho từng can phạm nhân; Quản lý phiên bản.'),
        ]),
        ('B. PHÂN HỆ THU NGÂN', [
            ('(10) Tra cứu can phạm nhân:', 'Tra cứu theo mã lưu ký; Hiển thị thông tin, số dư, lịch sử giao dịch, hạn mức.'),
            ('(11) Nạp tiền lưu ký:', 'Nạp tiền từ thân nhân; Ghi nhận sổ cái; Cập nhật số dư tự động.'),
            ('(12) Duyệt đơn hàng chờ:', 'Danh sách chờ duyệt; Duyệt/từ chối; Phương thức: số dư / tiền mặt / chuyển khoản.'),
            ('(13) Đặt hàng từ thân nhân:', 'Tạo đơn tại quầy; Chọn mặt hàng; Thanh toán trực tiếp.'),
        ]),
        ('C. PHÂN HỆ ĐẶT HÀNG TỰ PHỤC VỤ (Không cần đăng nhập)', [
            ('(14) Duyệt danh mục hàng hóa:', 'Hiển thị mặt hàng đang bán; Giao diện đơn giản.'),
            ('(15) Đặt hàng qua màn hình tự phục vụ:', 'Nhập mã lưu ký; Chọn mặt hàng; Tạo đơn chờ duyệt.'),
        ]),
        ('D. PHÂN HỆ QUÉT PHIẾU ĐẶT HÀNG', [
            ('(16) Quét và nhận dạng phiếu:', 'Quét tự động từ thư mục chia sẻ mạng; Nhận dạng chữ viết tay tiếng Việt (PaddleOCR); Nhận dạng mã lưu ký, mặt hàng, số lượng.'),
            ('(17) Xác minh và phê duyệt:', 'Tự động tạo đơn nếu độ tin cậy cao; Xác minh thủ công nếu cần; Phát hiện phiếu trùng lặp (SHA-256).'),
            ('(18) Giám sát hàng đợi quét:', 'Bảng điều khiển thời gian thực; Trạng thái: Đang chờ / Đang xử lý / Cần xác minh / Đã phê duyệt / Đã từ chối.'),
        ]),
        ('E. PHÂN HỆ TÍCH HỢP DỮ LIỆU CŨ (tùy chọn)', [
            ('(19) Đồng bộ dữ liệu can phạm nhân:', 'Kết nối SQL Server 2005 (phần mềm C11); Đồng bộ thông tin; Chỉ đọc, không ảnh hưởng dữ liệu cũ.'),
        ]),
    ]

    for section_title, features in sections:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        p.paragraph_format.space_after = Pt(4)
        add_run_tnr(p, section_title, bold=True)

        for label, desc in features:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.left_indent = Cm(0.5)
            add_run_tnr(p, label, bold=True)
            add_run_tnr(p, ' ' + desc)

    # 6. Đánh giá hiệu quả
    add_heading_custom(doc, '6. Đánh giá hiệu quả triển khai', level=2)
    add_para(doc, 'Việc triển khai phần mềm "Quản lý Căng-tin Trại tạm giam" có ý nghĩa thiết thực trong việc nâng cao hiệu quả công tác quản lý hoạt động căng-tin tại các Trại tạm giam, Nhà tạm giữ, cụ thể:', indent=0.5)

    efficiencies = [
        'Giảm 80% thời gian xử lý đơn hàng: Từ quy trình thủ công xuống quy trình tự động (quét phiếu \u2192 nhận dạng \u2192 tạo đơn \u2192 thanh toán \u2192 in phiếu giao nhận).',
        'Đảm bảo chính xác 100% về tài chính: Mô hình sổ cái bất biến loại bỏ khả năng sai lệch số dư; Mọi giao dịch được ghi nhận đầy đủ.',
        'Tăng cường minh bạch và giám sát: Nhật ký kiểm toán đầy đủ; Phân quyền chặt chẽ; Hỗ trợ thanh tra, kiểm toán.',
        'Tiết kiệm nhân lực: Giảm cán bộ quản lý căng-tin; Tự động hóa tổng hợp bếp, in phiếu, đối soát.',
        'Triển khai linh hoạt: 02 mô hình phù hợp mọi quy mô; Mạng nội bộ cách ly, đảm bảo an toàn thông tin.',
        'Khả năng mở rộng: Kiến trúc phân hệ; Tích hợp phần mềm C11 qua phân hệ đồng bộ.',
    ]
    for e in efficiencies:
        add_bullet(doc, e)

    # Footer
    doc.add_paragraph()
    footer_table = doc.add_table(rows=1, cols=2)
    footer_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    left = footer_table.cell(0, 0)
    left.width = Inches(3)
    p = left.paragraphs[0]
    add_run_tnr(p, 'Nơi nhận:\n- Như kính gửi;\n- Lưu: VT.', italic=True, size=11)

    right = footer_table.cell(0, 1)
    right.width = Inches(3)
    p = right.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run_tnr(p, 'CỤC TRƯỞNG\n\n\n\n\n\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026', bold=True)

    remove_table_borders(footer_table)

    output = 'pitch-docs/01-Thuyet-minh-phan-mem-Canteen.docx'
    doc.save(output)
    print(f'Document 1 saved: {output}')


if __name__ == '__main__':
    main()
