# Rà soát macOS 0.5.6 — 09/10/2026

Tiếp tục trên mã nguồn và dữ liệu hiện có, giữ các sửa đổi của phiên làm việc trước. Người dùng yêu cầu cập nhật từ bản đang dùng 0.5.5 lên 0.5.6 và không mất dữ liệu. Tại thời điểm kiểm tra, package và app trong Applications đã báo 0.5.6; bản cập nhật vẫn giữ số 0.5.6, thay executable bằng bản đã sửa và dùng cùng hồ sơ.

## Các lỗi được sửa trong lượt rà soát

- Nhãn phím tắt còn ghi Ctrl trên Mac: lấy platform từ native bridge, hiển thị ⌘ trong ribbon, bảng lệnh, hộp công thức, trích dẫn, bảng và zoom. Đã thử ⌘B, ⌘Z, ⌘⇧C, ⌘K trong Electron dev và renderer production.
- Client chỉ gửi SIGTERM sau khi backend không trả lời shutdown: thêm SIGKILL nếu backend vẫn không thoát sau một giây. Kiểm thử tiến trình thật không trả lời HTTP và cố tình bỏ qua SIGTERM xác nhận client đợi tới khi tiến trình dừng.
- Nhận diện Unicode tự chuyển công thức trong tài liệu đã lưu khi mở hoặc blur: bỏ chuyển tự động lúc tạo editor, chỉ theo dõi phần người dùng sửa/dán, bỏ qua tải/chuyển tài liệu và undo. Bộ chuyển đổi chỉ sửa token nằm trong vùng đã đổi, giữ các công thức cũ trong cùng paragraph. Kiểm thử bản sao hồ sơ thực tế tái hiện thay đổi trước sửa và xác nhận giữ nguyên sau sửa.
- App thiếu NSLocalNetworkUsageDescription dù báo cáo ban đầu nói đã có: thêm mô tả tiếng Việt trong cấu hình build và kiểm tra chính Info.plist sau đóng gói. Theo [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), ứng dụng truy cập LAN cần giải thích mục đích bằng trường này. Cấu hình dùng [extendInfo của electron-builder](https://www.electron.build/v26/docs/mac/).
- Hướng dẫn build/checksum còn ghi tên 0.5.2: sửa thành 0.5.6. Luồng build xuất lại ZIP mã nguồn sau xác minh app, rồi tạo checksum và manifest từ file thực tế. Tính SHA-256 DMG bằng stream để tránh nạp toàn bộ bộ cài vào RAM.
- Báo cáo “không gửi dữ liệu ra ngoài” quá rộng: PDF/Word vẫn xử lý trên máy; tra DOI gửi DOI tới resolver và LAN gửi dữ liệu khi người dùng bật/ghép máy. README và tài liệu giao thức đã ghi rõ.

## Bằng chứng kiểm thử

Runner `artifacts/mac-review-2026-10-09/report.json` ghi 24 nhóm qua, 0 lỗi, 0 bỏ qua sau các lần sửa và chạy lại. Có lịch sử lỗi để không che các lần kiểm thử thất bại. Các nhóm gồm lint, Go vet/unit/race, JavaScript/backend/LAN, PDF/Word thực tế, giao diện, bàn phím công thức, Electron dev/production, đồng bộ hai Electron, lưu khi thoát, tải đồng thời, stress và benchmark. Một hồi quy riêng xác nhận sửa một token Unicode không thay đổi token cũ trong cùng đoạn.

HTTP thật kiểm tra ready, token (401 khi thiếu), DOI sai (400) và DOI `10.1038/s41586-020-2649-2` qua doi.org/Crossref (200, BibTeX đúng). Log: `artifacts/mac-review-2026-10-09/protocol-live.json`. Tài liệu payload: [BACKEND-HTTP.md](BACKEND-HTTP.md).

Kiểm thử bản sao hồ sơ hiện tại chứa 4 dự án/6 tài liệu; mở, lưu và thoát bằng renderer production giữ nguyên nội dung, source, cấu hình, REF, tài nguyên và ID. Log: `artifacts/mac-review-2026-10-09/profile-copy-final-dev.log`. Không chạy kiểm thử chỉnh sửa trên hồ sơ thật.

So sánh sau khi lưu cho phép chuẩn hóa đoạn tiêu đề đánh số thành heading, hành vi đã có từ 0.5.1, và thay đổi timestamp. Ba kiểm thử riêng xác nhận phép so sánh vẫn phát hiện thay đổi nội dung, source, REF, ID và việc chuyển Unicode trong văn bản cũ thành công thức.

Bản đóng gói được kiểm tra chữ ký sâu, binary universal, yêu cầu macOS, Finder PATH tối giản, PDF các mẫu và APA/Biber, sáu kiểu bảng/caption, Word OMML round-trip, preview, lưu/khôi phục, backend tự khởi động lại và đồng bộ bản thảo/PDF giữa hai app. Log build cuối: `artifacts/mac-review-2026-10-09/package-release.log`.

Đối chiếu ASAR xác nhận 140 file runtime trùng byte với mã nguồn đã kiểm tra (`artifacts/mac-review-2026-10-09/package-source-integrity.json`).

## Cập nhật trên máy này

Đã cài bản đã sửa vào `/Applications/Viet Latex Studio.app`, mở lại thành công và xác nhận cửa sổ báo 0.5.6, tài liệu hiện tại và trạng thái đã lưu. Trước khi thay app, updater thử bản sao hồ sơ, yêu cầu app cũ lưu và thoát bình thường, rồi sao lưu toàn bộ hồ sơ cùng app cũ. Thao tác cài đặt không thay đổi byte của workspace; sau mở lại vẫn đủ 4 dự án và 6 tài liệu, giữ nội dung, source, REF, tài nguyên và ID theo phép so sánh trên.

Sao lưu đầy đủ: `/Users/doan/Library/Application Support/VietLatex Upgrade Backups/2026-10-09T03-05-26-769Z`. Thư mục chứa hồ sơ, `previous.app` và bản ghi `upgrade.json`; giữ riêng trên máy, không đưa vào ZIP mã nguồn. Log: `artifacts/mac-review-2026-10-09/install-final.log`.

## Giới hạn xác minh

Runtime được thử trên Apple Silicon; binary có cả arm64/x86_64 nhưng chưa chạy trên máy Intel. App dùng chữ ký ad-hoc, chưa notarize. Đồng bộ hai app trên cùng Mac chưa xác minh kết nối/quyền Wi-Fi giữa hai Mac thật. Chưa có bản gốc Windows để chứng nhận tương đương từng hành vi; giao thức được đối chiếu với client hiện tại.

Các mục SQLite/Yjs/SyncTeX/hơn 10.000 CSL, kiểm tra chính tả và tăng giới hạn ảnh trong lộ trình là nâng cấp riêng, chưa được triển khai chỉ từ lượt rà soát này. Runtime hiện tại dùng TeX Live/TinyTeX, không còn dùng Tectonic như mô tả ban đầu.
