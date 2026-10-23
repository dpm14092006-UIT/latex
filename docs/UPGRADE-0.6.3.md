# Viet LaTeX Studio 0.6.3

- Sửa PDF mất đường kẻ bảng: longtable được biên dịch đến khi độ rộng cột trong aux ổn định, thay vì dừng ở lượt đầu khiến đường kẻ chỉ dài vài point.
- Bảng chưa chọn kiểu, kể cả bảng cũ lưu `tableStyle: null`, mặc định kẻ lưới đầy đủ ngang/dọc trong bản thảo và PDF. Các kiểu đã chọn rõ ràng được giữ.
- Sửa công thức dạng khối có `\tag{1}` hiện nguyên mã LaTeX. Cấu hình riêng BlockMath ở chế độ display và InlineMath ở chế độ inline; giữ nguyên source và thao tác bấm để chỉnh sửa.
- Có kiểm tra đường vẽ thật trong PDF và trình soạn thảo với mẫu công thức/bảng từ lỗi được báo.
- Kiểm tra nâng cấp chấp nhận nhãn rỗng do schema bổ sung khi đoạn đánh số được nhận diện thành tiêu đề; vẫn phát hiện thay đổi nhãn do người dùng đặt.
