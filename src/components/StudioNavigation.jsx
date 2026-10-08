import { useEffect, useRef, useState } from 'react'
import { BookOpen, FileText, FolderPlus, Plus, Search, Trash2, X } from 'lucide-react'

export default function StudioNavigation({ projects, activeProject, activeTaskId, currentTitle, outline, open, onToggle, onClose, isCompact, onSelect, onProjectChange, onCreateProject, onCreateTask, onJump, onTemplates, onDelete, onCommand, blocked, summary = false, wordCount = 0, formulaCount = 0, imageCount = 0 }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  const results = (query.trim() ? projects : [activeProject]).flatMap(project => project.tasks.map(task => ({ ...task, projectId: project.id, projectName: project.name, title: task.id === activeTaskId ? currentTitle : task.title }))).filter(task => `${task.title} ${task.projectName}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')))
  useEffect(() => {
    if (!isCompact || !open) return
    const previous = document.activeElement
    const nav = document.getElementById('workspace-navigation')
    searchRef.current?.focus()
    const keyboard = event => {
      if (document.querySelector('[role="dialog"], dialog[open]')) return
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const elements = [...nav.querySelectorAll('button, input, select')].filter(item => !item.disabled && item.getClientRects().length)
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && (document.activeElement === first || !nav.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !nav.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus() }
  }, [isCompact, open, onClose])
  return <>
    {isCompact && open && <button type="button" className="mono-nav-shade" onClick={onClose} aria-label="Đóng điều hướng" />}
    <aside id="workspace-navigation" className="mono-navigator" aria-label="Điều hướng tài liệu" hidden={!open} inert={blocked}>
      <div className="mono-nav-head">
        <svg className="mono-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.2 3.8c3.1 0 5 3.5 5 8.2s-1.9 8.2-5 8.2S2.2 16.7 2.2 12s1.9-8.2 5-8.2Z" />
          <path d="M16.8 3.8c-3.1 0-5 3.5-5 8.2s1.9 8.2 5 8.2 5-3.5 5-8.2-1.9-8.2-5-8.2Z" />
          <path d="m9 8.8 6 6.4m0-6.4-6 6.4" />
        </svg>
        <div className="aurora-brand"><strong>VietLaTeX<span>studio</span></strong><small>Ý tưởng thành bản thảo.</small></div>
        {isCompact && <button type="button" className="btn btn--icon btn--ghost" title="Đóng" aria-label="Thu gọn điều hướng" onClick={onToggle}><X size={16} /></button>}
      </div>
      <label className="mono-search"><Search size={15} /><input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tài liệu…" aria-label="Tìm theo tên tài liệu" /><button type="button" className="mono-search-command" title="Bảng lệnh (Ctrl+K)" aria-label="Bảng lệnh" onClick={onCommand}><kbd>Ctrl K</kbd></button></label>
      <div className="mono-project-select"><select aria-label="Chọn dự án" value={activeProject.id} onChange={event => onProjectChange(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button type="button" className="btn btn--icon btn--ghost" title="Dự án mới" aria-label="Dự án mới" onClick={onCreateProject}><FolderPlus size={15} /></button></div>
      <div className="mono-doc-section"><div className="mono-section-title"><span>Tài liệu</span><button type="button" className="btn btn--icon btn--ghost" title="Tài liệu mới" aria-label="Tài liệu mới" onClick={onCreateTask}><Plus size={16} /></button></div>
        <nav className="mono-doc-list" aria-label="Tài liệu trong dự án">{results.map(task => <button type="button" key={task.id} className="mono-doc-item" aria-current={task.id === activeTaskId ? 'page' : undefined} title={task.title || 'Chưa đặt tên'} onClick={() => { onSelect(task.projectId, task.id); if (isCompact) onClose() }}><FileText size={15} /><span>{task.title || 'Chưa đặt tên'}{query && <small>{task.projectName}</small>}</span>{task.id === activeTaskId && <small>ĐANG MỞ</small>}</button>)}{!results.length && <p className="mono-empty-note">Không tìm thấy tài liệu phù hợp.</p>}</nav>
      </div>
      <section className="mono-outline-wrap"><div className="mono-section-title"><span>Mục lục</span><span>{outline.length}</span></div><nav aria-label="Mục lục bản thảo" className="mono-outline">{outline.map((heading, index) => <button type="button" key={index} style={{ paddingLeft: 9 + (heading.level - 1) * 11 }} title={heading.label} onClick={() => { onJump(index); if (isCompact) onClose() }}>{heading.label}</button>)}</nav>{!outline.length && <p className="mono-empty-note">Thêm tiêu đề vào bản thảo để điều hướng nhanh giữa các phần.</p>}</section>
      <div className="mono-nav-foot"><button type="button" disabled={summary} onClick={onTemplates}><BookOpen size={15} />Thư viện mẫu</button><button type="button" disabled={summary} onClick={onDelete}><Trash2 size={15} />Xóa tài liệu hiện tại</button></div>
      <div className="aurora-insights" aria-label="Thống kê bản thảo">
        <div className="aurora-insights-heading"><span>BẢN THẢO HIỆN TẠI</span><span className="aurora-status-dot" /></div>
        <div className="aurora-metrics"><div><strong>{wordCount.toLocaleString('vi-VN')}</strong><span>Từ</span></div><div><strong>{formulaCount}</strong><span>Công thức</span></div><div><strong>{imageCount}</strong><span>Hình ảnh</span></div></div>
        <p>Khoảng {Math.max(1, Math.ceil(wordCount / 200))} phút đọc <span>· Lưu trên máy</span></p>
      </div>
    </aside>
  </>
}
