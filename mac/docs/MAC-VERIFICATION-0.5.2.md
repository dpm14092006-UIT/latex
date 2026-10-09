# Kiểm tra Viet LaTeX Studio 0.5.2 cho macOS — 2026-10-08

GitHub main đã được pull bằng fast-forward đến `62209d657006e0713dfd1f8de3ce3b98cacb26fd`, gồm hai commit mới `297bd15` và `62209d6`. Giữ thư viện bảng, chú thích hình, sửa nhập Word/LaTeX, danh sách nhập tay, backend và lưu/thoát mới. Các sửa macOS/màu chữ nằm trong checkout cục bộ, chưa commit hoặc push; stash trước pull được giữ để khôi phục.

## Màu chữ

Tái hiện lỗi với HTML dán mang màu `rgb(242,242,242)`: chữ gõ tiếp kế thừa mark này và LaTeX xuất `\textcolor[HTML]{F2F2F2}`. Sửa lúc dán, đọc dữ liệu cũ và xuất LaTeX tự tạo: chữ trắng/xám trung tính rất sáng trở về Màu tự động; các mẫu tích hợp in màu đen. Giữ cỡ chữ, đậm, màu có sắc đã chọn và nền tô sáng. Đổi theme không đổi dữ liệu tài liệu. Các lệnh màu tự viết trong LaTeX vẫn được giữ.

## Runtime và giới hạn

Bộ cài universal gồm Electron 44.5.1, backend Go, Pandoc 3.11 và TinyTeX 2026.10. Không cần Node/Go/MacTeX riêng để sử dụng các mẫu tích hợp. Không chứa các runtime/launcher Windows. Go hủy cả nhóm tiến trình; XeLaTeX/xdvipdfmx xử lý đường dẫn app có dấu cách, tên thư mục chứa `~`/`%`; Pandoc được tìm bằng đường dẫn tuyệt đối.

Yêu cầu đầy đủ **macOS 26+**: metadata binary cho thấy Electron cần 13+, Pandoc cần 15+, Biber arm64 cần 26+. Mức macOS 12 trước đây là sai với bộ công cụ này và đã được sửa. Kiểm tra build đọc `vtool` của từng binary native và `Info.plist`, từ chối nếu mức yêu cầu của binary cao hơn bộ cài. Đã chạy trên macOS 26.5.1 Apple Silicon. Intel chỉ kiểm tra kiến trúc, chưa chạy thực tế. Các mẫu tùy chỉnh có thể cần thêm gói/font.

Chữ ký ad-hoc, chưa Developer ID/notarize. Gatekeeper của một lượt tải xuống mới chưa được kiểm thử; có thể cần Open Anyway. Không thay ứng dụng hoặc hồ sơ thật của người dùng trong kiểm thử.

## Kết quả đã hoàn thành

| Kiểm tra | Kết quả |
| --- | --- |
| npm run check | Qua: lint, Go vet/unit, 172 bài backend/serializer/workspace, 15 LAN và 18 upgrade = 205 bài JS; PDF/Word thật; production build |
| Go race với XeLaTeX/Pandoc đi kèm | Qua; chạy cold XeLaTeX trong thư mục có `~` và `%` |
| npm ci / audit | Qua, 0 lỗ hổng được báo cáo |
| Giao diện Chromium | Qua: responsive, nền tối, tương tác soạn thảo, không page error |
| Chú thích hình mới | Qua: ảnh cũ, thêm ảnh, sửa, undo/redo trên macOS, mở lại |
| Hai app LAN bản development | Qua: ghép, xung đột, gõ trong lúc I/O, lưu offline, khởi động lại host |
| Chữ ký, universal và mức macOS của binary | Qua: 65 binary/bundle được ký, codesign deep/strict, lipo cả hai kiến trúc; mọi minimum ≤ 26 |
| App đóng gói, PATH Finder tối thiểu và cwd ngoài repo | Qua: backend tự khởi động lại khi bị kill, sáu mẫu PDF/APA/Biber, Word/OMML, canvas PDF, lưu/thoát/mở lại, đóng cửa sổ giữ app chạy |
| Thư viện bảng trong app đóng gói | Qua: biên dịch sáu kiểu bảng bằng TeX đi kèm; PDF có đủ chú thích/nội dung, 2 trang |
| Màu chữ trong app đóng gói | Qua: gõ thật, gõ tiếp đoạn cũ, Enter/Shift+Enter/Backspace, dán màu nền tối, đổi theme, lưu dữ liệu; PDF paint chữ đen #000000 và màu đỏ #c62828; không paint chữ trắng |
| Tiêu đề và đồng bộ LAN trong app đóng gói | Qua cả hai suite, gồm lưu offline và mở lại host |
| DMG và bản sao cài đặt | Qua: hdiutil checksum VALID, mount chỉ đọc và kiểm tra version/minimum/chữ ký trong DMG; sao chép bằng ditto, chạy lại toàn bộ smoke PDF/Word/lưu/mở lại thành công; đã tháo ổ và xóa bản sao tạm |

Log trong `artifacts/verification/0.5.2`; PDF/ảnh chụp ở `artifacts/dark-text-pdf` và `artifacts/mac-smoke`.

## File bàn giao

- `release-desktop/Viet-Latex-Studio-0.5.2-universal.dmg` và `.sha256`.
- `release-desktop/Viet-Latex-Studio-0.5.2-Mac-Build-Source.zip` và `.sha256`; đã kiểm tra CRC, từng file và quyền 0755 của launcher Mac; không chứa hồ sơ người dùng, dependency hoặc output build.
- `release-desktop/manifest.json`: commit gốc, runtime, giới hạn, kết quả và SHA-256.

Thoát bản cũ bằng **Cmd+Q**, mở DMG và kéo app vào Applications để thay bản cũ. Mở lại tài liệu rồi chọn **Cập nhật PDF**. Workspace nằm ngoài app và được giữ khi thay app. Có thể xuất `.vls` trong Quản lý tài liệu → Sao lưu trước khi chuyển máy.
