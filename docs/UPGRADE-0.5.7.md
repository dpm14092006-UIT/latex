# Viet LaTeX Studio 0.5.7 — tự động cập nhật, quay lại Windows

- Tự động cập nhật trên macOS và Windows: app kiểm tra GitHub Releases khi mở và mỗi 6 giờ, tải bộ cài của đúng hệ điều hành, kiểm tra SHA-256, lưu tài liệu và tạo điểm khôi phục rồi cài và mở lại. Quản lý trong **Quản lý → Hệ thống → Cập nhật ứng dụng**.
- Windows: bộ cài NSIS x64 cài cho người dùng hiện tại (không cần admin), kèm Pandoc; dùng MiKTeX/TeX Live trên máy. Dữ liệu dùng chung với bản Portable cũ ở `%APPDATA%\latex-word-studio`.
- macOS: build hoạt động với Xcode 26 (`lipo -verify_arch` từng kiến trúc). Bộ cài DMG không đổi.
- Mã nguồn chia theo nền tảng: `mac/`, `win/`, `electron/mac`, `electron/win`.
