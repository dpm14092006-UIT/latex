import { useEffect, useMemo, useState } from 'react'
import { TableMap } from '@tiptap/pm/tables'
import { AlignCenter, AlignLeft, AlignRight, Check, Copy, Table2, Wand2, X } from 'lucide-react'
import { tableLatexPreview } from '../services/DocumentSerializer.js'
import {
  createPresetTable,
  normalizeCellAlign,
  normalizeTableStyle,
  TABLE_CAPTION_POSITIONS,
  TABLE_FONT_SIZES,
  TABLE_PRESETS,
  TABLE_ROW_SPACINGS,
  TABLE_STYLES,
  TABLE_WIDTHS,
} from '../services/TableStyles.js'

const ALIGN_OPTIONS = [
  ['left', 'Trái', AlignLeft],
  ['center', 'Giữa', AlignCenter],
  ['right', 'Phải', AlignRight],
]

// Position of the table that contains the selection, or -1.
export function findSelectedTable(state) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return $from.before(depth)
  }
  return -1
}

function StyleThumb({ style }) {
  return <table className="table-library-thumb" data-table-style={style} aria-hidden="true">
    <tbody>
      <tr><th /><th /><th /></tr>
      <tr><td /><td /><td /></tr>
      <tr><td /><td /><td /></tr>
      <tr><td /><td /><td /></tr>
    </tbody>
  </table>
}

function columnInfo(table) {
  const map = TableMap.get(table)
  const columns = Array.from({ length: map.width }, () => ({ label: '', aligns: [] }))
  const seen = new Set()
  for (let index = 0; index < map.map.length; index += 1) {
    const offset = map.map[index]
    if (seen.has(offset)) continue
    seen.add(offset)
    const column = map.colCount(offset)
    const cell = table.nodeAt(offset)
    if (!cell) continue
    if (!columns[column].label && cell.type.name === 'tableHeader') columns[column].label = cell.textContent.trim()
    if (cell.attrs.colspan === 1) columns[column].aligns.push(normalizeCellAlign(cell.attrs.align))
  }
  return columns.map(({ label, aligns }, index) => {
    const explicit = aligns.filter(Boolean)
    const align = explicit.length && explicit.length === aligns.length && explicit.every(value => value === explicit[0]) ? explicit[0] : explicit.length ? 'mixed' : null
    return { label: label || `Cột ${index + 1}`, align }
  })
}

export default function TableLibrary({ editor, onClose }) {
  const [tablePos] = useState(() => (editor ? findSelectedTable(editor.state) : -1))
  const editing = tablePos >= 0
  const [mode, setMode] = useState(editing ? 'edit' : 'insert')
  const [revision, setRevision] = useState(0)
  const [presetId, setPresetId] = useState(TABLE_PRESETS[0].id)
  const [draftStyle, setDraftStyle] = useState(() => normalizeTableStyle(TABLE_PRESETS[0].style))
  const [size, setSize] = useState({ rows: TABLE_PRESETS[0].rows, cols: TABLE_PRESETS[0].header.length })
  const [caption, setCaption] = useState('')
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!editor) return undefined
    const refresh = () => setRevision(value => value + 1)
    editor.on('transaction', refresh)
    return () => editor.off('transaction', refresh)
  }, [editor])

  // The dialog is modal and LAN updates are held while it is open, so the
  // table keeps its position; it is still re-checked before every change.
  const table = useMemo(() => {
    if (!editor || !editing) return null
    const node = editor.state.doc.nodeAt(tablePos)
    return node?.type.name === 'table' ? node : null
    // revision tracks editor transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editing, tablePos, revision])
  const editMode = mode === 'edit' && table
  const style = editMode ? normalizeTableStyle(table.attrs) : draftStyle
  const columns = useMemo(() => (editMode ? columnInfo(table) : []), [editMode, table])
  const preset = TABLE_PRESETS.find(item => item.id === presetId) || TABLE_PRESETS[0]
  const draftTable = useMemo(() => {
    const json = createPresetTable({ ...preset, style: draftStyle }, size)
    json.attrs.caption = caption.trim()
    return json
  }, [preset, draftStyle, size, caption])
  const latex = useMemo(() => {
    try {
      return tableLatexPreview(editMode ? table.toJSON() : draftTable)
    } catch {
      return ''
    }
  }, [editMode, table, draftTable])

  const dispatchTable = build => {
    const current = editor?.state.doc.nodeAt(tablePos)
    if (!current || current.type.name !== 'table') {
      setMessage('Không còn tìm thấy bảng này trong bản thảo. Hãy đóng hộp thoại và chọn lại bảng.')
      return
    }
    const transaction = editor.state.tr
    build(transaction, current)
    if (transaction.docChanged) editor.view.dispatch(transaction)
  }
  const updateStyle = patch => {
    if (!editMode) {
      setDraftStyle(value => normalizeTableStyle({ ...value, ...patch }))
      return
    }
    dispatchTable((transaction, current) => transaction.setNodeMarkup(tablePos, null, { ...current.attrs, ...patch }))
  }
  const updateTableText = (name, value) => dispatchTable((transaction, current) => {
    if ((current.attrs[name] || '') !== value) transaction.setNodeMarkup(tablePos, null, { ...current.attrs, [name]: value })
  })
  const setColumnAlign = (column, align) => dispatchTable((transaction, current) => {
    const map = TableMap.get(current)
    const seen = new Set()
    for (let row = 0; row < map.height; row += 1) {
      const offset = map.map[row * map.width + column]
      if (seen.has(offset) || map.colCount(offset) !== column) continue
      seen.add(offset)
      const cell = current.nodeAt(offset)
      if (cell && cell.attrs.colspan === 1 && cell.attrs.align !== align) transaction.setNodeMarkup(tablePos + 1 + offset, null, { ...cell.attrs, align })
    }
  })
  const choosePreset = item => {
    setPresetId(item.id)
    setDraftStyle(normalizeTableStyle(item.style))
    setSize({ rows: item.rows, cols: item.header.length })
  }
  const insertTable = () => {
    if (!editor) return
    const inserted = editor.chain().focus().insertContent(draftTable).run()
    if (inserted) onClose()
    else setMessage('Không chèn được bảng ở vị trí con trỏ hiện tại. Hãy đặt con trỏ vào một đoạn văn rồi thử lại.')
  }
  const copyLatex = async () => {
    try {
      await navigator.clipboard.writeText(latex)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setMessage('Không sao chép được vào bộ nhớ tạm.')
    }
  }
  const clampSize = (value, max) => Math.max(1, Math.min(max, Math.floor(Number(value) || 1)))

  return <div className="modal-backdrop studio-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="studio-dialog table-library" role="dialog" aria-modal="true" aria-labelledby="table-library-title">
      <header className="studio-dialog-head">
        <h2 id="table-library-title"><Table2 size={20} strokeWidth={1.8} />Thư viện bảng</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
      </header>
      <div className="studio-dialog-body table-library-body">
        {editing && <div className="table-library-tabs" role="tablist" aria-label="Chế độ">
          <button type="button" role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}>Tinh chỉnh bảng đang chọn</button>
          <button type="button" role="tab" aria-selected={mode === 'insert'} className={mode === 'insert' ? 'is-active' : ''} onClick={() => setMode('insert')}>Chèn bảng mới</button>
        </div>}
        {message && <p role="alert" className="studio-notice">{message}</p>}

        {!editMode && <section className="table-library-section" aria-labelledby="table-library-presets">
          <h3 id="table-library-presets">Mẫu dựng sẵn</h3>
          <div className="table-library-presets">
            {TABLE_PRESETS.map(item => <button type="button" key={item.id} className={presetId === item.id ? 'is-active' : ''} aria-pressed={presetId === item.id} onClick={() => choosePreset(item)}>
              <strong>{item.label}</strong>
              <span>{item.header.filter(Boolean).join(' · ') || 'Bảng bố cục không tiêu đề'}</span>
            </button>)}
          </div>
          <div className="table-library-size">
            <label>Số hàng nội dung<input type="number" min={1} max={100} value={size.rows} onChange={event => setSize(value => ({ ...value, rows: clampSize(event.target.value, 100) }))} /></label>
            <label>Số cột<input type="number" min={1} max={20} value={size.cols} onChange={event => setSize(value => ({ ...value, cols: clampSize(event.target.value, 20) }))} /></label>
            <label className="table-library-grow">Chú thích<input maxLength={500} placeholder="Ví dụ: Kết quả thực nghiệm" value={caption} onChange={event => setCaption(event.target.value)} /></label>
          </div>
        </section>}

        <section className="table-library-section" aria-labelledby="table-library-styles">
          <h3 id="table-library-styles">Kiểu đường kẻ</h3>
          <div className="table-library-styles">
            {TABLE_STYLES.map(item => <button type="button" key={item.id} className={style.tableStyle === item.id ? 'is-active' : ''} aria-pressed={style.tableStyle === item.id} title={item.description} onClick={() => updateStyle({ tableStyle: item.id })}>
              <StyleThumb style={item.id} />
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>)}
          </div>
        </section>

        <section className="table-library-section" aria-labelledby="table-library-tune">
          <h3 id="table-library-tune">Tinh chỉnh</h3>
          <div className="table-library-options">
            <label>Cỡ chữ<select value={style.fontSize} onChange={event => updateStyle({ fontSize: event.target.value })}>{TABLE_FONT_SIZES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Giãn dòng<select value={style.rowSpacing} onChange={event => updateStyle({ rowSpacing: event.target.value })}>{TABLE_ROW_SPACINGS.map(item => <option key={item.id} value={item.id}>{item.label} ({item.id})</option>)}</select></label>
            <label>Độ rộng<select value={style.tableWidth} onChange={event => updateStyle({ tableWidth: event.target.value })} title={TABLE_WIDTHS.find(item => item.id === style.tableWidth)?.description}>{TABLE_WIDTHS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Chú thích<select value={style.captionPosition} onChange={event => updateStyle({ captionPosition: event.target.value })}>{TABLE_CAPTION_POSITIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="table-library-check"><input type="checkbox" checked={style.headerBold} onChange={event => updateStyle({ headerBold: event.target.checked })} />Tiêu đề in đậm</label>
          </div>
          {editMode && <div className="table-library-size">
            <label className="table-library-grow">Chú thích bảng<input maxLength={500} defaultValue={table.attrs.caption || ''} key={`caption-${tablePos}`} onBlur={event => updateTableText('caption', event.currentTarget.value.trim())} /></label>
            <label>Nhãn LaTeX<input maxLength={100} placeholder="tab:ket-qua" defaultValue={table.attrs.label || ''} key={`label-${tablePos}`} onBlur={event => updateTableText('label', event.currentTarget.value.trim().replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 100))} /></label>
          </div>}
        </section>

        {editMode && <section className="table-library-section" aria-labelledby="table-library-columns">
          <h3 id="table-library-columns">Căn lề từng cột</h3>
          <p className="studio-dialog-note">Tự động: cột chỉ chứa số được căn phải, còn lại căn trái. Có thể căn riêng từng ô bằng nút căn lề trên thanh công cụ.</p>
          <div className="table-library-columns">
            {columns.map((column, index) => <div className="table-library-column" key={index} role="group" aria-label={`Căn lề ${column.label}`}>
              <span title={column.label}>{column.label}</span>
              <button type="button" className={column.align === null ? 'is-active' : ''} aria-pressed={column.align === null} onClick={() => setColumnAlign(index, null)}><Wand2 size={13} />Tự động</button>
              {ALIGN_OPTIONS.map(([value, label, Icon]) => <button type="button" key={value} className={column.align === value ? 'is-active' : ''} aria-pressed={column.align === value} title={`Căn ${label.toLowerCase()}`} aria-label={`Căn ${label.toLowerCase()}`} onClick={() => setColumnAlign(index, value)}><Icon size={14} /></button>)}
              {column.align === 'mixed' && <em>Nhiều kiểu</em>}
            </div>)}
          </div>
        </section>}

        <section className="table-library-section" aria-labelledby="table-library-latex">
          <div className="table-library-latex-head">
            <h3 id="table-library-latex">Mã LaTeX sẽ biên dịch</h3>
            <button type="button" className="btn btn--sm" onClick={copyLatex} disabled={!latex}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Đã sao chép' : 'Sao chép'}</button>
          </div>
          <pre className="table-library-code" tabIndex={0} aria-label="Mã LaTeX của bảng">{latex}</pre>
        </section>

        <footer className="table-library-foot">
          {editMode
            ? <><span className="studio-dialog-note">Thay đổi được áp dụng ngay; Ctrl+Z để hoàn tác.</span><button type="button" className="btn btn--solid" onClick={onClose}>Xong</button></>
            : <><button type="button" className="btn" onClick={onClose}>Hủy</button><button type="button" className="btn btn--solid" onClick={insertTable}>Chèn bảng</button></>}
        </footer>
      </div>
    </section>
  </div>
}
