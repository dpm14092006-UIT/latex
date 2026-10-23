# Nhật ký thay đổi — Viet LaTeX Studio

Mới nhất ở trên. Workspace v1 và giao thức LAN v1 được giữ qua mọi phiên bản dưới đây; nâng cấp không cần chuyển đổi tệp hay ghép máy lại.

## Chưa phát hành

## 0.6.3 — sửa đường kẻ bảng và công thức có số

- Biên dịch lại longtable để đường kẻ đủ độ rộng; bảng chưa chọn kiểu mặc định kẻ lưới.
- Render riêng công thức display/inline, giữ `\tag{1}` ở bản thảo thay vì hiện mã nguồn.
- Chi tiết: [UPGRADE-0.6.3](UPGRADE-0.6.3.md).

## 0.6.2 — tối ưu backend và sửa lỗi vòng tiếp theo

- Tra PDF cache trước giải mã tệp đính kèm; không lưu kết quả của tác vụ đã hủy. Đưa xử lý AST xuất Word vào worker và bỏ bản sao thừa đầu ra Pandoc.
- Giữ văn bản khi phục hồi định dạng lỗi; sửa text rỗng, danh sách Word và mark code lồng liên kết/in đậm.
- Chặn AI áp kết quả source cũ; tháo DMG khi mount thất bại hoặc bị hủy.
- Chi tiết và phạm vi đo hiệu năng: [UPGRADE-0.6.2](UPGRADE-0.6.2.md).

## 0.6.1 — rà soát hệ thống và bảo toàn dữ liệu

- Nâng khung cấu trúc thành tìm kiếm toàn bản thảo và tải thêm; sửa ngăn điều hướng mobile giữ khóa vùng soạn thảo sau khi chạy lệnh.
- Chặn nhập sao lưu bị mất dữ liệu do chuẩn hóa; giữ nội dung Word trong chú thích, ảnh trùng tên khác thư mục và các ô gộp bảng lớn.
- Sửa trạng thái cập nhật khi kiểm tra lại/tải/cài đồng thời; sao lưu nguyên tử và khôi phục app cũ khi xác minh bản thay thế thất bại.
- Đưa kiểm tra DOCX vào worker có hỗ trợ hủy; tăng kiểm tra dữ liệu gốc trước nâng cấp.
- Chi tiết: [UPGRADE-0.6.1](UPGRADE-0.6.1.md).

- **Khung tài liệu trực quan**: mở từ biểu tượng cấu trúc trên thanh trên hoặc bảng lệnh; sơ đồ các tiêu đề, đoạn văn, bảng, ảnh và công thức cập nhật theo bản thảo, đánh dấu khối đang chọn và cho phép bấm để đến đúng vị trí. Màn hình rộng dùng khung bên cạnh, màn hình nhỏ dùng ngăn có hỗ trợ bàn phím.
- **Trang & lề**: sơ đồ khổ giấy và vùng in với tiêu đề, tác giả, Abstract, mục lục; chỉnh A4/A5/Letter, lề, cỡ chữ, giãn dòng ngay trong khung. Lưu cùng thiết lập tài liệu; khóa chỉnh khi xem Tổng hợp hoặc PDF đang lấy source LaTeX riêng. Sơ đồ chỉ minh họa bố cục, phân trang thật vẫn xem ở Bản in.
- Tích hợp công cụ tinh gọn và hướng dẫn phím tắt F1 từ commit `dcf2879`, giữ các cải tiến cục bộ về caption bảng/ảnh và đồng bộ project.

## 0.6.0 — đồng bộ project và giao diện gọn hơn

- Đồng bộ từng project bằng mã qua Internet; có phê duyệt thiết bị, mã hóa, xử lý xung đột, PDF, ưu tiên LAN và nối lại khi offline. Cần cấu hình máy chủ HTTPS để dùng khác mạng.
- Nút **Đồng bộ** trên thanh công cụ và trong bảng lệnh. Bỏ khối thống kê/thời gian đọc lặp ở thanh bên.
- Sửa PATH Windows khi kiểm tra/chạy khác nền tảng; chống đường dẫn MiKTeX trùng do khác cách viết.
- Kiểm tra gói ứng dụng có đầy đủ dịch vụ mới và chạy ghép hai app đóng gói, tránh trường hợp mã nguồn đã cập nhật nhưng ứng dụng đã cài vẫn thiếu tính năng.
- Chi tiết: [UPGRADE-0.6.0](UPGRADE-0.6.0.md).

### Các cải tiến đã tích lũy trước 0.6.0

- **Backend và giao diện gọn hơn**: web và desktop dùng chung logic khởi động/dừng backend; hủy khởi động và request không để lại tiến trình, shutdown có giới hạn chờ và được gộp khi gọi đồng thời. Giữ đúng HTTP status khi backend trả lỗi JSON rỗng; không gửi token qua redirect và kiểm tra cổng trong tín hiệu ready. Backend từ chối yêu cầu khi đang dừng và kiểm tra Origin chặt hơn.
- **PDF**: **Cập nhật PDF** và **Thử lại** biên dịch mới tài liệu hiện tại; bỏ nút xóa toàn bộ cache trong Hệ thống cùng API/IPC riêng. Biên dịch tự động vẫn dùng cache. Bảng Hệ thống đọc đúng môi trường web và chỉ hiện hướng dẫn cài công cụ đang thiếu.
- **Điều hướng**: giữ một nhóm chọn chế độ Soạn thảo / Soạn + PDF / LaTeX / Bản in; thanh quy trình chỉ báo trạng thái source và PDF. Bỏ tùy chọn thử nghiệm đổi vị trí thanh chế độ trên/dưới.

- **Chính tả tiếng Anh**: hai từ điển Anh Mỹ/Anh Anh cục bộ, quét bản thảo và source LaTeX trong worker, gạch chân và tối đa 5 gợi ý, sửa/undo, bỏ qua, từ điển cá nhân có nhập/xuất. Có kiểm tra title, Abstract, caption ảnh/bảng và footnote; bảo vệ công thức/citation/code và cấu trúc source. Thiết lập lưu theo tài liệu; từ cá nhân ghi nguyên tử riêng trong userData. Xem [ENGLISH-SPELLCHECK.md](ENGLISH-SPELLCHECK.md).

- **Trợ lý AI Gemini**: nhập API key Google AI Studio trong **Quản lý → Trợ lý AI**; key mã hóa bằng Keychain/DPAPI, chỉ tiến trình chính giữ. Viết lại học thuật, sửa ngữ pháp, dịch Anh/Việt, tạo Abstract, giải thích lỗi XeLaTeX. Xem trước nội dung gửi đi; khi thay giữ nguyên công thức, trích dẫn, tham chiếu và hoàn tác được một bước. Xem [AI-GEMINI.md](AI-GEMINI.md).
- **Backend**: thêm fuzz test cho đường dẫn tài nguyên, base64, gói Word, năm in Crossref và cắt chuỗi UTF-8. Chặn thêm tên tệp Windows dành riêng `CONIN$`, `CONOUT$`, `COM¹–³`, `LPT¹–³` và dạng có dấu cách như `CON .png`.

- **Chính tả — sửa lỗi**: từ cá nhân được chấp nhận ở dạng VIẾT HOA TOÀN BỘ (tiêu đề), giống từ điển chuẩn. Kết quả quét đến trễ so với nội dung đang gõ không còn tạo gạch chân sai vị trí hoặc gây lỗi trình soạn thảo; chỉ đánh dấu những vị trí còn đúng từ đã quét.

- **LAN tự tìm lại máy chủ đổi IP**: máy nhận gửi UDP broadcast (cổng 47862) khi mất kết nối; chỉ máy chủ giữ khóa ghép trả lời được (HMAC-SHA256). Không cần tạo mã ghép mới sau khi router cấp lại địa chỉ. Địa chỉ mới được giữ cả khi phần còn lại của lượt đồng bộ/xử lý xung đột thất bại.
- **Ngủ/thức**: request đang chạy được hủy khi máy ngủ, đồng bộ lại ngay khi thức. Tùy chọn **Giữ máy này không ngủ khi làm máy chủ** (mặc định tắt).
- **Windows**: bảng LAN đọc loại mạng và quy tắc tường lửa của app, báo khi Windows Firewall chặn hoặc chưa cho phép, có nút mở trang cài đặt. Danh sách địa chỉ máy chủ xếp Wi-Fi/Ethernet trước, đánh dấu địa chỉ ảo của WSL/Hyper-V/VirtualBox/VPN.
- **Backend (macOS và Windows)**: mỗi lệnh XeLaTeX/BibTeX/Pandoc chạy trong một vùng chứa cả cây tiến trình (process group trên macOS, Job Object trên Windows). Hủy dừng cả helper mồ côi; lệnh xong thì helper còn sót cũng bị dừng; trên Windows backend chết thì tiến trình con cũng dừng. Xóa thư mục làm việc thử lại khi file còn bị antivirus/indexer giữ.

## 0.5.7 — tự động cập nhật, quay lại Windows

- Tự động cập nhật trên macOS và Windows: app kiểm tra GitHub Releases khi mở và mỗi 6 giờ, tải bộ cài của đúng hệ điều hành, kiểm tra SHA-256, lưu tài liệu và tạo điểm khôi phục rồi cài và mở lại. Quản lý trong **Quản lý → Hệ thống → Cập nhật ứng dụng**. Chi tiết: [AUTO-UPDATE.md](AUTO-UPDATE.md).
- Windows: bộ cài NSIS x64 cài cho người dùng hiện tại (không cần admin), kèm Pandoc; dùng MiKTeX/TeX Live trên máy. Dữ liệu dùng chung với bản Portable cũ ở `%APPDATA%\latex-word-studio`.
- macOS: build hoạt động với Xcode 26 (`lipo -verify_arch` từng kiến trúc). Bộ cài DMG không đổi.
- Mã nguồn chia theo nền tảng: `mac/`, `win/`, `electron/mac`, `electron/win`.

## 0.5.6 — PDF qua LAN

- Máy biên dịch chuyển PDF hiện tại qua kết nối LAN mã hóa. Máy nhận hiển thị và xuất đúng tệp đó mà không chạy source nhận được; không chuyển quyết định tin cậy LaTeX.
- So khớp phiên bản bản thảo, mẫu, source, ảnh và tài nguyên; sửa tài liệu làm PDF cũ hết hợp lệ. Kiểm tra định dạng, base64 và SHA-256 trước khi lưu/hiển thị.
- Chỉ gửi PDF khi thay đổi; cache giữ qua khởi động lại, tối đa 24 MiB/PDF và 32 MiB toàn cache. Lỗi PDF không chặn đồng bộ bản thảo.
- Máy cũ vẫn nhận bản thảo; bảng LAN báo máy cần cập nhật để nhận PDF.

## 0.5.5 — đồng bộ LAN chạy nền

- Bỏ đồng bộ cuộn giữa bản thảo và PDF; hai khung cuộn độc lập.
- Lịch đồng bộ 5 giây chạy ở tiến trình chính, không phụ thuộc bộ hẹn giờ Chromium bị làm chậm khi cửa sổ ẩn; thử lại khi máy thức dậy.
- Trạng thái LAN hiện ở thanh trạng thái; cảnh báo xung đột mở thẳng bảng LAN. Trạng thái từng máy dựa trên request mã hóa hợp lệ trong 20 giây gần nhất; không ghi hồ sơ ở lượt không có thay đổi.

## 0.5.4 — hiển thị PDF

- Đồng bộ cuộn lấy đúng dòng PDF chứa đoạn văn; số tiêu đề như `3.1.2.` khớp với `3.1.2` trong PDF.
- PDF nạp lại không kéo bản thảo về đầu; trang chưa vẽ dùng đúng kích thước thật, giảm nhảy bố cục.
- Mở tài liệu có ảnh không tự nhảy đến ảnh; chèn ảnh mới vẫn đưa PDF đến trang có ảnh.

## 0.5.3 — khoảng trắng dán và PDF tự động

- Tự sửa đoạn dán dùng dấu không ngắt dòng khiến XeLaTeX tràn lề, khi mở workspace, nhập, dán và xuất; giữ khoảng trắng đơn giữa số và đơn vị.
- Chế độ **Tự động · theo bản thảo** cập nhật PDF sau khoảng 0,9 giây ngừng gõ, các lượt cách nhau ít nhất 2 giây, chỉ một lượt chạy và giữ bản mới nhất đang chờ.
- Kiểm tra: `npm run test:preview-layout` (có thể đặt `PREVIEW_WORKSPACE` để thử trên bản sao workspace).

## 0.5.2 — màu chữ nền tối trong PDF

- Màu trung tính rất sáng của giao diện nền tối (`#ffffff`, `#f2f2f2`, xám từ `#e0e0e0`) được coi là **Màu tự động**, không xuất thành chữ trắng trong PDF. Màu có sắc, cỡ chữ, in đậm và tô sáng được giữ.
- Sửa ở ba lớp: đọc HTML/dán, sửa mark cũ khi mở/nhập, chặn màu gần trắng khi tạo LaTeX. Văn bản tô sáng giữ chữ đen trên nền nhạt.
- Kiểm tra: `npm run test:dark-text`.

## 0.5.1 — số tiêu đề

- Tiêu đề ghi sẵn số như `3.1.1 Night time light` giữ đúng số khi xuất PDF; bộ đếm LaTeX và nhãn tham chiếu dùng cùng số.
- Dòng tiêu đề đứng trước nội dung qua Shift+Enter hoặc ngắt dòng khi dán từ Word được tách thành tiêu đề và đoạn nội dung.
- Kiểm tra: `npm run test:headings` (đặt `DESKTOP_EXE` để chạy trên app đã đóng gói).

## 0.5.0 — đồng bộ LAN Windows/macOS

- Bảng Đồng bộ LAN: làm máy chủ, ghép bằng mã dùng một lần, tự đồng bộ mỗi 5 giây, đồng bộ ngay và ngắt quyền từng máy. Hướng dẫn: [LAN-SYNC.md](LAN-SYNC.md).
- Giữ ID, sửa offline, tài nguyên/mẫu, dấu xóa, xem trước xung đột và giữ cả hai bản. Dữ liệu mã hóa AES-256-GCM bằng khóa riêng từng máy; không truyền quyền tin cậy LaTeX.
- Thoát ứng dụng chỉ dừng backend sau khi lưu thành công; lỗi ghi hủy thoát.
- Menu native macOS, dò Pandoc Homebrew, kiểm tra universal backend/Pandoc, checksum DMG.
