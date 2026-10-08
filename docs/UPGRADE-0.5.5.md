# Viet LaTeX Studio 0.5.5 — đồng bộ LAN

- Bỏ hoàn toàn đồng bộ cuộn và nút liên kết giữa bản thảo/PDF. Hai khung cuộn độc lập; giữ các sửa chữ tràn lề, kích thước trang PDF và vị trí khi PDF nạp lại.
- Lịch đồng bộ LAN 5 giây chạy ở tiến trình chính, chuyển qua IPC đến renderer. Không phụ thuộc bộ hẹn giờ Chromium bị làm chậm khi cửa sổ bị ẩn. Thử lại khi máy thức dậy; giữ khóa chống hai lượt chạy chồng nhau, lưu trước xác nhận và cơ chế giữ bản sửa khi mạng đang chạy.
- Hiển thị trạng thái LAN ngay ở thanh trạng thái. Cảnh báo xung đột có lối mở trực tiếp bảng LAN. Khi còn xung đột, không báo đã đồng bộ thành công; máy chủ chưa có máy khác online báo đang chờ kết nối.
- Trạng thái từng máy dựa trên request mã hóa hợp lệ trong 20 giây gần nhất. Lượt poll cục bộ không làm mới thời gian liên lạc với máy khác. Không ghi hồ sơ mỗi lượt không có thay đổi.
- Giữ giao thức LAN v1 để tương thích các bản Windows đã ghép; không đổi cổng, khóa hoặc yêu cầu ghép lại khi nâng cấp.

Kiểm thử dùng hồ sơ tạm: hai Electron ẩn, đình chỉ interval 5 giây ở renderer và không dùng cờ tắt throttling; truyền tự động cả hai chiều, sửa trong lúc mạng chờ, thông báo xung đột, giữ cả hai, lưu offline và mở lại máy chủ. Kiểm tra vòng đời kết nối, request v1, mã hóa, dữ liệu/mẫu/ảnh, dấu xóa và revocation bằng TCP thật. Không đưa hồ sơ, tài liệu hoặc mã ghép thật vào repository.
