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

## Còn mở sau đợt theo dõi

- TeX vẫn đọc được mọi tệp người dùng đọc được (`openin_any`); cần kiểm thử trên TeX Live/MacTeX trước khi siết.
- MiKTeX có thể chờ hộp thoại cài gói tới hết 30 giây.
- Runtime Windows và EXE đã ký chưa được kiểm thử trong lượt chạy trên macOS.

## Kiểm tra lại trước khi push

- `npm run check` chạy lại hoàn tất: lint, Go vet/test, 169 kiểm tra JS/backend, 15 LAN, 18 nâng cấp và build production đều qua.
- Mỗi ảnh có dòng nhập chú thích ngay bên dưới; chú thích lưu cùng ảnh, hỗ trợ hoàn tác/làm lại và giữ khi xuất PDF/Word.
- `node scripts/image-captions-ui.mjs`: qua thao tác với ảnh cũ, tải ảnh mới, sửa chú thích, lưu/mở lại và hoàn tác/làm lại.
- `npm run test:desktop`: qua công thức, thiết lập, backup, PDF, tải Word có OMML, nhập Word/ZIP, nhân bản, lưu khi đóng và mở lại.
- `npm run test:ui`: qua điều hướng, thư viện mẫu, trích dẫn, tìm/thay, command palette, giao diện sáng/tối và sáu kích thước màn hình.
- `npm run smoke:serializer`: cả năm mẫu biên dịch XeLaTeX thành công.
- `npm audit --audit-level=low`: 0 lỗ hổng.
- Lượt đầu gặp hết thời gian biên dịch và cửa sổ desktop đóng trong khoảng gián đoạn dài; phép thử bảng dài và desktop chạy lại đều qua.

## Theo dõi các mục còn mở — 09/10/2026

- **Khôi phục workspace:** bộ nạp nay lọc node và tài nguyên hỏng riêng lẻ, giữ phần nội dung, metadata và asset hợp lệ. Nếu toàn bộ nội dung trực quan hỏng, task vẫn được giữ với tài liệu trắng an toàn; source LaTeX và metadata còn lại được giữ. Thêm hai hồi quy cho hỏng một phần và hỏng toàn bộ.
- **Đồng bộ LAN:** hạn phía client tính riêng cho request và response, bắt đầu ở 30 giây, tăng theo kích thước wire với giả định tối thiểu 256 KiB/giây, tối đa 15 phút; server nhận tối đa 15 phút. Lệch đồng hồ trên 5 phút giờ trả lời cách khắc phục. Kiểm thử đồng bộ: 22/22 qua.
- **Quyền đọc của TeX vẫn là giới hạn đã biết:** thử `openin_any=p` với XeLaTeX đi kèm vẫn cho `\input` một tệp ngoài thư mục dự án, trong khi asset cục bộ vẫn biên dịch. `texmf.cnf` của TeX Live 2026 ghi rõ `openin_any` không còn tác dụng. Local mode vì vậy không được xem là sandbox; banner tin cậy trong ứng dụng đã cảnh báo XeLaTeX có thể đọc file máy. Muốn cô lập file cần dùng Docker sandbox khi Docker/image có sẵn hoặc bổ sung sandbox theo hệ điều hành.
- **MiKTeX và Windows:** chưa thể kiểm tra hộp thoại cài package hoặc runtime Windows trong lượt macOS này; giữ nguyên trạng thái chưa xác minh.
- **Giao diện và smoke:** ổn định focus/blur MathLive khi mở/đóng hộp thoại; PDF batching smoke đặt chế độ xem tường minh để không kích hoạt compile ngoài ý muốn.
- Go race detector qua trên macOS; EXE Windows đã ký và runtime MiKTeX vẫn chưa được xác minh.
- Sau các sửa đổi: `npm run check:full -- --only=check` qua trong 42 giây; suite gồm lint, Go vet/test, backend, đồng bộ, nâng cấp/biên dịch thật và build Vite production. 13/13 kiểm thử rich-text và 22/22 kiểm thử LAN qua.
- `npm run desktop:build:dir` đóng gói lại app universal x64/arm64; kiểm tra chữ ký, TeX tree, chạy gói thật, PDF/Word, bảng, APA/Biber, lưu/mở lại và đồng bộ giữa hai app đều qua. Đây là gói ad-hoc để kiểm tra trên máy, không tạo DMG hay notarize.
- **Áp lực RAM khi tải body lớn:** bốn request compile đồng thời (mỗi body ~32 MiB) từng làm heap Go tăng khoảng 515 MiB. Backend nay giới hạn tổng body đang được giữ ở 40 MiB; body chunked giữ reservation theo mức tối đa của endpoint. Kiểm tra lại: một compile thành công, ba request bị từ chối có kiểm soát bằng 503; reservation đỉnh 33,554,686/41,943,040 byte và cuối lượt trở về 0. Health endpoint công bố mức đang dùng; bài stress thường xuyên kiểm tra không vượt giới hạn và không rò reservation.
- Sau thay đổi ngân sách body: `npm run check:full -- --only=check` qua (23 mục, 0 lỗi, 45 giây); `npm run test:go:race` qua; `npm run desktop:build:dir` đóng gói universal và smoke PDF/Word/UI/LAN hai app qua.

## Phản hồi về bàn phím công thức và NO₂ — 09/10/2026

- **Bàn phím che ô nhập và không đóng:** math-field đang dùng chính sách bàn phím `manual`, nên MathLive không tự ẩn bàn phím khi blur. Nay đóng/chèn công thức hoặc đổi chế độ nhập sẽ ẩn bàn phím; chặn thông điệp mở muộn khi hộp đã đóng. Có nút “Đóng bàn phím” cạnh ô nhập; Esc lần đầu ẩn bàn phím, lần tiếp theo đóng hộp, không can thiệp Escape của IME. Hộp công thức giảm chiều cao theo bàn phím và cuộn ô nhập vào vùng nhìn thấy. Math-field được tháo khi đổi khỏi chế độ trực quan để tránh focus muộn vào ô ẩn.
- **NO₂ bị xuất thành NO:** XeLaTeX với font hiện tại không có glyph Unicode `₂`; tái hiện PDF có ký tự thiếu `U+FFFF`. Serializer nay chuyển các chuỗi chỉ số Unicode thành `\textsubscript{…}`/`\textsuperscript{…}`, kể cả văn bản thường, tiêu đề, tác giả, abstract và chú thích, giữ nguyên dữ liệu bản thảo. Dùng chung bảng ký tự với chuẩn hóa/nhận diện công thức; đưa module mới vào gói Electron để các import ở main process hoạt động.
- **Hồi quy:** 42 kiểm thử serializer/nhập/nhận diện qua; PDF thật giữ đủ `NO₂ CO₂ H₂O SO₄²⁻ m² xₜ ¹⁴C`, số 2 của NO₂ thấp hơn baseline và nhỏ hơn chữ NO, số 2 của m² cao hơn baseline. UI bàn phím qua các kích thước 1440×1000, 1280×720, 390×844, nút đóng/Esc/IME, đổi chế độ, gõ và chèn.
- **Bản desktop:** kiểm tra code, smoke serializer và UI nhận diện/bàn phím đều qua. App universal đóng gói lại, kiểm tra bàn phím trực tiếp trong gói và giữ Unicode scripts trong PDF của cả sáu cấu hình mẫu qua; Word, lưu/mở lại, gõ/màu chữ, heading và LAN hai app vẫn qua. App đã cài đang chạy trong `/Applications` cần được mở lại từ gói mới để dùng sửa đổi; PDF cũ cần “Cập nhật PDF”.
- **Tự nhận diện trong bản thảo:** bổ sung chuyển token chỉ số Unicode sang node LaTeX trong dòng. Gõ `NO₂` rồi thêm dấu cách/dấu câu hoặc rời ô sẽ thành `\mathrm{NO}_{2}`; dán riêng hoặc trong câu sẽ nhận diện ngay. Chờ kết thúc token để `H₂O` và chỉ số nhiều chữ số không bị tách khi đang gõ. Giữ chữ quanh công thức, dấu định dạng và vị trí con trỏ; bỏ qua code/liên kết và không can thiệp hoàn tác. Bộ quét giữ đầy đủ `H₂O`, `SO₄²⁻`, bộ nhập “Gõ thường” dùng chữ đứng cho công thức hóa học. LaTeX sinh từ token Unicode không yêu cầu xác nhận source thô.
- **Kiểm tra bổ sung:** 21 kiểm thử nhập/nhận diện/quét/chuyển node qua; UI gõ và dán thực tế qua; XeLaTeX biên dịch các node vừa nhận diện, PDF giữ đủ `NO₂ CO₂ H₂O SO₄²⁻ m² xₜ` và không có ký tự thiếu. Chuỗi trích xuất PDF math-mode có thể trả số mũ trước chỉ số dưới; kiểm thử chấp nhận thứ tự trích xuất đó.
