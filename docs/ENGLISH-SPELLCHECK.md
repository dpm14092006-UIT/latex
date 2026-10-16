# Kiểm tra chính tả tiếng Anh

Viet LaTeX Studio có bộ kiểm tra tiếng Anh chạy cục bộ bằng từ điển Anh Mỹ và Anh Anh. Từ điển được đóng gói cùng ứng dụng; việc kiểm tra không gửi nội dung tài liệu đi mạng.

## Sử dụng

1. Mở tab tài liệu cần kiểm tra, bật **Chính tả tiếng Anh** trên thanh phía trên trình soạn thảo.
2. Chọn **Anh Mỹ** hoặc **Anh Anh**. Lựa chọn được lưu theo tài liệu; tài liệu cũ mặc định tắt.
3. Từ nghi sai có gạch chân lượn sóng. Nhấp từ để xem tối đa 5 gợi ý, chọn từ sửa hoặc bỏ qua. Phần caption/chú thích có thể được đánh dấu bằng viền chấm.
4. Chọn **Kiểm tra bản thảo** hoặc **Kiểm tra LaTeX** để mở danh sách lỗi. Nhấp một mục để chọn vị trí và mở gợi ý. Danh sách kiểm tra được cập nhật khi nội dung thay đổi.
5. Chọn **Từ điển cá nhân** để quản lý thuật ngữ và tên riêng.

Kiểm tra sau khoảng 350 ms ngừng gõ. Từ chứa con trỏ đang gõ được tạm bỏ qua; dùng nút Kiểm tra để rà soát toàn bộ. Trong IME composition, bộ kiểm tra chờ kết thúc nhập. Gợi ý chỉ tính khi mở xem, trong worker riêng; việc phân tích source LaTeX cũng chạy trong worker.

Popup hỗ trợ Tab/Shift+Tab và Escape. Sau khi sửa trong bản thảo hoặc source, dùng Ctrl+Z (Windows) / Cmd+Z (macOS) để hoàn tác một bước. Với tiêu đề tài liệu và Abstract, thanh chính tả có nút **Hoàn tác sửa tiêu đề/Abstract** cho lần sửa gần nhất; nếu trường đã được sửa tiếp, ứng dụng từ chối hoàn tác đó để bảo vệ nội dung mới.

Chỉ thao tác sửa do người dùng chọn mới thay nội dung. Quét và gạch chân không chèn mark vào JSON và không tạo thay đổi trong LaTeX, PDF hay Word. Nếu sửa bản thảo khi tài liệu đang dùng source riêng, ứng dụng áp dụng hành vi chuyển về source tự sinh hiện có.

## Phạm vi bản thảo

Kiểm tra đoạn văn, tiêu đề, danh sách, trích khối, nội dung ô bảng, tiêu đề tài liệu, Abstract đang bật, caption ảnh/bảng và footnote. Từ bị chia giữa chữ đậm/nghiêng vẫn được kiểm tra cùng nhau; sửa giữ các vùng định dạng.

Công thức, inline code, codeBlock, khóa citation và crossReference được bỏ qua. URL, email, DOI, đường dẫn và identifier chứa số/underscore cũng được bỏ qua. Bản Tổng hợp chỉ xem: kiểm tra và sửa tại các tab gốc.

## Phạm vi source LaTeX

Kiểm tra văn xuôi trong thân `document`; kiểm tra đối số văn bản của title, section/subsection/subsubsection/chapter, paragraph/subparagraph, caption, footnote, text/textbf/textit/textrm/textsf/texttt/textnormal, emph, underline, mbox/makebox. Với href, textcolor và colorbox, chỉ đối số văn bản được kiểm tra. Short heading/caption trong đối số tùy chọn cũng được kiểm tra.

Bảo vệ công thức giữa `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, môi trường toán và các môi trường chưa biết; bảo vệ comment, verb/verbatim, lstlisting/minted, khóa cite/ref/label, URL/path, input/include và định nghĩa macro. Danh sách môi trường văn xuôi có document, abstract, itemize/enumerate/description, quote/quotation, center/flushleft/flushright, figure/table, tabular/tabularx/longtable, minipage và multicols.

Macro không biết được xử lý thận trọng: bỏ qua các đối số không xác định. Văn bản bên trong công thức, kể cả `\text{...}`, đang được bỏ qua. Source chưa đóng dấu toán hoặc ngoặc có thể khiến phần còn lại chưa được kiểm tra. Bộ quét không thực thi macro hoặc thay thế trình phân tích TeX đầy đủ.

## Từ điển cá nhân và bỏ qua

- **Bỏ qua lần này:** bỏ qua một vị trí trong phiên. Khi bản thảo được chỉnh sửa, những lựa chọn này có thể được xóa để quét lại vị trí mới.
- **Bỏ qua từ trong phiên tài liệu:** bỏ qua từ đó cho phiên tab hiện tại; không lưu sau khi mở lại/chuyển tab.
- **Thêm vào từ điển:** lưu từ lâu dài trên máy, áp dụng cho cả hai biến thể tiếng Anh. Có thể xóa trong bảng từ điển để kiểm tra lại.
- **Nhập từ điển:** TXT, mỗi dòng một từ, hoặc JSON dạng mảng từ / đối tượng chứa `words`. Từ nhập được gộp vào danh sách đang có.
- **Xuất từ điển:** JSON để chuyển máy hoặc sao lưu riêng.

Giới hạn: 10.000 từ, 64 ký tự mỗi từ, tệp nhập tối đa 1 MiB. Từ chỉ chứa chữ, dấu nháy và gạch nối; không nhận cú pháp cờ affix. Tên riêng giữ quy tắc viết hoa; thêm một tên không đồng nghĩa chấp nhận mọi biến thể viết thường hoặc dạng sở hữu của tên đó.

Desktop lưu `spellcheck-v1.json` trong hồ sơ userData bằng ghi nguyên tử. Các cửa sổ nhận cập nhật revision khi từ điển thay đổi. Nếu tệp hỏng về nội dung/định dạng, ứng dụng giữ tệp `.damaged-*` rồi mở danh sách trống có thông báo. Lỗi truy cập/ghi không được báo thành lưu thành công. Web dùng localStorage và khóa ghi khi trình duyệt hỗ trợ Web Locks.

Từ điển cá nhân không nằm trong `.vls` và không tự đồng bộ LAN. Dùng Nhập/Xuất để chuyển danh sách. Thiết lập bật/tắt và Anh Mỹ/Anh Anh trong từng tài liệu vẫn đi cùng backup, nhân bản và LAN.

## Giới hạn nhận diện

Đây là bộ kiểm tra chính tả bằng từ điển. Các từ hợp lệ dùng sai như `their/there`, `form/from` và lỗi ngữ pháp như `He go` cần một bộ xét ngữ cảnh khác. Từ chuyên ngành và tên riêng thiếu trong từ điển có thể bị báo; thêm từ đã xác nhận vào từ điển cá nhân.

Phạm vi tách từ hiện ưu tiên chữ Latin tiếng Anh ASCII, contraction và gạch nối. Từ có chữ ngoài phạm vi này được bỏ qua nguyên token, tránh cắt sai từ tiếng Việt/Unicode. Văn bản tiếng Việt không dấu có thể bị báo nếu bật kiểm tra tiếng Anh.

Mỗi lượt quét giữ tối đa 2.000 lỗi và báo khi đạt giới hạn. Panel hiển thị 200 lỗi đầu; lỗi còn lại vẫn được đánh dấu trong editor. Sửa rồi quét lại để tiếp tục. Nếu worker/từ điển không hoạt động, trạng thái là **Không khả dụng**; ứng dụng vẫn cho soạn thảo.

## Phát triển và xác minh

```sh
npm run test:spellcheck
npm run test:spellcheck:ui
npm run test:spellcheck:bench
node scripts/build-desktop.mjs
npm run test:spellcheck:desktop
```

UI test dùng Edge trên máy Windows này; đặt `UI_TEST_BROWSER=chromium` để dùng Chromium do Playwright cài. Test production web: `node scripts/spellcheck-ui.mjs --production` sau build. Test executable thực tế: đặt `DESKTOP_EXE` tới bản app rồi chạy `test:spellcheck:desktop`. Bản có fuse chặn inspect main process dùng CDP renderer trên loopback, giữ nguyên fuse.

Kiểm thử dùng hồ sơ tạm riêng. Ảnh UI ở `artifacts/spellcheck-ui/`, báo cáo benchmark ở `artifacts/spellcheck/benchmark.json`, runtime desktop ở `artifacts/spellcheck-desktop/runtime.json`.

Benchmark dùng 500 lỗi sinh tự động từ bộ từ thử tự viết, không phải corpus đại diện cho mọi tài liệu. Trong lần đo ngày 10/10/2026, 20 biến đổi tạo thành từ vẫn hợp lệ; với 480 lỗi ngoài từ điển, 446 lỗi có đáp án trong 5 gợi ý (92,9%). Lần đo cuối của lõi trên Ryzen 9 7940HS: 10.000 từ 31,1 ms, 50.000 từ 113,0 ms, gợi ý P95 8,4 ms và nạp từ điển 250,3 ms. Đây là thời gian lõi Node, chưa gồm debounce, IPC/worker hoặc rendering; tốc độ thực tế phụ thuộc máy và nội dung.

Đã xác minh core, UI trình duyệt và Electron Windows với renderer production; bản macOS có cấu hình build và CI kiểm tra nhưng cần kết quả chạy trên macOS trước khi tuyên bố đã xác minh tại nền tảng đó.

### Tình trạng bản chạy trên máy Windows hiện tại

Bản `.exe` đã được đóng gói, kiểm tra ASAR và xác nhận có đủ dictionary/worker/license. Sau lần dựng cuối, Windows báo **“An Application Control policy has blocked this file”** khi khởi chạy executable chưa có chữ ký số. Vì vậy chưa coi bản executable cuối là đã qua kiểm tra chạy trên máy này. Không có chứng thư Code Signing trong kho CurrentUser của môi trường kiểm thử.

Runtime Electron đang có trong môi trường phát triển vẫn chạy được renderer production và bộ kiểm tra. Để dùng từ workspace, đóng bản ứng dụng đang chạy rồi chạy:

```sh
npm run desktop:preview
```

Lệnh dựng lại backend/renderer rồi mở app bằng runtime phát triển. Việc ký/phát hành executable cho môi trường Application Control cần chứng thư và quy trình phát hành phù hợp; các bài kiểm tra phát triển không thay thế bước đó.

Kiến trúc và yêu cầu ban đầu: [kế hoạch triển khai](ENGLISH-SPELLCHECK-PLAN.md).
