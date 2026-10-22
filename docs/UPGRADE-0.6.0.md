# Viet LaTeX Studio 0.6.0

- Tích hợp bản 0.5.12 mới nhất: thanh công cụ gọn, hướng dẫn phím tắt F1 và kiểm tra tham chiếu tài liệu.
- Thêm **Khung tài liệu** với sơ đồ bản thảo cập nhật trực tiếp và liên kết đến từng khối. **Trang & lề** minh họa trang, chỉnh thiết lập và giữ dữ liệu khi mở lại. Tổng hợp/source riêng khóa các thay đổi không áp dụng được. Xem [giao diện](UI-MONOCHROME.md).

- Thêm nút **Đồng bộ** ngay trên thanh công cụ và mục **Đồng bộ dự án giữa các thiết bị** trong bảng lệnh. Bản cài cũ 0.5.10 chưa có đồng bộ project qua Internet; cần cập nhật ứng dụng, không chỉ cập nhật mã nguồn.
- Ghép từng project bằng mã dùng một lần, xác nhận thiết bị, mã hóa đầu cuối, tự nối lại và tiếp tục sửa khi offline. Ưu tiên LAN đã xác thực rồi chuyển tiếp qua Internet. Project riêng trên máy nhận được giữ nguyên. Xem [hướng dẫn](INTERNET-SYNC.md).
- Máy chủ HTTPS cho đồng bộ Internet cần được cấu hình. Bản cài không kèm một dịch vụ cloud công khai hoặc kho tài liệu trên cloud. Đồng bộ LAN toàn workspace ở mục nâng cao vẫn dùng được trên cùng mạng.
- Giữ tác vụ lưu/gộp của cửa sổ đang đồng bộ hoạt động khi bị ẩn hoặc thu nhỏ. Khi tắt đồng bộ, ứng dụng trở lại giới hạn chạy nền thông thường; không tự bật giữ máy không ngủ.
- Gọn thanh bên: bỏ khối đếm từ/công thức/ảnh và ước lượng thời gian đọc lặp; thống kê được giữ một lần ở thanh trạng thái.
- Thanh trên không còn nút cập nhật thường trực khi đang dùng bản mới nhất. Khi có bản mới, đang tải/cài hoặc có lỗi, thao tác cập nhật vẫn xuất hiện; kiểm tra thủ công ở **Thiết lập → Hệ thống**.
- Sửa cách xây dựng PATH Windows để giữ đúng ký tự ổ đĩa, dùng dấu phân cách Windows và không thêm MiKTeX trùng do khác hoa/thường hoặc dấu gạch chéo.
- Kiểm thử giao diện chính tả dùng Chromium đi kèm Playwright theo mặc định, không đòi Microsoft Edge trên macOS.
- Cập nhật kiểm thử trích dẫn để kiểm tra nội dung gốc, nhóm nguồn và số trang được giữ trong cấu trúc citation hiện tại. Thêm kiểm thử đóng gói thực tế cho đồng bộ project.

Nâng cấp giữ workspace và ID dự án. Trình cập nhật cục bộ sao lưu hồ sơ cùng ứng dụng cũ, kiểm tra bản mới trên bản sao dữ liệu rồi mới thay ứng dụng. Chưa phát hành bản này lên GitHub Releases trong lần cập nhật cục bộ.
