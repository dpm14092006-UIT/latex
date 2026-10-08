# Viet LaTeX Studio 0.5.6 — PDF qua LAN

Kế thừa sửa nền LAN và bỏ đồng bộ cuộn trong 0.5.5. Giữ sửa chữ trắng/mất chữ, xuống dòng, tràn lề và cập nhật PDF tự động.

- Máy biên dịch chuyển PDF hiện tại qua kết nối LAN mã hóa riêng. Máy nhận hiển thị và xuất đúng tệp đó mà không chạy source nhận được. Không chuyển quyết định tin cậy LaTeX.
- So khớp phiên bản bản thảo, mẫu, source, ảnh và tài nguyên; sửa tài liệu làm PDF cũ không còn hợp lệ. Kiểm tra định dạng, base64 và SHA-256 trước khi lưu/hiển thị.
- Chỉ gửi PDF khi thay đổi; giữ cache sau khởi động lại. Tối đa 24 MiB/PDF và 32 MiB toàn cache, loại bản cũ nhất. Lỗi PDF không ngăn đồng bộ bản thảo; bảng LAN hiển thị lỗi chờ PDF.
- Giao thức bản thảo v1 giữ tương thích. Máy cũ vẫn nhận bản thảo; bảng LAN báo máy cần cập nhật để nhận PDF. Cả hai máy phải có ứng dụng hỗ trợ giao thức PDF mới.
- Giữ cổng và khóa đã ghép khi nâng cấp. Backup workspace và hồ sơ LAN cục bộ trước khi thay app; hồ sơ LAN có khóa riêng tư nên không đưa vào mã nguồn.

Kiểm thử với hồ sơ tạm: truyền PDF hai chiều qua TCP mã hóa, cache sau khởi động lại, từ chối PDF sai source/tài nguyên hoặc bản thảo đã đổi, cache hỏng không làm mất đồng bộ tài liệu. Hai Electron với interval renderer bị đình chỉ: PDF đúng byte của máy gửi được hiển thị và xuất được, source nhận vẫn chưa tin cậy. Kiểm tra tiếp xung đột, gõ trong lúc mạng chờ, lưu offline và mở lại máy chủ.
