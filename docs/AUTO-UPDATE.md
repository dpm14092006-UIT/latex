# Tự động cập nhật phiên bản

## Phát hành bản mới (người phát triển)

1. Viết ghi chú `docs/UPGRADE-X.Y.Z.md` (tuỳ chọn; nội dung hiển thị trong app ở mục “Có gì mới”).
2. Trên nhánh `main` sạch, chạy một trong:

   ```bash
   npm run release:patch   # 0.5.7 -> 0.5.8
   npm run release:minor   # 0.5.7 -> 0.6.0
   npm run release:major   # 0.5.7 -> 1.0.0
   ```

   Script `scripts/bump-version.mjs` cập nhật `package.json` và gốc `package-lock.json`, commit `Release X.Y.Z` và tạo tag `vX.Y.Z`. Tên DMG/Setup lấy theo version, không cần sửa tay. Dùng `node scripts/bump-version.mjs 0.6.2 --dry-run` để xem trước.
3. `git push origin HEAD vX.Y.Z`. Workflow `.github/workflows/release.yml` kiểm tra tag khớp `package.json`, chạy lint/test, build song song:
   - macOS: `Viet-Latex-Studio-X.Y.Z-universal.dmg` + `.sha256` (`mac/`)
   - Windows: `Viet-Latex-Studio-X.Y.Z-Setup.exe` + `.sha256` (`win/`)

   rồi tạo một GitHub Release chứa cả hai. Nếu một nền tảng build lỗi, release vẫn được tạo với nền tảng còn lại.

## Trong app (người dùng)

- Bản đã cài tự kiểm tra `releases/latest` của repo 15 giây sau khi mở và mỗi 6 giờ (tắt được trong **Quản lý → Hệ thống → Cập nhật ứng dụng**). Khi có bản mới, thanh thông báo xuất hiện phía trên vùng soạn thảo. App chỉ chọn bộ cài của đúng hệ điều hành.
- **Tải bản X.Y.Z**: tải bộ cài về `<hồ sơ>/updates/downloads`, kiểm tra kích thước và SHA-256 theo tệp `.sha256` của release.
- **Cài và khởi động lại**: luôn tạo điểm khôi phục workspace và đi qua luồng lưu-rồi-thoát bình thường (Cmd+Q / đóng cửa sổ). Nếu lưu thất bại, app không thoát và không thay bản cài.
  - **macOS**: mount DMG chỉ đọc, kiểm tra `codesign --verify --deep --strict`, đúng version, đúng bundle id `vn.vietlatex.studio` và (nếu bản đang cài ký Developer ID) cùng Team ID; chép app vào cạnh app hiện tại. Script tách rời chờ app thoát, chuyển app cũ sang `~/Library/Application Support/VietLatex Upgrade Backups/<thời điểm>-auto-<bản cũ>/`, đặt app mới vào chỗ cũ rồi mở lại; thay thất bại thì khôi phục app cũ. Giữ 1 bản app cũ tự động gần nhất. Log: `<hồ sơ>/updates/install.log`.
  - **Windows**: sau khi app thoát, chạy `Setup.exe /S --updated --force-run`; bộ cài NSIS cài đè vào thư mục cũ (per-user) và mở lại app. Dữ liệu ở `%APPDATA%\latex-word-studio` không bị đụng tới.
- Không cài tự động được (macOS: không có quyền ghi thư mục app hoặc app bị Gatekeeper “translocate”; Windows: bản Portable; bản dev): nút chuyển thành **Mở bộ cài** để cài thủ công.
- “Bỏ qua bản này” ẩn bản đó khỏi kiểm tra tự động; nút “Kiểm tra cập nhật” vẫn hiện.

## Biến môi trường

- `VIETLATEX_DISABLE_UPDATE_CHECK=true`: tắt kiểm tra tự động (dùng cho test).
- `VIETLATEX_UPDATE_FEED=https://…`: thay endpoint `releases/latest` khi thử nghiệm.

## Giới hạn

Bản build chưa ký Developer ID / Authenticode nên không dùng Squirrel.Mac/electron-updater. SHA-256 lấy cùng release nên chỉ chống tải hỏng, không chống việc tài khoản GitHub bị chiếm quyền; trên macOS, khi có Developer ID, kiểm tra Team ID sẽ chặn bộ cài ký bởi người khác. Trên Windows, Smart App Control có thể chặn `Setup.exe` chưa ký; khi đó dùng “Mở bộ cài” hoặc cài thủ công.
