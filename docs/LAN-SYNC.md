# Đồng bộ Windows và MacBook qua LAN — 0.5.0

## Dùng ngay

1. Cài hoặc mở ứng dụng desktop 0.5.0 trên cả hai máy. Kết nối cùng Wi-Fi/Ethernet; mạng khách có thể chặn hai máy nhìn thấy nhau.
2. Trên máy thường bật lâu hơn, mở **Quản lý tài liệu → Đồng bộ LAN → Làm máy chủ LAN**.
3. Chọn địa chỉ IPv4 của mạng đang dùng và bấm **Tạo mã ghép máy**. Sao chép đầy đủ mã.
4. Trên máy còn lại, mở **Đồng bộ LAN**, dán vào **Mã ghép từ máy chủ** và bấm **Ghép với máy chủ**.
5. Sau khi ghép, dữ liệu tự kiểm tra mỗi 5 giây. Có thể bấm **Đồng bộ ngay**. Dự án sẵn có ở hai máy được đưa vào cùng nhóm, giữ ID của tài liệu.

Mã ghép dùng một lần, hết hạn sau 10 phút. Tạo mã mới để thêm máy khác. Nhóm hỗ trợ tối đa 16 máy nhận. Máy chủ có thể **Ngắt quyền kết nối** từng máy. Tắt đồng bộ giữ tài liệu hiện có trên máy; bật một nhóm mới sẽ lấy toàn bộ workspace hiện tại làm dữ liệu đưa vào nhóm đó.

Nếu Windows Firewall hoặc macOS hỏi quyền truy cập mạng, cho phép ứng dụng trên mạng riêng. Máy chủ chọn một cổng TCP và giữ lại cổng đó khi mở lại. Không cần mở backend biên dịch ra mạng, không cần Internet hoặc dịch vụ cloud. Tra DOI vẫn cần Internet như trước.

Hiện kết nối bằng mã ghép và IPv4 nội bộ; chưa có tìm máy tự động/QR, IPv6 hoặc chuyển host tự động. Nếu IP máy chủ thay đổi sau khi router cấp lại địa chỉ, tạo mã ghép mới và ghép lại. Có thể dùng DHCP reservation trên router để giữ IP ổn định.

## Offline và xung đột

Khi máy chủ tắt hoặc mất mạng, cứ tiếp tục soạn thảo. Workspace và mốc phiên bản đã xác nhận được lưu trên ổ đĩa; các thay đổi chưa gửi được tính lại từ chúng khi nối lại, kể cả sau khi khởi động lại ứng dụng. Không cần giữ tiến trình sống để giữ các sửa đổi offline.

Đây là đồng bộ phiên bản, không phải hai con trỏ cùng gõ một đoạn văn. Hai máy sửa các tài liệu khác nhau thì được gộp. Nếu cùng sửa một tài liệu, hoặc một máy xóa trong lúc máy khác sửa, hệ thống giữ bản đang chia sẻ và phiên bản chờ trong hồ sơ đồng bộ. Mở tab **Đồng bộ LAN → Xung đột cần xử lý**:

- **Xem hai phiên bản**: xem tên và tối đa 1.600 ký tự nội dung/source của mỗi phía.
- **Giữ cả hai**: tạo bản sao có hậu tố “bản xung đột” để mở, so sánh và gộp thủ công.
- **Giữ bản đang chia sẻ**: bỏ yêu cầu thay đổi đang chờ.
- **Dùng bản từ máy gửi / Áp dụng xóa**: chọn phiên bản đang chờ.

Nếu bản đang chia sẻ vừa thay đổi thêm, thao tác chọn bị từ chối để bạn đồng bộ và xem lại. Thử lại một request hoặc mất kết nối sau khi máy chủ đã ghi không tạo thêm bản xung đột trùng.

Sửa trong lúc một request đang chạy được gộp lại với dữ liệu vừa nhận; nếu cả hai phía sửa cùng tài liệu trong khoảng này, ứng dụng giữ bản sửa thành tab “bản sửa trong lúc đồng bộ”. Thay đổi sẽ gửi ở lượt kế tiếp. Các dấu xóa được giữ để bản offline cũ không tự hồi sinh tài liệu đã xóa. Nếu xóa hết tài liệu, máy chủ tạo một dự án trống mới.

## Phạm vi dữ liệu và tin cậy

Đồng bộ toàn bộ workspace: dự án, thứ tự/lựa chọn tổng hợp tab, bản thảo, source LaTeX, thiết lập trang, tài liệu tham khảo/BibTeX, mẫu công thức, mẫu tài liệu, ảnh và tài nguyên. Các tệp nằm trong nội dung workspace; không truyền đường dẫn tuyệt đối của Windows/macOS.

Tab đang mở, theme, zoom và PDF cache thuộc từng máy. PDF được biên dịch bằng TeX trên máy đang sử dụng. Dùng cùng phiên bản TeX/gói/font nếu cần kết quả in giống nhau; mẫu dùng font chỉ có trên một máy cần cài font tương ứng.

Không truyền quyết định tin cậy LaTeX. Tài liệu hoặc mẫu nhận từ máy khác phải được người nhận xác nhận trước khi biên dịch. Mẫu thay đổi cũng làm tài liệu sử dụng mẫu đó quay lại trạng thái chờ tin cậy. Không tự biên dịch source được gửi qua LAN.

## Triển khai

- `electron/lan-sync.cjs`: dịch vụ nhóm, mốc phiên bản, dấu xóa, xung đột, ghép máy và lưu hồ sơ nguyên tử.
- `electron/lan-sync-transport.cjs`: HTTP nội bộ mang payload AES-256-GCM, nonce ngẫu nhiên 96 bit, khóa 256 bit riêng cho từng máy, AAD phân biệt request/response và endpoint. Giới hạn request, timeout, chống gửi lại request và giới hạn tốc độ. Header định danh thiết bị không chứa khóa.
- `src/services/LanSyncData.js`: biểu diễn dữ liệu theo tài liệu/mẫu/dự án, tách tin cậy và trạng thái từng máy, gộp sửa trong lúc nhận dữ liệu.
- IPC được kiểm tra frame nguồn; renderer không mở socket mạng trực tiếp. Backend Go vẫn chỉ bind loopback.

Máy chủ chỉ trả các record thay đổi sau revision gần nhất; một record tài liệu chứa cả nội dung và tài nguyên của tài liệu đó. Đây chưa phải truyền riêng từng blob hay từng thao tác gõ. Lượt kiểm tra không có thay đổi không truyền lại toàn bộ nhóm và không ghi lại hồ sơ đồng bộ.

Giới hạn: workspace nhận tối đa 128 MiB theo giới hạn ứng dụng; tối đa 10.000 record gồm các dấu xóa, 128 xung đột đang chờ, 16 máy nhận. Wire tối đa 180 MiB; hồ sơ sync tối đa 512 MiB vì chứa mốc dữ liệu và phiên bản đang chờ. Các giới hạn source/ảnh/tài nguyên sẵn có vẫn áp dụng. Mã ghép và khóa đã ghép cần giữ riêng tư; hồ sơ được tạo với quyền file 0600 trên hệ điều hành hỗ trợ và quyền thư mục người dùng trên Windows.

Hồ sơ `lan-sync-v1.json` nằm cạnh `workspace-v1.json` trong userData. Chỉ xác nhận mốc đồng bộ sau khi workspace đã được lưu. Ghi qua tệp tạm, fsync rồi rename. Lỗi ghi giữ trạng thái trước giao dịch; hồ sơ hỏng được giữ nguyên và đồng bộ bị tắt để bảo vệ dữ liệu tài liệu. Workspace có backup trước khi áp dụng thay đổi nhận được. Backup tài liệu không chứa thông tin ghép máy.

## Kiểm thử

```text
npm run test:sync
npm run test:sync:desktop
npm run test:quit-failure
npm run check
npm run test:go
```

Unit/integration tests dùng server TCP thật và hai hồ sơ. Desktop test dùng hai Electron riêng, giao thức production, địa chỉ LAN của máy khi có, và một relay trì hoãn phản hồi để kiểm tra gõ trong lúc mạng đang chạy. Tests không đọc hoặc ghi workspace thật của người dùng. Đặt `DESKTOP_EXE` đến executable đã đóng gói để chạy cùng kiểm tra trên bản phát hành. Harness này dùng Chromium CDP loopback với hồ sơ tạm và cửa sổ ẩn; giữ nguyên fuse tắt Node inspector trong bản phát hành.

## macOS

Menu native có App/Edit/Window, backend tìm MacTeX và Pandoc Homebrew kể cả PATH của Finder thiếu đường dẫn Homebrew. Chạy trên Mac:

```text
npm ci
npm run desktop:build:mac
```

Script tự chuẩn bị Pandoc nếu chưa có, xác minh kiến trúc x86_64/arm64 bằng lipo, ghép backend universal rồi tạo DMG và SHA-256. Dùng MacTeX/TeX Live để xuất PDF. Bản phát hành cho người khác cần chứng thư Apple và notarization theo cơ chế electron-builder; workflow CI tạo DMG thử nghiệm chưa ký nếu không cấu hình chứng thư.

Job macOS đã được thêm để chạy Go, backend, sync, tab UI, hai desktop, lỗi lưu khi thoát và build universal. Thêm job không đồng nghĩa job đã chạy: môi trường thực hiện hiện tại là Windows. Cần chạy pipeline/máy Mac thật để xác nhận DMG, Finder, clipboard/IME và sleep/wake trên macOS.
