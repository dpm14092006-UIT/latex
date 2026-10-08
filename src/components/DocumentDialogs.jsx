import { BookOpen, FilePlus2, FileStack, FolderPlus, Plus, Sigma, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { recognizeFormula } from '../formula-recognition.js'
import AbstractSettings from './AbstractSettings.jsx'

function DialogFrame({ title, Icon, width, onClose, children }) {
  return (
    <div className="modal-backdrop studio-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="studio-dialog" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header className="studio-dialog-head">
          <h2 id="dialog-title"><Icon size={20} strokeWidth={1.8} />{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
        </header>
        <div className="studio-dialog-body">{children}</div>
      </section>
    </div>
  )
}

function renderFormula(renderer, latex, displayMode) {
  const escapedLatex = String(latex).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
  if (!renderer) return escapedLatex
  try {
    return renderer.renderToString(latex, { throwOnError: false, displayMode })
  } catch {
    return escapedLatex
  }
}

export function WorkspaceDialog({ type, value, onChange, onClose, onSave, frame, onFrameChange, templates = [] }) {
  if (!type) return null
  const isProject = type === 'project'
  const label = isProject ? 'Tên dự án' : 'Tên tab'
  const Icon = isProject ? FolderPlus : FilePlus2
  const title = isProject ? 'Tạo dự án mới' : 'Tạo tab mới'
  return <DialogFrame title={title} Icon={Icon} width={680} onClose={onClose}>
    <p className="studio-dialog-note">{isProject ? 'Mỗi dự án có các tab nội dung riêng và một bản tổng hợp.' : 'Tab mới sẽ được lưu trong dự án đang chọn.'}</p>
    <label className="label" htmlFor="workspace-item-name">{label}</label>
    <input id="workspace-item-name" className="field" autoFocus maxLength={160} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && value.trim()) onSave() }} placeholder={isProject ? 'Ví dụ: Luận văn tốt nghiệp' : 'Ví dụ: Chương 1 — Tổng quan'} />
    {frame && <div className="studio-new-document-frame">
      <p className="studio-dialog-note">Thiết lập khung trước khi tạo: tiêu đề → tác giả / ngày → Abstract → mục lục (nếu bật) → nội dung theo mẫu.</p>
      <label>Mẫu khung tài liệu<select aria-label="Mẫu khung tài liệu" className="field" value={frame.templateId} onChange={event => onFrameChange({ ...frame, templateId: event.target.value })}><option value="">Bài viết mặc định — một cột</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {isProject && <label>Tiêu đề tài liệu đầu tiên<input className="field" maxLength={160} value={frame.documentTitle} onChange={event => onFrameChange({ ...frame, documentTitle: event.target.value })} placeholder="Để trống để dùng tên dự án" /></label>}
      <div className="studio-settings-grid">
        <label>Tác giả<input className="field" maxLength={500} value={frame.settings.author} onChange={event => onFrameChange({ ...frame, settings: { ...frame.settings, author: event.target.value } })} /></label>
        <label>Ngày hiển thị<input className="field" maxLength={100} placeholder="Ví dụ: October 2026" value={frame.settings.date} onChange={event => onFrameChange({ ...frame, settings: { ...frame.settings, date: event.target.value } })} /></label>
        <label className="studio-checkbox"><input type="checkbox" checked={frame.settings.tableOfContents} onChange={event => onFrameChange({ ...frame, settings: { ...frame.settings, tableOfContents: event.target.checked } })} />Thêm mục lục sau Abstract</label>
      </div>
      <AbstractSettings settings={frame.settings} onSettings={settings => onFrameChange({ ...frame, settings })} />
    </div>}
    <div className="studio-dialog-foot">
      <span />
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={onClose}>Hủy</button>
        <button type="button" className="btn btn--solid" disabled={!value.trim()} onClick={onSave}><Plus size={14} /> Tạo {isProject ? 'dự án' : 'tab'}</button>
      </div>
    </div>
  </DialogFrame>
}

export function FormulaDialog({
  editing = false,
  open,
  onClose,
  formula,
  onFormulaChange,
  formulaType,
  onFormulaTypeChange,
  inputMode,
  onInputModeChange,
  mathFieldRef,
  onUntrustedPaste,
  mathliveReady,
  katexRenderer,
  onInsert,
  normalizeFormula,
}) {
  const [plainFormula, setPlainFormula] = useState('')
  const recognized = recognizeFormula(plainFormula)
  const recognitionActive = inputMode === 'recognize'
  const canInsert = Boolean(formula.trim()) && (!recognitionActive || !recognized.error)
  if (!open) return null

  return (
    <DialogFrame title={editing ? 'Sửa công thức' : 'Chèn công thức'} Icon={Sigma} width={560} onClose={onClose}>
      <span className="label">Kiểu hiển thị</span>
      <div className="studio-choice-row">
        <button type="button" onClick={() => onFormulaTypeChange('inline')} aria-pressed={formulaType === 'inline'}>Trong dòng <span>x²</span></button>
        <button type="button" onClick={() => onFormulaTypeChange('block')} aria-pressed={formulaType === 'block'}>Căn giữa <span>∫ f(x)</span></button>
      </div>
      <span className="label">Cách nhập</span>
      <div className="seg w-fit">
        <button type="button" onClick={() => onInputModeChange('visual')} aria-pressed={inputMode === 'visual'}>Trực quan</button>
        <button type="button" onClick={() => onInputModeChange('latex')} aria-pressed={inputMode === 'latex'}>LaTeX</button>
        <button type="button" onClick={() => {
          if (recognitionActive) return
          setPlainFormula('')
          onFormulaChange('')
          onInputModeChange('recognize')
        }} aria-pressed={recognitionActive}>Gõ thường</button>
      </div>
      {recognitionActive && <div>
        <label className="label" htmlFor="plain-formula">Công thức cần nhận diện</label>
        <textarea id="plain-formula" className="field min-h-24 resize-y" value={plainFormula}
          autoFocus={recognitionActive} maxLength={4000} placeholder="p >= N_train hoặc (a+b)/sqrt(x^2+1)"
          onChange={event => {
            const value = event.target.value
            setPlainFormula(value)
            onFormulaChange(recognizeFormula(value).latex)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              if (canInsert) onInsert()
            }
          }} />
        <p className="studio-dialog-note">Dùng / cho phân số, ^ cho số mũ, _ cho chỉ số; có thể gõ Macro-F1=F1Emerging+F1Stable+F1Declining3, Yc,t(4){'{'}Emerging,Stable,Declining{'}'} hoặc SalesPerActiveProductc,t=Salesc,tActiveProductsc,t. Dùng ngoặc để nhóm biểu thức.</p>
        {plainFormula && recognized.error && <p role="alert" className="studio-dialog-note">{recognized.error}</p>}
        <label className="label" htmlFor="recognized-latex">LaTeX nhận diện được</label>
        <textarea id="recognized-latex" className="field min-h-24 resize-y" readOnly value={recognized.latex} />
        <div className="studio-choice-row">
          <button type="button" disabled={!recognized.latex} onClick={() => onInputModeChange('latex')}>Sửa mã LaTeX</button>
          <button type="button" disabled={!recognized.latex} onClick={() => onInputModeChange('visual')}>Sửa trực quan</button>
        </div>
      </div>}
      <div hidden={inputMode !== 'visual'}>
        {mathliveReady ? <math-field ref={mathFieldRef} className="mathlive-field" aria-label="Nhập công thức toán học" math-virtual-keyboard-policy="manual" math-mode-space={'\\;'} smart-mode="on" smart-fence smart-superscript /> : <div className="studio-preview-box label" style={{ borderStyle: 'dashed' }}>Đang tải bàn phím công thức…</div>}
      </div>
      <textarea
        hidden={inputMode !== 'latex'}
        className="field min-h-24 resize-y"
        autoFocus={inputMode === 'latex'}
        value={formula}
        onChange={event => onFormulaChange(event.target.value)}
        onPaste={onUntrustedPaste}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onInsert() }}
        placeholder="\\frac{a}{b}"
      />
      <span className="label">Xem trước</span>
      <div className="studio-preview-box" dangerouslySetInnerHTML={{ __html: renderFormula(katexRenderer, normalizeFormula(formula) || '\\,', formulaType === 'block') }} />
      <div className="studio-dialog-foot">
        <span className="label">Ctrl + Enter để {editing ? 'lưu' : 'chèn'}</span>
        <button type="button" className="btn btn--solid" disabled={!canInsert} onClick={onInsert}><Plus size={14} /> {editing ? 'Lưu công thức' : 'Chèn công thức'}</button>
      </div>
    </DialogFrame>
  )
}

export function FormulaLibraryDialog({
  open,
  onClose,
  builtInTemplates,
  customTemplates,
  katexRenderer,
  onInsert,
  onRemove,
  adding,
  onAdd,
  name,
  onNameChange,
  latex,
  onLatexChange,
  type,
  onTypeChange,
  onSave,
}) {
  if (!open) return null

  return (
    <DialogFrame title="Thư viện công thức" Icon={BookOpen} width={640} onClose={onClose}>
      <div className="studio-list">
        {[...builtInTemplates, ...customTemplates].map(item => (
          <div className="studio-list-row" key={item.id}>
            <button type="button" onClick={() => onInsert(item.latex, item.type, item.untrusted === true)}>
              <span>{item.name}<small>{item.type === 'block' ? 'Căn giữa' : 'Trong dòng'}</small></span>
              <span className="studio-list-formula" dangerouslySetInnerHTML={{ __html: renderFormula(katexRenderer, item.latex, item.type === 'block') }} />
            </button>
            {item.id.startsWith('custom-') && <button type="button" className="btn btn--icon" aria-label={`Xóa mẫu ${item.name}`} title="Xóa mẫu" onClick={() => onRemove(item.id)}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      {adding ? (
        <>
          <label className="label" htmlFor="formula-template-name">Tên mẫu</label>
          <input id="formula-template-name" className="field" value={name} onChange={event => onNameChange(event.target.value)} placeholder="Ví dụ: Xác suất có điều kiện" />
          <label className="label" htmlFor="formula-template-latex">Biểu thức</label>
          <textarea id="formula-template-latex" className="field min-h-20 resize-y" value={latex} onChange={event => onLatexChange(event.target.value)} placeholder="P(A|B) = \\frac{P(A \\cap B)}{P(B)}" />
          <div className="studio-choice-row">
            <button type="button" onClick={() => onTypeChange('inline')} aria-pressed={type === 'inline'}>Trong dòng</button>
            <button type="button" onClick={() => onTypeChange('block')} aria-pressed={type === 'block'}>Căn giữa</button>
          </div>
          <div className="studio-dialog-foot">
            <span />
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={() => onAdd(false)}>Hủy</button>
              <button type="button" className="btn btn--solid" disabled={!name.trim() || !latex.trim()} onClick={onSave}><Plus size={14} /> Lưu mẫu</button>
            </div>
          </div>
        </>
      ) : (
        <button type="button" className="studio-add" onClick={() => onAdd(true)}><Plus size={14} /> Thêm mẫu riêng</button>
      )}
    </DialogFrame>
  )
}

export function DocumentTemplatesDialog({
  open,
  onClose,
  templates,
  activeId,
  onApply,
  onRemove,
  adding,
  onAdd,
  name,
  onNameChange,
  source,
  onSourceChange,
  onSave,
  defaultTemplate,
}) {
  if (!open) return null

  return (
    <DialogFrame title="Mẫu tài liệu LaTeX" Icon={FileStack} width={660} onClose={onClose}>
      <div className="studio-list">
        <div className={`studio-list-row ${!activeId ? 'is-current' : ''}`}>
          <div className="studio-list-text"><strong>Mẫu bài viết<small>{!activeId ? 'Đang dùng' : 'Article · 11 pt · lề 1 in'}</small></strong></div>
          <button type="button" className={`btn ${!activeId ? 'is-active' : ''}`} disabled={!activeId} onClick={() => onApply('')}>{!activeId ? 'Đang dùng' : 'Dùng mẫu'}</button>
        </div>
        {templates.map(item => (
          <div className={`studio-list-row ${activeId === item.id ? 'is-current' : ''}`} key={item.id}>
            <div className="studio-list-text"><strong><span className="truncate">{item.name}</span><small>{activeId === item.id ? 'Đang dùng' : item.description || 'Mẫu riêng'}</small></strong></div>
            <button type="button" className={`btn ${activeId === item.id ? 'is-active' : ''}`} disabled={activeId === item.id} onClick={() => onApply(item.id)}>{activeId === item.id ? 'Đang dùng' : 'Dùng mẫu'}</button>
            {!item.builtIn && <button type="button" className="btn btn--icon" title={`Xóa mẫu ${item.name}`} aria-label={`Xóa mẫu ${item.name}`} onClick={() => onRemove(item.id)}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      {adding ? (
        <>
          <label className="label" htmlFor="document-template-name">Tên mẫu</label>
          <input id="document-template-name" className="field" value={name} onChange={event => onNameChange(event.target.value)} placeholder="Ví dụ: Báo cáo có bìa" />
          <label className="label" htmlFor="document-template-source">Mã LaTeX đầy đủ</label>
          <textarea id="document-template-source" className="field min-h-40 resize-y" value={source} onChange={event => onSourceChange(event.target.value)} spellCheck={false} placeholder="Dán mã LaTeX của bạn tại đây…" />
          <p className="studio-dialog-note">Mẫu cần có <code className="studio-code">{'{{content}}'}</code>; dùng <code className="studio-code">{'{{title}}'}</code> cho tiêu đề và <code className="studio-code">{'{{abstract}}'}</code> ngay sau <code className="studio-code">{'\\maketitle'}</code> cho Abstract từ thiết lập.</p>
          <div className="studio-dialog-foot">
            <span />
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={() => onAdd(false)}>Hủy</button>
              <button type="button" className="btn btn--solid" disabled={!name.trim() || !source.includes('{{content}}')} onClick={onSave}><Plus size={14} /> Lưu và dùng</button>
            </div>
          </div>
        </>
      ) : (
        <button type="button" className="studio-add" onClick={() => { onSourceChange(defaultTemplate); onAdd(true) }}><Plus size={14} /> Thêm mẫu LaTeX riêng</button>
      )}
    </DialogFrame>
  )
}
