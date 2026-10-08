# 0.5.1 — Nhận diện và giữ đúng số tiêu đề

Tiêu đề ghi sẵn `3.1.1 Night time light` giữ số `3.1.1` khi xuất PDF, kể cả tài liệu riêng chưa có tiêu đề cha. Bộ đếm LaTeX và nhãn tham chiếu cùng dùng số này.

Dòng `3.1 Dữ liệu vệ tinh` đứng trước nội dung trong cùng đoạn qua Shift+Enter hoặc ngắt dòng khi dán từ Word được tách thành tiêu đề và đoạn nội dung. Mục lục, bản thảo và PDF nhận cùng cấp tiêu đề. Bộ nhận diện giữ định dạng chữ, công thức và các ngắt dòng trong phần nội dung; không đổi đoạn mô tả, danh sách hoặc tiêu đề nhiều dòng đã có cấu trúc thành các mục mới.

Thanh tiêu đề và tên file Portable hiển thị 0.5.1 để phân biệt các bản 0.5.0 từng được build trong cùng ngày. Đóng bản cũ trước khi mở bản mới, sau đó chọn **Cập nhật PDF**. Dữ liệu workspace và bản sao lưu được giữ khi thay EXE. Khi có nhiều hồ sơ dữ liệu cũ, dùng đúng hồ sơ đang chứa tài liệu hiện tại trước khi chuyển ứng dụng.

Kiểm thử hồi quy: `npm run test:headings` build giao diện production, kiểm tra mục lục, nhập Shift+Enter, dán nội dung và đối chiếu số trong PDF thật. Cần XeLaTeX để chạy bài này. Có thể kiểm tra app Windows đã đóng gói bằng `DESKTOP_EXE` trỏ đến EXE; bài kiểm thử dùng hồ sơ tạm riêng, không sửa tài liệu đang sử dụng.

Build Mac tiếp tục chạy thủ công trên MacBook theo [hướng dẫn Mac](MAC-INSTALLER.md). Chưa có DMG đã xác minh trong phiên Windows.
