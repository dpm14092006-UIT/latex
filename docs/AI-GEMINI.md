# Trợ lý AI (Google Gemini)

Có trong app trên macOS và Windows. Môi trường thử giao diện trên trình duyệt (`npm run dev`, chỉ dùng khi phát triển) không có trợ lý, vì API key cần kho khóa của hệ điều hành.

## Vì sao cần API key, không dùng được gói Gemini/ChatGPT Plus/Claude Pro

Các gói trả phí trong ứng dụng của Google, OpenAI và Anthropic chỉ dùng trên web/app của từng hãng, không cấp quyền cho ứng dụng khác. Ứng dụng bên ngoài phải gọi qua API key, tính phí riêng theo lượng dùng. Gemini có hạn mức miễn phí trong Google AI Studio. Ở mức miễn phí, Google có thể dùng nội dung gửi lên để cải thiện dịch vụ, nên đừng gửi tài liệu nhạy cảm.

## Cài đặt

1. Mở **Quản lý → Trợ lý AI → Mở Google AI Studio**, tạo API key.
2. Dán key, bấm **Kiểm tra và lưu**. App gọi thử danh sách model để xác nhận key trước khi lưu.
3. Mặc định chọn model Flash ổn định mới nhất; có thể đổi trong ô **Model**.

Key được mã hóa bằng `safeStorage` của Electron (Keychain trên macOS, DPAPI trên Windows) và lưu tại `ai-v1.json` trong thư mục dữ liệu app. Giao diện không đọc lại được key. Key chỉ gửi trong header `x-goog-api-key` tới `generativelanguage.googleapis.com`, không nằm trong URL, và app không đi theo redirect. **Xóa API key** xóa tệp này.

Tệp chỉ giải mã được bằng tài khoản hệ điều hành đã tạo nó. Chuyển máy, đổi tài khoản, hoặc khôi phục sao lưu sang máy khác thì phải nhập lại key. Key không nằm trong gói `.vls` và không đi qua đồng bộ LAN.

## Sử dụng

Bấm **Trợ lý AI** trên thanh công cụ (cạnh Chính tả tiếng Anh):

| Thao tác | Nội dung gửi đi | Kết quả |
| --- | --- | --- |
| Viết lại văn phong học thuật, Sửa ngữ pháp, Dịch Anh/Việt | Vùng chọn, hoặc đoạn đang đặt con trỏ | **Thay vùng đã chọn** (một bước hoàn tác) hoặc sao chép |
| Tóm tắt thành Abstract | Vùng chọn, hoặc toàn bộ bản thảo nếu không chọn gì | **Đặt làm Abstract** |
| Giải thích lỗi biên dịch | Thông báo lỗi XeLaTeX gần nhất kèm khoảng 12 dòng source quanh dòng lỗi | Chỉ đọc/sao chép |

Trước khi gửi, panel ghi số ký tự sẽ gửi; mở **Sẽ gửi …** để xem đúng nội dung. Không có gì được gửi đi cho đến khi bấm **Gửi tới Gemini**.

Công thức, trích dẫn, tham chiếu và chú thích được gửi dưới dạng LaTeX (`$x^2$`, `\cite{key}`, `\ref{label}`, `\footnote{…}`). Khi thay, chúng được dựng lại thành node công thức/trích dẫn thật; đoạn trống phân tách đoạn văn, `\[...\]` riêng một đoạn thành công thức hiển thị. Trong chế độ LaTeX, vùng chọn source được thay nguyên văn. Nếu tài liệu đã đổi sau khi gửi, app từ chối thay và yêu cầu chọn lại.

Giới hạn: 20.000 ký tự mỗi lần, chờ tối đa 90 giây, có nút **Hủy**. Lời nhắc của từng thao tác cố định trong tiến trình chính; giao diện chỉ chọn thao tác, không gửi lời nhắc tùy ý bằng key của bạn.

## Kiểm tra

- `npm run test:ai`: module Gemini (mã hóa key, header, lỗi key/hạn mức/mạng/hủy, chọn model) và chuyển đổi vùng chọn ↔ node.
- `npm run test:ai:desktop`: chạy app Electron với máy chủ Gemini giả cục bộ (`VIETLATEX_TEST_GEMINI_API`, chỉ có hiệu lực khi chưa đóng gói). Kiểm tra nhập key, báo key sai, gửi đoạn có công thức, thay và hoàn tác. Đặt `AI_DESKTOP_SHOW=1` để hiện cửa sổ và lưu ảnh vào `artifacts/ai-desktop/`.

## Mở rộng sau

ChatGPT (OpenAI) và Claude (Anthropic) cũng dùng API key theo cùng mô hình. `electron/gemini.cjs` giữ phần lưu key và danh sách thao tác; khi thêm hãng mới, tách phần gọi HTTP thành từng provider và dùng lại giao diện.
