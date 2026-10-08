# Repo tham khảo giao diện

Đây là danh mục bốn repo từng được clone nông để tham khảo thiết kế và cách triển khai cho app Word → LaTeX/PDF. Các clone không có thay đổi cục bộ đã được dọn ngày 08/10/2026; URL, commit và giấy phép được giữ ở bảng dưới để tra cứu hoặc tải lại. Ứng dụng chạy thật nằm trong `../src`; bản dựng không nhập trực tiếp mã từ các repo này.

| Repo | Thư mục | Commit | Giấy phép | Phần nên tham khảo |
| --- | --- | --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | `shadcn-ui/` | `98a1fe6` | MIT | Component trong `apps/v4/registry/new-york-v4/ui/` và màu sáng/tối trong `apps/v4/app/globals.css` |
| [Plate](https://github.com/udecode/plate) | `plate/` | `a9bfa84` | MIT và một số giấy phép theo package | Thanh công cụ, công thức và tương tác soạn thảo trong `apps/www/src/registry/ui/` |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | `react-resizable-panels/` | `ffa22a1` | MIT | Bố cục `Group` / `Panel` / `Separator` có thể kéo đổi độ rộng và hỗ trợ bàn phím |
| [Lucide](https://github.com/lucide-icons/lucide) | `lucide/` | `66d8f9f` | ISC; một số icon kế thừa MIT của Feather | Bộ biểu tượng; app đã dùng package `lucide-react` |

Plate dùng Slate, còn app hiện dùng Tiptap/ProseMirror. Vì vậy, các ví dụ editor của Plate chỉ được dùng để tham khảo giao diện và tương tác. Khi sao chép mã hoặc icon sau này, cần giữ thông tin giấy phép tương ứng. Riêng `packages/diff/` của Plate có giấy phép kép.
