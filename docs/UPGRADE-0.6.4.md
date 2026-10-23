# Viet LaTeX Studio 0.6.4

- Khôi phục kiểu bảng học thuật/booktabs làm mặc định như mã trước 0.6.3: kẻ trên, dưới tiêu đề và cuối bảng, không đóng khung dày từng ô. Những bảng lưu kiểu `null` cũng trở lại form này; lựa chọn kiểu rõ ràng vẫn được giữ.
- Nhận diện hàng tiêu đề in đậm nhập từ Word dù các ô còn mang loại `tableCell`. Dùng cùng nhận diện trong bản thảo, PDF và xuất Word; không viết lại dữ liệu bảng để đổi form.
- Giữ sửa lỗi hội tụ độ rộng longtable và hiển thị công thức có số từ 0.6.3.
- Kiểm tra đường vẽ PDF thật xác nhận form mặc định có ba đường ngang đủ rộng và không có đường dọc. Kiểu Lưới vẫn kẻ đầy đủ khi được chọn.
