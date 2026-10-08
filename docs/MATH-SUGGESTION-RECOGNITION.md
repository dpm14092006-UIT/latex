# Khung quét và gợi ý chuyển biểu thức sang LaTeX

## Mục tiêu

Quét bản thảo để tìm các đoạn có khả năng là biểu thức toán, chuyển thử sang LaTeX, cho xem ngữ cảnh và bản render, rồi để người viết duyệt. Quét không tự sửa nội dung.

## Luồng xử lý

1. Đọc các khối văn bản có vị trí trong tài liệu rich-text.
2. Bỏ qua khối mã, văn bản nằm trong liên kết, node công thức đã có và các node inline không phải văn bản.
3. Chạy các bộ phát hiện theo cấu trúc: mẫu học thuật đã biết, quan hệ/phương trình, rồi biểu thức toán cục bộ như số mũ, chỉ số, phép tính và hàm.
4. Đưa từng đoạn ứng viên qua bộ chuyển gõ thường sang LaTeX. Không có kết quả chuyển hợp lệ thì bỏ ứng viên.
5. Gộp gợi ý trùng hoặc chồng lấn; gắn vị trí gốc, trích đoạn ngữ cảnh, lý do, độ tin cậy và kiểu chèn đề xuất.
6. Hiện danh sách cho người viết chọn. Trước khi thay, kiểm tra tài liệu và đoạn gốc còn đúng vị trí. Các đoạn được chọn chuyển trong một giao dịch để có thể hoàn tác chung.

## Các lớp phát hiện hiện có

- **Mẫu xác định, độ tin cậy cao:** Macro-F1 theo lớp, nhãn phân loại có chỉ số/phiên bản/tập giá trị, và biểu thức tỉ số “Per” có chỉ số trùng nhau.
- **Cấu trúc quan hệ:** dấu bằng, bất đẳng thức, phép thuộc tập; ưu tiên biểu thức có biến kèm số mũ/chỉ số hoặc nhiều toán tử.
- **Biểu thức cục bộ:** phép toán, phân số gõ bằng `/`, số mũ/chỉ số, và một số hàm phổ biến như `sqrt`, `sin`, `log`.
- **Mức cần xem lại:** biểu thức chỉ có một dấu quan hệ hoặc phép chia với tên biến dài. App đưa ra ngữ cảnh để người viết loại bỏ kết quả trùng với văn xuôi.

Ngưỡng hiện tại là luật heuristic để sắp xếp gợi ý, không phải xác suất thống kê. Gợi ý dưới ngưỡng bị ẩn; mức tin cậy cao có thể được chọn hàng loạt nhưng vẫn cần bấm nút chuyển.

## Chọn kiểu hiển thị

- Công thức nằm giữa câu mặc định là công thức trong dòng.
- Một biểu thức chiếm trọn đoạn văn có thể chuyển thành công thức căn giữa, xuống dòng riêng; người viết có thể đổi kiểu trước khi áp dụng.
- Hệ thống giữ nguyên văn bản cho tới khi người viết xác nhận. Nếu tài liệu đổi sau lần quét, vị trí cũ bị vô hiệu và cần quét lại.

## Giới hạn và hướng mở rộng

Phiên bản hiện tại quét nội dung văn bản đang có trong editor; chưa quét ảnh, ảnh chụp màn hình hay nội dung hình trong PDF. Có thể mở rộng bằng một bộ phát hiện OCR riêng, trả về hộp vùng ảnh, công thức LaTeX, độ tin cậy và bản xem trước; mọi kết quả OCR vẫn cần duyệt thủ công. Bộ phát hiện mới nên đăng ký như một rule độc lập, không sửa ngầm văn bản và không nâng mức tin cậy chỉ vì công thức render được.

Các giới hạn bảo vệ hiệu năng hiện tại là 12.000 ký tự mỗi khối, 5.000 khối và 2.000 gợi ý mỗi lần quét.
