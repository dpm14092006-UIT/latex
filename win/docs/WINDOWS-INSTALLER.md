# Cài Viet LaTeX Studio trên Windows

Bộ cài: `release-desktop/win/Viet-Latex-Studio-<phiên bản>-Setup.exe` (Windows 10/11 x64), kèm `.sha256` và `manifest.json`.

## Cài đặt

1. Chạy `Setup.exe`. Bộ cài NSIS cài cho người dùng hiện tại (mặc định `%LOCALAPPDATA%\Programs\viet-latex-studio`), không cần quyền admin, tạo lối tắt Start menu và Desktop.
2. XeLaTeX: cài [MiKTeX](https://miktex.org/download) hoặc TeX Live. App tự tìm MiKTeX ở `%LOCALAPPDATA%\Programs\MiKTeX` và `%ProgramFiles%\MiKTeX`; có thể chỉ định `XELATEX_PATH`.
3. Pandoc 3.11 đi kèm bộ cài, dùng cho nhập/xuất Word.

Dữ liệu tài liệu nằm ở `%APPDATA%\latex-word-studio`, ngoài thư mục cài đặt, nên dùng chung với các bản Portable 0.5.x trước đó. Gỡ cài đặt không xóa dữ liệu.

Bản build cục bộ chưa ký số. SmartScreen hoặc Smart App Control có thể cảnh báo/chặn lần chạy đầu; chọn **More info → Run anyway** nếu chính sách máy cho phép.

## Tự động cập nhật

App cài bằng `Setup.exe` tự kiểm tra GitHub Releases. Khi có bản mới: tải `Setup.exe`, kiểm tra SHA-256, tạo điểm khôi phục, lưu và thoát app, chạy bộ cài im lặng (`/S --updated --force-run`) vào đúng thư mục cũ rồi mở lại app. Bản Portable không tự thay được chính nó; nút cập nhật sẽ mở bộ cài để chuyển sang bản cài đặt. Chi tiết: [docs/AUTO-UPDATE.md](../../docs/AUTO-UPDATE.md).

## Build từ mã nguồn

Cần Node.js 24, npm 11 và Go 1.26.8+.

```bash
npm ci
npm run desktop:build:win
```

`win/build-win.mjs` tải Pandoc Windows nếu thiếu (`win/setup-pandoc.mjs`, kiểm tra SHA-256), build backend Go `vietlatex-backend.exe`, build giao diện, đóng gói NSIS bằng `win/electron-builder.config.cjs`, kiểm tra gói (`win/verify-win-package.mjs`) rồi chép bộ cài và SHA-256 vào `release-desktop/win` (`win/copy-win-installer.cjs`). `npm run desktop:build:win:dir` chỉ tạo app chưa đóng gói trong `artifacts/win-package/win-unpacked`.

Trên máy bật Windows Application Control, các bản build trước đây từng bị chặn ở bước NSIS tạo uninstaller hoặc khi chạy file `.exe` chưa ký. Khi gặp lỗi đó, build trên GitHub Actions (`.github/workflows/release.yml`) hoặc máy không áp chính sách.
