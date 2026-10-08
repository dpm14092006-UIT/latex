# 0.5.1 — Nhận diện và giữ đúng số tiêu đề

Tiêu đề ghi sẵn `3.1.1 Night time light` giữ số `3.1.1` khi xuất PDF, kể cả tài liệu riêng chưa có tiêu đề cha. Bộ đếm LaTeX và nhãn tham chiếu cùng dùng số này.

Dòng `3.1 Dữ liệu vệ tinh` đứng trước nội dung trong cùng đoạn qua Shift+Enter hoặc ngắt dòng khi dán từ Word được tách thành tiêu đề và đoạn nội dung. Mục lục, bản thảo và PDF nhận cùng cấp tiêu đề. Bộ nhận diện giữ định dạng chữ, công thức và các ngắt dòng trong phần nội dung; không đổi đoạn mô tả, danh sách hoặc tiêu đề nhiều dòng đã có cấu trúc thành các mục mới.

Thanh tiêu đề và tên bộ cài DMG hiển thị 0.5.1. Thoát bản cũ bằng **Cmd+Q** trước khi thay app trong Applications, rồi chọn **Cập nhật PDF**. Dữ liệu workspace và sao lưu nằm ngoài app nên được giữ khi thay bộ cài.

Kiểm thử hồi quy: `npm run test:headings` build giao diện production, kiểm tra mục lục, nhập Shift+Enter, dán nội dung và đối chiếu số trong PDF thật. Có thể kiểm tra app Mac đã đóng gói bằng `DESKTOP_EXE` trỏ đến `Viet Latex Studio.app/Contents/MacOS/Viet Latex Studio`; bài kiểm thử dùng hồ sơ tạm riêng.

Bộ cài Mac universal và quy trình kiểm tra được mô tả trong [hướng dẫn Mac](MAC-INSTALLER.md). Bản cục bộ chưa có notarization bằng Apple Developer ID.
