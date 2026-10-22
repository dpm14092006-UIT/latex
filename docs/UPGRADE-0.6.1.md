# Viet LaTeX Studio 0.6.1

Nâng cấp cục bộ sau đợt rà soát bằng ba agent chuyên trách và kiểm tra tích hợp toàn hệ thống.

- **Khung tài liệu** tìm trên toàn bộ bản thảo, hỗ trợ tiếng Việt không dấu và tải thêm các khối sau mốc 160. Nhận diện ngắt trang và giữ đúng tiêu đề có định dạng. Tìm cấu trúc không làm đổi sơ đồ trang.
- **Điều hướng trên màn hình nhỏ** đóng ngăn dự án trước khi mở bảng lệnh, tạo tài liệu hoặc thư viện; vùng viết không còn bị giữ ở trạng thái không tương tác sau thao tác.
- **Nhập gói sao lưu** dừng với thông báo nếu tài liệu, tài nguyên, source hoặc BibTeX không hợp lệ, thay vì báo thành công sau khi âm thầm bỏ nội dung. Các tiêu đề h4–h6 từ bản cũ vẫn được hạ về cấp hỗ trợ.
- **Word/LaTeX** giữ nội dung liên kết, mã và công thức trong chú thích/metadata; ưu tiên đúng đường dẫn ảnh khi nhiều ảnh trùng tên ở các thư mục khác nhau. LaTeX giữ các ô gộp được hỗ trợ trên 20 cột/100 hàng; Word tính cả cột bị chiếm bởi ô gộp từ hàng trước và báo rõ bảng vượt giới hạn thực tế.
- **Cập nhật ứng dụng** giữ bộ cài đã tải khi kiểm tra lại hoặc mạng lỗi; không trộn metadata phiên bản khi đang tải/cài. Hủy thao tác cài khi app không lưu/thoát được. Trình cập nhật cục bộ khôi phục app cũ nếu thay thế/xác minh bản mới bị lỗi và hỗ trợ home khác volume Applications.
- **Sao lưu workspace** ghi tạm, đồng bộ xuống đĩa và đổi tên nguyên tử trước khi xuất hiện trong danh sách phục hồi. Các snapshot mới dùng quyền riêng trên macOS/Linux.
- **Backend Word** đưa kiểm tra/giải nén DOCX vào hàng đợi worker và hỗ trợ hủy giữa các lượt đọc, tránh xử lý giải nén ngoài giới hạn đồng thời.
- **Kiểm tra nâng cấp** đối chiếu dữ liệu gốc trước khi chuẩn hóa để tránh trường hợp cả hai bản so sánh cùng mất một phần nội dung mà vẫn được xem là bằng nhau.

Workspace v1, ID dự án/tài liệu và hồ sơ đồng bộ được giữ. Trước khi cài, app mới chạy trên bản sao hồ sơ; app cũ và toàn bộ hồ sơ được giữ trong thư mục khôi phục.

Chưa phát hành phiên bản này lên GitHub Releases. Bộ kiểm thử và giới hạn kiểm chứng được ghi ở [SYSTEM-AUDIT-20261022](SYSTEM-AUDIT-20261022.md).
