# Giao thức backend Go trên macOS

Backend được Electron khởi chạy với `--listen=127.0.0.1:0`. Biến môi trường `VIETLATEX_API_TOKEN` chứa token riêng, ít nhất 32 ký tự; Electron tạo token ngẫu nhiên cho từng tiến trình. Backend xóa biến này trước khi chạy TeX/Pandoc. `VIETLATEX_PARENT_PID` giúp backend dừng khi Electron mất đột ngột.

Backend gửi một dòng JSON kết thúc bằng newline trên stdout:

```json
{"event":"ready","address":"127.0.0.1:4317"}
```

Địa chỉ/cổng thực tế lấy từ dòng này. Log ở stderr. Mọi request cần header `X-Vietlatex-Token`; thiếu/sai token trả 401. Origin ngoài localhost bị từ chối với 403. API chỉ bind loopback.

| Route | Request | Response thành công |
|---|---|---|
| `GET /api/health` | Không có body | JSON trạng thái, hàng đợi, cache và bộ nhớ |
| `GET /api/environment` | Không có body | JSON `compiler` và `word`, gồm `available`/`version` |
| `POST /api/cache/clear` | `{}` | JSON thống kê xóa cache |
| `POST /api/compile` | JSON `latex`, `images`, `assets`, `fresh` | Byte PDF, `application/pdf` |
| `POST /api/word/import` | Byte DOCX, MIME Word | Pandoc JSON AST trực tiếp |
| `POST /api/word/export` | Pandoc JSON AST trực tiếp | Byte DOCX, MIME Word |
| `POST /api/latex/parse` | Source UTF-8, `text/plain` | Pandoc JSON AST trực tiếp |
| `POST /api/doi` | JSON `{"doi":"10.1038/s41586-020-2649-2"}` | JSON `{"bibtex":"..."}` |
| `POST /api/shutdown` | `{}` | JSON xác nhận, sau đó dừng dịch vụ |

`images` và `assets` là mảng `{filename, data}`; `data` là base64 của byte tệp, không có tiền tố data URL. `images` dùng tên `image-N.png`/`image-N.jpg`. Trích dẫn nằm trong tài nguyên `.bib`. `id` từ Electron dùng để quản lý việc hủy ở phía client, không tham gia nội dung biên dịch. `fresh: true` bỏ qua cache.

Word dùng `pandoc-api-version`, `meta`, `blocks`; export hỗ trợ thêm `_bibliography` (BibTeX) và `_citationStyle`. Backend loại hai trường riêng này trước khi gửi AST tới Pandoc và dùng CSL nhúng. IPC bọc kết quả nhập thành `{ast}`, xuất thành `{bytes}`; đây là wrapper của Electron, không phải body HTTP.

Lỗi trả JSON `{error, log?, line?}`; mã trạng thái nằm ở HTTP, không bắt buộc có trường `status` trong JSON. Các mã chính: 400 dữ liệu sai, 413 vượt dung lượng, 422 lỗi TeX/Pandoc, 503 chưa có công cụ/đang quá tải/đang dừng, 504 hết thời gian biên dịch. 503 kèm `Retry-After: 3`. Hủy phía client dùng đóng kết nối/AbortSignal.

Giới hạn hiện tại: source 800 KiB; body JSON 40 MiB; tổng body đang xử lý 40 MiB; nhập Word 25 MiB; DOI body 4 KiB và phản hồi metadata 256 KiB. Ảnh bản thảo vẫn giới hạn 8 ảnh/450 KiB mỗi ảnh; tài nguyên dự án 100 tệp, 10 MiB/tệp, tổng 24 MiB. Xem hằng số trong `backend/internal/service` khi thay đổi giới hạn.

Runtime 0.5.6 dùng XeLaTeX/BibTeX/Biber trong TeX Live/TinyTeX đóng gói và Pandoc universal. Có thể chỉ định `XELATEX_PATH`/`PANDOC_PATH`; cache TeX nằm ngoài `.app`. Tectonic mô tả trong báo cáo ban đầu không còn là runtime của checkout này. PDF/Word xử lý cục bộ; tra DOI cần mạng và gửi DOI tới resolver.

Giao thức này được đối chiếu với mã client/frontend hiện tại và kiểm thử HTTP/backend thực tế. Không có binary/mã nguồn bản gốc Windows trong checkout để chứng nhận tương đương từng hành vi của bản gốc.
