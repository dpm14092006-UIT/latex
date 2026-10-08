# Viet LaTeX Studio 0.5.6 — macOS

Ứng dụng desktop soạn tài liệu tiếng Việt, nhập công thức trực quan, chỉnh LaTeX và xem PDF. Bản thảo, tài nguyên, sao lưu và chuyển đổi Word được xử lý trên máy.

Bản 0.5.6 đồng bộ PDF đã biên dịch để máy nhận xem và xuất mà không phải chạy LaTeX. LAN chạy mỗi 5 giây khi cửa sổ bị ẩn, hiển thị trạng thái máy đã ghép và xung đột chưa xử lý. Đã bỏ chức năng đồng bộ cuộn; bản thảo và PDF cuộn độc lập. Giữ sửa chữ bị cắt, tràn lề và cập nhật PDF tự động. Xem [thay đổi 0.5.6](docs/UPGRADE-0.5.6.md).

Bản sửa macOS 0.5.2 ngăn chữ trắng/gần trắng từ nền tối lọt vào PDF, tự sửa định dạng cũ khi mở và giữ các màu chữ/tô sáng đã chọn. Xem [thay đổi 0.5.2](docs/UPGRADE-0.5.2.md).

Phiên bản 0.5.1 giữ đúng số tiêu đề và nhận diện tiêu đề trước ngắt dòng khi dán từ Word hoặc dùng Shift+Enter. Xem [thay đổi 0.5.1](docs/UPGRADE-0.5.1.md).

## Cài trên MacBook

Mở `release-desktop/Viet-Latex-Studio-0.5.6-universal.dmg`, kéo **Viet Latex Studio.app** vào **Applications** rồi mở app. Bộ cài universal dành cho macOS 26+, gồm Electron, backend Go, Pandoc và TeX Live gọn. Không cần Node/Go/MacTeX riêng để sử dụng các mẫu có sẵn, PDF và Word. Bản cục bộ có chữ ký ad-hoc, chưa notarize bằng Apple Developer ID.

Chi tiết build/cài và giới hạn: [Bộ cài MacBook](docs/MAC-INSTALLER.md). Các bản EXE/NSIS, launcher CMD và backend riêng Windows đã được loại bỏ khỏi checkout này. Lịch sử kiểm thử Windows trong tài liệu audit là ghi nhận của phiên trước.

Dữ liệu nằm trong hồ sơ `userData` của Electron, ngoài thư mục cài ứng dụng. Trước khi chuyển máy, dùng **Quản lý tài liệu → Sao lưu** để xuất gói `.vls`. Đóng cửa sổ giữ app chạy; **Cmd+Q** lưu tài liệu rồi thoát.

## Đồng bộ LAN

Mở **Quản lý tài liệu → Đồng bộ LAN**. Một máy làm máy chủ, tạo mã ghép một lần; máy còn lại dán mã và ghép. Dữ liệu tự kiểm tra mỗi 5 giây, tiếp tục lưu khi offline, giữ cả hai phiên bản khi cùng sửa. Không tự bật chia sẻ khi cài app. Giao thức vẫn đọc workspace từ các bản trước. Xem [hướng dẫn kết nối và xung đột](docs/LAN-SYNC.md).

## Chức năng

- Soạn tiêu đề, đậm/nghiêng/gạch chân/gạch bỏ, liên kết, danh sách, trích dẫn, khối mã, ảnh; undo/redo, tìm/thay thế, căn lề.
- Công thức trong dòng/căn giữa, MathLive có font cục bộ, nhập LaTeX, thư viện mẫu; nhấp công thức để sửa. Nhận dấu `$...$`, `$$...$$`, `\(...\)`, `\[...\]` khi dán, giữ công thức hiện có và định dạng văn bản.
- Bảng: thêm/xóa hàng/cột, gộp/tách ô. Xuất LaTeX với multirow/multicolumn; longtable trải nhiều trang và lặp hàng tiêu đề, giữ nhóm ô gộp trên cùng trang. Mẫu hai cột giữ bảng nhỏ trong cột; bảng dài chuyển sang trang toàn chiều rộng rồi trở lại hai cột. Caption và hàng tiêu đề được giữ khi xuất Word.
- Quản lý dự án/tài liệu: tìm, đổi tên, nhân bản, xóa; mỗi tài liệu giữ riêng bản thảo, source, cấu hình và tài nguyên.
- Thiết lập khung ngay khi tạo dự án/tài liệu: chọn mẫu, tiêu đề tài liệu đầu tiên, tác giả, ngày, Abstract và mục lục trước khi tạo. Mẫu nghiên cứu/IEEE có dàn bài sẵn. Abstract mặc định bật cho tài liệu tạo bằng hộp thoại mới; tài liệu cũ giữ cấu hình hiện có.
- Cấu hình tác giả/ngày, A4/Letter/A5, cỡ chữ, lề, giãn dòng, mục lục PDF, đánh số công thức; **Trang & tác giả → Abstract** để bật/tắt, chọn “Abstract” hoặc “Tóm tắt” và nhập nội dung. Tiêu đề Abstract luôn căn giữa, in đậm; nội dung căn đều hai lề, nằm sau phần tiêu đề và trước mục lục/nội dung. Bản thảo hiển thị khung riêng với nút **Sửa Abstract**; nội dung được giữ khi xuất Word.
- Nhãn tiêu đề/công thức, tham chiếu chéo, chú thích chân trang, trích dẫn và BibTeX; tự chạy thêm các lượt XeLaTeX/BibTeX hoặc Biber để cập nhật tham chiếu. Theo mẫu tài liệu mặc định dùng APA 7th, riêng IEEEtran dùng IEEE; có thể chọn số thứ tự, IEEE hoặc Harvard rõ ràng cho từng tài liệu.
- Quét trích dẫn chưa liên kết: tác giả–năm, nhóm nhiều bài, trích dẫn tường thuật và số gốc; tìm REF theo tác giả/năm/tiêu đề, duyệt và liên kết hàng loạt, giữ lựa chọn khi quét lại, hoàn tác một bước. Nút “Xóa cite trong bản thảo” gỡ mọi citation node; Ctrl+Z hoàn tác riêng thao tác xóa và danh mục BibTeX vẫn được giữ. Khi PDF đang dùng source riêng, quay về bản thảo trước khi dùng nút này; các lệnh cite viết trong source riêng được sửa bằng trình LaTeX. Số trong bản gốc được đối chiếu bằng bảng ánh xạ riêng.
- CodeMirror tô cú pháp LaTeX, số dòng, tìm/thay thế, undo/redo, đánh dấu dòng lỗi. Khi gõ/dán, thao tác vượt 800 KiB UTF-8 bị chặn nguyên vẹn; source cũ quá lớn vẫn có thể giảm nội dung. PDF có chuyển trang, thu phóng, tải xuống, log và thử lại bỏ qua cache.
- Nhập `.tex` thành tài liệu mới; nhập ZIP dự án với tệp chính và tài nguyên; thêm/xóa tài nguyên; xuất ZIP source, ảnh và tài nguyên. Hỗ trợ tài nguyên tex/bib/bst/sty/cls/png/jpg/jpeg/pdf/eps/csv/txt. Tài nguyên trong ZIP phải nằm cùng thư mục với tệp chính hoặc thư mục con; tệp ở ngoài bị báo lỗi để tránh nhập thiếu.
- Nhập/xuất `.docx` trên desktop bằng Pandoc đóng gói; công thức hỗ trợ chuyển thành OMML chỉnh sửa được trong Word. Có chuyển đổi văn bản, tiêu đề, danh sách, bảng, liên kết, ảnh và chú thích.
- Lưu workspace nguyên tử: sau 300 ms ngừng sửa, định kỳ 1,5 giây khi gõ, chờ lưu khi đóng. Giữ tối đa 15 backup luân phiên, tự tạo không dày hơn 2 phút; có điểm khôi phục thủ công.
- Tự phục hồi backup nếu tệp chính hỏng, giữ riêng tệp hỏng. Khi mở workspace, ứng dụng xóa các tệp tạm ghi nguyên tử đúng mẫu đã cũ hơn 24 giờ; tệp mới hơn được giữ nguyên. Nhập `.vls`/mở backup tạo bản sao dự án, tránh đè dữ liệu đang làm.
- Source/tài nguyên nhập ngoài chờ **Tin cậy và biên dịch**. Kiểm tra đường dẫn, dung lượng, ZIP mã hóa/liên kết/trùng tên trước khi nhập.

## Hai chế độ tài liệu và giới hạn Word

Ở chế độ tự động, bản thảo và cấu hình sinh LaTeX. Khi sửa source thủ công, PDF lấy source đã sửa. Sửa bản thảo sẽ chuyển PDF về source tự sinh và giữ source riêng để khôi phục; giao diện báo trạng thái và có nút khôi phục. Nhập `.tex`/ZIP chưa chuyển ngược thành mô hình soạn thảo. Xuất Word lấy **bản thảo**, không chuyển source LaTeX tùy ý.

Nhập DOI ưu tiên metadata từ resolver. Khi không tra được DOI hoặc nguồn chỉ có văn bản, parser hỗ trợ bài báo, chương sách và kỷ yếu hội nghị (gồm LNCS), giữ năm xuất bản riêng với năm trong tên hội nghị, editor, series, volume, publisher và pages khi nhận ra. Giao diện báo rõ các mục được phân tích từ văn bản để kiểm tra metadata trước khi trích dẫn.

Quét cite giữ cả nhóm khớp một phần, ví dụ nhóm sáu nguồn có hai mục `Avogaro 2025a/2025b` chưa xác định. Chọn bộ lọc **Nhóm khớp một phần** hoặc **Cần kiểm tra / chọn nguồn** để xử lý; mỗi hậu tố a/b phải được đối chiếu với một bài riêng qua tiêu đề/DOI. Gợi ý cùng năm được ưu tiên hơn gợi ý khác năm và luôn cần duyệt. Đổi nguồn bỏ trạng thái đã duyệt; chỉ chọn khớp chính xác hàng loạt khi toàn bộ nguồn của nhóm thực sự khớp. Số gốc phải có ánh xạ; không lấy số hiện tại làm số gốc. Bộ quét hỗ trợ cite xuống dòng, ba tác giả ghi đầy đủ, `n.d.`, số trong cite tường thuật và locator từng nguồn; tối đa 2.000 vị trí mỗi lượt, có báo giới hạn. Thay tài liệu hoặc metadata sau quét buộc quét lại; undo liên kết tách khỏi thao tác gõ.

Chèn cite sau vùng bôi đen giữ nguyên câu đã chọn. **Cách cite** chọn trong ngoặc hoặc tường thuật; sửa cite vẫn giữ đúng kiểu này. Nhập lặp DOI giữ một REF, cập nhật metadata và giữ khóa hiện có để không làm đứt cite/source/ánh xạ số gốc. BibTeX hỗ trợ chuỗi `@string`, nối bằng `#`, ngoặc tròn, tên tổ chức có ngoặc bảo vệ và kiểm tra dung lượng theo UTF-8.

Word không bảo toàn tuyệt đối mọi bố cục: tham chiếu chéo xuất dưới dạng tên nhãn; macro tùy chỉnh, floating shapes, tracked changes, kiểu Word phức tạp cần rà soát. Bảng dài nhiều ô gộp, ảnh và công thức dài cần xem PDF trước khi in.

## Phát triển và đóng gói

Cần Node.js 24 LTS, npm 11 và Go 1.26.8+. Dùng macOS để tạo DMG universal; Linux chỉ phục vụ kiểm thử CI. Backend Go dùng thư viện chuẩn, không có module bên thứ ba.

```bash
npm ci
npm run setup:pandoc
npm run setup:tex
npm run desktop:dev
```

```bash
npm run check
npm run test:go:race
npm run desktop:build:mac
```

`desktop:build` cũng tạo bộ cài Mac. `desktop:build:dir` tạo app universal trong `artifacts/mac-package/mac-universal`; `desktop:verify:mac` kiểm tra app đã đóng gói. DMG và SHA-256 đã qua kiểm tra nằm trong `release-desktop`. Xem [MAC-INSTALLER.md](docs/MAC-INSTALLER.md).

Electron chạy backend trên cổng loopback ngẫu nhiên với token riêng. Backend tự tìm bộ TeX/Pandoc trong Resources; PATH được chuẩn bị cho Finder. Huỷ biên dịch dừng cả nhóm tiến trình trên macOS. Font Latin Modern đi kèm nạp theo tên file, cache sinh ra nằm ngoài app có chữ ký.

Bộ TeX gồm XeLaTeX, BibTeX, Biber, biblatex-apa, csquotes và các gói phục vụ mẫu có sẵn. Mẫu LaTeX tự nhập có thể cần gói/font bổ sung. Word dùng Pandoc 3.11 và CSL APA cục bộ. Giấy phép và provenance đi kèm runtime.

Vite 8 dùng Rolldown; MathLive và PDF.js tải lười. Giao diện đóng gói dùng `vietlatex://`; ASAR integrity bật, các fuse Node/inspector bị tắt. Các bài kiểm thử app đóng gói kết nối debugger renderer trên loopback và không thay fuse.

`npm run dev`/`preview` dựng backend rồi chạy Vite cùng API loopback. Word/backup hồ sơ là chức năng desktop; web dùng localStorage có dung lượng nhỏ hơn. `npm run build` chỉ tạo giao diện web.

## Docker tùy chọn

Mặc định gọi XeLaTeX trên máy với shell escape tắt; **không phải sandbox hệ điều hành**. Chỉ biên dịch nguồn tin cậy ở chế độ này. Để dùng container, cài/chạy Docker Linux engine:

```bash
docker build -t vietlatex-tex:local sandbox
export VIETLATEX_SANDBOX=docker
npm run desktop:dev
```

Với bản cài, khởi động app từ môi trường có biến trên. Container không có mạng, filesystem gốc chỉ đọc, bỏ capabilities, giới hạn CPU/RAM/PID và chỉ mount thư mục công việc tạm. Có bước dọn container khi hủy/timeout. Docker runtime chưa được kiểm chứng trên máy hiện tại vì Linux engine chưa hoạt động.

## Kiểm tra và giới hạn

```bash
npm run lint
npm run check
npm run check:full
npm run test:backend
npm run test:go
npm run test:ui
npm run smoke:math-paste
npm run smoke:latex
npm run test:stress
npm run test:upgrade
npm run test:load
npm run test:desktop
npm run test:desktop:dist
```

`npm run check` chạy lint, Go vet/unit, backend, LAN sync, XeLaTeX/Word upgrade tests và production build. `npm run check:full` mở rộng sang các smoke/UI/Electron tests, đồng bộ hai cửa sổ desktop, lỗi ghi khi thoát, PDF batching, tải đột biến, stress 64 client × 8 yêu cầu, benchmark có ngưỡng và dependency audit. Các suite chạy tuần tự, lưu log và `report.json` trong `artifacts/full-check`; đặt `FULL_CHECK_OUTPUT` để đổi nơi lưu. Go race detector chạy trên macOS/Linux với C compiler của môi trường phát triển. Có thể chạy riêng bằng `npm run test:go:race`; CI Linux chạy bước này. Upgrade tests có XeLaTeX/BibTeX thật và DOCX roundtrip kiểm tra OMML. Desktop smoke dùng Playwright với hồ sơ tạm riêng: công thức, cấu hình, backup, source/PDF, tin cậy ZIP, nhân bản, lưu khi đóng/mở lại. `test:desktop:dist` kiểm tra production renderer qua `vietlatex://`; đặt `DESKTOP_EXE` để kiểm tra executable đóng gói. Đặt `DESKTOP_SMOKE_SCREENSHOTS=1` để hiển thị cửa sổ và lưu ảnh trong `artifacts/desktop-smoke`.

`test:ui` dùng Chromium do Playwright quản lý; cài bằng `npx playwright install chromium`. GitHub Actions chạy Go vet/unit, lint/backend, UI smoke trên Chromium, production build và audit dependency; Dependabot kiểm tra npm và GitHub Actions hằng tuần.

Sau khi sửa một suite lỗi, có thể chạy lại riêng và cập nhật báo cáo chung bằng `npm run check:full -- --only=test:pdf-batching,test:desktop`; các log và kết quả lần trước được giữ trong `previousAttempts`. Nhánh `@electron/get → global-agent` được ghim override `4.1.3` để bỏ dependency `sprintf-js` có cảnh báo DoS GHSA-hp3w-g68c-fv3c; test proxy loopback xác minh API downloader vẫn hoạt động. Đây là dependency của công cụ đóng gói Electron.

## Giới hạn

Biên dịch: tự chọn 1–8 worker theo CPU/RAM + 8 chờ; dưới 256 MiB RAM trống giảm về 1 worker sau hai lần đo liên tiếp, kể cả khi nhiều worker đang chạy; mỗi lượt chương trình 30 giây; cache 32 bản/32 MiB; PDF tối đa 75 MiB. Tra DOI có hàng đợi riêng 4 chạy + 8 chờ; chẩn đoán môi trường 1 chạy + 2 chờ, quá tải trả 503 kèm Retry-After. Shutdown chặn yêu cầu mới, đánh thức hàng đợi, hủy tác vụ và đợi biên dịch/Word cùng tiến trình khởi động sẵn dọn tài nguyên. Source 800 KiB; tài nguyên 100 tệp, 10 MiB/tệp, tổng 24 MiB; bản thảo tối đa 8 ảnh đã tối ưu. Workspace 128 MiB; Word nhập 25 MiB. Tắt cưỡng bức/mất điện có thể mất phần chưa lưu; backup cùng ổ không thay thế sao lưu sang ổ khác.

Có đồng bộ phiên bản qua LAN; chưa có cộng tác gõ đồng thời, cloud sync, tracked changes và tự cập nhật có chữ ký. Chạy trực tiếp trên Intel, Apple Developer ID/notarization và Docker runtime cần kiểm tra riêng. Xem [ARCHITECTURE.md](ARCHITECTURE.md).


### Tab tài liệu và bản tổng hợp

Mỗi tài liệu trong dự án xuất hiện thành một tab phía trên khung soạn thảo. Nhấn **+** để thêm tab trống hoặc chọn mẫu; nhấp đúp tên tab để đổi tên. Nút **Sắp xếp và tổng hợp tab** cho phép đưa tab lên trước/ra sau, chọn các tab cần ghép và bắt đầu một phần trên trang mới.

Tab **Tổng hợp** ghép nội dung theo thứ tự tab và lấy nội dung mới nhất khi mở. Bản này chỉ cho xem; sửa nội dung ở tab gốc. Bản chung dùng thiết lập trang, Abstract và mẫu của tab đầu tiên được chọn, gộp danh mục trích dẫn và tài nguyên của các tab. Chuyển sang LaTeX để tải gói `.zip` hoặc dùng Xuất PDF để xuất toàn bộ. Nội dung nguồn và lựa chọn ghép được lưu trong workspace và gói sao lưu.

Nếu một tab đang dùng source LaTeX riêng, hãy kiểm tra bản thảo đồng bộ rồi chọn **Dùng lại bản thảo** trước khi tổng hợp. Ứng dụng chặn xuất bản tổng hợp khi có tài nguyên cùng tên nhưng khác nội dung, khóa trích dẫn hoặc nhãn tham chiếu bị trùng, hoặc vượt giới hạn tài liệu.

Kiểm thử tính năng: `node --test scripts/project-compilation.test.mjs` và `npm run test:project-tabs`.
