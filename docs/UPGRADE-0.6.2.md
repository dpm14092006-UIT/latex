# Viet LaTeX Studio 0.6.2

Tối ưu backend và sửa các lỗi tìm được trong lượt rà soát tiếp theo.

- **PDF cache**: tra kết quả bằng dấu vân tay của yêu cầu trước khi giải mã lại tệp đính kèm. Giữ kiểm tra dữ liệu ở lượt biên dịch mới, giới hạn kích thước, ngày địa phương và chế độ biên dịch mới. Không đưa kết quả từ tác vụ đã hủy vào cache.
- **Word**: đưa việc đọc/kiểm tra AST xuất Word vào worker có quản lý hủy; bỏ lần sao chép thừa toàn bộ đầu ra Pandoc sau khi tiến trình đã kết thúc.
- **Phục hồi bản thảo**: giữ văn bản và định dạng hợp lệ khi một mark hoặc căn lề bị hỏng; loại text rỗng trước khi đưa vào trình soạn thảo.
- **Chuyển đổi Word**: giữ ngắt trang tại ranh giới AST, giữ các lớp liên kết/in đậm quanh mã không phụ thuộc thứ tự mark, và bổ sung đoạn đầu bắt buộc cho mục danh sách nhập từ Pandoc.
- **Trợ lý AI**: khóa thay đổi vùng chọn qua thanh công cụ trong lúc xử lý; từ chối áp kết quả source nếu bản tài liệu đã thay đổi, kể cả khi vị trí cũ trỏ vào một đoạn chữ giống hệt.
- **Cập nhật macOS**: tháo DMG cả khi thao tác mount lỗi hoặc bị hủy giữa chừng.

Đo hiệu năng lặp lại qua HTTP trên máy phát triển: cache với 4 MiB tệp đính kèm từ 42–43 ms xuống 37 ms; 20 MiB từ 208–228 ms xuống 183 ms. Các số này gồm mã hóa JSON, HTTP và trả PDF, không phải thời gian XeLaTeX. Số liệu gốc và kết quả kiểm tra được giữ trong `artifacts/backend-optimization`.

Chi tiết: [Báo cáo hiệu năng backend](BACKEND-PERFORMANCE-20261022.md). Kiểm tra Pandoc thật xác nhận DOCX xuất có ngắt trang và in đậm code; bộ đọc DOCX của Pandoc hiện bỏ ngắt trang và lớp in đậm code khi nhập lại. Sửa tại ranh giới AST không loại bỏ giới hạn bộ đọc này.

Workspace và hồ sơ được sao lưu trước khi cập nhật ứng dụng cục bộ. Chưa phát hành lên GitHub Releases.
