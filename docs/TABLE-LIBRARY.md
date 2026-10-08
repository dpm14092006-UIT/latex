# Thư viện bảng

Mở bằng **Chèn → Thư viện bảng**, hoặc nút **Kiểu bảng** trên thanh công cụ bảng khi con trỏ đang ở trong bảng. Mọi lựa chọn được lưu trên bảng và chuyển thành LaTeX khi biên dịch, không cần gõ lệnh tay.

## Chèn bảng mới

Chọn một mẫu dựng sẵn (kết quả, so sánh, số liệu, danh mục, thuật ngữ, bố cục không kẻ), đặt số hàng nội dung, số cột và chú thích, rồi bấm **Chèn bảng**. Mẫu gồm tiêu đề cột gợi ý và căn lề cột phù hợp. Mã LaTeX ở cuối hộp thoại là đúng đoạn sẽ được biên dịch.

## Kiểu đường kẻ

| Kiểu | LaTeX |
| --- | --- |
| Học thuật | `booktabs`: `\toprule`, `\midrule` dưới tiêu đề, `\bottomrule` (mặc định, giống bảng cũ) |
| Lưới | Đường dọc `|` và `\hline` sau mỗi hàng; ô gộp hàng dùng `\cline` để đường kẻ không cắt qua ô |
| Sọc xen kẽ | Ba đường kẻ, hàng nội dung xen kẽ tô nền `\rowcolor` (gói `colortbl`, `xcolor`) |
| Tiêu đề tô nền | Ba đường kẻ, các hàng tiêu đề tô nền |
| Tối giản | Chỉ `\midrule` dưới tiêu đề |
| Không kẻ | Không có đường kẻ |

Nhóm hàng có ô gộp dọc không bị tô sọc, vì `colortbl` sẽ phủ màu lên chữ của `\multirow`. Ở tiêu đề tô nền, ô gộp dọc được đặt ở hàng cuối của nhóm (`\multirow{-n}`) để chữ không bị che.

## Tinh chỉnh

- **Cỡ chữ**: rất nhỏ (`\scriptsize`), nhỏ hơn (`\footnotesize`), nhỏ (`\small`, mặc định), bằng văn bản (`\normalsize`).
- **Giãn dòng**: `\arraystretch` 1; 1,2 (mặc định); 1,5; 1,8.
- **Độ rộng**: *Tự động* giữ cột ngắn theo nội dung và cho cột dài xuống dòng; *Toàn trang* cho mọi cột xuống dòng với tổng độ rộng bằng vùng chữ; *Theo nội dung* không xuống dòng trong ô.
- **Chú thích**: trên hoặc dưới bảng.
- **Tiêu đề in đậm**: bật/tắt `\textbf` cho ô tiêu đề.
- **Căn lề từng cột**: Tự động (cột chỉ chứa số căn phải, còn lại căn trái), trái, giữa, phải. Ô có căn lề khác cột được xuất bằng `\multicolumn{1}{…}`. Thanh công cụ bảng có nút căn trái/giữa/phải cho ô đang chọn và nút bật/tắt hàng tiêu đề.

Thay đổi trong chế độ tinh chỉnh áp dụng ngay vào bản thảo; Ctrl+Z hoàn tác từng bước. Bản thảo hiển thị gần đúng đường kẻ, nền, cỡ chữ và giãn dòng; đường nét đứt mờ chỉ là đường dẫn soạn thảo, không xuất ra PDF.

## Dữ liệu và an toàn

Thuộc tính lưu trên node `table`: `tableStyle`, `fontSize`, `rowSpacing`, `tableWidth`, `captionPosition`, `headerBold`; ô dùng thuộc tính `align` sẵn có của Tiptap. Bảng cũ không có các thuộc tính này vẫn xuất như trước. Mọi giá trị đi qua danh sách cho phép trong `src/services/TableStyles.js`; giá trị lạ (từ ZIP, LAN hay dữ liệu hỏng) quay về mặc định, không thể chèn LaTeX tùy ý. Kiểm thử: `scripts/table-styles.test.mjs`.

Gõ `1. ` ở đầu dòng không còn tự tạo danh sách đánh số thụt lề; dùng nút **Danh sách đánh số** khi cần danh sách thật.
