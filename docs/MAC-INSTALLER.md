# Bộ cài MacBook

File `.exe` dành cho Windows. Bản cài trực tiếp cho Mac của dự án là `Viet-Latex-Studio-0.5.1-universal.dmg`; bên trong có `Viet Latex Studio.app`. Mục tiêu universal hỗ trợ cả Mac Intel và Apple Silicon.

Hiện chưa có file DMG được tạo hoặc kiểm thử trong phiên Windows này. `scripts/build-mac.mjs` và thư viện ghép universal cần chạy trên macOS. Cross-compile backend từ Windows chỉ kiểm tra mã Go tạo được binary Darwin, không thay thế build và chạy ứng dụng Mac. Không đổi đuôi EXE sang DMG.

## Tạo trên MacBook

Lấy mã nguồn mới nhất từ GitHub trên MacBook:

```bash
git clone https://github.com/dpm14092006-UIT/latex.git
cd latex
```

Nếu đã clone, chạy `git pull --ff-only` trong thư mục repo để cập nhật. Có thể dùng gói `Viet-Latex-Studio-0.5.1-Mac-Build-Source.zip` rồi giải nén khi không dùng Git. Gói này là mã nguồn để tạo bộ cài, không chứa workspace cá nhân, dependency Windows hoặc các bản phát hành cũ.

Cần [Node.js 24 LTS](https://nodejs.org/en/download) với npm 11 và [Go 1.26.8+](https://go.dev/dl/), cùng Command Line Tools của Apple cho lipo. Nếu chưa có Command Line Tools, cài bằng `xcode-select --install` trên Mac. Sau khi môi trường sẵn sàng, chạy trong thư mục repo hoặc thư mục mã nguồn vừa giải nén:

```bash
bash scripts/build-mac.command
```

Script cài dependency theo lockfile, tải Pandoc và Tectonic Mac có kiểm tra SHA-256, ghép backend/Pandoc/Tectonic universal, build giao diện, tạo DMG và đối chiếu checksum đầu ra. Không cài Node/Go hoặc thay đổi thiết lập bảo mật macOS tự động.

Bộ cài được tạo trong `release-desktop`. Sau khi build thành công, mở DMG và kéo `Viet Latex Studio.app` vào Applications. Người chỉ sử dụng bộ cài hoàn chỉnh không cần cài Node.js hoặc Go. Nếu Mac có MacTeX/TeX Live, app dùng XeLaTeX của bộ đó. Nếu không, app dùng Tectonic đóng gói sẵn: lần biên dịch đầu tải gói TeX cần thiết (cần mạng, vài phút, lưu ở `~/Library/Caches/Tectonic`). Kiểu APA 7th cần Biber nên vẫn cần MacTeX/TeX Live. Đặt `VIETLATEX_TEX_ENGINE=xelatex` hoặc `tectonic` để chọn cố định. Trên macOS, backend nạp Latin Modern theo tên tệp vì XeTeX trên Mac không tìm được phông trong cây TeX theo tên. Pandoc được đóng gói để chuyển đổi Word.

## Tạo qua GitHub Actions

Mã nguồn dùng repo [dpm14092006-UIT/latex](https://github.com/dpm14092006-UIT/latex). Chọn **Actions → Build Mac installer → Run workflow** nếu muốn dùng runner macOS thay cho MacBook. Workflow riêng nằm tại `.github/workflows/mac-installer.yml`, chạy lint/Go/LAN unit rồi tạo DMG universal và SHA-256. Bước xác minh kiểm tra tính toàn vẹn chữ ký, kiến trúc Intel/Apple Silicon của Electron/backend/Pandoc/Tectonic và chạy kiểm thử đồng bộ bằng chính app đã đóng gói. Khi job thành công, tải artifact `Viet-Latex-Studio-macOS-universal` và giải nén để lấy DMG. Workflow **Quality checks** chạy kiểm thử khi push; bước build/kiểm tra bộ cài Mac chỉ chạy khi bấm **Run workflow**, với artifact `macos-universal-test-installer`. Push mã nguồn không tự tạo hoặc phát hành bộ cài Mac.

Nếu có chứng thư Apple, dùng repository secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` để electron-builder ký/notarize. Khi thay đổi Electron fuses, cấu hình khôi phục chữ ký ad-hoc để kiểm tra app universal; chữ ký này không xác nhận nhà phát hành bằng Apple Developer ID. Nếu không có chứng thư, chưa được coi là bản phát hành có Developer ID và notarize. Kiểm thử chạy app trên runner không thay thế kiểm tra Gatekeeper khi tải và cài trên MacBook. Không tắt Gatekeeper để thay thế việc kiểm thử/ký ứng dụng.

Tài liệu đóng gói: [electron-builder macOS v26](https://www.electron.build/v26/docs/mac/), [build nhiều nền tảng](https://www.electron.build/docs/features/multi-platform-build/).
