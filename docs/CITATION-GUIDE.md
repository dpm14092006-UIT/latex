# Nhận diện công thức và liên kết trích dẫn

## Công thức gõ thường — đã triển khai

Mở Chèn công thức → Gõ thường. Công thức được chuyển sang LaTeX ngay khi nhập, có xem trước và có thể chuyển sang sửa LaTeX hoặc sửa trực quan trước khi chèn.

Ví dụ: `p >= N_train`, `sqrt(x)`, `(a+b)/c`, `x^(n+1)`, `sin(x) + alpha`, `abs(x)`.

Dùng ngoặc để xác định phạm vi phân số và số mũ. `a+b/c` là a cộng b/c; `(a+b)/c` là phân số có tử a+b. Tên biến liền chữ được giữ nguyên; dùng `N_train` khi muốn chỉ số, không tự suy diễn `Ntrain`.

Hỗ trợ các phép toán cơ bản, quan hệ, chỉ số, số mũ, căn, giá trị tuyệt đối, hàm thông dụng và tên chữ Hy Lạp. Công thức thiếu toán hạng, thiếu ngoặc hoặc chứa ký hiệu không hỗ trợ sẽ báo lỗi và không cho chèn trong chế độ Gõ thường. Công thức LaTeX có sẵn dùng tab LaTeX. Ma trận, hệ phương trình và tích phân có cận chưa có cú pháp gõ thường riêng.

Kiểm thử: `node --test scripts/formula-recognition.test.mjs scripts/math-input.test.mjs`; `node scripts/formula-recognition-ui.mjs`; `npm run lint`; `npm run build`.

## Liên kết cite nhanh — đã triển khai

Mở Trích dẫn & tài liệu tham khảo (đặt con trỏ trong tài liệu rồi Ctrl+Shift+C) → Quét trích dẫn. Có thể tìm lệnh Quét trích dẫn chưa liên kết REF trong Ctrl+K.

1. Chọn danh mục số gốc nếu tài liệu có `[12]`. Chưa chọn thì các trích dẫn số cần chọn REF thủ công.
2. Bấm Quét tài liệu. Nhận diện `[12]`, `[2, 5–7]`, `(Nguyễn, 2023)`, `(Smith et al., 2021; Lee, 2022)`, `[@smith2021]`, `Sousa et al. (2025)` và `Giri and Chen (2022)`. Gộp các text node liền nhau dù có in đậm/in nghiêng. Mẫu `(Swaminathan & Venkitasubramony, 2024; Anitha & Neelakandan, 2025)` là một nhóm có hai nguồn được đối chiếu riêng.
3. Bảng duyệt hiển thị ngữ cảnh, nguồn, tiêu đề và lý do khớp. Những dòng khớp duy nhất được chọn sẵn để bạn duyệt; chưa thay đổi tài liệu cho tới khi bấm Liên kết.
4. Với nguồn mơ hồ hoặc chưa có ánh xạ, tìm REF bằng tác giả/năm/tiêu đề/khóa rồi chọn tài liệu. Có thể dùng lựa chọn cho mọi lần xuất hiện cùng mẫu tác giả/năm; không dùng chung chỉ vì cùng `(2025)`. Có bộ lọc cần chọn nguồn, nhiều nguồn khớp, đã chọn, và tìm trong kết quả. Quét lại giữ các lựa chọn còn phù hợp; liên kết một phần giữ cả nguồn thủ công và trạng thái bỏ chọn của phần còn lại.
5. Bấm Liên kết N vị trí đã chọn. Chuyển các mẫu text thành node citation lưu khóa BibTeX, dùng cơ chế đánh số và xuất LaTeX/Word hiện có.
6. Có nút Hoàn tác liên kết; cả lô là một transaction và một bước Undo. Kiểm tra tài liệu và BibTeX chưa thay đổi kể từ lúc quét. Nếu đổi, yêu cầu quét lại.

Khi nhập danh mục tham khảo có số `[12]`, hệ thống tự lưu bảng số gốc → khóa REF trong `settings.citationSourceMaps` của tài liệu. Có thể đặt tên danh mục khi nhập. Mỗi lần nhập là một bảng riêng; cùng số 12 trong hai danh mục không bị gộp. DOI đã có sẵn được nối với khóa cũ và vẫn giữ đúng số gốc. BibTeX và RIS không có số gốc thì không suy diễn từ thứ tự tệp. Với danh mục đã nhập trước khi có tính năng này, dùng Thêm ánh xạ số gốc, ví dụ `[12] smith2021`.

Quy tắc đối chiếu: khóa REF chính xác; nhãn tác giả ngắn và năm đầy đủ; chuẩn hóa dấu, `and`/`&`/`và` và `et al.`/`và cộng sự`. Không tự chọn khi có hai nguồn cùng tác giả/năm, trùng khóa BibTeX, nguồn gốc đã xóa hoặc hậu tố năm a/b không khớp dữ liệu. Danh sách số gốc bị trùng số trong cùng một lần nhập giữ cả hai ứng viên để duyệt.

Phạm vi: bỏ qua citation đã liên kết, công thức, code, hyperlinks, và phần dưới heading cấp cao có tên Tài liệu tham khảo / References / Bibliography (cho tới heading cùng cấp hoặc cao hơn). Danh mục dán như paragraph thường cần người dùng kiểm tra ngữ cảnh. Trích dẫn tường thuật lưu mode riêng và đi qua trình soạn thảo, LaTeX, Word; cả tác giả và năm được thay thành một node. Số trang và các biến thể chưa hỗ trợ để nguyên. Quét tối đa 2.000 vị trí mỗi lượt, tối đa 50 nguồn trong một trích dẫn. Không kiểm chứng một nguồn có thực sự hỗ trợ phát biểu trong câu.

Quét và đối chiếu REF có sẵn chạy cục bộ. Nhập DOI vẫn dùng cơ chế tra cứu hiện có. Ánh xạ lưu trong workspace và đi qua sanitizer khi mở lại. Nếu đóng hộp thoại hoặc đổi BibTeX trong lúc nhập nguồn qua mạng, kết quả không ghi đè các chỉnh sửa mới.

Kiểu trích dẫn là lựa chọn chung cho tài liệu, không phải định dạng riêng từng REF. Theo mẫu tài liệu mặc định dùng APA 7th, riêng IEEEtran dùng IEEE; các lựa chọn rõ ràng APA/IEEE/số/Harvard được giữ. Trích dẫn APA không đánh số; nhóm nhiều bài sắp theo tác giả, giữ dấu chấm phẩy. LaTeX APA dùng biblatex-apa + Biber + csquotes, Word dùng CSL APA 7th đầy đủ của Citation Style Language. Khóa BibTeX có `_` được giữ nguyên khi tạo tệp biên dịch; chỉ escape nội dung trường. Backend không trả PDF nếu lượt cuối vẫn báo citation undefined.

Kiểm thử: xem `artifacts/full-audit/report.md` và các log bên cạnh. Các nhóm đã kiểm tra gồm parser/transaction, giao diện Edge, lưu/mở lại, desktop development/production, XeLaTeX và Pandoc thật, các mẫu tài liệu, tải và dọn thư mục tạm. Ảnh giao diện: `artifacts/citation-scan/narrative-review.png`. PDF/DOCX hồi quy nằm trong cùng thư mục.

Nghiên cứu: đối chiếu [định dạng và quy tắc khóa/tác giả BibTeX](https://www.bibtex.org/Format/) với `Bibliography.js`, `AcademicNodes.js`, `DocumentSerializer.js` và `WordDocument.js` của dự án. Với thao tác tài liệu và history, kiểm tra [ProseMirror reference](https://prosemirror.net/docs/ref/) và định nghĩa API của phiên bản cài trong `node_modules/prosemirror-model/dist/index.d.ts`, `node_modules/prosemirror-history/dist/index.d.ts`. Không thêm model AI hoặc dịch vụ bên ngoài cho quét text.

Nguồn định dạng APA: [biblatex-apa trên CTAN](https://ctan.org/pkg/biblatex-apa), [CSL APA 7th](https://github.com/citation-style-language/styles/blob/master/apa.csl). CSL giữ thông tin tác giả và giấy phép CC BY-SA 3.0 trong tệp gốc được lưu cục bộ.

Các hướng mở rộng còn lại: locator số trang, gợi ý tại con trỏ và quét nền phần văn bản vừa đổi. Nhãn trong editor cho các trường hợp disambiguation phức tạp chưa thay thế được toàn bộ khả năng của Biber/CSL; PDF/Word dùng bộ định dạng đầy đủ. Các mẫu LaTeX tùy chỉnh có sẵn một hệ trích dẫn khác cần cấu hình nhất quán với kiểu chọn; bộ sinh không tự viết lại source đã sửa tay.
