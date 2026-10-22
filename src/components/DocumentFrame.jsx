import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, Check, FileText, ListTree, PanelRightClose, Search, Settings2 } from 'lucide-react'
import { documentMap, PAPER_SIZES } from '../services/DocumentFrameData.js'

export default function DocumentFrame({ editor, document: doc, title, settings, onSettings, onClose, onJump, onOpenManager, onTemplates, onSource, sourceEdited, readOnly, templateName }) {
  const dialogRef = useRef(null)
  const [tab, setTab] = useState('structure')
  const [query, setQuery] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(160)
  const [activeBlock, setActiveBlock] = useState(() => editor?.state.selection.$from.index(0) ?? null)
  const [drawer, setDrawer] = useState(() => window.matchMedia('(max-width: 1280px)').matches)
  const map = useMemo(() => documentMap(doc, visibleLimit, query), [doc, visibleLimit, query])
  const previewRows = useMemo(() => documentMap(doc, 10).rows, [doc])
  const paper = PAPER_SIZES[settings.paper] || PAPER_SIZES.a4paper
  const locked = readOnly || sourceEdited
  const Frame = drawer ? 'dialog' : 'aside'
  useEffect(() => {
    if (!editor) return
    const update = () => setActiveBlock(editor.state.selection.$from.index(0))
    editor.on('selectionUpdate', update)
    return () => editor.off('selectionUpdate', update)
  }, [editor])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1280px)')
    const update = () => setDrawer(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = window.document.activeElement
    if (drawer) dialog.showModal()
    else dialog.querySelector('button')?.focus()
    return () => {
      const restore = dialog.contains(window.document.activeElement) || window.document.activeElement === window.document.body
      if (drawer) dialog.close()
      if (restore && previous?.isConnected) previous.focus()
    }
  }, [drawer])
  const update = (key, value) => onSettings({ ...settings, [key]: value })
  return <Frame ref={dialogRef} id="document-frame" className="document-frame" aria-labelledby="document-frame-title" aria-modal={drawer || undefined}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (!drawer || event.key !== 'Tab') return
      const items = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(item => item.tabIndex >= 0 && item.getClientRects().length)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    <header className="document-frame-head"><div><span className="document-frame-eyebrow">TỪ Ý TƯỞNG ĐẾN BẢN IN</span><h2 id="document-frame-title">Khung tài liệu</h2></div><button autoFocus type="button" className="btn btn--icon btn--ghost" onClick={onClose} aria-label="Đóng khung tài liệu"><PanelRightClose size={17} /></button></header>
    <div className="document-frame-tabs" role="tablist" aria-label="Nội dung khung tài liệu">
      {[['structure', 'Cấu trúc', ListTree], ['page', 'Trang & lề', FileText]].map(([id, label, Icon], index) => <button key={id} type="button" role="tab" id={`frame-tab-${id}`} aria-selected={tab === id} aria-controls={`frame-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'structure' : event.key === 'End' ? 'page' : index === 0 ? 'page' : 'structure'
        setTab(next); dialogRef.current.querySelector(`#frame-tab-${next}`)?.focus()
      }}><Icon size={14} />{label}</button>)}
    </div>
    <div className="document-frame-body">
      {sourceEdited && <p className="document-frame-note">PDF đang dùng LaTeX riêng. Sơ đồ dưới đây mô tả bản thảo.<button type="button" onClick={onSource}>Mở LaTeX <ArrowUpRight size={12} /></button></p>}
      {readOnly && <p className="document-frame-note">Bản tổng hợp chỉ đọc. Chọn tab gốc để sửa thiết lập.</p>}
      <section id="frame-panel-structure" role="tabpanel" aria-labelledby="frame-tab-structure" hidden={tab !== 'structure'}>
        <p className="document-frame-intro">Nhìn toàn bộ mạch viết. Chọn một khối để đến đúng vị trí trong bản thảo.</p>
        {map.total > 0 && <div className="document-frame-search"><label><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisibleLimit(160) }} placeholder="Tìm trong cấu trúc…" aria-label="Tìm khối trong tài liệu" /></label><span>{query.trim() ? `${map.matched} kết quả / ${map.total} khối` : `${map.total} khối trong bản thảo`}</span></div>}
        <div className="document-frame-cover"><FileText size={18} /><div><strong>{title || 'Chưa đặt tên'}</strong><span>{templateName || 'Bài viết mặc định'}</span></div></div>
        {settings.abstractEnabled && <button type="button" className="document-frame-frontmatter" onClick={() => onOpenManager('settings')}><span>A</span>{settings.abstractTitle || 'Abstract'}<ArrowUpRight size={12} /></button>}
        {settings.tableOfContents && <div className="document-frame-frontmatter"><ListTree size={14} />Mục lục tự động</div>}
        <ol className="document-frame-map" aria-label="Các khối trong bản thảo">{map.rows.map(row => <li key={row.blockIndex} data-kind={row.kind} style={{ '--depth': Math.max(0, row.level - 1) }}><button type="button" title={row.label} aria-current={activeBlock === row.blockIndex ? 'location' : undefined} onClick={() => { if (drawer) onClose(); onJump(row.blockIndex) }}><span className="document-frame-badge">{row.badge}</span><span>{row.label}</span></button></li>)}</ol>
        {!map.total && <div className="document-frame-empty"><ListTree size={30} /><strong>Bắt đầu từ một dàn ý</strong><p>Thêm tiêu đề, đoạn văn, bảng hoặc công thức. Cấu trúc sẽ xuất hiện tại đây khi bạn viết.</p><button type="button" onClick={onTemplates} disabled={readOnly}>Chọn mẫu có sẵn <ArrowUpRight size={13} /></button></div>}
        {map.total > 0 && map.matched === 0 && <p className="document-frame-intro document-frame-no-results" role="status">Không tìm thấy khối phù hợp. Thử một từ khác hoặc xóa nội dung tìm kiếm.</p>}
        {map.remaining > 0 && <button type="button" className="document-frame-more" onClick={() => setVisibleLimit(value => value + 160)}>Hiện thêm {Math.min(160, map.remaining)} khối <span>({map.remaining} khối còn lại)</span></button>}
      </section><section id="frame-panel-page" role="tabpanel" aria-labelledby="frame-tab-page" hidden={tab !== 'page'}>
        <figure className="document-frame-preview">
          <div className="document-frame-paper" style={{ aspectRatio: `${paper.width} / ${paper.height}` }} aria-label={`Sơ đồ trang ${paper.label}, lề ${settings.margin} mm`} role="img">
            <div className="document-frame-printarea" style={{ inset: `${settings.margin / paper.height * 100}% ${settings.margin / paper.width * 100}%` }}><strong>{title || 'Tiêu đề tài liệu'}</strong>{settings.author && <span className="document-frame-author">{settings.author}</span>}{settings.date && <span className="document-frame-author">{settings.date}</span>}
              {settings.abstractEnabled && <div className="document-frame-mini-abstract"><b>{settings.abstractTitle || 'Abstract'}</b><i /><i /><i /></div>}
              {settings.tableOfContents && <div className="document-frame-mini-toc"><b>Mục lục</b><i /><i /></div>}
              <div className="document-frame-mini-body">{(previewRows.length ? previewRows : [{ kind: 'heading' }, { kind: 'paragraph' }, { kind: 'paragraph' }, { kind: 'paragraph' }]).map((row, index) => <span key={index} data-kind={row.kind}>{row.kind === 'heading' ? row.label || 'Nội dung chính' : row.kind === 'blockMath' ? 'ƒ(x)' : row.kind === 'imageBlock' ? '▧' : ''}</span>)}</div>
            </div>
          </div>
          <figcaption><strong>{paper.label} · {paper.width} × {paper.height} mm</strong><span>Sơ đồ bố cục. Kiểm tra phân trang ở Bản in.</span></figcaption>
        </figure>
        {templateName && <p className="document-frame-note">Mẫu “{templateName}” có thể quy định bố cục riêng. PDF thể hiện kết quả cuối cùng.</p>}
        <fieldset className="document-frame-fields" disabled={locked}><legend>Thiết lập trang</legend>
          <label>Khổ giấy<select aria-label="Khổ giấy" value={settings.paper} onChange={event => update('paper', event.target.value)}>{Object.entries(PAPER_SIZES).map(([id, size]) => <option value={id} key={id}>{size.label}</option>)}</select></label>
          <label>Lề đều (mm)<input type="number" min="10" max="50" step="0.5" defaultValue={settings.margin} key={settings.margin} onBlur={event => { const value = event.target.valueAsNumber; const next = Number.isFinite(value) ? Math.max(10, Math.min(50, value)) : settings.margin; event.target.value = String(next); if (next !== settings.margin) update('margin', next) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <label>Cỡ chữ<select aria-label="Cỡ chữ" value={settings.fontSize} onChange={event => update('fontSize', Number(event.target.value))}>{[10, 11, 12].map(size => <option key={size} value={size}>{size} pt</option>)}</select></label>
          <label>Giãn dòng<select aria-label="Giãn dòng" value={settings.lineSpacing} onChange={event => update('lineSpacing', Number(event.target.value))}>{[...new Set([1, 1.2, 1.5, 2, settings.lineSpacing])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          <label className="document-frame-check"><input type="checkbox" checked={settings.abstractEnabled} onChange={event => update('abstractEnabled', event.target.checked)} /><span>Thêm Abstract</span>{settings.abstractEnabled && <Check size={13} />}</label>
          <label className="document-frame-check"><input type="checkbox" checked={settings.tableOfContents} onChange={event => update('tableOfContents', event.target.checked)} /><span>In mục lục trong PDF</span>{settings.tableOfContents && <Check size={13} />}</label>
        </fieldset>
      </section>
    </div>
    <footer className="document-frame-foot"><button type="button" onClick={() => onOpenManager('settings')}><Settings2 size={14} />Trang & tác giả<ArrowUpRight size={12} /></button><button type="button" onClick={onTemplates} disabled={readOnly}><BookOpen size={14} />Thư viện mẫu<ArrowUpRight size={12} /></button></footer>
  </Frame>
}
