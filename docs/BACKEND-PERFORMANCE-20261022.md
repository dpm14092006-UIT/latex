# Backend 0.6.2 — đo và tối ưu ngày 22/10/2026

Máy đo: Apple M1, macOS arm64. Không chạy đồng thời các bộ UI, stress hoặc benchmark khác trong cửa sổ so sánh. Không dùng dữ liệu hồ sơ thật để tạo tải.

## Thay đổi

- Cache PDF băm các trường yêu cầu có phân định độ dài trước khi giải mã ảnh/tệp. Chỉ biên dịch đã kiểm tra thành công mới được đưa vào cache; giữ phân biệt ảnh/tài nguyên, tên/thứ tự tệp, ngày địa phương, Fresh, strict base64 và các giới hạn cũ.
- Khi compiler trả về sau khi yêu cầu cuối đã hủy, bỏ kết quả thay vì đưa vào cache.
- Đưa parse/validate/serialize AST xuất Word vào worker có quản lý vòng đời, tránh dựng đồng thời nhiều AST lớn bên ngoài hàng đợi.
- Trả buffer stdout đã hoàn tất trực tiếp sau `exec.Cmd.Wait`; không sao chép thêm toàn bộ đầu ra Pandoc, vốn có thể đạt 32 MiB.

## Đo riêng cache trong Go

Mỗi ca khởi tạo cache trước, sau đó đo lặp với compiler giả. Không gồm HTTP, JSON hoặc XeLaTeX. Mỗi phiên bản chạy `-benchtime=1s -count=3`, lấy median ba mẫu. Baseline dùng `compile.go` nguyên bản từ commit `dcf2879`; metadata có SHA-256 kiểm chứng.

| Tệp đính kèm | Trước | Sau | Giảm thời gian | Cấp phát trước → sau |
|---|---:|---:|---:|---:|
| 4 MiB | 6,724 ms | 2,533 ms | 62,3% | 4.211.668 → 176 B/lượt |
| 20 MiB | 39,110 ms | 12,608 ms | 67,8% | 20.997.351 → 176 B/lượt |

## Đo qua HTTP

So sánh tuần tự baseline → bản tối ưu → baseline trên hai executable được giữ riêng, mỗi ca chín lượt sau làm nóng. Kiểm tra PDF hợp lệ, số cache hit tăng đúng chín và không tăng số lần chạy compiler. Số đo gồm tạo JSON ở client, HTTP, parse JSON ở Go và trả PDF. Warm XeLaTeX tắt trong phép đo này.

| Tệp đính kèm | Baseline lần 1 | Bản tối ưu | Baseline lần 2 |
|---|---:|---:|---:|
| 4 MiB | 43,30 ms | 37,24 ms | 42,14 ms |
| 20 MiB | 227,99 ms | 183,13 ms | 207,79 ms |

Đường HTTP nhanh hơn khoảng 12–20% ở các ca này. Yêu cầu không có tài nguyên dưới 1 ms median ở cả ba lượt. Heap được lấy mẫu sau yêu cầu, không phải đỉnh RSS; chu kỳ GC khác nhau nên không dùng các mẫu này để tuyên bố giảm bộ nhớ đỉnh của toàn ứng dụng. Số cấp phát nêu trên chỉ thuộc phép đo cache trong Go.

## Biên dịch mới

Chín lượt mỗi loại, có `fresh: true`, chạy lần lượt baseline → tối ưu → baseline:

| Loại tài liệu | Baseline lần 1 | Bản tối ưu | Baseline lần 2 |
|---|---:|---:|---:|
| Một lượt XeLaTeX | 233 ms | 242 ms | 246 ms |
| Tham chiếu | 434 ms | 456 ms | 479 ms |
| Bibliography | 662 ms | 687 ms | 692 ms |

Thời gian bản tối ưu nằm trong khoảng dao động của baseline. Không suy diễn tối ưu cache thành tăng tốc XeLaTeX. Giữ nguyên ngân sách benchmark và các giới hạn tài nguyên.

Số liệu thô: `artifacts/backend-optimization/{baseline-cache,optimized-cache,baseline-cache-repeat,baseline-compile,optimized-compile,baseline-compile-repeat}.json`, `micro-before.txt`, `micro-after.txt`, `micro-metadata.json`. Chạy lại bằng `npm run test:bench:cache` hoặc `npm run test:bench`; `VIETLATEX_TEST_BACKEND_EXE` cho phép chọn executable cố định để đối chiếu.

## Kiểm chứng bản 0.6.2

- Bộ hồi quy đầy đủ và kiểm tra Word bổ sung đạt 35/35 suite, không bỏ qua suite. `check` gồm 349 kiểm thử Node, Go vet/test và production build. Có Go race, stress 64 client × 8 yêu cầu, benchmark có ngân sách giữ nguyên, AI desktop và save/quit failure.
- Dependency audit không phát hiện vulnerability. Backend Windows amd64 cross-build thành công; chưa chạy ứng dụng trên Windows thật.
- Gói macOS universal đã đạt kiểm tra chữ ký, kiến trúc, PDF với các template/style, Word thật, lưu/thoát/mở lại, chính tả và đồng bộ hai ứng dụng. Đối chiếu 173 file source/build cùng metadata production trong ASAR với workspace đều khớp.
- Kiểm tra Word thực tế phân biệt rõ: AST và DOCX xuất giữ lớp in đậm quanh code, nhưng bộ đọc DOCX của Pandoc loại lớp đó khi nhập lại. DOCX xuất có ngắt trang, Pandoc đọc thành hai Para và bỏ ngắt trang. Đây là giới hạn còn tồn tại; không khẳng định round trip DOCX giữ hai thuộc tính này. Văn bản, code, link và danh sách được kiểm tra bằng Pandoc thật.
- Báo cáo máy đọc được, log, checksum executable và bản sao source chưa commit nằm ở `artifacts/backend-optimization`. Số đo phụ thuộc tải máy và chu kỳ GC, không phải cam kết tốc độ cho mọi tài liệu.
- Đã cài và mở lại ứng dụng 0.6.2. Thử nâng cấp trên bản sao hồ sơ đạt; đối chiếu dữ liệu sau mở lại giữ nguyên 7 dự án/13 tài liệu. Bản app cũ và toàn bộ hồ sơ được giữ tại `/Users/doan/Library/Application Support/VietLatex Upgrade Backups/2026-10-22T17-04-09-554Z`. Bản cập nhật được kiểm chứng cục bộ trước khi đưa lên Git; chưa phát hành GitHub Release.
