import { AlignLeft, Check, FileCode2, FileDown, LayoutPanelLeft, Menu, Moon, PanelTopClose, PanelRight, Settings2, Sun } from 'lucide-react'

const views = [
  { id: 'write', label: 'Soạn thảo', Icon: AlignLeft },
  { id: 'split', label: 'Soạn + PDF', Icon: LayoutPanelLeft },
  { id: 'source', label: 'LaTeX', Icon: FileCode2 },
  { id: 'preview', label: 'Bản in', Icon: PanelRight },
]

export default function DocumentHeader({ readOnly = false, title, projectName, onTitleChange, saved, theme, onToggleTheme, exporting, canExport, onExport, mode, onModeChange, onToggleFocus, onToggleNav, navOpen, onOpenManager, isCompact, dockPlacement, onToggleDock }) {
  return <>
    <header className="studio-header mono-topbar">
      <div className="mono-top-left">
        <button type="button" className="btn btn--icon btn--ghost" onClick={onToggleNav} aria-label="Điều hướng tài liệu" aria-expanded={navOpen} aria-controls="workspace-navigation" title="Mở hoặc thu gọn điều hướng"><Menu size={17} /></button>
        <div className="mono-document-meta">
          <div className="mono-breadcrumb">Không gian làm việc / {projectName}</div>
          <div className="studio-document">
            <input readOnly={readOnly} maxLength={160} value={title} onChange={onTitleChange} aria-label="Tên tài liệu" spellCheck={false} />
            <span className="studio-save" role="status" data-saving={!saved}><Check size={12} />{saved ? 'Đã lưu' : 'Đang lưu…'}</span>
          </div>
        </div>
      </div>
      <div className="studio-header-actions">
        <button type="button" className="btn btn--icon btn--ghost" onClick={onToggleTheme} title={theme === 'dark' ? 'Nền trắng' : 'Nền đen'} aria-label={theme === 'dark' ? 'Nền trắng' : 'Nền đen'}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        <button type="button" className="btn btn--icon btn--ghost" onClick={onToggleFocus} title="Chế độ tập trung" aria-label="Chế độ tập trung"><PanelTopClose size={16} /></button>
        <span className="mono-top-divider" />
        <button type="button" className="btn mono-settings" title="Quản lý tài liệu, sao lưu và thiết lập" aria-label="Quản lý tài liệu" onClick={onOpenManager}><Settings2 size={15} /><span>Thiết lập</span></button>
        <button type="button" className="btn btn--solid studio-export" onClick={onExport} disabled={exporting || !canExport} title={canExport ? 'Cập nhật nội dung mới nhất rồi lưu PDF' : 'Kiểm tra nguồn và tài nguyên trước khi xuất PDF'} aria-label="Xuất PDF"><FileDown size={15} /><span>{exporting ? 'Đang chuẩn bị…' : 'Xuất PDF'}</span></button>
      </div>
    </header>
    <div className="mono-modebar">
      <div className="mono-mode-caption"><strong>Writing Studio</strong><span>·</span><span>Không gian viết của bạn</span></div>
      <nav className="studio-views" aria-label="Chế độ làm việc">
        {views.filter(view => !isCompact || view.id !== 'split').map(({ id, label, Icon }) => <button type="button" key={id} onClick={() => onModeChange(id)} aria-pressed={mode === id} aria-label={label} title={label}><Icon size={13} /><span>{label}</span></button>)}
      </nav>
      {onToggleDock && <button type="button" className="noir-dock-placement" onClick={onToggleDock} aria-label={dockPlacement === 'top' ? 'Đặt thanh chế độ bên dưới' : 'Đặt thanh chế độ bên trên'} title={dockPlacement === 'top' ? 'Thử vị trí bên dưới' : 'Thử vị trí bên trên'}>{dockPlacement === 'top' ? '↓' : '↑'}</button>}
    </div>
  </>
}
