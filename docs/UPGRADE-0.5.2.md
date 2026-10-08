# 0.5.2 — Màu chữ nền tối và bản in PDF

Bản macOS được cập nhật từ GitHub main đến `62209d6` (2026-10-08), giữ thư viện sáu kiểu bảng, chú thích hình, danh sách nhập tay, sửa backend/Word và quy trình lưu/thoát mới. Phiên bản 0.5.2 là bản sửa macOS cục bộ, chưa push lên GitHub.

Màu hiển thị của giao diện nền tối không được lưu thành màu trắng trên trang PDF. Các màu trung tính rất sáng (`#ffffff`, `#f2f2f2` và xám trung tính từ `#e0e0e0` trở lên) được coi là **Màu tự động** của văn bản. PDF dùng màu mặc định của mẫu; các mẫu tích hợp dùng chữ đen trên trang trắng. Màu chữ có sắc đã chọn, cỡ chữ, in đậm và tô sáng được giữ.

Bản sửa có ba lớp: chuẩn hóa màu khi đọc HTML/dán văn bản; sửa các mark màu cũ khi mở, nhập hoặc chuyển tài liệu; và ngăn màu trắng/gần trắng bị xuất vào LaTeX tự tạo. Chữ gõ tiếp không kế thừa màu trắng đã được sửa. Đổi nền sáng/tối chỉ thay đổi giao diện.

Văn bản tô sáng trên nền tối cũng giữ chữ đen trên nền tô sáng nhạt, kể cả đoạn có định dạng đen rõ ràng. Màu nền tô sáng không bị chuẩn hóa theo màu chữ.

Cài `Viet-Latex-Studio-0.5.2-universal.dmg`, mở lại tài liệu rồi chọn **Cập nhật PDF** để thay bản xem trước cũ. Có thể dùng **Màu tự động** trong menu Màu chữ cho đoạn đang chọn. Các lệnh màu do người dùng viết trực tiếp trong LaTeX riêng vẫn tuân theo mã nguồn đó.

Kiểm thử `npm run test:dark-text` dùng hồ sơ tạm, mở dữ liệu cũ có chữ trắng/gần trắng, gõ thật và gõ tiếp vào đoạn cũ, Enter/Shift+Enter/Backspace, dán span mang màu nền tối, đổi theme và kiểm tra dữ liệu lưu. PDF được kiểm tra các lệnh vẽ chữ: nội dung thường là `#000000`, màu đỏ đã chọn vẫn là `#c62828`. Kiểm tra canvas và ảnh chụp xác nhận chữ hiển thị trên trang.
