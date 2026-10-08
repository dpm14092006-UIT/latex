# Viet LaTeX Studio 0.5.0

Ứng dụng desktop soạn tài liệu tiếng Việt, nhập công thức trực quan, chỉnh LaTeX và xem PDF. Bản thảo, tài nguyên, sao lưu và chuyển đổi Word được xử lý trên máy.

## Sử dụng Windows

Phiên bản 0.5.0 thêm đồng bộ LAN Windows/macOS, giữ phiên bản xung đột và sửa lỗi lưu khi thoát; xem [bàn giao 0.5.0](docs/UPGRADE-0.5.0.md). Bản mới nhất sau đợt sửa lỗi ngày 08/10/2026 là `release-desktop/latest-2026-10-08/Viet-Latex-Studio-0.5.0-Portable.exe`, có manifest và SHA-256 bên cạnh. Các bản phát hành cũ, kể cả 0.4.6, đã được dọn theo yêu cầu; chỉ giữ bản Portable mới nhất. Bộ app gồm Pandoc 3.11; **XeLaTeX cần được cài riêng** bằng MiKTeX hoặc TeX Live. Lần đầu TeX có thể cần mạng để tải gói còn thiếu. **Quản lý tài liệu → Hệ thống** kiểm tra XeLaTeX/Pandoc và xóa cache.

Bản Portable chưa ký số và chưa xác minh khởi chạy. Windows Code Integrity trên máy hiện tại đã chặn EXE đóng gói khi kiểm tra; Electron chạy từ workspace với renderer production đã qua. Xem [báo cáo rà soát và chịu tải](docs/AUDIT-LOAD-2026-10-08.md).

Trong thư mục dự án, mở `Mở app Electron.cmd` để build backend/giao diện mới nhất rồi mở cửa sổ Electron. Thanh tiêu đề hiển thị phiên bản đang chạy. `npm run desktop:preview` build lại giao diện trước khi mở Electron.

Dữ liệu nằm trong hồ sơ `userData` của Electron, ngoài thư mục cài ứng dụng. Trước khi chuyển máy, dùng **Quản lý tài liệu → Sao lưu** để xuất gói `.vls`.

## Đồng bộ Windows và MacBook

Mở **Quản lý tài liệu → Đồng bộ LAN**. Một máy làm máy chủ, tạo mã ghép một lần; máy còn lại dán mã và ghép. Dữ liệu tự kiểm tra mỗi 5 giây, tiếp tục lưu khi offline, giữ cả hai phiên bản khi cùng sửa. Không tự bật chia sẻ khi cài app. Xem [hướng dẫn kết nối, xung đột và build Mac](docs/LAN-SYNC.md).

MacBook cần `.app`/`.dmg`, không dùng file EXE Windows. Bản DMG universal phải tạo trên Mac hoặc runner macOS; có script `scripts/build-mac.command` và workflow riêng **Build Mac installer**. Xem [chuẩn bị bộ cài MacBook](docs/MAC-INSTALLER.md). Phiên Windows này chưa tạo hoặc chạy thử DMG.

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

Cần Node.js 22.13+ (khuyến nghị Node 24 LTS theo `.nvmrc`), npm 11+, Go 1.26.8+ để phát triển/đóng gói, và XeLaTeX (Windows: MiKTeX/TeX Live; macOS: MacTeX/TeX Live). `npm ci` dùng lockfile và chế độ kiểm tra `engines` nghiêm ngặt. Người dùng bản desktop đã đóng gói không cần cài Go.

Xuất PDF APA 7th dùng `biblatex-apa`, `csquotes` và `biber`; cài các gói này trong bộ TeX. Xuất Word dùng CSL APA 7th của dự án Citation Style Language (bản cục bộ, giữ thông tin tác giả và giấy phép trong tệp CSL). Docker TeX cần xây lại image sau khi cập nhật Dockerfile để có Biber.

```powershell
npm ci
npm run setup:pandoc
npm run backend:build
npm run desktop:dev
```

Backend Go dùng thư viện chuẩn, không có Go module bên thứ ba. `npm run backend:build` tạo `build/backend/vietlatex-backend` cho máy hiện tại; `npm run desktop:build` tạo helper Windows x64, còn `npm run desktop:build:mac` tạo helper universal bằng lipo. Bản cài gói helper vào `Resources/backend` cạnh Pandoc. Electron chạy helper trên cổng loopback ngẫu nhiên với token riêng; web dev dùng Vite proxy tới API loopback.

Hàng đợi biên dịch mặc định tự chọn số tiến trình theo CPU và RAM trống (tối đa một tiến trình cho mỗi hai luồng logic, tối đa 8; giới hạn bộ nhớ có thể chọn ít hơn), và giữ tối đa 8 yêu cầu chờ. Trong lúc chạy, số worker tự giảm khi RAM trống thấp và tăng dần khi RAM đủ (`VIETLATEX_ADAPTIVE_WORKERS=0` để tắt). Có thể đặt `VIETLATEX_COMPILE_WORKERS` từ 1 đến 8 để cố định. XeLaTeX chỉ được khởi động sẵn sau lượt biên dịch đầu tiên và được giải phóng sau 10 phút không biên dịch (`VIETLATEX_WARM_TEX=eager` để khởi động sẵn ngay khi mở app, `0` để tắt). Tăng số này giúp xử lý nhiều lượt biên dịch đồng thời; không làm một tài liệu XeLaTeX đơn lẻ chạy nhanh hơn.

Vite 8 dùng Rolldown; MathLive và PDF.js được tải lười khi mở các chức năng liên quan. Bản Electron đã đóng gói phục vụ giao diện qua giao thức nội bộ `vietlatex://`; build bật ASAR integrity và tắt `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, debugger CLI cùng đặc quyền bổ sung của `file://`.

`setup:pandoc` tải 3.11 từ GitHub chính thức của Pandoc, đối chiếu SHA-256 công bố, giữ giấy phép và provenance. Trên macOS, ghép hai kiến trúc bằng lipo. Có thể đặt `PANDOC_PATH` khi phát triển.

```powershell
npm run desktop:build
```

`desktop:build:dir` tạo và sao chép app đầy đủ vào `release-desktop/VietLatex-Studio-<version>`, xác minh phiên bản bên trong ASAR và ghi checksum. `desktop:build` thực hiện bước đó trước khi tạo NSIS và `.sha256`. Bản Windows hiện chưa có chữ ký số nhà phát hành. Trên Mac dùng `desktop:build:mac` tạo universal DMG; cần kiểm thử trên máy Mac và chứng thư ký/notarize khi phát hành.

`npm run dev` dựng backend Go rồi chạy trình duyệt cùng API loopback; `npm run preview` cũng chạy API Go với Vite preview. Word và backup hồ sơ là chức năng desktop; trình duyệt dùng localStorage có dung lượng nhỏ hơn. `npm run build` chỉ tạo giao diện web.

## Docker tùy chọn

Mặc định gọi XeLaTeX trên máy với shell escape tắt; **không phải sandbox hệ điều hành**. Chỉ biên dịch nguồn tin cậy ở chế độ này. Để dùng container, cài/chạy Docker Linux engine:

```powershell
docker build -t vietlatex-tex:local sandbox
$env:VIETLATEX_SANDBOX = 'docker'
npm run desktop:dev
```

Với bản cài, khởi động exe từ môi trường có biến trên. Container không có mạng, filesystem gốc chỉ đọc, bỏ capabilities, giới hạn CPU/RAM/PID và chỉ mount thư mục công việc tạm. Có bước dọn container khi hủy/timeout. Docker runtime chưa được kiểm chứng trên máy hiện tại vì Linux engine chưa hoạt động.

## Kiểm tra và giới hạn

```powershell
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

`npm run check` chạy lint, Go vet/unit, backend, LAN sync, XeLaTeX/Word upgrade tests và production build. `npm run check:full` mở rộng sang các smoke/UI/Electron tests, đồng bộ hai cửa sổ desktop, lỗi ghi khi thoát, PDF batching, tải đột biến, stress 64 client × 8 yêu cầu, benchmark có ngưỡng và dependency audit. Các suite chạy tuần tự, lưu log và `report.json` trong `artifacts/full-check`; đặt `FULL_CHECK_OUTPUT` để đổi nơi lưu. Go race detector chạy khi môi trường hỗ trợ; Windows cần C compiler tương thích và `CGO_ENABLED=1`, nếu thiếu sẽ ghi rõ bước bị bỏ qua. Có thể chạy riêng bằng `npm run test:go:race`; CI Linux chạy bước này. Upgrade tests có XeLaTeX/BibTeX thật và DOCX roundtrip kiểm tra OMML. Desktop smoke dùng Playwright với hồ sơ tạm riêng: công thức, cấu hình, backup, source/PDF, tin cậy ZIP, nhân bản, lưu khi đóng/mở lại. `test:desktop:dist` kiểm tra production renderer qua `vietlatex://`; đặt `DESKTOP_EXE` để kiểm tra executable đóng gói. Đặt `DESKTOP_SMOKE_SCREENSHOTS=1` để hiển thị cửa sổ và lưu ảnh trong `artifacts/desktop-smoke`.

`test:ui` mặc định dùng Microsoft Edge trên Windows; đặt `UI_TEST_BROWSER=chromium` để dùng Chromium do Playwright quản lý. GitHub Actions chạy Go vet/unit, lint/backend, UI smoke trên Chromium, production build và audit dependency; Dependabot kiểm tra npm và GitHub Actions hằng tuần.

Sau khi sửa một suite lỗi, có thể chạy lại riêng và cập nhật báo cáo chung bằng `npm run check:full -- --only=test:pdf-batching,test:desktop`; các log và kết quả lần trước được giữ trong `previousAttempts`. Nhánh `@electron/get → global-agent` được ghim override `4.1.3` để bỏ dependency `sprintf-js` có cảnh báo DoS GHSA-hp3w-g68c-fv3c; test proxy loopback xác minh API downloader vẫn hoạt động. Đây là dependency của công cụ đóng gói Electron.

## Dọn đầu ra cũ

`scripts/cleanup-old-versions.ps1` mặc định chỉ lập danh sách; thêm `-Apply` để xóa. Đợt dọn toàn bộ demo và bản cũ dùng `-Thorough`, ghi `docs/cleanup-report.json`. Script xác minh checksum bản Portable mới nhất, giữ mã nguồn hiện tại, dependency phát triển, dữ liệu workspace chính, tài liệu và bằng chứng kiểm tra gần nhất. Kiểm tra đường dẫn và junction/symlink trước khi xóa, bỏ qua tài nguyên đang được tiến trình dùng. Demo giao diện và profile demo riêng đã bỏ; các thư mục cache/build tạm được tạo lại khi cần.

Bằng chứng kiểm thử 19 suite qua, 0 lỗi, 1 Go race skip đã được gộp vào `docs/verification-2026-10-08.zip`, đối chiếu checksum từng file trước khi xóa thư mục `artifacts`. Bản sao mã nguồn trước sửa và các ghi chú phiên bản cũ đã dọn. `npm run check:full` sẽ tạo lại `artifacts/full-check`; chạy full một lần trước khi dùng tùy chọn `--only`.

```powershell
.\scripts\cleanup-old-versions.ps1 -Thorough
.\scripts\cleanup-old-versions.ps1 -Thorough -Apply
```

Biên dịch: tự chọn 1–8 worker theo CPU/RAM + 8 chờ; dưới 256 MiB RAM trống giảm về 1 worker sau hai lần đo liên tiếp, kể cả khi nhiều worker đang chạy; mỗi lượt chương trình 30 giây; cache 32 bản/32 MiB; PDF tối đa 75 MiB. Tra DOI có hàng đợi riêng 4 chạy + 8 chờ; chẩn đoán môi trường 1 chạy + 2 chờ, quá tải trả 503 kèm Retry-After. Shutdown chặn yêu cầu mới, đánh thức hàng đợi, hủy tác vụ và đợi biên dịch/Word cùng tiến trình khởi động sẵn dọn tài nguyên. Source 800 KiB; tài nguyên 100 tệp, 10 MiB/tệp, tổng 24 MiB; bản thảo tối đa 8 ảnh đã tối ưu. Workspace 128 MiB; Word nhập 25 MiB. Tắt cưỡng bức/mất điện có thể mất phần chưa lưu; backup cùng ổ không thay thế sao lưu sang ổ khác.

Có đồng bộ phiên bản qua LAN; chưa có cộng tác gõ đồng thời, cloud sync, tracked changes và tự cập nhật có chữ ký. Windows sạch, macOS, signing/notarization và Docker runtime cần kiểm tra riêng. Xem [ARCHITECTURE.md](ARCHITECTURE.md).


### Tab tài liệu và bản tổng hợp

Mỗi tài liệu trong dự án xuất hiện thành một tab phía trên khung soạn thảo. Nhấn **+** để thêm tab trống hoặc chọn mẫu; nhấp đúp tên tab để đổi tên. Nút **Sắp xếp và tổng hợp tab** cho phép đưa tab lên trước/ra sau, chọn các tab cần ghép và bắt đầu một phần trên trang mới.

Tab **Tổng hợp** ghép nội dung theo thứ tự tab và lấy nội dung mới nhất khi mở. Bản này chỉ cho xem; sửa nội dung ở tab gốc. Bản chung dùng thiết lập trang, Abstract và mẫu của tab đầu tiên được chọn, gộp danh mục trích dẫn và tài nguyên của các tab. Chuyển sang LaTeX để tải gói `.zip` hoặc dùng Xuất PDF để xuất toàn bộ. Nội dung nguồn và lựa chọn ghép được lưu trong workspace và gói sao lưu.

Nếu một tab đang dùng source LaTeX riêng, hãy kiểm tra bản thảo đồng bộ rồi chọn **Dùng lại bản thảo** trước khi tổng hợp. Ứng dụng chặn xuất bản tổng hợp khi có tài nguyên cùng tên nhưng khác nội dung, khóa trích dẫn hoặc nhãn tham chiếu bị trùng, hoặc vượt giới hạn tài liệu.

Kiểm thử tính năng: `node --test scripts/project-compilation.test.mjs` và `npm run test:project-tabs`.
