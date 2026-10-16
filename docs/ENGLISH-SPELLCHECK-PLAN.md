# Kế hoạch triển khai kiểm tra chính tả tiếng Anh

Ngày lập: 10/10/2026. Trạng thái: đã triển khai hai mốc bản thảo và source LaTeX trong workspace. Core, UI và Electron production Windows đã được kiểm tra. Đóng gói Windows thành công nhưng executable cuối bị Windows Application Control chặn; macOS chưa có kết quả chạy tại nền tảng đó. Phần dưới giữ thiết kế và tiêu chí ban đầu; hướng dẫn hiện hành và cách chạy qua runtime phát triển ở [ENGLISH-SPELLCHECK.md](ENGLISH-SPELLCHECK.md).

## Nhật ký triển khai

- Engine nspell và dictionary EN-US/EN-GB, asset/license/checksum, worker, tokenizer/cache và giới hạn được triển khai.
- Bản thảo dùng ProseMirror plugin/Decoration; source dùng CodeMirror StateField. Phân tích LaTeX nằm trong worker. Gợi ý đảo chữ liền nhau được ưu tiên trước gợi ý dictionary để xử lý những lỗi như `teh`.
- Popup, panel, title/Abstract/caption/footnote, undo, bỏ qua và từ cá nhân có nhập/xuất được nối vào UI. Title/Abstract có nút hoàn tác sửa gần nhất; rich text/source dùng lịch sử editor.
- Từ cá nhân lưu riêng userData/IPC, ghi nguyên tử, bảo toàn tệp hỏng, có revision cập nhật nhiều cửa sổ. Settings từng tài liệu được sanitize và kiểm tra roundtrip LAN.
- Core tests, UI tests, benchmark và desktop tests đã thêm vào npm scripts, check/check:full và CI theo nền tảng. Script chuẩn bị asset nằm trong Vite buildStart để dùng cho dev/build/packaging.
- Cấu trúc thực tế dùng `SpellcheckTools.jsx` làm bộ điều phối/popup/panel, `PersonalDictionary.js` cho storage adapter, `SpellcheckClient.js` quản lý worker; các trách nhiệm tương ứng các module dự kiến bên dưới được gộp tại đây.
- Tập đánh giá hiện là 500 biến đổi từ tự tạo cùng các fixture văn bản đúng, không phải corpus tài liệu thật đã gán nhãn độc lập. Báo cáo nêu riêng giới hạn này; chưa coi đó là chứng cứ chính xác chung.

## 1. Mục tiêu và phạm vi

Tích hợp bộ kiểm tra chính tả tiếng Anh vào Viet LaTeX Studio, chạy cục bộ, gạch chân từ nghi sai, cho phép xem gợi ý, sửa, bỏ qua và thêm từ cá nhân. Bảo vệ công thức, lệnh LaTeX, trích dẫn, nhãn và định dạng tài liệu.

Hai mốc sản phẩm:

- **Mốc A — bản thảo:** đoạn văn, tiêu đề, danh sách, blockquote, nội dung ô bảng; sau đó nối các trường tiêu đề tài liệu, Abstract, caption ảnh/bảng và footnote vào cùng bộ kiểm tra. Có EN-US/EN-GB, gợi ý sửa, từ điển cá nhân và danh sách lỗi.
- **Mốc B — mã LaTeX:** kiểm tra văn xuôi trong source riêng bằng bộ quét hiểu trạng thái LaTeX; bảo vệ cấu trúc và hỗ trợ những lệnh chứa văn bản đã định nghĩa rõ.

Kiểm tra ngữ pháp, dùng nhầm từ hợp lệ như `their/there`, và viết lại câu là phần mở rộng sau hai mốc. Bộ từ điển không đủ để kết luận những lỗi đó. Không tự động thay từ khi gõ trong phiên bản đầu.

## 2. Hiện trạng đã kiểm tra

| Thành phần | Hiện trạng | Điểm tích hợp |
| --- | --- | --- |
| `src/main.jsx` | React, khởi tạo Tiptap, `spellcheck: 'false'`, chuyển bản thảo/source, lưu tài liệu | Đăng ký extension, quản lý thiết lập theo tài liệu, nối bộ điều phối |
| `src/components/EditorPane.jsx` | Toolbar, ProseMirror plugin và Decoration cho phân trang | Công cụ Chính tả, popup và decoration riêng |
| `src/components/SourceEditor.jsx` | CodeMirror 6, stex, `spellcheck: 'false'`, giới hạn 800 KiB source | Extension riêng cho source, mapping vị trí, sửa qua transaction |
| `src/services/AcademicNodes.js` | Citation/crossReference/footnote dạng atom; footnote chứa văn bản trong attribute; bảng chứa caption trong attribute | Bỏ qua khóa tham chiếu; adapter cho footnote/caption |
| `src/services/ImageBlock.js` | Caption ảnh là attribute, sửa bằng input trong node view | Adapter kiểm tra caption và sửa attribute |
| `src/services/DocumentSettings.js` | Abstract là chuỗi trong settings | Kiểm tra Abstract và lưu tùy chọn chính tả |
| `src/services/WorkspaceData.js` | Chuẩn hóa workspace và settings từng tài liệu | Bảo toàn tùy chọn mới, đọc tài liệu cũ |
| `electron/main.cjs`, `electron/preload.cjs` | IPC có kiểm tra sender; lưu dữ liệu trong userData | Từ điển cá nhân bền vững, thao tác có giới hạn |
| `vite.config.js`, `electron/app-protocol.cjs` | Asset cục bộ, CSP, giao thức `vietlatex://` | Đóng gói dictionary và worker, kiểm tra bản production |
| `scripts/` | Node test, Playwright UI/Electron, hồi quy PDF/Word/workspace | Thêm suite tập trung cho tính năng |

Repo đang có nhiều thay đổi chưa commit. Khi triển khai phải đọc diff hiện tại của những tệp cần sửa, chỉnh đúng vùng tích hợp, giữ các thay đổi đang có. Không tự tạo release hay tăng version trong bước này.

## 3. Lựa chọn kỹ thuật

Thử nghiệm **nspell + Hunspell dictionaries**, dùng `dictionary-en` cho EN-US và `dictionary-en-gb` cho EN-GB. Engine JavaScript cung cấp kiểm tra từ và gợi ý; ứng dụng chịu trách nhiệm tách từ, bảo vệ vùng nội dung và nối UI.

Lý do: dùng chung kết quả và quy tắc trên web/Windows/macOS; chủ động quét tài liệu và bảo vệ LaTeX. Spellchecker có sẵn của Electron là lựa chọn cho tích hợp nhanh, nhưng phụ thuộc hệ điều hành; tài liệu Electron cho biết macOS dùng API native và không đặt ngôn ngữ qua cùng cơ chế Windows/Linux. Giữ spellcheck native tắt trong các vùng dùng engine riêng để tránh gạch chân trùng.

Không import entry Node đọc filesystem của gói dictionary vào renderer. Script chuẩn bị asset đọc `index.aff`, `index.dic`, sao chép sang asset cục bộ; worker nạp chúng bằng URL do Vite xử lý. Khóa dependency và ghi nguồn/version/checksum trong manifest. Giữ giấy phép của engine và từng dictionary đi cùng bộ cài.

Quyết định engine được chốt sau thử nghiệm build/worker, độ chính xác mẫu và benchmark. Nếu không đạt, giữ interface engine và đánh giá backend Hunspell khác; không phải sửa lại editor/UI.

Nguồn kỹ thuật đã đối chiếu:

- [nspell: API, trách nhiệm tokenizer và dữ liệu dictionary](https://github.com/wooorm/nspell).
- [Dictionary packages: EN-US/EN-GB, cách nạp và giấy phép từng bộ](https://github.com/wooorm/dictionaries).
- [Electron SpellChecker: nền tảng, ngôn ngữ và tải dictionary](https://www.electronjs.org/docs/latest/tutorial/spellchecker).

## 4. Hành vi người dùng

Tài liệu cũ và tài liệu mới mặc định tắt kiểm tra, vì ứng dụng hiện phục vụ cả nội dung tiếng Việt. Khi bật, mặc định EN-US; có thể chọn EN-GB. Giao diện vẫn tiếng Việt, ghi rõ phạm vi kiểm tra là tiếng Anh.

Luồng chính:

1. Chọn **Chính tả → Bật kiểm tra tiếng Anh → Anh Mỹ/Anh Anh**.
2. Gõ xong từ hoặc dừng gõ khoảng 350 ms, ứng dụng cập nhật vùng nghi sai. Không báo lỗi từ đang gõ hoặc trong IME composition.
3. Nhấp từ được đánh dấu để xem tối đa 5 gợi ý, **Bỏ qua lần này**, **Bỏ qua trong phiên tài liệu**, **Thêm vào từ điển**.
4. Chọn gợi ý sửa đúng một vị trí; giữ định dạng, con trỏ hợp lý và undo một bước.
5. **Kiểm tra toàn tài liệu** mở bảng lỗi có vị trí và đoạn ngữ cảnh, nhảy đến vị trí hoặc trường dữ liệu tương ứng.
6. **Từ điển cá nhân** cho phép thêm/xóa, nhập/xuất danh sách từ.

Popup hỗ trợ bàn phím, Escape để đóng và trả focus về vị trí đang sửa. Theme sáng/tối dùng màu hiện có, gạch lượn sóng bằng màu foreground để hợp giao diện monochrome; có nhãn và tooltip để lỗi không chỉ được phân biệt bằng màu. Không chặn menu cắt/sao chép/dán hiện có.

Chế độ Tổng hợp chỉ cho xem: không cung cấp thao tác sửa; điều hướng lỗi về tài liệu gốc khi có mapping xác định. Mốc A có thể tắt kiểm tra trong Tổng hợp và ghi trạng thái rõ ràng, thay vì cho phép thao tác có vị trí không chắc chắn.

Nội dung pha trộn ngôn ngữ: không tuyên bố tự nhận diện ngôn ngữ hoàn chỉnh. Bỏ qua token có ký tự ngoài phạm vi từ điển phù hợp, nhưng tiếng Việt không dấu vẫn có thể bị báo; người dùng có thể tắt kiểm tra hoặc bỏ qua. Không bỏ qua mọi từ viết hoa đầu câu, vì điều đó sẽ bỏ sót lỗi thông thường.

## 5. Kiến trúc và hợp đồng dữ liệu

Luồng xử lý: **editor/field → các đoạn văn có mapping → tokenizer → worker/engine → danh sách lỗi → decoration/bảng lỗi → transaction sửa**.

Các module dự kiến:

| Module | Trách nhiệm |
| --- | --- |
| `src/services/SpellcheckTokenizer.js` | Token, vùng loại trừ, normalization phục vụ lookup và mapping UTF-16 |
| `src/services/SpellcheckEngine.js` | Wrapper nspell, EN-US/EN-GB, thêm từ cá nhân, cache có giới hạn |
| `src/services/SpellcheckSegments.js` | Trích đoạn Tiptap/field, mapping vị trí thật |
| `src/services/LatexSpellcheckScanner.js` | Quét trạng thái source, trả vùng văn xuôi an toàn |
| `src/services/SpellcheckSettings.js` | Defaults, sanitize, giới hạn dữ liệu từ cá nhân |
| `src/services/SpellcheckExtension.js` | ProseMirror plugin, mapping decoration, sửa bằng transaction |
| `src/services/SourceSpellcheckExtension.js` | CodeMirror state/effects/decoration và sửa source |
| `src/workers/spellcheck.worker.js` | Nạp dictionary, nhận scan/suggest, chia batch, kiểm soát job |
| `src/hooks/useSpellcheck.js` | Điều phối document identity, revision, settings, trạng thái worker |
| `src/components/SpellcheckPopover.jsx` | Gợi ý và thao tác tại vị trí lỗi |
| `src/components/SpellcheckPanel.jsx` | Quét toàn bộ, danh sách lỗi và từ điển cá nhân |
| `electron/spellcheck-store.cjs` | Lưu từ cá nhân cục bộ, ghi nguyên tử và IPC có giới hạn |
| `scripts/prepare-spellcheck-assets.mjs` | Chuẩn bị dictionary + license + manifest vào build |

Hợp đồng scan có `requestId`, `documentId`, `revision`, `locale`, `dictionaryRevision`, `segments`. Mỗi segment có id, văn bản và mapping về editor hoặc field. Kết quả lặp lại các id/revision và chứa lỗi với `segmentId`, `from`, `to`, `original`, `reason: 'not-in-dictionary'`. Không gán phần trăm chắc chắn do từ điển không tạo ra xác suất đáng tin cậy.

Gợi ý được yêu cầu riêng khi mở popup; không gọi `suggest()` cho mọi lỗi trong một lượt quét. Có thể cache theo từ gốc, locale và phiên bản từ cá nhân. Worker chỉ giữ một dictionary locale đang hoạt động; nạp lại khi đổi locale. Tối đa một scan đang chạy và một yêu cầu mới nhất chờ, không tạo hàng đợi dài.

Đơn vị vị trí là UTF-16 theo JavaScript/ProseMirror/CodeMirror. Unicode normalization và thay apostrophe cong bằng thẳng chỉ dùng cho lookup; phải giữ văn bản gốc và mapping, không thay chuỗi tài liệu để tính offset. Kết quả quá hạn khi đổi tài liệu, chỉnh sửa, đổi locale hoặc dictionary được loại bỏ.

## 6. Tách từ và bảo vệ nội dung

Xử lý contraction và possessive: `don't`, `can't`, `can't` với apostrophe cong, `researcher's`; dấu gạch nối kiểm tra cả từ hoặc các thành phần theo quy tắc dictionary được kiểm chứng. Từ bị chia bởi bold/italic trong cùng đoạn phải được ghép để kiểm tra, đồng thời giữ mapping và mark runs.

Bỏ qua URL, email, DOI, đường dẫn, token có số/ký hiệu giống identifier, inline code, codeBlock. Chỉ bỏ qua viết tắt theo quy tắc rõ ràng; không blanket-ignore tất cả chữ hoa. Không cắt một từ có ký tự Unicode thành những mảnh ASCII rồi báo lỗi từng mảnh.

Trong Tiptap, đọc cấu trúc node và marks. Bỏ qua inlineMath/blockMath, citation và crossReference. Không lấy `getText()` rồi suy ngược vị trí từ văn bản phẳng; cách đó dễ lệch quanh atom, bảng và xuống dòng. Nối chuỗi có mapping trong từng textblock; không nối qua math/code/reference atom.

Footnote/caption là attribute; lỗi có đích dạng node-position + attribute, hoặc field-id, và giá trị trước khi sửa. Áp dụng qua cập nhật attribute/settings, không giả lập vị trí inline. Khi người dùng mở field editor, sử dụng cùng engine; bảng lỗi cũng có thể đưa focus vào field đó. Tiêu đề, Abstract, caption và footnote phải được kiểm tra trong mốc A hoàn chỉnh.

## 7. Quét source LaTeX

Bộ quét trạng thái, có stack brace/environment, hỗ trợ escape và recovery. Không dùng một biểu thức regex lớn để xóa LaTeX và kiểm tra phần còn lại.

Phạm vi bắt buộc:

- Bỏ qua `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, môi trường equation/align/gather và các biến thể sao được hỗ trợ.
- Phân biệt `\$` là ký tự dollar với delimiter; `%` mở comment, `\%` là văn bản.
- Bỏ qua comment, verb/verbatim, lstlisting/minted, tên lệnh, label/ref/cite, URL/path, include/input, bibliography và nội dung preamble không nằm trong lệnh văn bản đã hỗ trợ.
- Kiểm tra thân `document` và đối số văn bản của danh sách lệnh có schema rõ: section/subsection/subsubsection, title, caption, footnote, textbf/textit/emph, href với URL bị bỏ qua và nhãn hiển thị được kiểm tra. Đối số tùy chọn phải được phân loại theo từng lệnh.
- Macro chưa biết: ưu tiên bỏ qua các đối số không xác định; không đoán mọi `{...}` là văn xuôi. Thông báo phạm vi chưa hỗ trợ trong hướng dẫn tính năng.
- Source đang gõ chưa đóng ngoặc hoặc môi trường: đánh dấu vùng chưa chắc chắn, bỏ qua vùng đó và khôi phục tại checkpoint an toàn; không sửa cấu trúc source.
- `\text{...}` trong toán: đưa vào sau khi đã có test nested braces và offset; nếu chưa đạt, mốc B công bố rõ vùng này đang bỏ qua.

Khởi đầu quét toàn source trong worker theo batch. Đo hiệu năng ở 800 KiB; nếu không đạt mục tiêu thì bổ sung checkpoint lexer và quét lại từ trước vùng thay đổi đến khi trạng thái hội tụ. Không quét riêng một dòng nếu chưa biết trạng thái math/environment ở đầu dòng.

Sửa source áp dụng transaction của CodeMirror, rồi đi qua luồng `onChange` hiện có để duy trì sourceEdited, lưu và biên dịch. Kiểm tra lại `original`, document identity và revision trước thao tác.

## 8. Sửa từ, undo và trạng thái tài liệu

Decoration và kết quả scan chỉ là trạng thái hiển thị: không thêm mark vào JSON, không ghi vào LaTeX/Word/PDF, không đánh dấu tài liệu đã sửa. Với ProseMirror, transaction cập nhật kết quả có `addToHistory: false` và không thay document. Kiểm tra `onUpdate` hiện có để chắc chắn callback lưu/chuyển chế độ chỉ chạy khi có thay đổi nội dung.

Khi người dùng sửa: xác nhận vị trí còn chứa `original`; transaction chỉ thay phạm vi đó. Từ trải qua nhiều mark runs có quy tắc giữ định dạng được test; có thể phân phối ký tự mới theo các run cũ và cho phần dư kế thừa run cuối. Trường hợp không thể bảo toàn định dạng rõ ràng phải được xử lý có quy tắc, không âm thầm xóa marks cả đoạn.

Sửa một lỗi là một bước undo; không gộp vào lịch sử gõ trước đó. Popup mất hiệu lực khi edit/tab switch làm lỗi không còn khớp. Bỏ qua một lần dựa trên occurrence và mapping trong phiên; bỏ qua cả từ theo tài liệu chỉ tồn tại trong phiên. Thêm vào từ điển cá nhân tồn tại qua khởi động lại và có thể xóa để kiểm tra lại.

Sửa bản thảo đang có source riêng tuân theo hành vi chuyển về source tự sinh hiện có. Kiểm thử và sử dụng thông báo chế độ hiện có; scan và mở popup không được kích hoạt chuyển chế độ.

## 9. Lưu trữ và tương thích

Thiết lập mỗi tài liệu: thêm đối tượng `spellcheck: { enabled: false, locale: 'en-US' }` vào settings được sanitize. Chỉ nhận `en-US`/`en-GB`; tài liệu cũ fallback tắt. Thiết lập đi theo nhân bản, backup và đồng bộ LAN thông qua settings; test các đường sanitize/import/export thực tế.

Từ cá nhân: desktop lưu `spellcheck-v1.json` trong userData qua store riêng, ghi nguyên tử; web dùng LocalDocumentStore với key riêng. IPC chỉ nhận thao tác đã định nghĩa, kiểm tra sender, kiểu dữ liệu và giới hạn, không nhận đường dẫn tùy ý. Nếu có nhiều cửa sổ, main process là nơi ghi duy nhất và phát revision để các renderer làm mới.

Giới hạn dự kiến: 10.000 từ, 64 ký tự mỗi từ, tối đa 1 MiB file nhập; bỏ control characters, newline và slash cú pháp affix để từ cá nhân chỉ là từ literal. Quy tắc case-sensitive và case variants phải được chốt bằng fixture, không lowercase mọi tên riêng một cách mù quáng. Dữ liệu hỏng không chặn mở tài liệu; báo trạng thái từ điển và giữ bản hỏng để xử lý.

Từ điển cá nhân là thiết lập cục bộ, không tự đồng bộ LAN và không tự nằm trong gói `.vls` ở phiên bản đầu. Cung cấp nhập/xuất JSON hoặc TXT rõ ràng để chuyển máy; hướng dẫn phải nêu phạm vi backup này. Thiết lập trong tài liệu vẫn đi theo `.vls`.

Không gửi văn bản đi mạng. Dictionary cần có sẵn từ lần chạy đầu của bộ cài. Lỗi nạp dictionary hoặc worker hiển thị **Không khả dụng**, không kết luận tài liệu không có lỗi và không chặn soạn thảo.

## 10. Hiệu năng và đo chất lượng

Các con số dưới đây là mục tiêu nghiệm thu ban đầu, chưa phải kết quả đo:

| Hạng mục | Mục tiêu |
| --- | --- |
| Thời gian đợi sau gõ | 350 ms, điều chỉnh qua thử nghiệm |
| Thêm chi phí trên main thread khi gõ | P95 dưới 16 ms trên máy kiểm thử, cần ghi cấu hình máy |
| Quét 10.000 từ | Dưới 1 giây sau khi dictionary sẵn sàng |
| Quét 50.000 từ | Dưới 3 giây, có trạng thái đang kiểm tra |
| Gợi ý cho một từ | P95 dưới 250 ms sau khi nạp, nếu chậm UI vẫn phản hồi |
| Bộ nhớ tăng thêm | Mục tiêu dưới 80 MiB cho một locale; đo riêng từ baseline |
| Dictionary/worker | Nạp lười khi bật tính năng, không tải lại mỗi phím gõ |
| Số lỗi hiển thị | Giới hạn 2.000/lượt, báo rõ khi đã chạm giới hạn |

Cache lookup/gợi ý có LRU và giới hạn; không gợi ý hàng loạt khi scan. Worker chạy chia batch để nhận yêu cầu hủy giữa các batch; timeout không chỉ bỏ kết quả mà phải terminate/restart worker nếu engine bị kẹt trong một lệnh đồng bộ. Tắt tính năng hoặc đóng editor phải dọn listener/timer và job.

Tập đánh giá bản đầu: khoảng 500 lỗi gõ có sửa đúng đã gán nhãn; ít nhất 10.000 token tiếng Anh đúng thông dụng; thêm corpus khoa học/toán, tên riêng, acronym và các ví dụ LaTeX. Tách mẫu phát triển và mẫu nghiệm thu; tránh chỉ đo các lỗi đã hard-code.

Mục tiêu trên corpus đã thống nhất: phát hiện ít nhất 95% lỗi gõ ngoài từ điển; sửa đúng xuất hiện trong 5 gợi ý ở ít nhất 85% trường hợp có đáp án duy nhất; tỷ lệ báo nhầm dưới 1% trên từ thông dụng đúng. Đo riêng thuật ngữ chuyên ngành, không gộp rồi tuyên bố chính xác chung. Vùng được bảo vệ phải có 0 thay đổi nội dung và 0 lỗi đánh dấu trong fixture bắt buộc.

## 11. Các giai đoạn và đầu ra

| Giai đoạn | Công việc | Điều kiện hoàn thành | Ước lượng công sức |
| --- | --- | --- | --- |
| 0. Thử nghiệm engine | Dependency, asset/license, worker production, corpus nhỏ, đo sơ bộ | EN-US/EN-GB hoạt động offline trong web và Electron; chốt engine | 0,5–1 ngày |
| 1. Lõi | Tokenizer, cache, revision, worker batching, settings, test core | Lookup/suggest, case/apostrophe, cancellation và stale results đúng | 1–1,5 ngày |
| 2. Bản thảo chính | Segment mapping, Tiptap decoration, popup, replace/undo | Gạch chân/sửa trong đoạn, tiêu đề, bảng; giữ math/code/cite/marks | 1–2 ngày |
| 3. Mốc A hoàn chỉnh | Panel, personal dictionary/store, Abstract/caption/footnote/title, lưu/khôi phục | Mọi vùng văn bản trong phạm vi A được kiểm tra; UI và storage qua test | 1–1,5 ngày |
| 4. Source LaTeX | Lexer, CodeMirror extension, popup, source mode, fixture macro | Mốc B hoạt động, source protection và undo qua test | 1,5–2,5 ngày |
| 5. Nghiệm thu | Corpus, benchmark, regression, production Windows/macOS, hướng dẫn | Đạt ngưỡng hoặc ghi rõ điều chỉnh phạm vi có chứng cứ | 1–1,5 ngày |

Tổng dự kiến: **6–10 ngày công** cho cả hai mốc, tùy kết quả engine/lexer và môi trường kiểm thử. Đây là ước lượng công sức của một người phát triển, không cam kết thời gian chạy của agent. Mốc A có thể nghiệm thu trước sau giai đoạn 3. Không cần API AI hoặc phí dịch vụ cho phạm vi này.

Mỗi giai đoạn cập nhật trạng thái và kết quả trong tài liệu này hoặc nhật ký triển khai; không coi một checkbox hoàn tất nếu chưa có test/đầu ra tương ứng.

## 12. Ma trận kiểm thử và lệnh kiểm tra

Các suite mới dự kiến: `scripts/spellcheck.test.mjs`, `scripts/spellcheck-segments.test.mjs`, `scripts/latex-spellcheck.test.mjs`, `scripts/spellcheck-ui.mjs`, `electron/spellcheck-store.test.cjs`. Thêm npm scripts `test:spellcheck` và `test:spellcheck:ui` khi có mã.

Kiểm thử bắt buộc:

- `recieve`, `teh`, `seperate`, `occured`; từ đúng, contraction, possessive, smart apostrophe, gạch nối, uppercase và EN-US/EN-GB.
- Emoji/Unicode trước lỗi, CRLF/LF, từ bị chia bởi marks, nhiều lỗi giống nhau, paragraph/table/atom boundaries.
- Math/code/URL/email/DOI/cite/ref/label không có lỗi giả; các trường title/Abstract/caption/footnote được phát hiện.
- Sửa đúng occurrence, undo/redo, typing composition, popup keyboard/focus, theme sáng/tối, panel thu hẹp.
- Gõ trong khi worker quét, đổi tab/locale, document reload, từ cá nhân thêm/xóa từ cửa sổ khác: không áp dụng kết quả cũ.
- Source có math nhiều dòng, escape dollar/percent, comment, verbatim, môi trường lồng, optional args, macro chưa biết và cú pháp chưa đóng.
- Bật/tắt hoặc scan giữ JSON nội dung, trạng thái saved và sourceEdited; sửa mới thay nội dung. Decoration không lọt vào Word/PDF/LaTeX.
- Tài liệu cũ, duplicate, `.vls`, restore, LAN settings, personal dictionary restart/corruption/import limits.
- Worker/dictionary lỗi, không mạng, production `vietlatex://`/CSP và source sát 800 KiB.

Chạy unit suite mới theo từng giai đoạn. Khi tích hợp xong chạy `npm run lint`, unit chính tả, `npm run build`, UI chính tả, rồi `npm run check` theo yêu cầu repo. Chạy các suite hiện có liên quan: rich-text/document-data/serializer, project-compilation, citation, upgrade/workspace, UI và desktop; kiểm tra smoke PDF/Word thật khi thay đường xuất/lưu. Dùng hồ sơ test riêng.

Windows production có thể kiểm tra tại máy hiện tại. macOS cần môi trường macOS để build/run bộ cài; nếu chưa có thì ghi trạng thái chưa xác minh, không suy ra đã đạt từ unit tests Windows. Nếu baseline repo có lỗi không liên quan, ghi baseline và ảnh hưởng thay vì nhận đó là lỗi tính năng mới hoặc bỏ qua âm thầm.

## 13. Rủi ro và xử lý

| Rủi ro | Cách xử lý |
| --- | --- |
| Thuật ngữ/tên riêng thiếu trong dictionary | Personal dictionary, corpus chuyên ngành, danh sách bổ sung nhỏ có nguồn và test |
| nspell/asset không tương thích worker build | Thử nghiệm ở giai đoạn 0, wrapper engine độc lập, không import filesystem vào renderer |
| Source parser không biết macro riêng | Allowlist lệnh văn bản, bỏ vùng không chắc chắn, công bố giới hạn |
| Vị trí lỗi lệch sau sửa hoặc đổi tab | documentId/revision/dictionaryRevision, transaction mapping và kiểm tra original trước sửa |
| Gợi ý tốn CPU | Gợi ý theo yêu cầu, cache, giới hạn token, worker batching và restart timeout |
| Scan làm tài liệu dirty/chuyển source mode | Decoration/meta-only state; regression onUpdate/sourceEdited/saved |
| Chữ giữa các marks hoặc text attributes bị bỏ sót | Segment mapping và adapter field/node attribute riêng |
| Thay dependency hoặc giấy phép dictionary | Pin lockfile, manifest/checksum/license của từng bộ |

## 14. Tiêu chí nghiệm thu cuối

- EN-US và EN-GB hoạt động cục bộ từ lần chạy đầu; lựa chọn được lưu theo tài liệu.
- Phát hiện, gợi ý, sửa, bỏ qua, thêm/xóa từ cá nhân và quét toàn tài liệu hoạt động trong phạm vi đã định nghĩa.
- Bảo toàn công thức, cấu trúc LaTeX, citation, labels, marks và undo; chỉ thao tác sửa do người dùng chọn mới thay nội dung.
- Đạt các mục tiêu chất lượng/hiệu năng trên corpus và cấu hình máy được ghi lại, hoặc có điều chỉnh phạm vi được giải thích bằng kết quả đo.
- Test tập trung và kiểm tra hồi quy liên quan đạt; production offline/CSP được kiểm tra theo từng nền tảng.
- Có hướng dẫn sử dụng, giới hạn grammar/context/macros, cách chuyển từ cá nhân giữa máy và ghi chú thay đổi.
- Có thể tắt tính năng mà tài liệu vẫn mở, sửa, biên dịch và xuất bình thường; không cần migration phá vỡ schema nội dung.

Phần mở rộng sau nghiệm thu: kiểm tra ngữ cảnh/grammar có bật riêng, phân đoạn ngôn ngữ và các dictionary chuyên ngành. Chỉ chọn engine và dịch vụ cho phần mở rộng sau khi đánh giá nhu cầu, dữ liệu và chi phí; không đưa dependency đó vào hai mốc đầu.
