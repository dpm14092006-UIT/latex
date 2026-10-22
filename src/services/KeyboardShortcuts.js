// The native bridge is authoritative; browser previews use the browser platform.
function currentPlatform() {
  return globalThis.window?.desktopAPI?.platform
    || globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || ''
}

export function formatShortcut(text, platform = currentPlatform()) {
  return /darwin|mac/i.test(platform) ? text.replace(/\bCtrl\b/g, '⌘') : text
}

// Native editor bindings and application bindings share one discoverable catalogue.
// Formatting remains local to the editor; it must never rewrite a dialog's input.
export const KEYBOARD_SHORTCUTS = [
  { id: 'help', group: 'Ứng dụng', label: 'Mở bảng phím tắt', keys: ['F1'] },
  { id: 'commands', group: 'Ứng dụng', label: 'Mở bảng lệnh', keys: ['Ctrl+K'] },
  { id: 'save', group: 'Ứng dụng', label: 'Lưu ngay trên máy', keys: ['Ctrl+S'] },
  { id: 'bold', group: 'Định dạng bản thảo', label: 'In đậm', keys: ['Ctrl+B'] },
  { id: 'italic', group: 'Định dạng bản thảo', label: 'In nghiêng', keys: ['Ctrl+I'] },
  { id: 'underline', group: 'Định dạng bản thảo', label: 'Gạch chân', keys: ['Ctrl+U'] },
  { id: 'strike', group: 'Định dạng bản thảo', label: 'Gạch ngang', keys: ['Ctrl+Shift+S'] },
  { id: 'subscript', group: 'Định dạng bản thảo', label: 'Chỉ số dưới', keys: ['Ctrl+,'] },
  { id: 'superscript', group: 'Định dạng bản thảo', label: 'Chỉ số trên', keys: ['Ctrl+.'] },
  { id: 'clear-format', group: 'Định dạng bản thảo', label: 'Xóa định dạng chữ và căn lề', keys: ['Ctrl+\\'] },
  { id: 'undo', group: 'Soạn thảo', label: 'Hoàn tác', keys: ['Ctrl+Z'] },
  { id: 'redo', group: 'Soạn thảo', label: 'Làm lại', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'find', group: 'Soạn thảo', label: 'Tìm trong bản thảo', keys: ['Ctrl+F'] },
  { id: 'replace', group: 'Soạn thảo', label: 'Tìm và thay thế trong bản thảo', keys: ['Ctrl+H'], macKeys: ['Ctrl+Alt+F'] },
  { id: 'link', group: 'Soạn thảo', label: 'Chèn hoặc sửa liên kết', keys: ['Ctrl+Shift+K'] },
  { id: 'formula', group: 'Soạn thảo', label: 'Chèn công thức toán học', keys: ['Ctrl+Shift+M'] },
  { id: 'citation', group: 'Soạn thảo', label: 'Chèn trích dẫn', keys: ['Ctrl+Shift+C'] },
  { id: 'page-break', group: 'Soạn thảo', label: 'Ngắt trang', keys: ['Ctrl+Enter'] },
  { id: 'heading-1', group: 'Đoạn văn', label: 'Tiêu đề cấp 1', keys: ['Ctrl+Alt+1'] },
  { id: 'heading-2', group: 'Đoạn văn', label: 'Tiêu đề cấp 2', keys: ['Ctrl+Alt+2'] },
  { id: 'heading-3', group: 'Đoạn văn', label: 'Tiêu đề cấp 3', keys: ['Ctrl+Alt+3'] },
  { id: 'paragraph', group: 'Đoạn văn', label: 'Đoạn văn thường', keys: ['Ctrl+Alt+0'] },
  { id: 'bullet-list', group: 'Đoạn văn', label: 'Danh sách gạch đầu dòng', keys: ['Ctrl+Shift+8'] },
  { id: 'ordered-list', group: 'Đoạn văn', label: 'Danh sách đánh số', keys: ['Ctrl+Shift+7'] },
  { id: 'align-left', group: 'Đoạn văn', label: 'Căn trái', keys: ['Ctrl+Shift+L'] },
  { id: 'align-center', group: 'Đoạn văn', label: 'Căn giữa', keys: ['Ctrl+Shift+E'] },
  { id: 'align-right', group: 'Đoạn văn', label: 'Căn phải', keys: ['Ctrl+Shift+R'] },
  { id: 'align-justify', group: 'Đoạn văn', label: 'Căn đều hai bên', keys: ['Ctrl+Shift+J'] },
  { id: 'zoom-in', group: 'Xem bản thảo', label: 'Phóng to bản thảo', keys: ['Ctrl+='] },
  { id: 'zoom-out', group: 'Xem bản thảo', label: 'Thu nhỏ bản thảo', keys: ['Ctrl+-'] },
  { id: 'zoom-reset', group: 'Xem bản thảo', label: 'Thu phóng về 100%', keys: ['Ctrl+0'] },
]

export function shortcutKeys(id, platform = currentPlatform()) {
  const shortcut = KEYBOARD_SHORTCUTS.find(item => item.id === id)
  return (/darwin|mac/i.test(platform) ? shortcut?.macKeys : null) || shortcut?.keys || []
}

export function matchesShortcut(event, id, platform = currentPlatform()) {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return false
  const mac = /darwin|mac/i.test(platform)
  return shortcutKeys(id, platform).some(binding => {
    const parts = binding.split('+')
    const key = parts.pop().toLowerCase()
    const primary = parts.includes('Ctrl')
    return Boolean(event.ctrlKey) === (primary && !mac)
      && Boolean(event.metaKey) === (primary && mac)
      && Boolean(event.altKey) === parts.includes('Alt')
      && Boolean(event.shiftKey) === parts.includes('Shift')
      && event.key.toLowerCase() === key
  })
}
