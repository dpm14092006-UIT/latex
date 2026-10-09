# Kiểm tra Viet LaTeX Studio 0.5.1 cho macOS — 2026-10-08

Đã pull nhánh main từ GitHub đến `626907b158362ad7907a40effe0055a1341bfb9a`. Các sửa tiêu đề/Shift+Enter/dán Word trong bản 0.5.1 đã được giữ và kiểm thử trên app đóng gói. Phần sửa macOS nằm ở checkout cục bộ, chưa push lên GitHub.

## Bộ cài

- `release-desktop/Viet-Latex-Studio-0.5.1-universal.dmg`, khoảng 706 MiB.
- Cấu hình trước đây ghi macOS 12+; kiểm tra binary đi kèm cho thấy Electron cần 13+, Pandoc cần 15+, Biber arm64 cần 26+. Cấu hình được sửa thành macOS 26+ trong 0.5.2. Universal arm64/x86_64. Đã chạy thực tế trên Apple Silicon. Chưa chạy thực tế trên Mac Intel.
- Bao gồm Electron 44.5.1, backend Go, Pandoc 3.11 và TeX Live 2026/TinyTeX v2026.10. Không cần Node, Go hoặc MacTeX riêng để dùng các mẫu tích hợp.
- Đã bỏ EXE/NSIS, launcher CMD, script PowerShell, icon ICO và các nhánh backend dành cho Windows khỏi checkout.
- Bộ cài dùng chữ ký ad-hoc. Chữ ký và tài nguyên đã qua `codesign --verify --deep --strict`; chưa có Apple Developer ID/notarization.

## Sửa backend và đóng gói

Finder PATH được bổ sung để tìm công cụ trong app. XeLaTeX và xdvipdfmx được gọi trực tiếp, xử lý đường dẫn có dấu cách. Công cụ con chạy trong nhóm tiến trình để hủy cả nhóm khi dừng biên dịch. Cache/cấu hình TeX nằm trong Library của người dùng, ngoài app. Font Latin Modern được nạp từ file đi kèm; không cần cài font vào hệ thống.

Backend Go, Pandoc, Electron, XeTeX, Biber và toàn bộ binary native trong cây TeX đều đã kiểm tra chứa arm64 và x86_64. Symlink TeX phải là đường dẫn tương đối và nằm trong Resources. Bộ đóng gói kiểm tra không có EXE/DLL/CMD/BAT trong runtime TeX trước khi đưa DMG vào release-desktop.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| npm run check | Qua: lint, Go vet/unit, 169 bài JS, PDF/Word thật, build production |
| Go race sau khi sửa lượt biên dịch đơn | Qua |
| npm audit | 0 lỗ hổng được báo cáo |
| App đóng gói với PATH tối thiểu, cwd ngoài repo | Qua |
| Backend bị kill rồi tự khởi động lại | Qua |
| PDF mặc định, APA/Biber và 4 mẫu tích hợp | Cả 6 mẫu qua |
| Word export/import, công thức OMML | Qua |
| PDF hiện trong giao diện, không chỉ trả bytes | Qua; đã xem ảnh chụp |
| Lưu khi thoát, backend dừng, mở lại dữ liệu | Qua |
| Đóng cửa sổ giữ app chạy theo macOS | Qua |
| Hồi quy tiêu đề 0.5.1, Shift+Enter, dán Word, số trong PDF | Qua trên app đóng gói |
| Hai app đồng bộ LAN: ghép, giữ ID, xung đột, gõ trong khi đồng bộ, offline và restart | Qua |
| hdiutil verify DMG | Checksum VALID |
| Sao chép app từ DMG bằng ditto rồi kiểm tra chữ ký/chạy lại PDF, Word, lưu/khôi phục | Qua |

Lần thử chạy trực tiếp từ ổ DMG chỉ đọc hết thời gian chờ ở bước khởi chạy; log hệ thống có kiểm tra bảo mật và kết nối bị timeout. App sau khi sao chép ra khỏi DMG đã qua kiểm thử. Cách cài được hỗ trợ là kéo app vào Applications, không chạy lâu dài trên ổ DMG. Khi tải về máy khác, Gatekeeper có thể yêu cầu Open Anyway vì bản này chưa notarize; bước Gatekeeper cho một lượt tải xuống mới chưa được xác minh.

Mẫu LaTeX người dùng tự thêm có thể cần gói/font ngoài bộ TeX gọn. Intel đã xác minh kiến trúc binary, chưa xác minh hành vi khi chạy trên máy Intel.

## Cài đặt

Thoát bản cũ bằng Cmd+Q, mở DMG, kéo Viet Latex Studio.app vào Applications rồi mở app. Nếu macOS chặn, dùng System Settings → Privacy & Security → Open Anyway. Workspace nằm ngoài ứng dụng và được giữ khi thay app. Có thể xuất .vls trong Quản lý tài liệu → Sao lưu trước khi chuyển máy.

Đối chiếu SHA-256 bằng `shasum -a 256 -c Viet-Latex-Studio-0.5.1-universal.dmg.sha256` trong release-desktop. Log kiểm thử được lưu ở artifacts/verification.
