# Thư viện bảng

Mở bằng **Chèn → Thư viện bảng**, hoặc nút **Kiểu bảng** trên thanh công cụ bảng khi con trỏ đang ở trong bảng. Mọi lựa chọn được lưu trên bảng và chuyển thành LaTeX khi biên dịch, không cần gõ lệnh tay.

## Chèn bảng mới

Chọn một mẫu dựng sẵn (kết quả, so sánh, số liệu, danh mục, thuật ngữ, bố cục không kẻ), đặt số hàng nội dung, số cột và chú thích, rồi bấm **Chèn bảng**. Mẫu gồm tiêu đề cột gợi ý và căn lề cột phù hợp. Mã LaTeX ở cuối hộp thoại là đúng đoạn sẽ được biên dịch.

## Caption theo bản thảo journal

Số bảng và tiêu đề được nhập riêng:

- **Table No.**: tự gõ `5.2.2`, `S1` hoặc `???`; không có số thứ tự tự sinh.
- **Caption**: chỉ gõ tiêu đề, ví dụ `Forecast comparison`.
- PDF và Word ghép thành `Table 5.2.2. Forecast comparison` hoặc `Table ???. Forecast comparison`. Chỉ nhập số thì hiện `Table 5.2.2`; để cả hai ô trống thì không có caption.

Hai ô có ngay trên bảng, trong thanh công cụ và thư viện bảng; dùng chung cho bảng một cột, hai cột, nhiều trang và mã LaTeX xem trước. Caption cũ bắt đầu bằng `Bảng 5.2.2.` hoặc `Table 5.2.2.` tự tách số sang **Table No.**, giữ nguyên tiêu đề và chuẩn hóa tên thành `Table`.

Caption hình vẫn nhập toàn bộ, ví dụ `Figure 1. Forecast results` hoặc `Figure ???`. `Table` và `Figure` giữ tiếng Anh khi bản nháp có tiếng Việt; nội dung tiêu đề do người dùng gõ không tự dịch. Ghi chú chưa có nhãn dùng `Note:`; nhãn tự nhập như `Source:` được giữ nguyên.

Tham chiếu LaTeX tới bảng lấy đúng giá trị ở **Table No.**. Để trống số thì tham chiếu dùng `??`, không suy đoán theo vị trí bảng. Số và tiêu đề được giữ khi xuất/nhập Word.

## Kiểu đường kẻ

| Kiểu | LaTeX |
| --- | --- |
| Học thuật | `booktabs`: `\toprule`, `\midrule` dưới tiêu đề, `\bottomrule` |
| Lưới (mặc định) | Đường dọc `|` và `\hline` sau mỗi hàng; ô gộp hàng dùng `\cline` để đường kẻ không cắt qua ô |
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

## Xóa hàng và cột

Chọn trọn hàng hoặc cột rồi nhấn **Delete/Backspace** sẽ xóa luôn hàng/cột, bảng tự co lại; **Ctrl+Z** khôi phục được. Chọn một phần các ô thì Delete chỉ xóa nội dung các ô đó. Khi chỉ đang gõ trong một ô, Delete/Backspace vẫn sửa chữ như bình thường. Có thể dùng trực tiếp nút **Xóa hàng** hoặc **Xóa cột** trên thanh công cụ bảng.

Độ rộng **Tự động** theo nội dung và số cột còn lại; **Toàn trang** vẫn dùng hết vùng chữ. Hàng trống tạo để điền sau vẫn được giữ; muốn bỏ khoảng trắng của các hàng đã làm rỗng, chọn chúng và dùng **Xóa hàng**.

## Dữ liệu và an toàn

Số và nội dung được lưu riêng trên node `table`: `tableNumber` (tối đa 50 ký tự), `caption` (500 ký tự), `note` (2.000 ký tự). Thuộc tính định dạng: `tableStyle`, `fontSize`, `rowSpacing`, `tableWidth`, `captionPosition`, `headerBold`; ô dùng thuộc tính `align` sẵn có của Tiptap. Từ 0.6.3, bảng chưa chọn kiểu hoặc lưu kiểu `null` dùng lưới đầy đủ; kiểu đã chọn rõ ràng vẫn được giữ. Backend biên dịch longtable nhiều lượt để độ rộng cột và đường kẻ ổn định. Mọi giá trị đi qua danh sách cho phép trong `src/services/TableStyles.js`; giá trị lạ quay về mặc định, không thể chèn LaTeX tùy ý. Kiểm thử: `scripts/table-styles.test.mjs`, `scripts/table-math-rendering.mjs`.

Gõ `1. ` ở đầu dòng không còn tự tạo danh sách đánh số thụt lề; dùng nút **Danh sách đánh số** khi cần danh sách thật.
