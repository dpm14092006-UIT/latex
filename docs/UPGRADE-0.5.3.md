# Viet LaTeX Studio 0.5.3 — đồng bộ bản thảo/PDF

Các đoạn dán dùng dấu không ngắt dòng cho hầu hết khoảng trắng khiến XeLaTeX kéo cả đoạn ra ngoài lề. Bản này tự sửa mẫu khoảng trắng đó khi mở workspace, nhập, dán và xuất LaTeX; giữ chữ, định dạng, công thức, mã và khoảng trắng đơn lẻ giữa số với đơn vị. Workspace được sửa khi lưu tiếp theo.

Chế độ **Tự động · theo bản thảo** cập nhật PDF sau khi ngừng gõ khoảng 0,9 giây; các lượt cách nhau ít nhất 2 giây. Mỗi lần chỉ chạy một lượt, giữ phiên bản mới nhất đang chờ, báo khi bản xem trước cũ và xuất PDF luôn dùng nội dung mới nhất. Thời gian biên dịch thực tế tùy tài liệu. Lần nâng cấp đầu chuyển chế độ tự động cũ sang chế độ này; lựa chọn thủ công được giữ. Vẫn có thể chọn nhịp 1/2 trang.

Trong **Soạn + PDF**, nút liên kết **Đồng bộ cuộn bản thảo và PDF** bật mặc định. Cuộn một khung di chuyển khung kia theo các đoạn văn/tiêu đề tìm được trong PDF; nội suy vị trí giữa các đoạn. Hai bố cục có thể có số trang khác nhau. Chỉ áp dụng với PDF ở chế độ **Cuộn**; có thể tắt bằng nút liên kết. PDF mới giữ vị trí cuộn; chèn ảnh vẫn đưa đến trang chứa ảnh.

Chạy `npm run test:preview-layout` sau khi build desktop để kiểm tra PDF thật, chữ trong lề, cuộn hai chiều, tắt đồng bộ, dán văn bản và nội dung mới trong PDF tự cập nhật. Có thể đặt `PREVIEW_WORKSPACE` tới một workspace để kiểm tra trên bản sao trong hồ sơ tạm; kiểm thử không sửa hồ sơ gốc.
