# Rà soát toàn diện và nâng cấp — 08/10/2026 (đợt 2)

Rà soát song song bốn mảng (backend Go, Electron/LAN, service frontend, giao diện React), kèm hai thay đổi theo yêu cầu: bỏ tự tạo danh sách khi gõ `1. ` và thêm [thư viện bảng](TABLE-LIBRARY.md). Mỗi lỗi sửa có kiểm thử hồi quy khi có thể chạy ngoài Electron.

Kết quả cuối: `npm run check` qua (lint, Go vet/test, 166 kiểm thử JS/backend, 15 LAN, 18 nâng cấp, build production); `npm run smoke:serializer` biên dịch XeLaTeX cả 5 mẫu; `npm audit` 0 lỗ hổng; `npm ci --dry-run` khớp lockfile. Biên dịch thật 6 kiểu bảng × 3 cấu hình + 6 mẫu: 0 lỗi, 0 tràn lề (trước khi sửa `\multirow` là 24 cảnh báo tràn).

## Theo yêu cầu

- **Gõ `1. ` không còn tự tạo danh sách thụt lề** (`ManualOrderedList`); nút Danh sách đánh số vẫn dùng được. Dòng ngắn dạng `1. Mở đầu` vẫn được nhận là tiêu đề theo quy tắc 0.5.1.
- **Thư viện bảng**: 6 mẫu dựng sẵn, 6 kiểu đường kẻ, cỡ chữ, giãn dòng, độ rộng, vị trí chú thích, tiêu đề đậm, căn lề từng cột/ô, xem và sao chép mã LaTeX. Căn lề ô được xuất/nhập Word.

## Lỗi đã sửa — LaTeX/PDF

- Link có `%` hoặc `#` (ví dụ Wikipedia tiếng Việt) làm hỏng cả lượt biên dịch.
- `\multirow{n}{*}` trong cột xuống dòng tràn lề; ô gộp cột lệch vài pt làm hở nền; lưới kẻ xuyên ô gộp.
- Biên dịch không dùng warm XeLaTeX thất bại khi đường dẫn TEMP có `~`/`%` (tên rút gọn Windows như `NGUYEN~1`).
- Lượt nhiều pass bị hủy/lỗi để rò thư mục `viet-latex-*` trên Windows; hết giờ chỉ giết tiến trình con trực tiếp (biber của MiKTeX vẫn chạy).
- Tài liệu dùng `\autoref`, `\cref`, `\nameref`, `\listoffigures`… chỉ chạy một lượt nên còn `??`.
- Cache PDF dùng ngày UTC trong khi `\today` dùng giờ máy (0–7 giờ sáng tại Việt Nam hiện ngày hôm trước).
- Backend dừng giữa chừng trả 200 rỗng; nay trả 503.

## Lỗi đã sửa — dữ liệu và đồng bộ

- Khi thoát, lần lưu xếp hàng sau lượt flush cuối có thể bị mất (nguồn gốc tệp `workspace-v1.json.<pid>.<uuid>.tmp` còn sót trong `user-data`, tệp này **mới hơn** bản đang dùng — giữ nguyên, chưa tự khôi phục).
- Đổi tên tệp nguyên tử thất bại khi phần mềm diệt virus/indexer khóa tệp trên Windows; thêm thử lại ngắn. Thêm fsync thư mục trên macOS/Linux.
- Renderer crash hoặc tải trang lỗi làm cửa sổ không thể đóng; `activate` trên macOS có thể mở cửa sổ thứ hai.
- LAN: dừng dịch vụ có thể chờ 30 giây; khe hở chống gửi lại; body `/pair` không giới hạn trước xác thực; cổng máy chủ bị chiếm làm trạng thái sai; tệp tạm hồ sơ sync không được dọn.
- Electron cấp mọi quyền trình duyệt mặc định; nay chỉ cho clipboard.
- Token API backend lộ sang XeLaTeX/BibTeX/Pandoc; backend mồ côi khi Electron crash (`VIETLATEX_PARENT_PID`).
- ZIP từ macOS/công cụ cũ có tên tiếng Việt bị từ chối; `__MACOSX`, `.DS_Store`, `Thumbs.db` làm nhập dự án thất bại.
- Nhập Word: ảnh EMF/WMF tính vào ngân sách trước khi bỏ; liên kết ảnh ngoài làm hỏng cả lượt nhập; AST quá lớn báo sai lỗi; Pandoc đường dẫn tương đối không tìm thấy; chú thích hình bị mất; footnote dài làm hỏng cả lượt nhập.

## Lỗi đã sửa — trích dẫn, công thức, giao diện

- BibTeX: dấu tiếng Việt lồng nhau (`Nguy{\~{\^e}}n`), `\d`/`\h`, họ kiểu phương Tây ("Van Thanh Nguyen" → Nguyen), `$…$` trong tiêu đề, ngày APA `(2024, March 5)`/`(n.d.)`, ngoặc lẻ nuốt các mục sau.
- Nhãn trích dẫn tính lại toàn bộ mỗi phím gõ (30–45 ms với 600 trích dẫn); nay dùng lại khi không đổi.
- Nhận dạng công thức: `(a)(b)/c`, `|x|`, `sin(x)`; `\text{max\_depth}`; ngày `12/05/2024` bị gợi ý là phân số.
- Gõ Telex/VNI: Enter/Esc trong lúc đang ghép dấu chèn trích dẫn, tạo tab, chạy lệnh hoặc đóng hộp thoại.
- Esc trong hộp thoại thu gọn cả thanh công cụ; hộp thoại đang bận đóng mất kết quả.
- Trạng thái nút B/I/U, danh sách, kiểu đoạn không cập nhật khi di chuyển con trỏ.
- Chèn ảnh sau khi chuyển tài liệu rơi vào tài liệu khác; PDF mới hiện cảnh báo lỗi giả; công thức mở lại ở chế độ gõ thường; MathLive không nhận focus lần đầu; zoom phím tắt không hoạt động ở chế độ chỉ đọc; Enter không áp dụng liên kết.
- CSS: token không tồn tại (`--border`, `--font-ui`) và CSS chết. Viền mảnh nay hiện trên nút tab dự án (có thể hoàn lại ba dòng trong `monochrome.css` nếu muốn giữ kiểu không viền).

## Dependency

Nâng trong phạm vi semver: `@codemirror/language` 6.13.1, `@codemirror/view` 6.43.14, `@codemirror/legacy-modes` 6.5.5, `playwright` 1.64.0, `react-resizable-panels` 4.14.3; thêm `@tiptap/extension-list` làm dependency trực tiếp. Electron 44.7.0 chưa nâng được vì tiến trình Electron đang chạy khóa tệp — chạy `npm update electron` khi đã đóng app. Giữ `katex` 0.18 và `mathlive` 0.110 (bản 0.x mới có thể đổi API).

## Còn mở

- TeX vẫn đọc được mọi tệp người dùng đọc được (`openin_any`); cần kiểm thử trên TeX Live/MacTeX trước khi siết.
- MiKTeX có thể chờ hộp thoại cài gói tới hết 30 giây.
- Một node/tài nguyên không hợp lệ làm bỏ cả task khi nạp; nên chuyển sang sửa từng phần thay vì bỏ cả task.
- Thời gian chờ LAN 30 giây tuyệt đối có thể không đủ cho workspace gần 128 MiB trên Wi-Fi chậm; lệch đồng hồ > 5 phút báo lỗi khó hiểu.
- Go race detector (cần cgo) và EXE đã ký chưa chạy trong đợt này.

## Kiểm tra lại trước khi push

- `npm run check` chạy lại hoàn tất: lint, Go vet/test, 169 kiểm tra JS/backend, 15 LAN, 18 nâng cấp và build production đều qua.
- Mỗi ảnh có dòng nhập chú thích ngay bên dưới; chú thích lưu cùng ảnh, hỗ trợ hoàn tác/làm lại và giữ khi xuất PDF/Word.
- `node scripts/image-captions-ui.mjs`: qua thao tác với ảnh cũ, tải ảnh mới, sửa chú thích, lưu/mở lại và hoàn tác/làm lại.
- `npm run test:desktop`: qua công thức, thiết lập, backup, PDF, tải Word có OMML, nhập Word/ZIP, nhân bản, lưu khi đóng và mở lại.
- `npm run test:ui`: qua điều hướng, thư viện mẫu, trích dẫn, tìm/thay, command palette, giao diện sáng/tối và sáu kích thước màn hình.
- `npm run smoke:serializer`: cả năm mẫu biên dịch XeLaTeX thành công.
- `npm audit --audit-level=low`: 0 lỗ hổng.
- Lượt đầu gặp hết thời gian biên dịch và cửa sổ desktop đóng trong khoảng gián đoạn dài; phép thử bảng dài và desktop chạy lại đều qua.
