# Viet LaTeX Studio 0.5.4 — hoàn thiện đồng bộ và hiển thị

- Khi tìm một đoạn trong nhiều dòng PDF, đồng bộ cuộn lấy tọa độ dòng thực sự chứa đoạn, thay vì tọa độ dòng đầu vùng dò. Tiêu đề `3.1.2. Enhanced Vegetation Index` khớp với số tiêu đề PDF `3.1.2 Enhanced Vegetation Index`.
- PDF đang nạp lại không kéo bản thảo về đầu. Khi dữ liệu PDF mới sẵn sàng, khung PDF theo vị trí nội dung đang đọc trong bản thảo. Bật lại đồng bộ cũng căn lại ngay.
- Trang chưa vẽ dùng đúng kích thước trang thực và cùng quy tắc thu phóng với trang đã vẽ. Giảm nhảy bố cục khi cuộn; giữ cạnh trái PDF có thể cuộn tới khi phóng lớn hơn chiều rộng khung.
- Mở tài liệu có ảnh không tự nhảy đến ảnh. Chèn ảnh mới vẫn đưa PDF đến trang có ảnh.
- Giữ sửa khoảng trắng dán, cập nhật PDF tự động và định dạng màu chữ từ 0.5.3.

Kiểm thử desktop dùng hồ sơ tạm: giữ nguyên toàn bộ chữ và dấu cách sau sửa NBSP, không tràn PDF, kiểm tra từng ký tự trong cột bản thảo, đồng bộ hai chiều và bật/tắt, căn tiêu đề EVI trong 45 pixel, hình học PDF khi phóng to, giữ vị trí qua nạp lại và nội dung sửa mới thực sự có trong PDF.
