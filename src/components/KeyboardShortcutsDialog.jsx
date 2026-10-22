import { useEffect, useRef, useState } from 'react'
import { Keyboard, Search, X } from 'lucide-react'
import { formatShortcut, KEYBOARD_SHORTCUTS, shortcutKeys } from '../services/KeyboardShortcuts.js'

const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()

export default function KeyboardShortcutsDialog({ onClose }) {
  const dialogRef = useRef(null)
  const [query, setQuery] = useState('')
  const matches = KEYBOARD_SHORTCUTS.filter(item => normalize(`${item.label} ${item.group} ${shortcutKeys(item.id).map(key => formatShortcut(key)).join(' ')}`).includes(normalize(query.trim())))
  const groups = [...new Set(matches.map(item => item.group))]
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement
    dialog.showModal()
    return () => { dialog.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialogRef} className="mono-command studio-shortcuts" aria-labelledby="shortcuts-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (!event.nativeEvent.isComposing) onClose() } }}>
    <header className="studio-shortcuts-header"><h2 id="shortcuts-title"><Keyboard size={19} />Phím tắt</h2><button type="button" className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Đóng bảng phím tắt"><X size={18} /></button></header>
    <p className="studio-shortcuts-note">Bôi đen văn bản rồi nhấn phím tắt để định dạng, hoặc bật định dạng trước khi gõ. Các phím soạn thảo áp dụng khi con trỏ ở trong bản thảo; trong khung LaTeX, dùng phím tắt của trình sửa mã.</p>
    <label className="mono-command-search"><Search size={17} /><input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm thao tác hoặc tổ hợp phím…" aria-label="Tìm phím tắt" /></label>
    <div className="studio-shortcuts-body">
      {groups.map(group => <section key={group} aria-label={group}><h3>{group}</h3><dl>{matches.filter(item => item.group === group).map(item => <div key={item.id}><dt>{item.label}</dt><dd>{shortcutKeys(item.id).map((key, index) => <span key={key}>{index > 0 && <span className="studio-shortcuts-or">hoặc</span>}<kbd>{formatShortcut(key)}</kbd></span>)}</dd></div>)}</dl></section>)}
      {!matches.length && <p role="status">Không tìm thấy phím tắt phù hợp.</p>}
    </div>
    <footer className="studio-shortcuts-note">Tài liệu được tự động lưu. {formatShortcut('Ctrl+S')} lưu ngay; {formatShortcut('Ctrl+K')} mở bảng lệnh; Esc đóng bảng này.</footer>
  </dialog>
}
