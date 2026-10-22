# Rà soát hệ thống — 22/10/2026

Phạm vi: Viet LaTeX Studio 0.6.1 trên macOS, từ commit `dcf2879` và các thay đổi cục bộ đang có. Ba agent chuyên trách rà soát giao diện, mô hình tài liệu và backend/Electron; agent chính kiểm tra tích hợp, cập nhật cục bộ và dữ liệu nâng cấp. Các agent đọc chéo các phần đã sửa trước khi đóng gói.

## Phát hiện và thay đổi

| Khu vực | Vấn đề có thể tái hiện | Thay đổi |
| --- | --- | --- |
| Khung tài liệu | Các khối sau mốc 160 không có lối mở; tiêu đề có nhiều đoạn định dạng bị thêm khoảng trắng. | Tìm trên toàn bộ nội dung có/không dấu, tải thêm, giữ vị trí gốc, nhận diện ngắt trang; sơ đồ trang độc lập bộ lọc. |
| Điều hướng mobile | Mở bảng lệnh/hộp thoại từ ngăn dự án giữ ngăn mở và vùng viết ở trạng thái `inert`. | Đóng ngăn trước khi mở công cụ; kiểm tra cả lệnh bàn phím, tạo tài liệu và quay lại khối được chọn. |
| Nhập sao lưu | Bộ chuẩn hóa có thể bỏ node/tài nguyên nhưng số tài liệu vẫn đúng, khiến nhập báo thành công. | Kiểm tra dữ liệu gốc trước chuẩn hóa; báo rõ và chưa nhập khi có nội dung không hợp lệ. Giữ tương thích chuyển h4–h6. |
| Word | Mất nội dung Link/Code/Math trong chú thích và metadata khi duyệt sai vị trí tuple Pandoc. | Trích văn bản theo cấu trúc AST đúng; không lấy nhầm thuộc tính ẩn. |
| Ảnh | Alias tên ảnh trong thư mục con có thể ghi đè tệp cùng tên ở thư mục gốc. | Xây bảng đường dẫn chính xác trước, chỉ thêm alias nếu chưa tồn tại. |
| Bảng | LaTeX rút colspan về 20, rowspan về 100 dù mô hình chấp nhận 256; Word bỏ qua cột ô gộp đang tiếp tục. | Giữ span được hỗ trợ; tính lưới chiếm dụng cho Word và báo rõ nếu thực sự vượt giới hạn. Không siết validator làm mất bảng cũ. |
| Bộ cập nhật | Kiểm tra lại làm mất `ready`; kiểm tra khi đang tải/cài có thể thay metadata. | Giữ bộ cài đã xác minh; chặn thay metadata trong tác vụ và chờ kiểm tra đang chạy. |
| Hủy thoát | Lưu thất bại có thể để updater kẹt `installing` hoặc giữ thao tác cài cho lần thoát khác. | Hủy tác vụ cài khi thoát bị hủy; chỉ bắt đầu helper sau sự kiện thoát đã được chấp nhận. |
| Sao lưu workspace | Bản sao đang ghi có thể xuất hiện như một điểm phục hồi hoàn chỉnh. | Ghi tạm, fsync, đổi tên nguyên tử; snapshot mới dùng quyền 0600, thư mục backup mới 0700 trên POSIX. |
| Backend DOCX | Giải nén/CRC diễn ra trước hàng đợi và trước theo dõi shutdown. | Đưa vào worker, kiểm tra context giữa các tệp/lượt đọc; kiểm thử hủy khi chờ và khi đọc. |
| Cập nhật cục bộ | Bản mới xác minh lỗi sau swap có thể để app lỗi trong Applications. | Giao dịch thay app có khôi phục bản cũ, giữ bản bị từ chối và không ghi đè bản phục hồi. |
| Home khác volume | Đổi tên app sang backup trong home khác volume gây EXDEV. | Giữ swap trên volume Applications; sao chép và xác minh app cũ trong backup trước khi thay thế khi cần. |
| So sánh nâng cấp | Chuẩn hóa cả trước/sau có thể che việc hai bản cùng mất một phần nội dung. | Kiểm tra raw document/assets/source/BibTeX và số dự án/tài liệu trước khi so sánh. |

## Kiểm chứng

Kết quả máy đọc được và log chi tiết nằm ở `artifacts/system-audit/`. Bộ chạy đầy đủ đạt **33/33 suite, không bỏ qua suite nào**; riêng `check` gồm 343 kiểm thử Node, Go vet/test và production build. Trạng thái cuối cùng ở `full-check/report.json`. Lỗi lint ở lượt đầu đã sửa và chạy lại; lịch sử được giữ trong báo cáo.

- UI dùng Chromium/Playwright với dữ liệu riêng; không chỉnh tài liệu thật để thử tính năng. Kiểm tra các kích thước 1600/1120/901/900/768/390 px, sơ đồ 182 khối, tìm kiếm, chuyển thẻ và bàn phím Windows/Mac.
- PDF, BibTeX/Biber, Word/Pandoc, lưu/thoát/mở lại và đồng bộ chạy qua backend/Electron thực tế trong các suite tích hợp.
- Go vet/race, tải đột biến, stress 64 client × 8 yêu cầu, benchmark có ngưỡng và audit dependency đều thuộc bộ kiểm tra.
- Backend Windows được cross-build trên Mac. Bộ cài/macOS mới được kiểm tra chữ ký, kiến trúc và smoke test sau đóng gói trước khi cài vào Applications.
- Kiểm tra bổ sung bằng Pandoc thật: DOCX có ô gộp tiếp tục từ hàng trước giữ lưới ba cột và nội dung khi nhập lại. XeLaTeX thật biên dịch được ô gộp 21 cột. Kết quả ở `merged-table-integration.json`.
- Hồ sơ thật được thử trên bản sao trước cập nhật. Trình cài giữ app cũ, sao lưu toàn bộ hồ sơ và xác minh dữ liệu sau mở lại.

## Giới hạn

Đây là kết quả rà soát và kiểm thử trong môi trường hiện có, không phải bằng chứng không còn lỗi. Chưa chạy bộ cài Windows trên máy Windows thật hoặc app Intel trên máy Intel. Home khác volume được kiểm tra lựa chọn đường dẫn và giao dịch hoán đổi bằng unit test, chưa có lượt cài trên ổ ngoài thật. Kiểm tra đồng bộ hai app trên một máy và relay loopback không thay thế kiểm tra nhiều máy qua Internet/router thực tế. Sơ đồ trang là minh họa; kiểm tra phân trang chính xác ở Bản in.

Quyền 0600/0700 là tăng bảo vệ cho snapshot mới; không tuyên bố đã xác minh được một lỗ hổng đọc chéo tài khoản ở hồ sơ cũ. Chưa publish GitHub Release, không đổi cài đặt đồng bộ hoặc gửi nội dung tài liệu ra dịch vụ ngoài để kiểm thử.
