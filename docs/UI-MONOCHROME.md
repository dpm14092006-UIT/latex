# VietLaTeX — giao diện monochrome chính thức

Nguồn thiết kế: `C:/Users/ROG/Downloads/vietlatex_studio_monochrome.html`, do người dùng cung cấp ngày 30/09/2026.

Thay đổi được yêu cầu sau khi chọn mẫu: **bỏ hoàn toàn thanh biểu tượng đen ở mép trái**, đồng thời giữ cột dự án, tài liệu và mục lục sát mép trái. Sidebar dùng một biểu tượng nhỏ tự thiết kế, không có wordmark hoặc khu vực tài khoản. Nền đen là mặc định sau cập nhật đầu tiên; lựa chọn sáng/tối sau đó tiếp tục được lưu và dùng lại. Cột tài liệu có nút thu gọn và mở lại từ thanh tên tài liệu.

## Đã triển khai

- Cột tìm kiếm, chọn dự án, tạo dự án/tài liệu, danh sách tài liệu và mục lục nối với workspace thật.
- Thanh tên tài liệu, trạng thái lưu thật, sáng/tối, tập trung, thiết lập và xuất PDF thật.
- Các chế độ Soạn thảo, Soạn + PDF, LaTeX và Bản in. LaTeX có khung riêng toàn chiều rộng theo mẫu; PDF vẫn mở được từ tab Bản in.
- Chọn chế độ tại một thanh phía trên tài liệu; bỏ tùy chọn thử nghiệm đổi vị trí trên/dưới. Thanh trạng thái chỉ hiển thị source tự tạo/đã chỉnh sửa và tình trạng PDF.
- **Cập nhật PDF** và **Thử lại** biên dịch mới tài liệu hiện tại; tab Hệ thống tập trung vào kiểm tra môi trường và cập nhật ứng dụng, chỉ hiện link cài công cụ khi đang thiếu.
- Bản thảo và PDF có khung bo góc, nền giấy và đường chia kéo được. Không sử dụng HTML giả lập PDF của mẫu thiết kế.
- Thanh công cụ Cơ bản gọn; các công cụ cũ vẫn nằm trong Trang chủ, Chèn, Tham chiếu, Bố cục và Xem.
- Bảng lệnh dùng Ctrl+K, lọc tiếng Việt có/không dấu, Enter để chạy và phím mũi tên để chọn. Chèn liên kết dùng Ctrl+Shift+K hoặc nút Liên kết.
- Xóa tài liệu mở bước xác nhận hiện có; ứng dụng vẫn tạo bản sao lưu trước khi xóa.
- Màn hình nhỏ dùng cột điều hướng dạng ngăn mở/đóng và hiển thị một khung nội dung mỗi lần; hộp thoại chặn tương tác với nội dung phía sau.

## Thành phần

- `src/components/DocumentFrame.jsx`, `src/services/DocumentFrameData.js` và `src/document-frame.css`: khung trực quan cấu trúc/trang. Mở bằng **Khung tài liệu** trên thanh trên hoặc Ctrl+K → Khung tài liệu. Các khối liên kết với vị trí bản thảo thật; thiết lập dùng cùng dữ liệu với Trang & tác giả, không tạo bản sao tài liệu. Khung đặt bên phải ở độ rộng trên 1280 px, chuyển thành native modal drawer khi màn hình hẹp hơn; hỗ trợ Escape, focus trap và phím mũi tên giữa hai thẻ. Không lưu trạng thái mở để tránh chiếm vùng viết khi mở lại app.
- Cấu trúc hiển thị 160 khối đầu và có **Xem thêm**. Ô tìm kiếm duyệt toàn bộ nội dung, hỗ trợ tiếng Việt có/không dấu và giữ nguyên vị trí khối gốc; sơ đồ trang không bị thay đổi bởi bộ lọc. Trên màn hình nhỏ, điều hướng dự án được đóng trước khi mở công cụ khác để vùng viết không bị khóa sau khi hoàn tất.

- `src/obsidian.css`: lớp giao diện đen bóng áp dụng ngày 07/10/2026 từ demo đã duyệt. Chỉ đổi palette, nền, viền, bóng và chuyển trạng thái; giữ nguyên kích thước khung, ribbon, phân trang, kéo chia khung, component và dữ liệu. Không có điểm nhấn xanh lá. Nền đen mặc định và lựa chọn sáng/tối đã lưu tiếp tục dùng logic hiện có.

- `src/monochrome.css`: hình thức theo mẫu, responsive và theme.
- `src/components/StudioNavigation.jsx`: dự án, tài liệu, tìm kiếm, mục lục.
- `src/components/DocumentHeader.jsx`: tên tài liệu, hành động và chế độ xem.
- `src/components/CommandPalette.jsx`: bảng lệnh bằng native dialog.
- `src/components/EditorPane.jsx`: thanh công cụ nhanh và công cụ nâng cao hiện có.
- `src/main.jsx`: kết nối với editor, workspace, compiler và các hộp thoại.

Không thay engine Tiptap, MathLive, CodeMirror, PDF.js, backend Go hay schema dữ liệu tài liệu bằng logic minh họa trong HTML.

## Kiểm tra

- `npm run test:ui`: điều hướng, tạo/chuyển tài liệu, hủy xóa, bảng lệnh, LaTeX, kéo chia khung, focus, theme, môi trường backend, một thanh chọn chế độ và độ rộng 1600/1120/901/900/768/390 px. Mặc định dùng Chromium của Playwright; đặt `UI_TEST_BROWSER=msedge` để dùng Edge đã cài.
- `npm run test:desktop`: công thức, PDF thật, Word/OMML, thiết lập, sao lưu, nhập dự án, nhân bản, lưu cuối phiên và khôi phục khi mở lại.
- `npm run lint` và `npm run build`.
- `npm run test:document-frame`: vị trí khối qua đoạn trống, giới hạn số khối hiển thị, chọn tiêu đề/bảng/công thức, cập nhật khi gõ, bảng lệnh, thay đổi và lưu thiết lập, khóa Tổng hợp/source riêng, sáng/tối và ngăn 390 px. Ảnh ở `artifacts/document-frame/`.

`npm run test:ui` lưu ảnh kiểm tra giao diện ở `artifacts/monochrome-ui/`. Các bài kiểm tra dùng dữ liệu riêng, không sửa tài liệu đang dùng của người dùng.
