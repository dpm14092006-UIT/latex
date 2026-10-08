import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

export default function CommandPalette({ commands, onClose }) {
  const ref = useRef(null)
  const [query, setQuery] = useState('')
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
  const matches = commands.filter(command => normalize(command.label).includes(normalize(query)))
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement; dialog.showModal(); return () => { dialog.close(); if (previous?.isConnected) previous.focus() } }, [])
  const run = command => { onClose(); command.run() }
  return <dialog ref={ref} className="mono-command" aria-labelledby="command-title" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) { const bounds = ref.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose() } }}>
    <h2 id="command-title" className="sr-only">Bảng lệnh</h2>
    <div className="mono-command-search"><Search size={18} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm thao tác…" aria-label="Tìm lệnh" onKeyDown={event => { if (event.key === 'Enter') { const command = matches.find(item => !item.disabled); if (command) run(command) } if (event.key === 'ArrowDown') { event.preventDefault(); ref.current.querySelector('.mono-command-results button:not(:disabled)')?.focus() } }} /><button type="button" className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Đóng bảng lệnh"><X size={16} /></button></div>
    <div className="mono-command-results" onKeyDown={event => { if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; event.preventDefault(); const items = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]; const index = items.indexOf(document.activeElement); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }}>
      {matches.map(command => <button type="button" key={command.id} disabled={command.disabled} onClick={() => run(command)}><command.Icon size={16} /><span>{command.label}</span></button>)}
      {!matches.length && <p>Không tìm thấy thao tác. Thử “PDF”, “công thức” hoặc “tài liệu”.</p>}
    </div>
  </dialog>
}
