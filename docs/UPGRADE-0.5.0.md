# 0.5.0 — Đồng bộ LAN Windows/macOS

- Bảng Đồng bộ LAN: làm máy chủ, ghép bằng mã dùng một lần, tự đồng bộ mỗi 5 giây, nút đồng bộ ngay và ngắt quyền từng máy.
- Giữ ID, sửa offline, tài nguyên/mẫu, dấu xóa, xem trước xung đột và giữ cả hai bản. Dữ liệu mã hóa AES-256-GCM bằng khóa riêng cho từng máy.
- Mốc dữ liệu chỉ được xác nhận sau khi ghi workspace. Sửa trong lúc nhận phản hồi được gộp và bảo toàn. Không truyền quyền tin cậy LaTeX.
- Sửa thoát ứng dụng: lưu thành công trước khi dừng backend; lỗi ghi hủy thoát và giữ backend hoạt động.
- Menu native macOS, dò Pandoc Homebrew, script kiểm tra universal backend/Pandoc, checksum DMG và job macOS.

Workspace v1 vẫn được dùng, không yêu cầu chuyển đổi tệp và không tự bật chia sẻ. Cài 0.5.0 trên các máy cần ghép. Hướng dẫn: [Đồng bộ LAN](LAN-SYNC.md).
