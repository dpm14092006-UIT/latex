# Bộ cài MacBook

File `.exe` dành cho Windows. Bản cài trực tiếp cho Mac của dự án là `Viet-Latex-Studio-0.5.0-universal.dmg`; bên trong có `Viet Latex Studio.app`. Mục tiêu universal hỗ trợ cả Mac Intel và Apple Silicon.

Hiện chưa có file DMG được tạo hoặc kiểm thử trong phiên Windows này. `scripts/build-mac.mjs` và thư viện ghép universal cần chạy trên macOS. Cross-compile backend từ Windows chỉ kiểm tra mã Go tạo được binary Darwin, không thay thế build và chạy ứng dụng Mac. Không đổi đuôi EXE sang DMG.

## Tạo trên MacBook

Chuyển gói `Viet-Latex-Studio-0.5.0-Mac-Build-Source.zip` sang Mac và giải nén. Đây là mã nguồn để tạo bộ cài, chưa phải ứng dụng đã cài. Gói không chứa workspace cá nhân, dependency Windows hoặc các bản phát hành cũ.

Cần [Node.js 24 LTS](https://nodejs.org/en/download) với npm 11 và [Go 1.26.8+](https://go.dev/dl/), cùng Command Line Tools của Apple cho lipo. Nếu chưa có Command Line Tools, cài bằng `xcode-select --install` trên Mac. Sau khi môi trường sẵn sàng, mở Terminal ở thư mục vừa giải nén và chạy:

```bash
bash scripts/build-mac.command
```

Script cài dependency theo lockfile, tải Pandoc Mac có kiểm tra SHA-256, ghép backend/Pandoc universal, build giao diện, tạo DMG và đối chiếu checksum đầu ra. Không cài Node/Go hoặc thay đổi thiết lập bảo mật macOS tự động.

Bộ cài được tạo trong `release-desktop`. Sau khi build thành công, mở DMG và kéo `Viet Latex Studio.app` vào Applications. Người chỉ sử dụng bộ cài hoàn chỉnh không cần cài Node.js hoặc Go. Xuất PDF vẫn cần MacTeX/TeX Live trên Mac; Pandoc được đóng gói để chuyển đổi Word.

## Tạo qua GitHub Actions

Mã nguồn dùng repo [dpm14092006-UIT/latex](https://github.com/dpm14092006-UIT/latex). Chọn **Actions → Build Mac installer → Run workflow**. Workflow riêng nằm tại `.github/workflows/mac-installer.yml`, dùng runner macOS, chạy lint/Go/LAN unit rồi tạo DMG universal và SHA-256. Cả hai workflow kiểm tra tính toàn vẹn chữ ký, kiến trúc Intel/Apple Silicon của Electron/backend/Pandoc và chạy kiểm thử đồng bộ bằng chính app đã đóng gói. Khi job thành công, tải artifact `Viet-Latex-Studio-macOS-universal` và giải nén để lấy DMG. Workflow **Quality checks** cũng kiểm thử và build DMG khi push lên repo, với artifact `macos-universal-test-installer`.

Nếu có chứng thư Apple, dùng repository secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` để electron-builder ký/notarize. Khi thay đổi Electron fuses, cấu hình khôi phục chữ ký ad-hoc để kiểm tra app universal; chữ ký này không xác nhận nhà phát hành bằng Apple Developer ID. Nếu không có chứng thư, chưa được coi là bản phát hành có Developer ID và notarize. Kiểm thử chạy app trên runner không thay thế kiểm tra Gatekeeper khi tải và cài trên MacBook. Không tắt Gatekeeper để thay thế việc kiểm thử/ký ứng dụng.

Tài liệu đóng gói: [electron-builder macOS v26](https://www.electron.build/v26/docs/mac/), [build nhiều nền tảng](https://www.electron.build/docs/features/multi-platform-build/).
