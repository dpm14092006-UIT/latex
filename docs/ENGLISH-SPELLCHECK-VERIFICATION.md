# Xác minh chính tả tiếng Anh — 10/10/2026

## Kết quả

- `npm run test:spellcheck`: 14 bài kiểm tra đạt, gồm từ điển, tokenizer, vùng LaTeX bảo vệ, mapping vị trí/định dạng, hoàn tác độc lập và lưu trữ nguyên tử.
- `npm run lint`: đạt.
- `npm run check`: đạt các bộ hồi quy Go, backend, LAN, updater, nâng cấp và build. Một bài kiểm tra theo nền tảng được bỏ qua trên Windows. Lượt này chạy trước thay đổi cuối về ranh giới lịch sử hoàn tác; thay đổi đó đã được kiểm tra lại bằng bộ 14 bài, UI production và Electron bên dưới.
- `npm run test:ui`: giao diện hiện có đạt kiểm tra Edge và responsive.
- `node scripts/spellcheck-ui.mjs --production`: đạt sửa/hoàn tác, vùng toán/code, tiêu đề/Abstract/footnote/caption/bảng, từ điển qua reload, bỏ qua, đổi tab, source LaTeX, không gọi mạng, responsive và quét 50.000 từ trong ngân sách 5 giây.
- `npm run test:spellcheck:desktop`: đạt trên runtime Electron với renderer production qua `vietlatex://`, CSP, worker/từ điển đóng gói, IPC, lưu trữ và khởi động lại.
- `npm run test:spellcheck:bench`: đạt ngân sách hiệu năng và gợi ý của fixture tổng hợp. Báo cáo: `artifacts/spellcheck/benchmark.json`.

## Số đo cuối

Máy Windows, AMD Ryzen 9 7940HS, Node v24.15.0. Lõi Node quét 10.000 từ trong 31,1 ms; 50.000 từ trong 113,0 ms. Nạp từ điển 250,3 ms; bộ nhớ heap tăng khoảng 57 MiB; gợi ý P95 8,4 ms. Chưa bao gồm debounce, IPC/worker hoặc rendering.

Fixture tự tạo có 500 biến đổi: 20 tạo thành từ hợp lệ, 480 lỗi ngoài từ điển được nhận diện; 446/480 có đáp án trong 5 gợi ý. Tỷ lệ 92,9% chỉ mô tả fixture này, không phải độ chính xác tổng quát trên văn bản thực tế.

## Giới hạn xác minh bản phát hành

Bản Windows được dựng và kiểm tra cấu trúc ASAR. Máy kiểm thử đã từ chối khởi chạy executable chưa ký số với thông báo “An Application Control policy has blocked this file”. Kết quả Electron runtime phía trên không chứng minh executable cuối chạy được dưới chính sách này. Không thay đổi chính sách bảo mật và không thay thế ứng dụng đã cài.

macOS có cấu hình build/CI và kiểm tra tài nguyên đóng gói; chưa có kết quả chạy macOS trong phiên này. Chữ ký phát hành và kiểm tra runtime trên các nền tảng đích còn thuộc bước phát hành.

## Nhật ký

Các log lưu trong `artifacts/spellcheck/`: `check.log`, `unit-test.log`, `lint.log`, `production-ui-test.log`, `desktop-runtime-test.log`, `benchmark-test.log`, `windows-package.log`. Báo cáo runtime: `artifacts/spellcheck-desktop/runtime.json`.

Hướng dẫn tính năng và cách mở bản workspace: [ENGLISH-SPELLCHECK.md](ENGLISH-SPELLCHECK.md).
