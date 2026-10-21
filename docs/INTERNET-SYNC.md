# Đồng bộ từng project bằng mã qua Internet

Tính năng nằm trong **Quản lý tài liệu → Đồng bộ** của ứng dụng desktop macOS và Windows. Hai máy không cần cùng Wi-Fi. Mỗi project có nhóm và khóa riêng; không chia sẻ toàn bộ workspace. Mỗi máy hỗ trợ 32 project, mỗi project hỗ trợ một máy giữ kết nối và tối đa 16 thiết bị nhận.

## Cách dùng

1. Trên máy đã có project, chọn project trong **Thêm project hoặc kết nối bằng mã**, nhập địa chỉ HTTPS của máy chủ ở **Cài đặt kết nối**, rồi bấm **Bật đồng bộ project**. Địa chỉ được nhớ cho các project tiếp theo trên máy này.
2. Trong thẻ project, bấm **Thêm thiết bị → Sao chép mã mời**.
3. Trên máy khác, dán đầy đủ mã `vietlatex-sync:…` vào **Mã kết nối project**, bấm **Kết nối project**. Máy nhận không cần nhập địa chỉ máy chủ.
4. Trên máy giữ project, bấm **Cho phép thiết bị** khi thấy đúng tên máy đang ghép. Có thể chọn **Từ chối**.
5. Ứng dụng kiểm tra mỗi 5 giây, kể cả khi cửa sổ bị thu nhỏ. Project nhận được thêm bên cạnh project riêng; tab đang mở được giữ nguyên. Sau khi ghép thành công không cần nhập lại mã khi mở ứng dụng hoặc khởi động lại máy chủ chuyển tiếp.

Mã mời dùng một lần, hết hạn sau 10 phút. Tạo mã mới vô hiệu mã trước và các yêu cầu đang chờ của mã đó. Khi khởi động lại ứng dụng, mã mời chưa dùng/yêu cầu chưa ghép không được giữ; tạo mã mới. Thiết bị đã ghép có thể bấm **Thêm thiết bị** để xin mã mới, nhưng máy giữ project vẫn cần xác nhận thiết bị mới. Máy giữ project quản lý danh sách thiết bị và **Thu hồi quyền** từng máy.

Máy giữ project và thiết bị muốn nhận/gửi cần cùng chạy ứng dụng và không ngủ. Tắt màn hình khác với ngủ máy. Có thể bật **Giữ máy này không ngủ khi đồng bộ** trên máy giữ project; gập nắp MacBook vẫn có thể làm máy ngủ. Khi máy giữ project tắt, các máy nhận tiếp tục soạn thảo, trao đổi thay đổi khi máy giữ project trực tuyến trở lại. Hai máy nhận không trao đổi trực tiếp khi máy giữ project vắng mặt. Chưa có chuyển vai trò máy giữ project tự động.

Các thiết bị đã ghép thử kết nối LAN có xác thực trước, rồi dùng chuyển tiếp Internet nếu không kết nối trực tiếp được. Không cần mở cổng router. Các địa chỉ LAN được thử lại mỗi 30 giây; thay đổi địa chỉ LAN không ngăn kết nối Internet. Ghép lần đầu và tạo mã mới cần máy chủ chuyển tiếp.

## Dữ liệu và xung đột

Chia sẻ tài liệu, source LaTeX, thiết lập trang, BibTeX, ảnh/tệp đính kèm, PDF khớp phiên bản và các mẫu trang project đang dùng. Mẫu trang được sao chép vào phạm vi project để không ghi đè mẫu trùng ID của project riêng. Các mẫu công thức trong thư viện toàn workspace, giao diện, zoom và quyết định tin cậy LaTeX không được chia sẻ.

Tiếp tục sửa khi offline. Hồ sơ phiên bản được lưu nguyên tử trên đĩa, cùng nguyên tắc chỉ xác nhận sau khi workspace đã được lưu như đồng bộ LAN. Xung đột tài liệu giữ hai phiên bản để chọn **Giữ cả hai**, **Giữ bản đang chia sẻ** hoặc **Dùng bản từ máy gửi**. Xung đột thông tin project cần chọn một phiên bản. Đây là đồng bộ phiên bản tài liệu, không phải cộng tác nhiều con trỏ trong cùng đoạn văn.

**Ngắt đồng bộ project** giữ bản trên máy và ngừng kết nối sau khi mở lại ứng dụng. Nếu máy đã có project cùng ID, ghép mới bị từ chối để giữ các sửa đổi hiện có; nhân bản project cũ hoặc dùng kết nối đã lưu. Nếu xóa toàn bộ project/tài liệu đang chia sẻ, đồng bộ báo cần ngắt kết nối để giữ bản trên các máy khác; không tự tạo project ngoài phạm vi hoặc âm thầm hồi sinh dữ liệu.

LAN toàn workspace vẫn ở phần mở rộng cuối bảng. Không chạy chế độ đó đồng thời với các nhóm project để tránh chia sẻ ngoài phạm vi đã chọn. Xem [LAN-SYNC.md](LAN-SYNC.md) về giới hạn dung lượng, PDF, dấu xóa, backup và chính sách tin cậy.

## Chạy máy chủ chuyển tiếp

Kho mã chưa cấu hình sẵn máy chủ công khai. Chạy máy chủ trên VPS/host có DNS và HTTPS; chỉ chạy trên MacBook rồi dùng `localhost` sẽ không cho laptop ở mạng khác truy cập được.

Máy chủ dùng Node.js 24, không cần cài package bổ sung. Thử nghiệm trên một máy:

```sh
npm run sync:relay
```

Mặc định bind `127.0.0.1:8787`. Nhập `http://127.0.0.1:8787` trong hai phiên ứng dụng trên cùng máy để thử. HTTP chỉ được ứng dụng chấp nhận với địa chỉ loopback. Mọi địa chỉ Internet phải là HTTPS, không kèm user/password, query hoặc đường dẫn.

Triển khai bằng Docker Compose và Caddy từ thư mục gốc kho mã:

```sh
SYNC_DOMAIN=sync.your-domain.example docker compose -f deploy/sync-relay/compose.yaml up -d --build
```

Thay tên miền ví dụ bằng tên miền thật, trỏ DNS tới máy chủ và cho phép inbound TCP 80/443. Caddy quản lý chứng chỉ HTTPS. Chỉ Caddy được xuất cổng; relay ở mạng nội bộ của Compose. Địa chỉ nhập trong ứng dụng là `https://sync.your-domain.example`. Cấu hình này chưa được chạy bằng Docker trong phiên phát triển này; dịch vụ Node được kiểm tra bằng HTTP thật và hai phiên Electron.

Có thể chạy Node sau reverse proxy HTTPS sẵn có. Biến `PORT` mặc định 8787, `RELAY_BIND` mặc định 127.0.0.1. Proxy cần cho phép long polling khoảng 20 giây và các lượt truyền lớn tới 15 phút. `GET /healthz` trả `{ "ok": true }`. Biến ứng dụng `VIETLATEX_SYNC_RELAY_URL` đặt địa chỉ mặc định; người dùng vẫn có thể chọn địa chỉ trong giao diện. Chưa có cơ chế tự chuyển một nhóm đã ghép sang tên miền khác: giữ tên miền ổn định hoặc ghép lại.

Relay chỉ chuyển các gói AES-256-GCM đã mã hóa đầu cuối; khóa mã hóa nằm trong lời mời và trên thiết bị. Relay lưu định tuyến/khả năng truy cập và hàng đợi ngắn hạn trong RAM, không ghi nội dung project ra đĩa. Máy chủ vẫn thấy địa chỉ IP, ID thiết bị, số lượng và thời điểm gói tin. Định danh phòng là SHA-256 của bí mật chủ phòng, nên người biết mã phòng không thể chiếm vai trò chủ khi relay khởi động lại. Quyền trả lời/poll và quyền gửi gói tách riêng. Mỗi thiết bị đã ghép dùng khóa nội dung riêng; thu hồi quyền được kiểm tra ở máy giữ project.

Một tiến trình relay giữ tối đa 256 phòng, 16 lượt chờ/phòng, một lượt chờ/thiết bị, tổng buffer khoảng 360 MiB (không tính overhead runtime/JSON), tối đa 180 MiB/gói; request ghép tối đa 64 KiB. Có hạn đọc, giới hạn tốc độ và dọn request khi mất kết nối. Compose giới hạn RAM 1 GiB. Đây là dịch vụ tự vận hành cho nhóm nhỏ, chưa có tài khoản/quota thuê bao hoặc nhiều replica dùng chung định tuyến. Không bật access log chứa token hoặc body ở reverse proxy.

## Mã nguồn và kiểm tra

- `electron/project-sync.cjs`: điều phối các nhóm và LAN cũ, index nguyên tử, ghép chờ phê duyệt, receipt sau khi lưu workspace.
- `electron/lan-sync.cjs`: cơ chế phiên bản/xung đột/PDF dùng chung, kiểm tra phạm vi và lựa chọn LAN/relay.
- `electron/sync-relay-client.cjs`: HTTPS, xác thực, mã hóa và long polling có reconnect/backoff.
- `electron/sync-relay-server.cjs`: chuyển tiếp gói opaque, xác thực chủ phòng, giới hạn tài nguyên.
- `src/services/ProjectSyncData.js`: trích riêng project, cách ly mẫu trang và gộp với project riêng.
- `src/components/ProjectSyncPanel.jsx`: bật đồng bộ, mã mời, xác nhận, thu hồi và xử lý xung đột.

```sh
npm run test:sync
npm run test:sync:internet:desktop
npm run test:sync:desktop
npm run lint
```

Kiểm thử Internet dùng relay TCP thật và hồ sơ tạm, ép đi qua relay để không vô tình chỉ kiểm tra LAN. Kiểm thử desktop mở hai Electron với UI production, xác nhận ghép qua giao diện, truyền bản thảo hai chiều và kiểm tra project riêng không bị gửi. Hồ sơ thật của người dùng không được đọc/ghi trong những bài này. Chưa xác minh hai thiết bị vật lý ở hai mạng ngoài Internet hoặc Windows desktop trong phiên phát triển này.
