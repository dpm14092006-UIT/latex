# Báo cáo rà soát và nâng cấp chịu tải — 08/10/2026

Đã rà soát các luồng chính của frontend React/Tiptap, Electron, lưu workspace và đồng bộ LAN, backend Go, biên dịch XeLaTeX, xuất Word, tài nguyên dự án, DOI, hàng đợi, cache và vòng đời tiến trình. Đã sửa các lỗi tìm được, bổ sung kiểm thử hồi quy và chạy bộ kiểm tra mở rộng trên Windows.

Kết quả cuối của `npm run check:full`: **19 suite qua, 0 suite lỗi, 1 suite bỏ qua**. Suite bỏ qua là Go race detector do máy chưa có C compiler tương thích cho CGO. Kiểm tra thêm ngoài runner: build gói Windows qua; chạy EXE vừa đóng gói bị Windows Code Integrity chặn vì yêu cầu ký số, nên chưa xác minh runtime của EXE đó.

Nguồn kiểm chứng lúc chạy: `artifacts/full-check/report.json` lưu kết quả từng suite và lịch sử chạy lại; `artifacts/audit-verification.json` gộp các kiểm tra bổ sung. Sau yêu cầu dọn toàn bộ demo và bản cũ, 43 file bằng chứng cần thiết đã được gộp vào `docs/verification-2026-10-08.zip`, giữ tên entry tương ứng. Checksum từng file trong ZIP được đối chiếu trước khi xóa thư mục `artifacts`; bản sao mã nguồn cũ trong `audit-before` đã dọn. Các đường dẫn artifacts dưới đây là đường dẫn lúc kiểm tra; những log được giữ nằm trong ZIP.

## Lỗi đã sửa và thay đổi chịu tải

| Vấn đề | Thay đổi và tác dụng |
| --- | --- |
| Yêu cầu đã hủy vẫn có thể lấy slot; yêu cầu mới hoặc waiter còn tiếp tục khi backend dừng | Hàng đợi có trạng thái đóng, từ chối yêu cầu mới và đánh thức toàn bộ waiter. Kiểm tra context đã hủy trước khi lấy slot. |
| Shutdown trả về khi công việc nền hoặc tài nguyên tạm chưa dọn xong | Theo dõi compile flight, xuất Word và tiến trình warm đang khởi tạo; hủy công việc và chờ cleanup hoàn tất. Không nhận công việc mới sau khi bắt đầu dừng. |
| Trùng biên dịch trong khoảng một flight hoàn tất và flight mới được tạo | Kiểm tra lại cache dưới mutex trước khi tạo flight mới. |
| DOI và chẩn đoán môi trường có thể tạo quá nhiều công việc song song | DOI giới hạn 4 active + 8 chờ; chẩn đoán giới hạn 1 active + 2 chờ. Có admission trước công việc nặng; shutdown hủy cả các request phụ trợ. Health cung cấp số liệu hai hàng đợi này. |
| Thuật toán adaptive vẫn có thể chọn nhiều worker khi RAM trống rất thấp | Khi RAM khả dụng dưới 256 MiB, mục tiêu giảm còn 1 worker, vẫn theo cơ chế hysteresis hiện có. |
| Asset quá lớn được giải mã trước khi kiểm tra giới hạn | Kiểm tra chiều dài Base64 và ngân sách tổng trước decode cho PDF/Word. Chuyển sang decoder strict, bỏ bước encode lại toàn bộ dữ liệu để so sánh. |
| Frontend/backend không thống nhất một số Base64 và đường dẫn tài nguyên | Kiểm tra padding bit chuẩn, chặn tên document.tex/document.pdf trong đường dẫn lồng nhau và toàn bộ ký tự điều khiển ASCII. |
| Parser JSON có thể đọc và cấp phát cho giá trị JSON thứ hai trước khi từ chối | Sau giá trị đầu tiên, chỉ quét whitespace; từ chối ngay byte đầu tiên của giá trị tiếp theo, đồng thời giữ giới hạn kích thước body. |
| Workspace không hợp lệ có thể ghi đè bản lưu đang đọc được | Validate đầy đủ cấu trúc trước serialize và ghi đĩa. Kiểm thử thêm khả năng khôi phục và ghi tiếp sau lỗi. |
| Một số thư mục source tạm cũ không được sweep | Thêm thư mục vietlatex-source vào cleanup theo tuổi và quyền sở hữu. |
| Frontend mất mã trạng thái overload | Giữ HTTP/IPC status trong lỗi LatexCompiler để bên gọi xử lý chính xác. |
| Kiểm thử Electron chọn nhầm cửa sổ DevTools; PDF chọn text không duy nhất | Chờ cửa sổ renderer đúng URL; chọn trạng thái PDF bằng selector cụ thể. |

Đã bổ sung 24 kiểm thử cấp cao nhất: 17 Go và 7 JavaScript. Các kiểm thử bao phủ shutdown, cancellation, resize hàng đợi, cleanup, admission, giới hạn body/asset, RAM thấp, đường dẫn, workspace và proxy dependency. Nhóm 9 tình huống concurrency/cancellation/shutdown/coalescing được chạy lặp 30 lần mỗi tình huống và đều qua; đây là kiểm thử hành vi đồng thời, không thay thế race detector.

## Số đo chịu tải

Stress cuối dùng **64 client, 8 request/client, tổng 512 request**, cố định 4 worker và tối đa 8 request chờ. Kịch bản có cả yêu cầu hợp lệ, cache, yêu cầu bị hủy, dữ liệu sai và retry sau HTTP 503.

| Chỉ số | Kết quả |
| --- | ---: |
| Phản hồi PDF thành công | 408 |
| Kịch bản hủy | 52 |
| Dữ liệu sai bị từ chối / bị shed khi quá tải | 30 / 22 |
| Lỗi ngoài dự kiến | 0 |
| Thời gian lượt stress | 54,1 giây |
| Tốc độ phản hồi PDF, gồm cache | 7,54/giây |
| Thời gian client nhận PDF p50 / p95 / max, gồm chờ hàng đợi | 2.297 / 2.650 / 3.079 ms |
| Health p50 / p95 / max | 1 / 2 / 77 ms |
| Đỉnh active / queued / admitted | 4 / 8 / 12 |
| Đỉnh Go heap lấy mẫu | 4.557.264 byte |
| Active / queued / admitted sau lượt stress | 0 / 0 / 0 |
| Thư mục tạm rò sau shutdown | 0 |

Có 5.070 lần retry HTTP 503 trong lượt stress, phù hợp cơ chế từ chối sớm khi đủ slot. 150 phản hồi dùng cache; vì vậy 7,54/giây không phải số lần biên dịch tài liệu mới mỗi giây. Go heap lấy mẫu không bao gồm tổng RAM của Electron hoặc các tiến trình XeLaTeX. Hai thư mục warm còn lại khi backend đang chạy được dọn sạch khi backend đóng.

Lượt burst 18 request nhận 12 request và từ chối 6 request bằng HTTP 503, rồi phục hồi toàn bộ slot. Benchmark 5 vòng có kiểm tra ngưỡng: tài liệu đơn median 746 ms; tài liệu có tham chiếu 1.131 ms; bibliography 1.816 ms; 4 request trùng hoàn tất trong 700 ms với 3 request được gộp; 4 tài liệu khác nhau hoàn tất trong 1.087 ms. Tất cả ngưỡng của benchmark đều qua.

Microbenchmark giải mã **asset 10 MiB**, đối chiếu thuật toán cũ và mới trong cùng lượt chạy:

| Thuật toán | Thời gian | Bộ nhớ cấp phát/lần | Số allocation |
| --- | ---: | ---: | ---: |
| Decode rồi encode lại | 26,97 ms | 38.461.443 byte | 3 |
| Strict decode | 17,21 ms | 10.494.023 byte | 1 |

Giảm khoảng **72,7% bộ nhớ cấp phát** và **36,2% thời gian** trong microbenchmark này. Đây không phải phép đo mức giảm RAM toàn ứng dụng. Lượt stress ban đầu dùng cấu hình client/worker khác, nên không dùng để kết luận phần trăm tăng throughput.

Log chính: `artifacts/full-check/test-stress.log`, `artifacts/full-check/test-load.log`, `artifacts/full-check/benchmark.json`, `artifacts/audit-memory-benchmark.log`, `artifacts/audit-concurrency-repeat.log`.

## Phạm vi kiểm thử và dependency

Các suite qua gồm lint, Go vet/unit, JavaScript/backend unit, LAN, XeLaTeX/Word thực tế, paste và serializer, UI responsive, project tabs/PDF, PDF batching, citation scan, review fixes, nhận dạng công thức, Electron dev, Electron renderer production, đồng bộ giữa hai Electron, thoát ứng dụng khi lưu lỗi, load, stress, benchmark và npm audit. Kiểm tra UI ở các chiều rộng 1600, 1120, 901, 900, 768 và 390 px không ghi nhận page error.

`npm audit` ban đầu báo 8 mục moderate trong cùng chuỗi dependency đóng gói. Đã thêm override hẹp `@electron/get -> global-agent@4.1.3` để loại chuỗi cũ kéo theo sprintf-js. Advisory gốc: [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). API proxy được xác minh bằng kiểm thử loopback thực tế; lockfile qua `npm ci --ignore-scripts --dry-run`. **npm audit sau sửa: 0 vulnerability được báo tại thời điểm kiểm tra.** Log trước/sau: `artifacts/audit-dependencies-before.json`, `artifacts/audit-dependencies-after.json`, `artifacts/full-check/audit.log`.

## Chạy lại và giới hạn xác minh

```powershell
npm run check:full
```

Runner lưu log riêng từng suite vào `artifacts/full-check/`, ghi report sau mỗi bước và tiếp tục để thu đủ lỗi. Sau khi full run hoàn tất, có thể chạy lại một phần, giữ lịch sử lần chạy trước:

```powershell
npm run check:full -- --only=check,test:stress,test:bench,audit
```

Go race detector cần CGO và C compiler phù hợp. Lần gọi trực tiếp trên máy này thất bại với thông báo `-race requires cgo`; runner ghi nhận skip rõ ràng. Đã thêm `npm run test:go:race` vào Linux quality CI; chưa có kết quả chạy CI từ xa trong đợt này.

Đã build thành công gói Windows bằng electron-builder. EXE lúc kiểm tra nằm tại `artifacts/audit-package/win-unpacked/Viet Latex Studio.exe`, chưa ký số. Windows chặn khởi chạy cả ở workspace và bản sao đường dẫn ASCII; Code Integrity ghi sự kiện 3033/3077 về yêu cầu ký số. Bằng chứng: `artifacts/audit-windows-policy.json`, `artifacts/audit-package-sha256.json`, `artifacts/audit-packaging.log`, `artifacts/audit-packaged-exe-smoke.log`. **Build thành công không đồng nghĩa runtime EXE này đã được kiểm thử thành công.** Electron dev và renderer production đã qua; không thay đổi chính sách Windows. Thư mục unpacked này đã được dọn sau khi tạo bản Portable bên dưới.

Bản sao EXE để chẩn đoán đường dẫn từng nằm ở `C:\Users\ROG\AppData\Local\Temp\VietLatex-Audit-20261008`. Lần đầu một lệnh gộp có thao tác xóa bị kiểm tra phê duyệt tự động chặn. Sau khi người dùng yêu cầu dọn dẹp, bản sao đã được xóa bằng script PowerShell kiểm tra đường dẫn và trạng thái sử dụng.

Đã tạo `release-desktop/latest-2026-10-08/Viet-Latex-Studio-0.5.0-Portable.exe` lúc 08:33 ngày 08/10/2026, Windows x64, 167.818.757 byte. Manifest và SHA-256 ở cùng thư mục. Build Portable qua; chưa xác minh runtime. Build Setup mới thất bại ở bước chạy chương trình tạo uninstaller do hạn chế Windows; đầu ra Setup chưa hoàn chỉnh đã được dọn, không cung cấp như một bộ cài hợp lệ. Log: `artifacts/audit-latest-installer.log`, `artifacts/audit-latest-portable.log`.

Không chạy kiểm thử native macOS/Linux trong đợt này. Các thay đổi hiện ở workspace; cần mở lại bản ứng dụng chạy từ workspace để nạp backend và renderer mới. Bản ứng dụng đã cài trong Program Files không tự được cập nhật bởi lượt build này.

## Dọn dẹp sau bàn giao

Theo yêu cầu người dùng, đã xóa 104 mục gồm 20.441 file, tổng 11.891.830.602 byte (11,89 GB, khoảng 11,08 GiB): 4,70 GB trong dự án và 7,19 GB ở thư mục tạm riêng của dự án. Các mục gồm bản phát hành 0.4.3–0.4.5, bản 0.5.0 đóng gói cũ, bản unpacked trùng, các build tạm, test profile cũ, ảnh/log kiểm thử cũ, clone tham khảo sạch, diagnostic tạm và backend-next cũ. Không có mục xóa lỗi.

Giữ Portable 0.5.0 mới nhất và checksum, thư mục 0.4.6 dự phòng, mã nguồn/cấu hình, dependency, Pandoc, build dùng để mở app, dữ liệu workspace, demo thiết kế, Dockerfile, tài liệu, bản sao trước sửa và các log/report kiểm tra gần nhất. Backend đang mở sử dụng bản `.old.exe`, nên giữ file này đến khi ứng dụng đóng. Hai ứng dụng đang mở vẫn hoạt động sau khi dọn.

Kiểm tra checksum trước/sau xác nhận Portable giữ nguyên; 225 file mã nguồn/cấu hình/tài liệu/asset kiểm tra ngay trước và sau thao tác xóa không bị thay đổi hoặc mất. Sau đó cập nhật tài liệu và script dọn để phản ánh bố cục còn lại. Báo cáo đợt đầu và kiểm tra toàn vẹn được giữ trong `docs/verification-2026-10-08.zip`.

Người dùng tiếp tục yêu cầu dọn hết demo và bản cũ, đồng thời xác nhận giữ môi trường phát triển. Đợt bổ sung đã xóa 19 mục, 875.917.927 byte: thư mục 0.4.6 dự phòng, demo và launcher, hồ sơ demo riêng, ghi chú 0.3/0.4, hai công cụ dùng một lần, cache Vite, thư mục Go tạm rỗng, references rỗng và artifacts đã lưu bằng chứng. 174 file mã nguồn/cấu hình hiện tại kiểm tra trước/sau giữ nguyên; workspace chính đọc được và backup giữ nguyên. Lint sau dọn qua.

Tổng hai đợt dọn: 12.767.748.529 byte, khoảng 12,77 GB. Chỉ giữ bản Portable Windows mới nhất; thông tin giữ 0.4.6 phía trên mô tả quyết định của đợt đầu và đã được thay bằng yêu cầu dọn bổ sung. Tài liệu hiện tại được gom vào docs. Các mục còn lại như src, electron, backend, scripts, node_modules, public, build, dist, sandbox, tools, user-data là mã nguồn, môi trường phát triển hoặc dữ liệu sử dụng. File backend `.old.exe` đang được phiên Electron mở dùng vẫn được giữ. Báo cáo hiện tại: `docs/cleanup-report.json`, `docs/cleanup-integrity.json`.
