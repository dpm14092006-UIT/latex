import { useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, Settings2 } from 'lucide-react'

export default function ProjectTabs({ project, activeId, currentTitle, summary, onSelect, onSummary, onCreate, onAction }) {
  const [options, setOptions] = useState(false)
  const [renaming, setRenaming] = useState(null)
  return <div className="project-tabs-wrap">
    <div className="project-tabs" role="tablist" aria-label="Các tab tài liệu">
      {project.tasks.map(task => <button role="tab" type="button" key={task.id} aria-selected={!summary && task.id === activeId} onClick={() => onSelect(project.id, task.id)} onDoubleClick={() => setRenaming({ id: task.id, title: task.title })}>{!summary && task.id === activeId ? currentTitle : task.title || 'Chưa đặt tên'}</button>)}
      <button type="button" role="tab" aria-selected={summary} onClick={onSummary}>Tổng hợp</button>
      <button type="button" onClick={onCreate} aria-label="Thêm tab" title="Thêm tab"><Plus size={15} /></button>
      <button type="button" onClick={() => setOptions(!options)} aria-expanded={options} aria-label="Sắp xếp và tổng hợp tab"><Settings2 size={15} /></button>
    </div>
    {renaming && <form className="project-tab-rename" onSubmit={event => { event.preventDefault(); if (renaming.title.trim()) { onAction('rename-task', project.id, renaming.id, renaming.title); setRenaming(null) } }}><label>Tên tab <input autoFocus maxLength={160} value={renaming.title} onChange={event => setRenaming({ ...renaming, title: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); setRenaming(null) } }} /></label><button type="submit">Lưu tên</button><button type="button" onClick={() => setRenaming(null)}>Hủy</button></form>}
    {options && <div className="project-tab-options"><p>Ghép theo thứ tự tab. Bản tổng hợp dùng thiết lập trang và mẫu của tab đầu tiên được chọn. Nhấp đúp vào tab để đổi tên.</p>{project.tasks.map((task, index) => <div className="project-tab-option" key={task.id}><label><input type="checkbox" checked={task.includeInCompilation !== false} onChange={() => onAction('include-compilation', project.id, task.id)} />{task.title}</label><label><input type="checkbox" checked={task.compilationPageBreak === true} onChange={() => onAction('page-break-compilation', project.id, task.id)} />Trang mới</label><button type="button" disabled={index === 0} aria-label={`Đưa ${task.title} lên trước`} onClick={() => onAction('move-task-left', project.id, task.id)}><ArrowLeft size={14} /></button><button type="button" disabled={index === project.tasks.length - 1} aria-label={`Đưa ${task.title} ra sau`} onClick={() => onAction('move-task-right', project.id, task.id)}><ArrowRight size={14} /></button></div>)}</div>}
    {summary && <p className="project-compilation-note">Bản tổng hợp tự cập nhật từ các tab. Chọn tab gốc để sửa nội dung; dùng LaTeX hoặc Xuất PDF để xuất toàn bộ.</p>}
  </div>
}
