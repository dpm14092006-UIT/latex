# TEST 2 — Bàn giao sửa validation dữ liệu
Ngày: 2026-10-20. Dự án: App gõ chuyển thành latex / Viet LaTeX Studio.

## Kết quả
Đã sửa một điểm yếu trong validation khóa trích dẫn/tham chiếu ở `src/services/DocumentData.js`; thêm regression test riêng trong `scripts/document-reference-validation.test.js`.
Cả hai file có receipt `saved=true` và đã được đọc lại, so khớp toàn bộ nội dung đã ghi.
Chưa chạy bất kỳ test, lint hay lệnh thực thi nào. Không có receipt thực thi và không tuyên bố test pass.

## Phạm vi đã đọc
Đọc README.md và ARCHITECTURE.md trước khi đọc source. Các file đã đọc đầy đủ thành công:

1. `README.md`
2. `ARCHITECTURE.md`
3. `package.json`
4. `src/components/SourceEditor.jsx`
5. `src/components/DocumentDialogs.jsx`
6. `src/math-input.js`
7. `src/unicode-scripts.js`
8. `src/services/MathNodeTransforms.js`
9. `src/services/DocumentData.js` (trước và sau sửa)
10. `src/services/DocumentLimits.js`
11. `src/services/AcademicNodes.js`
12. `src/services/ProjectAssets.js`
13. `src/services/RichTextFormats.js`
14. `src/services/DocumentSpacing.js`
15. `src/services/WorkspaceData.js`
16. `scripts/document-reference-validation.test.js` (test mới, đọc lại sau lưu)

Đã liệt kê `src` và `scripts` với limit 100; kết quả không báo còn trang. Tuy nhiên danh sách của công cụ lọc loại file: danh sách `scripts` không hiển thị các test .mjs mà package.json tham chiếu. Không coi danh sách này là bằng chứng không có các test đó.

Các lần đọc chưa thành công:
- `scripts/math-input.test.mjs`, `scripts/document-data.test.mjs`: công cụ báo `unsupported_file` (“This file type is not supported by project tools.”).
- `src/services/DocumentSerializer.js`: công cụ báo không hoàn tất, thông báo chung về phạm vi/quyền/giới hạn; không có nội dung để rà soát.
- Lần liệt kê `src` và `scripts` với limit 250 báo lỗi chung; gọi lại limit 100 thành công.

Không đọc .env, user-data, credential, node_modules, build hoặc release. Không dùng shell, không cài package, không thay cấu hình bảo mật/tài khoản, không xóa file, không tạo bộ cài. Không dùng worker.

## Luồng đã đối chiếu từ source
- Nhập source: SourceEditor dùng CodeMirror transactionFilter gọi acceptsSourceEdit; DocumentLimits đo UTF-8, giới hạn 800 KiB và cho phép giảm source cũ quá lớn.
- Nhập công thức: FormulaDialog có chế độ trực quan/LaTeX/gõ thường, xem trước qua renderer; math-input xử lý delimiter, Unicode chỉ số, nội dung văn bản và chuẩn hóa công thức.
- Sửa công thức: MathNodeTransforms cập nhật node inline/block và xử lý đoạn văn lân cận khi chuyển kiểu.
- Validation: DocumentData kiểm tra cấu trúc node, attrs, công thức, ảnh, trích dẫn và tham chiếu. WorkspaceData gọi isValidDocument khi nạp/sửa chữa bản thảo; AcademicNodes tạo các thuộc tính trích dẫn/tham chiếu dạng chuỗi.

Đây là rà soát tĩnh có giới hạn, không phải xác minh toàn bộ luồng nhập → serializer → PDF. Chưa đọc main.jsx, formula-recognition.js, backend hoặc toàn bộ scripts.

## Phát hiện và trước/sau
Ba trường `citation.attrs.key`, `citation.attrs.sourceParts[].key` và `crossReference.attrs.target` chỉ được kiểm tra bằng RegExp.test với fallback `|| ''`, chưa kiểm tra kiểu string.

RegExp.test tự ép kiểu: số 123 thành "123", true thành "true", mảng ["ref-a"] thành "ref-a"; cả ba chuỗi đều hợp regex. Vì vậy JSON sai kiểu có thể được đánh dấu hợp lệ và đi vào bước xử lý tài liệu tiếp theo. Một object JSON như {"toString":"ref-a"} còn có thể làm phép ép kiểu ném TypeError thay vì trả false.

Ví dụ bản thảo gồm doc → paragraph → citation với attrs.key = 123:
- Trước: qua kiểm tra khóa vì regex kiểm tra chuỗi "123".
- Sau: trả false vì key không phải string.
- attrs.key = "123" vẫn hợp lệ.

Đây là kết luận từ đọc mã và ngữ nghĩa JavaScript, chưa phải kết quả chạy test. Không khẳng định đã tái hiện lỗi UI hoặc lỗi biên dịch.

Bản sửa thêm điều kiện typeof === 'string' trước regex tại đúng ba trường. Giữ nguyên regex, tập ký tự, giới hạn 100 ký tự/khóa, tối đa 50 khóa citation và một target crossReference. Không tự ép kiểu hoặc sửa dữ liệu.

Tương thích: chuỗi hợp lệ và các trường tùy chọn giữ nguyên quy tắc. JSON sai kiểu trước đây lọt validation nay bị từ chối; khi nạp qua WorkspaceData, nó có thể đi qua nhánh sửa chữa hiện có và loại node không hợp lệ. Hành vi phục hồi này chưa được kiểm thử tích hợp.

## File đã sửa/tạo
| File | Thay đổi |
| --- | --- |
| src/services/DocumentData.js | Sửa đúng ba điều kiện validation, thêm kiểm tra string |
| scripts/document-reference-validation.test.js | Thêm 9 test qua node:test, dùng node:assert/strict |
| docs/AGENT-AI-ACCEPTANCE-20261020.md | Báo cáo bàn giao này |

Receipt ghi source:
- Trước: SHA-256 `c11a5981e67ba7ba735daf18e316a1de05b50116b87e279acef04e76f6dce1b7`.
- Sau: SHA-256 `0aa928ef085e42644ba771c64f0d45427d22227e68ddf22d10925c00226a9fee`, saved=true.
- Test mới: SHA-256 `444f01881917d5ba4a468e35d17d130219539a2d44eefe3b5b6d9db97ab86350`, saved=true.
- Đọc lại source và test khớp nội dung dự kiến; đây là kiểm tra lưu file, không phải receipt chạy test.

## Regression test và lệnh cần chạy ngoài
Test mới kiểm tra:
- Cả ba trường từ chối number, boolean, array, object, null và undefined; exception sẽ làm test thất bại.
- Vẫn nhận chuỗi "123", "true", khóa chứa dấu cho phép và khóa dài đúng 100 ký tự.
- Vẫn từ chối rỗng, ký tự không hợp lệ, khóa quá 100 ký tự.
- Citation và sourceParts vẫn nhận 50 khóa, từ chối 51; crossReference từ chối nhiều target.
- Validation không sửa đầu vào hợp lệ.

Chạy từ thư mục gốc dự án với Node theo README (Node 24 LTS). Các lệnh sau chỉ là bàn giao, CHƯA CHẠY:

```text
node --test scripts/document-reference-validation.test.js
node --test scripts/document-reference-validation.test.js scripts/document-data.test.mjs scripts/math-input.test.mjs scripts/math-node-transforms.test.mjs
npm run lint
```

Lệnh đầu chạy riêng 9 test mới, không cần thêm package. Lệnh thứ hai là kiểm tra mở rộng cùng các suite đã được package.json liệt kê; nội dung .mjs chưa đọc được nên chưa xác minh yêu cầu môi trường/tác dụng phụ của chúng.
Không đổi package.json: test mới chưa được thêm vào danh sách tường minh của test:backend/check; cần chạy bằng lệnh trên.

Để xác nhận regression trước/sau ở môi trường kiểm chứng riêng: giữ test mới, chạy với DocumentData trước sửa rồi chạy lại với bản đã sửa. Dự kiến ba test từ chối sai kiểu thất bại trên bản cũ và vượt qua trên bản mới; đây chưa phải kết quả thực thi.

## Chưa kiểm chứng
- Test/lint, khả năng nạp module ở runtime, UI và quá trình phục hồi workspace.
- Nhập/dán với IME tiếng Việt, undo/redo, render KaTeX/MathLive, serialize LaTeX và xuất PDF/Word.
- Tương tác với test .mjs hiện có và nội dung DocumentSerializer bị chặn đọc.
- Không có đánh giá toàn bộ repository hay chứng nhận không còn lỗi ngoài phạm vi trên.

## TEST 2 — Kiểm chứng mở rộng sau bàn giao

Host đã chạy `npm run check`: lint, spellcheck14, AI10, Go vet/unit qua. `test:backend` có 210 pass, 3 fail, 2 skip. Ba failure ở `scripts/citation-linker.test.mjs` dòng 113, 332, 343 bản trước sửa. Đây là kết quả **host báo**, agent không chạy shell hoặc test. Kết quả chạy lại sau sửa đang chờ host.

Đã đọc toàn bộ `scripts/citation-linker.test.mjs`, `src/services/CitationLinker.js`, `src/services/AcademicNodes.js`, `src/services/DocumentData.js`, `src/services/CitationEditing.js` và báo cáo này; đã liệt kê `scripts` và `src/services`. Hai lần đọc `src/services/DocumentSerializer.js` đều bị công cụ chặn với lỗi chung về phạm vi/quyền, nên chưa tự xác minh nhánh serializer hay kết quả xuất LaTeX. Không coi đây là rà soát toàn bộ source. Thông tin serializer dùng `sourceParts` là quan sát do host cung cấp.

Nguyên nhân ba failure: schema citation rút gọn trong test chỉ khai báo `key/mode`. ProseMirror loại bỏ attrs `sourceText/sourceParts` do `linkCitationTransaction` tạo, rồi assertion cũ đòi locator xuất hiện trong `textContent` hoặc text node liền kề. Schema sản phẩm trong `AcademicNodes.js` khai báo cả `sourceText` và `sourceParts`; `CitationLinker.js` đưa locator vào từng `sourceParts[].suffixText` cùng `separatorBefore` theo thứ tự nguồn. Đây là lỗi fixture/assertion, chưa có bằng chứng mất locator trong node sản phẩm.

Chỉ sửa `scripts/citation-linker.test.mjs`: bổ sung hai attrs đúng schema sản phẩm; kiểm tra grouped citation là một node có `sourceText` gốc và `sourceParts` theo thứ tự Smith `pp. 2–4`, Lee `p. 9`; kiểm tra undo trả lại document gốc và redo giữ nguyên metadata; kiểm tra narrative `p. 6` và parenthetical `pp. 14–16` trong `sourceParts`, đồng thời giữ phần văn xuôi kế tiếp. Không sửa `CitationLinker.js`, `DocumentData.js` hoặc `scripts/document-reference-validation.test.js`. Các câu trong phần báo cáo cũ nói “chưa chạy test” phản ánh thời điểm trước khi host chạy check; kết quả host ở mục này cập nhật trạng thái đó.

Cần host chạy lại `npm run check` để xác nhận. Chưa có receipt thực thi sau sửa hoặc xác minh serializer/PDF.


## Host xác nhận cuối — 20/10/2026

Sau các bản sửa qua prompt và diff approval trong AGENT AI, host đã chạy npm run check thành công (exit 0): lint, spellcheck 14, AI 10, Go vet/unit, backend 213 pass/2 skip, sync 27, updater 14, upgrade 20 và production build. Tổng Node: 298 passed/2 skipped. Test regression mới đã được nối vào test:backend trong package.json. Các câu chưa chạy/chưa nối package ở trên là lịch sử trước các lượt tiếp tục.

Host cũng chạy đối chiếu baseline HEAD với bản hiện tại: numeric citation key, boolean grouped key và array cross-reference target đều được bản cũ nhận sai, bản mới từ chối; chuỗi hợp lệ vẫn được giữ. Log và JSON trước/sau ở E:/AGENT AI/docs/evidence/manual-ui-20261019. Đây là kết quả chạy của host, không phải model tự tuyên bố đã chạy shell. Chưa nghiệm thu thao tác IME, PDF/Word hoặc toàn bộ UI của Viet LaTeX Studio; DocumentSerializer.js vẫn vượt giới hạn đọc 64.000 bytes của công cụ.
