# VietLaTeX — giao diện monochrome chính thức

Nguồn thiết kế: `C:/Users/ROG/Downloads/vietlatex_studio_monochrome.html`, do người dùng cung cấp ngày 30/09/2026.

Thay đổi được yêu cầu sau khi chọn mẫu: **bỏ hoàn toàn thanh biểu tượng đen ở mép trái**, đồng thời giữ cột dự án, tài liệu và mục lục sát mép trái. Sidebar dùng một biểu tượng nhỏ tự thiết kế, không có wordmark hoặc khu vực tài khoản. Nền đen là mặc định sau cập nhật đầu tiên; lựa chọn sáng/tối sau đó tiếp tục được lưu và dùng lại. Cột tài liệu có nút thu gọn và mở lại từ thanh tên tài liệu.

## Đã triển khai

- Cột tìm kiếm, chọn dự án, tạo dự án/tài liệu, danh sách tài liệu và mục lục nối với workspace thật.
- Thanh tên tài liệu, trạng thái lưu thật, sáng/tối, tập trung, thiết lập và xuất PDF thật.
- Các chế độ Soạn thảo, Soạn + PDF, LaTeX và Bản in. LaTeX có khung riêng toàn chiều rộng theo mẫu; PDF vẫn mở được từ tab Bản in.
- Bản thảo và PDF có khung bo góc, nền giấy và đường chia kéo được. Không sử dụng HTML giả lập PDF của mẫu thiết kế.
- Thanh công cụ Cơ bản gọn; các công cụ cũ vẫn nằm trong Trang chủ, Chèn, Tham chiếu, Bố cục và Xem.
- Bảng lệnh dùng Ctrl+K, lọc tiếng Việt có/không dấu, Enter để chạy và phím mũi tên để chọn. Chèn liên kết dùng Ctrl+Shift+K hoặc nút Liên kết.
- Xóa tài liệu mở bước xác nhận hiện có; ứng dụng vẫn tạo bản sao lưu trước khi xóa.
- Màn hình nhỏ dùng cột điều hướng dạng ngăn mở/đóng và hiển thị một khung nội dung mỗi lần; hộp thoại chặn tương tác với nội dung phía sau.

## Thành phần

- `src/obsidian.css`: lớp giao diện đen bóng áp dụng ngày 07/10/2026 từ demo đã duyệt. Chỉ đổi palette, nền, viền, bóng và chuyển trạng thái; giữ nguyên kích thước khung, ribbon, phân trang, kéo chia khung, component và dữ liệu. Không có điểm nhấn xanh lá. Nền đen mặc định và lựa chọn sáng/tối đã lưu tiếp tục dùng logic hiện có.

- `src/monochrome.css`: hình thức theo mẫu, responsive và theme.
- `src/components/StudioNavigation.jsx`: dự án, tài liệu, tìm kiếm, mục lục.
- `src/components/DocumentHeader.jsx`: tên tài liệu, hành động và chế độ xem.
- `src/components/CommandPalette.jsx`: bảng lệnh bằng native dialog.
- `src/components/EditorPane.jsx`: thanh công cụ nhanh và công cụ nâng cao hiện có.
- `src/main.jsx`: kết nối với editor, workspace, compiler và các hộp thoại.

Không thay engine Tiptap, MathLive, CodeMirror, PDF.js, backend Go hay schema dữ liệu tài liệu bằng logic minh họa trong HTML.

## Kiểm tra

- `npm run test:ui`: điều hướng, tạo/chuyển tài liệu, hủy xóa, bảng lệnh, LaTeX, kéo chia khung, focus, theme, không còn rail đen và độ rộng 1600/1120/901/900/768/390 px. Dùng Edge headless mặc định; biến `UI_TEST_BROWSER` cho phép chọn channel khác đã cài.
- `npm run test:desktop`: công thức, PDF thật, Word/OMML, thiết lập, sao lưu, nhập dự án, nhân bản, lưu cuối phiên và khôi phục khi mở lại.
- `npm run lint` và `npm run build`.

Ảnh kiểm tra giao diện ở `artifacts/monochrome-ui/`. Các bài kiểm tra dùng dữ liệu riêng, không sửa tài liệu đang dùng của người dùng.

### Kiểm tra Obsidian ngày 07/10/2026

- Lint, kiểm tra UI và tab dự án đã qua.
- Desktop smoke đã qua cả renderer dev và renderer production qua giao thức `vietlatex:`: công thức, zoom/pinch, PDF thật, Word/OMML, backup, nhập dự án có tin cậy, nhân bản, lưu cuối phiên và mở lại. Trạng thái PDF đã cập nhật được kiểm tra là màu trung tính.
- So sánh bounding boxes khi bật/tắt `obsidian.css`: sidebar, header, mode bar, tab dự án, ribbon, trang soạn và footer giữ nguyên hình học. Chế độ giảm chuyển động tắt transition.
- Đã đóng gói app tại `release-desktop/VietLatex-Studio-0.4.4/`. Kết nối trực tiếp file EXE bằng Playwright Electron hết thời gian chờ; kiểm thử production dùng Electron runtime với renderer đã build và CSP/giao thức nội bộ. Không thay đổi các fuse bảo vệ của bản đóng gói để phục vụ automation.
- Ảnh renderer production có PDF thật ở `artifacts/desktop-smoke/source-pdf.png` và ảnh khôi phục dữ liệu ở `artifacts/desktop-smoke/restored-editor.png`.

### Triển khai Noir 0.4.5 — 07/10/2026

Giao diện Noir đã duyệt hiện là stylesheet app chính `src/noir.css`, tải sau Obsidian. Demo nhập cùng stylesheet, giữ entry/profile dữ liệu mẫu riêng. App chính không nhập bootstrap dữ liệu demo. Phiên bản mới 0.4.5 giữ bản release 0.4.4 để có thể quay lại khi cần. Không đổi schema workspace, engine editor, API native hay logic biên dịch.

Thanh mode 34 px, đổi trên/dưới có lưu lựa chọn; ở viewport từ 1100 px dùng chung hàng tab khi đặt trên. Sidebar, công cụ gốc và các hộp thoại giữ đầy đủ. Thêm nút thu gọn ribbon và công cụ PDF; lỗi/nguồn chưa tin cậy vẫn hiện. Các thao tác thu gọn dùng nút có tên truy cập và điều khiển bàn phím.

Kiểm tra cuối:
- `npm run lint`: qua.
- `npm run test:backend`: 127/127 qua. Lượt chạy đồng thời ban đầu có một lỗi khởi tạo test backend; kiểm tra riêng và chạy lại toàn bộ đều qua 127/127.
- `npm run test:upgrade`: 18/18 qua, gồm XeLaTeX tiếng Việt, bảng dài, trích dẫn/APA/BibTeX, Word/OMML, ảnh, tài nguyên và phục hồi workspace.
- `npm run test:go`: vet và tests qua.
- `npm run test:ui`, `npm run test:project-tabs`: qua.
- `node scripts/noir-compact-check.mjs`: chạy app chính bằng Vite riêng, kiểm đủ sáu nhóm công cụ gốc (11/25/11/4/2/4), ribbon/PDF thu gọn, lưu vị trí dock, focus, cảnh báo và bảy chiều rộng 1600/1366/1120/901/900/768/390 px. Không lỗi JS/tràn ngang/chồng tab hoặc editor.
- `npm run test:project-pdf`: PDF thật gồm hai tab, ngắt trang, đánh số công thức liên tục và tham chiếu chéo qua.
- Desktop smoke với `VIETLATEX_TEST_PACKAGED_RENDERER=true`: renderer production qua giao thức vietlatex, công thức, zoom/pinch, PDF thật, Word/OMML download/import, backup native, import archive, duplicate, lưu cuối phiên và mở lại đều qua. Ảnh ở `artifacts/noir-release/`.
- `npm run desktop:build`: app đầy đủ và NSIS installer 0.4.5 tạo thành công, có release-manifest/checksum.

Giới hạn xác minh EXE: Windows Application Control chặn khởi chạy file release mới (`An Application Control policy has blocked this file`). Không thay chính sách hoặc fuse. Vì vậy test trên chính EXE release chưa qua bước khởi động; không coi nó là đã được kiểm thử trực tiếp. `scripts/packaged-noir-smoke.mjs` giữ sẵn bài test CDP với profile tạm để chạy trên máy cho phép app. Electron runtime hiện có chạy renderer production đã được kiểm tra. Launcher `Mở app Electron.cmd` rebuild app chính trước khi mở.

### Rà lỗi và tinh chỉnh 0.4.6 — 07/10/2026

Sửa lỗi giao diện tìm được trong đợt rà tiếp:
- Menu bảng, màu và ký hiệu trước đây bị đặt theo khoảng cách đáy cố định 160/200/210 px, nên rời nút mở khi ribbon xuống hàng. Nay đo nút thật và kích thước menu trong layout effect, mở phía trên cách nút 6 px, chặn biên viewport, giới hạn chiều cao và cập nhật khi resize. Esc khôi phục focus về nút mở mà không đóng luôn ribbon.
- Thanh tìm/thay thế và liên kết có nút đóng riêng và Esc, trả focus cho editor. Không cần mở lại tab ribbon để đóng.
- Thiết lập trên màn hình <=620 px giữ nút biểu tượng thay vì bị ẩn hoàn toàn. Header vẫn co tên tài liệu và không tràn ngang.
- Body quản lý dùng min-height:0 để cuộn trong cửa sổ thấp, giữ nút đóng và nav truy cập được.
- Cảnh báo PDF khi công cụ đang thu gọn chừa khoảng cho nút mở, tránh nút đè lên chữ cảnh báo.

Kiểm tra sau sửa:
- Lint, test:ui và test:project-tabs qua.
- Noir compact: toàn bộ sáu nhóm công cụ gốc giữ inventory, dock trên/dưới, cảnh báo, thu gọn/mở công cụ, focus và bảy độ rộng qua.
- `node scripts/noir-menu-probe.mjs`: fixture 20 tài liệu, tên dài, 160 ký tự đổi tên; sáu viewport 1600/1366/1120/901/768/390 ×660; bốn menu nằm sát nút/không vượt viewport, Escape/focus và resize qua; tìm kiếm/link đóng bằng nút/Esc qua; sắp xếp 20 tab và hộp quản lý 390×420 cuộn trong bounds qua. Không lỗi JavaScript. Ảnh ở `artifacts/noir-audit/`.
- Native desktop với renderer production 0.4.6 qua giao thức vietlatex: công thức, zoom/pinch, thiết lập, backup, nguồn/PDF thật, Word/OMML, import archive có tin cậy, duplicate, lưu khi đóng và mở lại đều qua. Ảnh ở `artifacts/noir-release-046/`.
- Backend/schema dữ liệu giữ nguyên; đợt triển khai 0.4.5 đã qua 127 backend và 18 integration/upgrade tests cùng Go/PDF tổng hợp thật.

Kết quả đóng gói 0.4.6: thư mục app đầy đủ `release-desktop/VietLatex-Studio-0.4.6` tạo thành công. Bước NSIS dừng vì Windows Code Integrity/Application Control chặn chạy stub tạo uninstaller; event 3077/3033 ghi rõ file `Temp/VietLatexDesktopBuild-0.4.6/Viet-Latex-Studio-0.4.6-Setup.exe` không đạt yêu cầu signing của máy. File stub không phải bộ cài hoàn chỉnh và không được đưa ra release. Kiểm tra EXE app 0.4.6 cũng bị chặn khởi chạy; không tính là test trực tiếp đã qua. Không thay chính sách bảo vệ. Dùng `Mở app Electron.cmd` cho app chính 0.4.6 với renderer production đã kiểm thử; bộ cài hoàn chỉnh mới nhất còn là 0.4.5. App thường được đóng qua CloseMainWindow/flush của Electron rồi mở bản nguồn mới; không tắt cưỡng bức.
