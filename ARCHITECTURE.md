# Kiến trúc 0.5.0

## Luồng dữ liệu

```text
Tiptap JSON + settings → DocumentSerializer → LaTeX tự sinh
CodeMirror / .tex / ZIP → source thủ công → nguồn được chọn
                                                 ↓
                             tài nguyên + ảnh + thư mục tạm
                                                 ↓
                         Electron IPC → Go / HTTP loopback → Go
                                                 ↓
                           hàng đợi → XeLaTeX → BibTeX nếu cần
                                                 ↓
                                      cache PDF → PDF.js
DOCX ↔ Pandoc JSON ↔ WordDocument ↔ Tiptap JSON
workspace ↔ atomic store + backups / ZIP .vls
```

## Thành phần

- `electron/lan-sync.cjs`, `lan-sync-transport.cjs`, `src/services/LanSyncData.js`, `LanSyncPanel.jsx`: dịch vụ LAN tách khỏi API biên dịch. Mã ghép một lần, khóa theo máy, payload AES-GCM. Record theo tài liệu/dự án/mẫu, revision, dấu xóa, xung đột bền vững và gộp sửa trong lúc nhận. Renderer xác nhận mốc sau khi lưu workspace; nhận thay đổi tạo backup và không nhận quyền tin cậy LaTeX. Dữ liệu nhận được giữ chờ nếu đang mở hộp thoại công thức/trích dẫn có vị trí trong tài liệu. Chi tiết: [LAN-SYNC](docs/LAN-SYNC.md).

- `src/main.jsx`: điều phối workspace, tài liệu hiện hành, lưu/flush, chọn nguồn PDF và trạng thái tin cậy.
- `WorkspaceData.js`, `DocumentData.js`, `DocumentSettings.js`: cấu trúc, xác thực, dữ liệu cũ, thao tác dự án/tài liệu.
- `WorkspaceDialog`, `AbstractSettings.jsx`: thiết lập khung mẫu trước khi tạo dự án/tài liệu. Settings giữ `abstractEnabled`, `abstract`, `abstractTitle`; serializer chèn `{{abstract}}` sau maketitle, trước mục lục/nội dung và cố định heading căn giữa, body căn đều. Mẫu cũ chưa có placeholder được chèn hoặc thay khối abstract khi bật cấu hình. Bản thảo hiển thị frontmatter riêng; Word xuất nội dung tóm tắt trước các block chính.
- `DocumentSerializer.js`: escape văn bản/code/liên kết, math LaTeX, bảng longtable/tabular, span ô, nhãn, tham chiếu, chú thích, BibTeX.
- `ProjectAssets.js`, `ArchiveService.js`: assets base64, đường dẫn tương đối, giới hạn ZIP, .vls và gói source.
- `WordDocument.js`, `backend/internal/service/word.go`: ánh xạ AST qua Pandoc, OMML; hàng đợi, giới hạn/timeout, thư mục tạm; Pandoc sandbox; từ chối raw nodes/ảnh ngoài khi xuất.
- `SourceEditor.jsx`: CodeMirror tải lười, history theo tài liệu, dòng lỗi.
- `TableStyles.js`, `TableLibrary.jsx`, `table-library.css`: thư viện bảng. Node `table` lưu kiểu đường kẻ (học thuật/lưới/sọc/tiêu đề tô nền/tối giản/không kẻ), cỡ chữ, giãn dòng, độ rộng, vị trí chú thích, tiêu đề đậm; ô dùng `align` của Tiptap. Giá trị qua whitelist, mặc định null để bảng cũ giữ nguyên JSON và LaTeX. `StyledTableView` phản chiếu kiểu lên bản thảo. Hộp thoại giữ vị trí bảng nên được tính là hộp thoại chặn nhận LAN. Gõ `1. ` không còn tự tạo danh sách (`ManualOrderedList`). Chi tiết: [TABLE-LIBRARY](docs/TABLE-LIBRARY.md).
- `RichTextExtensions.js`, `RichTextFormats.js`: định dạng kiểu Word — chỉ số trên/dưới, màu chữ, tô sáng, cỡ chữ, ngắt trang. Màu/cỡ chỉ nhận giá trị trong bảng màu/danh sách cỡ; CSS dán từ Word/web được chuẩn hóa về hex/cỡ gần nhất hoặc bỏ. LaTeX: `	extsuperscript`/`	extsubscript`, `	extcolor[HTML]` (xcolor), `ontsize`, tô sáng bằng `\colorbox` từng từ (không cần soul), `
ewpage`. Word: Superscript/Subscript, Span `mark` → highlight; ngắt trang là RawBlock openxml duy nhất backend chấp nhận. Màu chữ và cỡ chữ chưa xuất sang .docx (Pandoc không hỗ trợ).
- `AcademicNodes.js`: citation/crossReference/footnote và label heading/equation. Node `citation` giữ một hoặc nhiều khóa (`key` phân tách bằng dấu phẩy); plugin `citationNumbers` tính nhãn hiển thị ([1–3] hoặc (Tác giả, năm)) từ toàn bộ tài liệu + danh mục trong `editor.storage.citation`, main.jsx làm mới khi BibTeX/kiểu đổi.
- `Bibliography.js`, `ReferencesDialog.jsx`: phân tích BibTeX, đánh số theo thứ tự xuất hiện (unsrt/IEEEtran) hoặc theo tác giả (plain), nhập DOI/danh sách [1]…/APA, cảnh báo khóa thiếu/trùng/chưa dùng. Kiểu trích dẫn (`settings.citationStyle`): auto, unsrt, ieee, plain, apa (`[natbibapa]{apacite}` + `\citep`), authoryear (`natbib` + plainnat); kiểu số dùng gói `cite` để gộp dải. `bibtexForCompile` thêm `note={\url{…}}` (unsrt/plain) hoặc `url` (IEEE) từ DOI khi biên dịch, không sửa BibTeX gốc. Ctrl+Shift+C mở hộp thoại; trích dẫn chèn sau vùng chọn, gộp vào trích dẫn liền trước; bấm vào trích dẫn để sửa.
- `backend/internal/service/doi.go`: `POST /api/doi` tra BibTeX qua doi.org (content negotiation), chỉ theo redirect HTTPS tới resolver DOI/Crossref/DataCite, timeout 15 giây, tối đa 256 KB. Xuất Word dùng `--citeproc` với CSL nhúng (`csl/numeric.csl`, `csl/apa.csl`); tác giả–năm dùng CSL mặc định của Pandoc.
- `StudioManager.jsx`: quản lý tài liệu, backup, trang/tác giả, tài nguyên, học thuật, chẩn đoán.
- `electron/workspace-store.cjs`: tệp tạm rồi rename, hàng đợi ghi, backup và phục hồi. Khi mở workspace, xóa tệp ghi tạm đúng mẫu đã cũ hơn 24 giờ; giữ lại tệp mới để không đụng vào lần ghi đang hoạt động. `workspace-v1.json` trong userData, backup trong thư mục backups.
- `electron/main.cjs`, `app-protocol.cjs`, `preload.cjs`: IPC kiểm tra frame gốc, context isolation/sandbox, tắt Node integration, CSP khi đóng gói, chặn điều hướng ngoài; whitelist trợ giúp. Giao diện đóng gói đi qua `vietlatex://bundle`, chỉ đọc tệp nằm trong `dist`.
- `backend/internal/service`: dịch vụ Go cho HTTP, xác thực đầu vào, cache LRU PDF, hàng đợi biên dịch, quản lý tiến trình XeLaTeX/BibTeX/Pandoc và dọn thư mục tạm.
- `electron/backend-client.cjs`: Electron khởi chạy Go như tiến trình riêng, dùng cổng loopback ngẫu nhiên và token nội bộ; khi thoát hủy lượt đang chạy rồi dừng dịch vụ.
- `scripts/run-web.mjs`, `vite.config.js`: web dev/preview chạy Go ở loopback:4317; proxy Vite thêm token ở phía máy chủ.

## Tính nhất quán và khôi phục

Bản thảo và source giữ riêng. Sửa bản thảo khi đang dùng source riêng chuyển PDF về source tự sinh và giữ source riêng làm bản khôi phục. Nút xóa toàn bộ citation chỉ hoạt động khi dùng bản thảo; lịch sử xóa được đóng ở cả hai phía để Ctrl+Z không gộp với thao tác gõ. Chuyển task lưu vào ID đã chụp của task trước. Hàng đợi persist đọc snapshot mới nhất khi tới lượt ghi. Khi đóng lấy JSON trực tiếp từ editor hiện hành và chờ ghi; lỗi lưu giữ cửa sổ mở.

Backup tự chụp trước lần ghi mới, giãn ít nhất 2 phút, giữ 15 bản; thao tác thủ công dùng cùng hàng đợi. Nếu tệp chính hỏng, thử backup mới nhất, giữ riêng tệp hỏng; không có dữ liệu hợp lệ thì dừng ghi. Nhập backup tạo dự án và ID mới, nguồn chờ tin cậy.

Mất điện/tắt cưỡng bức có thể mất phần chưa ghi. Backup cùng ổ không thay thế bản sao ngoài máy. LocalStorage có giới hạn nhỏ hơn native store.

## Ranh giới bảo mật

Local mode tắt shell escape, kiểm tra đường dẫn, timeout/dung lượng, thư mục tạm và trust gate. Đây không phải OS sandbox; TeX vẫn có thể đọc tệp máy trong phạm vi quyền tiến trình. Docker mode tắt mạng, root filesystem chỉ đọc, bỏ capabilities, chỉ mount thư mục công việc, giới hạn tài nguyên và dọn container khi hủy; cần engine/image hoạt động.

ZIP kiểm tra mục lục trước giải nén và kích thước sau giải nén, traversal, trùng tên không phân biệt hoa/thường, encryption, symlink. IPC/HTTP xác thực lại assets. API chỉ bind loopback, yêu cầu token riêng và chặn Origin ngoài localhost. Electron bật ASAR integrity, chỉ tải app từ ASAR, tắt Node-as-a-service, NODE_OPTIONS, tham số inspect và đặc quyền `file://`. Giới hạn không phải chứng nhận chịu mọi tệp thù địch.

Compile tự chọn số tiến trình theo CPU và RAM trống (tối đa một tiến trình cho mỗi hai luồng logic, tối đa 8; có thể đặt `VIETLATEX_COMPILE_WORKERS` từ 1 đến 8) + 8 chờ; quá tải 503. Các yêu cầu trùng nội dung đang chạy được gộp vào một lượt XeLaTeX (không chiếm thêm chỗ hàng đợi); lượt chung chỉ bị hủy khi mọi yêu cầu chờ đã hủy. Tài liệu nhiều lượt chạy các lượt trung gian với `-no-pdf`, chỉ chạy lại khi .aux/.toc/.lof/.lot/.out còn thay đổi (tối đa 4 lượt), rồi `xdvipdfmx` tạo PDF một lần; thiếu xdvipdfmx thì chạy thêm một lượt đầy đủ. Backend giữ sẵn tối đa 2 tiến trình XeLaTeX đã khởi động (chờ ở dấu nhắc `**`, mỗi tiến trình một thư mục tạm riêng, tái tạo sau 10 phút) và khởi động trước lượt kế tiếp của tài liệu nhiều lượt song song với lượt hiện tại. `VIETLATEX_WARM_TEX`: `auto` (mặc định) không khởi động tiến trình nào lúc mở app, bật pool ở lượt compile đầu và trả RAM sau 10 phút không compile; `1`/`2` như auto với số tiến trình đó; `eager` khởi động sẵn 2 tiến trình lúc mở; `0`/`off` tắt. Pool không vượt số worker hiện tại và bỏ hết tiến trình rảnh khi RAM trống dưới 1 GiB; Docker mode không dùng. Mỗi 5 giây backend đo lại RAM trống (cộng lại ~250 MiB cho mỗi worker đang chạy để không tự co vì chính mình) và chỉnh số worker theo cùng bảng ngưỡng lúc khởi động: giảm sau 2 lần đo liên tiếp, tăng từng worker sau 3 lần đo; worker đang chạy không bị ngắt khi giảm, giới hạn nhận request (worker + hàng đợi) đi theo. `VIETLATEX_COMPILE_WORKERS` cố định số worker, `VIETLATEX_ADAPTIVE_WORKERS=0` giữ giá trị lúc khởi động. `GET /api/health` trả `compiler` (hàng đợi, `rejectedQueue`/`rejectedAdmission`, `waitMs`/`compileMs` với avg/p50/p95/max trên 256 mẫu gần nhất, `compileFailed`, `workers`, `warm`), `word` (hàng đợi, `waitMs`, `runMs`) và `system` (RAM trống, CPU, uptime, heap backend). Khi khởi động, backend dọn thư mục `viet-latex-*`/`vietlatex-word-*` cũ hơn 24 giờ. Electron tạo cửa sổ song song với việc khởi động backend. CI job `compile-benchmark` chạy `test:bench` với `BENCH_ENFORCE=1` theo ngưỡng trong `scripts/bench-budget.json` (tỉ lệ so với tài liệu một lượt + trần tuyệt đối). Đo bằng `npm run test:bench`. Cache 32 bản/32 MiB; Retry bỏ qua cache, tab Hệ thống xóa cache. Mỗi lượt XeLaTeX/BibTeX tối đa 30 giây, tài liệu nhiều lượt có tổng thời gian cao hơn.

## Giới hạn và phát hành

Rà soát chịu tải tháng 10/2026 bổ sung trạng thái đóng cho mọi hàng đợi: yêu cầu chờ được đánh thức khi shutdown, yêu cầu mới bị từ chối trước khi đọc body. Lifecycle context hủy cả tra DOI và chẩn đoán; các WaitGroup đợi flight biên dịch, lượt Word và warm spawn dọn xong trước khi backend thoát. DOI dùng 4 worker + 8 chờ, chẩn đoán 1 worker + 2 chờ; `/api/health` báo riêng `doi` và `diagnostics`. Worker controller giữ hysteresis nhưng ép mục tiêu về 1 khi RAM trống dưới 256 MiB để phần RAM cộng bù của worker đang chạy không che áp lực bộ nhớ nghiêm trọng.

Kiểm tra Base64 giới hạn độ dài trước giải mã và dùng strict decoding không mã hóa lại dữ liệu để so sánh; giao diện kiểm tra cả bit padding và tên tệp dành riêng trong thư mục con giống backend. JSON chỉ cho phép whitespace sau giá trị đầu tiên, đọc tới EOF theo giới hạn body và từ chối giá trị thứ hai ngay khi gặp, tránh cấp phát cho dữ liệu chắc chắn bị loại. Cache được kiểm tra lại dưới khóa trước khi tạo flight để tránh biên dịch thừa khi lượt trước vừa hoàn tất. Dọn thư mục tạm cũ bao gồm cả `vietlatex-source-*`. Workspace store xác thực cấu trúc snapshot trước khi đưa vào hàng đợi ghi.

Không phân tích LaTeX tùy ý ngược sang Tiptap. Word chỉ chuyển cấu trúc hỗ trợ, macro phức tạp không bảo đảm OMML; refs là tên nhãn, chưa là field động. Phân trang bản thảo có thể khác PDF khi đổi giấy/lề. Chưa có cộng tác, cloud sync, tracked changes và updater có chữ ký.

0.5.0 thêm đồng bộ phiên bản LAN, chưa có cộng tác gõ đồng thời. 0.5.6 bổ sung PDF đã biên dịch qua endpoint `/pdf` mã hóa, kiểm tra SHA-256 và hai dấu phiên bản: bản thảo/mẫu, source/ảnh/tài nguyên. PDF không nằm trong record bản thảo, nên client v1 cũ vẫn tương thích. Cache cục bộ tối đa 32 MiB, 24 MiB/tệp; renderer nhận PDF qua IPC, kiểm tra phiên bản hiện tại rồi đưa vào scheduler. Xem/xuất PDF nhận được không cấp quyền thực thi source. Tick 5 giây đến từ tiến trình chính và tiếp tục khi resume. Luồng thoát hoàn thành flush trước khi dừng dịch vụ; lỗi lưu giữ cả cửa sổ lẫn backend hoạt động. Menu App/Edit/Window được bật trên macOS.

Setup Pandoc kiểm tra SHA-256 và giữ giấy phép. Vite đóng gói font MathLive cục bộ. Builder dùng thư mục tạm theo phiên bản để tránh lỗi đường dẫn workspace có dấu, rồi copy installer và SHA-256 về release-desktop.

Toolchain được ghim bằng package-lock/npm ci, Node 22.13+ (CI dùng Node 24), Go 1.26.8+, ESLint flat config và React Hooks rules. Backend Go chỉ dùng thư viện chuẩn; CI biên dịch backend cho Linux và chạy lint/backend tests, Vite/Rolldown production build cùng npm audit. Desktop đóng gói helper riêng theo nền tảng; macOS universal ghép hai binary bằng lipo. `test:desktop:dist` chạy production renderer trong Electron dev binary qua giao thức nội bộ.

Tests: backend, serializer, math paste, XeLaTeX/BibTeX, Word OMML roundtrip, load và Electron smoke. Desktop test dùng VIETLATEX_USER_DATA trỏ mkdtemp, không mở hồ sơ thật. Bản macOS universal được kiểm tra chữ ký ad-hoc, kiến trúc và runtime Apple Silicon theo quy trình trong docs/MAC-INSTALLER.md. Chạy trên Intel, Developer ID/notarization và Docker runtime chưa được xác minh.

## PDF theo đợt

Công thức được nhận diện bằng delimiter và dựng bằng KaTeX trực tiếp trong bản thảo; nguồn LaTeX vẫn được cập nhật độc lập với PDF. `PdfCompileScheduler` thay debounce biên dịch 700 ms bằng ba chế độ: khoảng 2 trang (mặc định), khoảng 1 trang, hoặc chỉ khi yêu cầu. Lựa chọn được lưu trên thiết bị. Bộ gom đợt dùng số trang bản thảo đo trực tiếp bởi editor; khi dùng source riêng, nó ước lượng một trang trên 3.000 ký tự LaTeX. Dàn trang PDF vẫn có thể khác. Ảnh, tài nguyên và thay đổi định dạng vẫn làm PDF hết cập nhật và được xử lý qua mốc thời gian hoặc cập nhật thủ công.

Tự động đợi ngừng gõ 5 giây và giãn tối thiểu 30 giây giữa thời điểm bắt đầu các lượt. Thay đổi nhỏ dùng mốc 60 giây từ khi có thay đổi chưa biên dịch, vẫn đợi ngừng gõ. Một client chỉ có một lượt đang chạy và giữ phiên bản mới nhất để xử lý tiếp. Gõ tiếp không hủy lượt đang chạy; chuyển tài liệu, mất trạng thái tin cậy hoặc đóng ứng dụng thì hủy. Lỗi không tự lặp vô hạn; sửa tài liệu hoặc yêu cầu thử lại để chạy tiếp.

PDF cũ vẫn xem được kèm thông báo chưa cập nhật. Cập nhật PDF và xuất PDF bỏ qua thời gian gom đợt; xuất lấy snapshot trực tiếp từ editor và kiểm tra lại phiên bản trước khi tải. Chuyển tài liệu trong lúc xuất hủy yêu cầu xuất. Thử lại chủ động bỏ cache; xuất bản đã cập nhật dùng lại Blob hiện có. Kiểm tra chính sách và tranh chấp bằng `scripts/pdf-compile-scheduler.test.mjs`; `npm run test:pdf-batching` kiểm tra giao diện bằng trình duyệt headless, backend thật và hồ sơ tách biệt (mặc định Edge, có thể đặt `PDF_SMOKE_BROWSER`).
