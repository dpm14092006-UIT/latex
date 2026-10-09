import { useCallback, useEffect, useRef, useState } from 'react'
import { formatShortcut } from '../services/KeyboardShortcuts.js'
import { X, FolderOpen, Download, Upload, Copy, Pencil, Trash2, Settings, History, FileCode2, BookOpen, Activity } from 'lucide-react'
import AbstractSettings from './AbstractSettings.jsx'
import LanSyncPanel from './LanSyncPanel.jsx'

const tabs = [['documents', 'Tài liệu', FolderOpen], ['backup', 'Sao lưu', History], ['sync', 'Đồng bộ LAN', Activity], ['settings', 'Trang & tác giả', Settings], ['assets', 'Tài nguyên', FileCode2], ['academic', 'Học thuật', BookOpen], ['system', 'Hệ thống', Activity]]
export default function StudioManager({ readOnly = false, open, initialTab = 'documents', initialDelete = null, onClose, workspace, onSelect, onAction, onExport, onImport, onImportLatex, onImportWord, onExportWord, onOpenReferences, settings, onSettings, assets, onAssets, editor, onSnapshot, onRestore, notice, clearCache, title, syncStatus, onSyncAction }) {
  const [tab, setTab] = useState(initialTab), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null), [deleting, setDeleting] = useState(initialDelete), [backups, setBackups] = useState([]), [environment, setEnvironment] = useState(null)
  const [label, setLabel] = useState(''), [reference, setReference] = useState(''), [footnote, setFootnote] = useState('')
  const backupInput = useRef(null), latexInput = useRef(null), wordInput = useRef(null), assetsInput = useRef(null)
  const run = useCallback(async task => { setBusy(true); setMessage(''); try { const result = await task(); if (typeof result === 'string') setMessage(result) } catch (error) { setMessage(error.message || 'Không thực hiện được thao tác.') } finally { setBusy(false) } }, [])
  const refreshEnvironment = useCallback(() => run(async () => { setEnvironment(window.desktopAPI?.environment ? await window.desktopAPI.environment() : { compiler: await (await fetch('/api/environment')).json() }) }), [run])
  const loadBackups = useCallback(() => run(async () => setBackups(await window.desktopAPI.listBackups())), [run])
  useEffect(() => { if (open && tab === 'backup' && window.desktopAPI?.listBackups) void loadBackups() }, [open, tab, loadBackups])
  useEffect(() => { if (open && tab === 'system') void refreshEnvironment() }, [open, tab, refreshEnvironment])
  if (!open) return null
  const insert = node => { editor?.chain().focus().insertContent(node).run(); onClose() }
  const chooseFile = (ref, handler) => <input ref={ref} hidden type="file" accept={ref === backupInput ? '.vls,.zip' : ref === latexInput ? '.zip' : '.docx'} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(() => handler(file)) }} />
  return <div className="modal-backdrop studio-manager-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="studio-manager" role="dialog" aria-modal="true" aria-labelledby="manager-title">
      <header><div><h2 id="manager-title">Quản lý không gian làm việc</h2><p>{title}</p></div><button type="button" className="modal-close" aria-label="Đóng" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <nav aria-label="Công cụ quản lý">{tabs.map(([id, text, Icon]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={15} />{text}</button>)}</nav>
      <div className="studio-manager-body" aria-busy={busy}>
        {(message || notice) && <p className="studio-notice" role="status">{message || notice}</p>}
        {busy && <p role="status">Đang xử lý…</p>}
        {readOnly && ['settings', 'assets', 'academic'].includes(tab) && <p className="studio-notice">Chọn tab gốc để sửa thiết lập, tài nguyên hoặc trích dẫn. Bản tổng hợp dùng thiết lập của tab đầu tiên được chọn.</p>}
        <fieldset disabled={busy || (readOnly && ['settings', 'assets', 'academic'].includes(tab))}>
        {tab === 'sync' && <LanSyncPanel status={syncStatus} onAction={onSyncAction} />}
        {tab === 'documents' && <>
          <div className="studio-manager-actions"><button type="button" onClick={() => latexInput.current.click()}><Upload size={14} />Nhập dự án LaTeX ZIP</button><button type="button" onClick={() => wordInput.current.click()}><Upload size={14} />Nhập Word</button><button type="button" onClick={() => run(onExportWord)}><Download size={14} />Xuất bản thảo Word</button></div>
          {chooseFile(latexInput, onImportLatex)}{chooseFile(wordInput, onImportWord)}
          <label>Tìm dự án hoặc tài liệu<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nhập tên cần tìm…" /></label>
          {workspace.projects.map(project => {
            const tasks = project.tasks.filter(task => `${project.name} ${task.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            if (!tasks.length) return null
            return <section className="studio-project-card" key={project.id}><div className="studio-manager-row"><strong>{project.name}</strong><div className="studio-manager-actions"><button type="button" title="Đổi tên dự án" aria-label={`Đổi tên dự án ${project.name}`} onClick={() => setEditing({ action: 'rename-project', projectId: project.id, value: project.name })}><Pencil size={14} /></button><button type="button" title="Nhân bản dự án" onClick={() => run(() => onAction('duplicate-project', project.id))}><Copy size={14} /></button><button type="button" title="Xóa dự án" onClick={() => setDeleting({ action: 'delete-project', projectId: project.id, name: project.name })}><Trash2 size={14} /></button></div></div>
              {tasks.map(task => <div key={task.id} className="studio-manager-row"><button type="button" className="studio-task-title" onClick={() => { onSelect(project.id, task.id); onClose() }}>{task.title || 'Chưa đặt tên'}<small>{new Date(task.updatedAt).toLocaleString('vi-VN')}</small></button><div className="studio-manager-actions"><button type="button" title="Đổi tên tài liệu" onClick={() => setEditing({ action: 'rename-task', projectId: project.id, taskId: task.id, value: task.title })}><Pencil size={14} /></button><button type="button" title="Nhân bản tài liệu" onClick={() => run(() => onAction('duplicate-task', project.id, task.id))}><Copy size={14} /></button><button type="button" title="Xóa tài liệu" onClick={() => setDeleting({ action: 'delete-task', projectId: project.id, taskId: task.id, name: task.title })}><Trash2 size={14} /></button></div></div>)}
            </section>
          })}
          {editing && <div className="studio-notice"><label>Tên mới<input autoFocus maxLength={160} value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value })} /></label><div className="studio-manager-actions"><button type="button" disabled={!editing.value.trim()} onClick={() => run(async () => { await onAction(editing.action, editing.projectId, editing.taskId, editing.value); setEditing(null) })}>Lưu tên</button><button type="button" onClick={() => setEditing(null)}>Hủy</button></div></div>}
          {deleting && <div className="studio-notice"><p>Xóa “{deleting.name}”? Ứng dụng sẽ tạo bản sao lưu trước khi xóa.</p><div className="studio-manager-actions"><button type="button" onClick={() => run(async () => { await onAction(deleting.action, deleting.projectId, deleting.taskId); setDeleting(null); return 'Đã xóa và giữ bản sao lưu.' })}>Xác nhận xóa</button><button type="button" onClick={() => setDeleting(null)}>Hủy</button></div></div>}
        </>}
        {tab === 'backup' && <>
          <p>Gói .vls chứa toàn bộ dự án, tài liệu, công thức, mẫu và tài nguyên. Nhập hoặc khôi phục sẽ thêm bản sao thành dự án mới.</p>
          <div className="studio-manager-actions"><button type="button" onClick={() => run(onExport)}>Tải gói sao lưu .vls</button><button type="button" onClick={() => backupInput.current.click()}>Nhập gói sao lưu</button><button type="button" onClick={() => run(async () => { await onSnapshot(); if (window.desktopAPI?.listBackups) setBackups(await window.desktopAPI.listBackups()); return 'Đã tạo bản sao lưu.' })}>Tạo điểm khôi phục</button></div>
          {chooseFile(backupInput, onImport)}
          {window.desktopAPI?.listBackups ? <><p>Giữ tối đa 15 bản trên máy. Bản tự động được tạo trước khi lưu đè, cách nhau ít nhất hai phút.</p>{backups.map(backup => <div className="studio-manager-row" key={backup.id}><span>{new Date(backup.createdAt).toLocaleString('vi-VN')} · {(backup.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" onClick={() => run(async () => { await onRestore(backup.id); return 'Đã mở bản khôi phục thành dự án mới.' })}>Mở bản khôi phục</button></div>)}</> : <p>Bản trình duyệt dùng tệp .vls để lưu các điểm khôi phục ra máy.</p>}
        </>}
        {tab === 'settings' && <><p>Áp dụng thiết lập trang cho mẫu bài viết mặc định. Mẫu riêng có thể dùng các biến tác giả, ngày, khổ giấy và lề.</p><div className="studio-settings-grid">
          <label>Tác giả<input maxLength={500} value={settings.author} onChange={event => onSettings({ ...settings, author: event.target.value })} /></label>
          <label>Ngày hiển thị<input maxLength={100} placeholder="Để trống nếu không in ngày" value={settings.date} onChange={event => onSettings({ ...settings, date: event.target.value })} /></label>
          <label>Khổ giấy<select value={settings.paper} onChange={event => onSettings({ ...settings, paper: event.target.value })}><option value="a4paper">A4</option><option value="letterpaper">Letter</option><option value="a5paper">A5</option></select></label>
          <label>Cỡ chữ<select value={settings.fontSize} onChange={event => onSettings({ ...settings, fontSize: Number(event.target.value) })}>{[10, 11, 12].map(size => <option key={size} value={size}>{size} pt</option>)}</select></label>
          <label>Lề trang (mm)<input type="number" min={10} max={50} step={0.5} value={settings.margin} onChange={event => onSettings({ ...settings, margin: Number(event.target.value) })} /></label>
          <label>Giãn dòng<input type="number" min={1} max={2} step={0.1} value={settings.lineSpacing} onChange={event => onSettings({ ...settings, lineSpacing: Number(event.target.value) })} /></label>
          <label className="studio-checkbox"><input type="checkbox" checked={settings.numberedEquations} onChange={event => onSettings({ ...settings, numberedEquations: event.target.checked })} />Đánh số công thức căn giữa</label>
          <label className="studio-checkbox"><input type="checkbox" checked={settings.tableOfContents} onChange={event => onSettings({ ...settings, tableOfContents: event.target.checked })} />In mục lục trong PDF</label>
        </div><AbstractSettings settings={settings} onSettings={onSettings} /></>}
        {tab === 'assets' && <><p>Tài nguyên được lưu cùng tài liệu và đưa vào thư mục biên dịch. Dùng đúng tên trong lệnh LaTeX. Tối đa 100 tệp, 10 MB/tệp và 24 MB tổng.</p><button type="button" onClick={() => assetsInput.current.click()}>Thêm tệp tài nguyên</button><input ref={assetsInput} hidden type="file" multiple accept=".tex,.bib,.bst,.sty,.cls,.png,.jpg,.jpeg,.pdf,.eps,.csv,.txt" onChange={event => { const files = [...event.target.files]; event.target.value = ''; void run(() => onAssets('add', files)) }} />{assets.map(asset => <div className="studio-manager-row" key={asset.filename}><code>{asset.filename}</code><button type="button" onClick={() => run(() => onAssets('remove', asset.filename))}>Gỡ tệp</button></div>)}</>}
        {tab === 'academic' && <>
          <p>{formatShortcut('Trích dẫn và danh mục tài liệu tham khảo (DOI, BibTeX, kiểu IEEE/APA…) được quản lý trong hộp thoại riêng. Phím tắt: Ctrl+Shift+C.')}</p>
          <div className="studio-manager-actions"><button type="button" onClick={() => onOpenReferences?.('cite')}>Chèn trích dẫn</button><button type="button" onClick={() => onOpenReferences?.('library')}>Danh mục tài liệu</button></div>
          <div className="studio-settings-grid">
          <label>Nhãn tiêu đề hoặc công thức đang chọn<input value={label} onChange={event => setLabel(event.target.value)} placeholder="eq:result" /><button type="button" disabled={!/^[A-Za-z0-9:._-]{1,100}$/.test(label)} onClick={() => { const type = editor?.isActive('blockMath') ? 'blockMath' : editor?.isActive('heading') ? 'heading' : null; if (!type) { setMessage('Chọn tiêu đề hoặc công thức căn giữa trong bản thảo trước khi gắn nhãn.'); return } editor.chain().focus().updateAttributes(type, { label }).run(); setMessage(`Đã gắn nhãn ${label}.`) }}>Gắn nhãn</button></label>
          <label>Nhãn cần tham chiếu<input value={reference} onChange={event => setReference(event.target.value)} placeholder="eq:result" /><button type="button" disabled={!/^[A-Za-z0-9:._-]{1,100}$/.test(reference)} onClick={() => insert({ type: 'crossReference', attrs: { target: reference } })}>Chèn tham chiếu</button></label>
          <label>Chú thích chân trang<input maxLength={5000} value={footnote} onChange={event => setFootnote(event.target.value)} /><button type="button" disabled={!footnote.trim()} onClick={() => insert({ type: 'footnote', attrs: { text: footnote } })}>Chèn chú thích</button></label></div>
        </>}
        {tab === 'system' && <><div className="studio-manager-actions"><button type="button" onClick={refreshEnvironment}>Kiểm tra môi trường</button><button type="button" onClick={() => run(async () => { await clearCache(); return 'Đã xóa cache; PDF sẽ biên dịch lại.' })}>Biên dịch lại từ đầu</button></div>{environment && <><p>VietLaTeX Studio {environment.version || 'web'}</p><p>XeLaTeX: {environment.compiler?.available ? environment.compiler.version : environment.compiler?.error}</p><p>Pandoc / Word: {environment.word?.available ? environment.word.version : environment.word?.error || 'Dùng tính năng Word trong bản desktop.'}</p><p>Chế độ biên dịch: {environment.compiler?.sandbox === 'docker' ? 'Docker cách ly, không có mạng.' : 'XeLaTeX cục bộ — chỉ biên dịch source và template bạn tin cậy.'}</p></>}<p>Bộ cài Mac có sẵn XeLaTeX và Pandoc. Mẫu LaTeX tự thêm có thể cần gói từ MacTeX/TeX Live.</p>{window.desktopAPI?.openHelp && <div className="studio-manager-actions"><button type="button" onClick={() => run(() => window.desktopAPI.openHelp('tex'))}>Mở trang cài XeLaTeX</button><button type="button" onClick={() => run(() => window.desktopAPI.openHelp('word'))}>Mở trang cài Pandoc</button></div>}</>}
        </fieldset>
      </div>
    </section>
  </div>
}
