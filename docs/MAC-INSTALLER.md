# Cài Viet LaTeX Studio 0.5.6 trên MacBook

Bộ cài: `release-desktop/Viet-Latex-Studio-0.5.6-universal.dmg`.
Bản universal chứa Electron, backend Go, Pandoc 3.11 và TeX Live 2026 (TinyTeX) cho Apple Silicon và Intel. Cần macOS 26 trở lên. Apple Silicon được kiểm thử trực tiếp; kiến trúc Intel được kiểm tra trong các binary, chưa chạy thử trên máy Intel.

Runtime đi kèm: Electron cần macOS 13+, Pandoc cần macOS 15+, Biber arm64 trong TinyTeX 2026.10 cần macOS 26+. Bộ cài universal khai báo macOS 26+ để mọi chức năng đi kèm hoạt động; đã kiểm thử trên macOS 26.5.1 Apple Silicon.

## Cài và sử dụng

1. Thoát bản cũ bằng **Cmd+Q**.
2. Mở file DMG.
3. Kéo **Viet Latex Studio.app** vào **Applications**, thay bản cũ nếu có.
4. Mở ứng dụng trong Applications, mở lại tài liệu rồi chọn **Cập nhật PDF**.

Không cần cài Node.js, Go, Pandoc hoặc MacTeX riêng để dùng các mẫu có sẵn, xuất PDF và chuyển đổi Word. Mẫu LaTeX tự thêm có thể yêu cầu gói hoặc font chưa có trong bộ TeX gọn. Khi cần dùng bộ TeX khác, có thể đặt `XELATEX_PATH` đến executable của MacTeX/TeX Live trong môi trường khởi chạy.

Ứng dụng tự tìm công cụ khi mở bằng Finder. Cache TeX nằm trong `~/Library/Caches/vn.vietlatex.studio`; cấu hình TeX trong `~/Library/Application Support/vn.vietlatex.studio`. Workspace và sao lưu nằm trong hồ sơ Electron của người dùng, không nằm trong app hoặc DMG. Dùng **Quản lý tài liệu → Sao lưu** để xuất `.vls` khi chuyển máy.

Đóng cửa sổ giữ ứng dụng chạy theo hành vi macOS. **Cmd+Q** thoát ứng dụng sau khi lưu tài liệu và dừng backend/XeLaTeX. Thanh menu hỗ trợ thao tác sửa và cửa sổ theo macOS.

Bản build cục bộ dùng chữ ký ad-hoc, chưa có Apple Developer ID hoặc notarization. Nếu macOS chặn bản tải về, mở **System Settings → Privacy & Security → Open Anyway** cho ứng dụng bạn đã kiểm tra nguồn. Không cần tắt Gatekeeper. Muốn phân phối rộng rãi mà không có bước này, cần ký bằng chứng thư Apple và notarize.

## Build lại trên macOS

Cần Node.js 24 LTS/npm 11, Go 1.26.8+ và Apple Command Line Tools (`xcode-select --install`).

```bash
unzip Viet-Latex-Studio-0.5.6-Mac-Build-Source.zip
cd Viet-Latex-Studio-0.5.6
bash scripts/build-mac.command
```

Nếu đã clone thì cập nhật bằng `git pull --ff-only` trước khi sửa mã. Các thay đổi trong phiên làm việc này nằm ở checkout cục bộ cho đến khi được commit/push.

Luồng build dùng lockfile npm, tải Pandoc có SHA-256 công bố và TinyTeX v2026.10 có SHA-256 được ghim. Các gói TeX bổ sung được cài từ kho TeX Live qua `tlmgr`, dùng kiểm tra checksum mặc định của TeX Live. Danh sách gói nằm trong `scripts/setup-tex.mjs`; provenance nằm cạnh từng runtime. Font Latin Modern được nạp từ file trong bộ TeX, không cài font vào macOS.

```bash
npm ci
npm run check
npm run test:go:race
npm run desktop:build:mac
```

Build chạy xác minh chữ ký, kiến trúc universal, PDF các mẫu/APA, Word round-trip, lưu/khôi phục và đồng bộ hai app đã đóng gói trước khi sao chép DMG sang `release-desktop`. App trung gian nằm trong `artifacts/mac-package/mac-universal`. Build không publish lên GitHub.

Kiểm tra file nhận được:

```bash
cd release-desktop
shasum -a 256 -c Viet-Latex-Studio-0.5.6-universal.dmg.sha256
```

## Cập nhật bản đang dùng, giữ dữ liệu

Sau khi build và xác minh thành công, chạy `npm run desktop:update:local` để cập nhật app trong Applications. Script mở một bản sao workspace bằng app mới, so sánh nội dung/source/cấu hình/REF/tài nguyên sau khi lưu và thoát; nếu khác thì dừng trước khi thay app.

App cũ nhận SIGTERM và tự lưu trước khi thoát. Script chờ tối đa 30 giây; nếu chưa thoát thì giữ nguyên app. Sau đó sao lưu toàn bộ hồ sơ cùng app cũ vào `~/Library/Application Support/VietLatex Upgrade Backups/<thời điểm>/`, thay app bằng bản đã kiểm tra chữ ký rồi mở lại. Kiểm tra SHA-256 xác nhận thao tác cài không ghi vào workspace; dữ liệu sau mở lại được so sánh thêm một lần. Không đổi schema workspace v1, ID dự án/tài liệu hoặc hồ sơ LAN.

Nếu đã đặt vị trí dữ liệu riêng trong `user-data-location.json`, script dùng đúng đường dẫn đó. Với `VIETLATEX_USER_DATA`, cần giữ cùng biến khi chạy script để kiểm tra hồ sơ tương ứng.

Quyền mạng nội bộ có mô tả trong Info.plist. Chỉ bật **Đồng bộ LAN** khi cần ghép máy. Kiểm thử hai app trên một Mac không thay thế kiểm thử quyền mạng và kết nối Wi-Fi giữa hai Mac thật. Tham khảo [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

## GitHub Actions và chữ ký nhà phát hành

Workflow **Build Mac installer** chạy thủ công trên runner macOS. Cấu hình có thể dùng secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` cho ký/notarize. Chưa có các thông tin này trong bản build cục bộ.

Tài liệu: [electron-builder v26 macOS](https://www.electron.build/v26/docs/mac/), [TinyTeX releases](https://github.com/rstudio/tinytex-releases), [MacTeX](https://www.tug.org/mactex/).
