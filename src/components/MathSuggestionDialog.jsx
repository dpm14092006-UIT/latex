import { Check, RefreshCw, ScanSearch, X } from 'lucide-react'
import { closeHistory } from '@tiptap/pm/history'
import { useEditorState } from '@tiptap/react'
import { useState } from 'react'
import { scanMathDocument } from '../services/MathSuggestionScanner.js'

function preview(renderer, latex, displayMode) {
  if (!renderer) return latex
  try {
    return renderer.renderToString(latex, { throwOnError: false, displayMode, trust: false })
  } catch {
    return latex
  }
}

function runScan(editor) {
  const doc = editor.state.doc
  return { doc, ...scanMathDocument(doc) }
}

export default function MathSuggestionDialog({ editor, katexRenderer, onClose }) {
  const [scan, setScan] = useState(() => runScan(editor))
  const [selected, setSelected] = useState(() => new Set())
  const [modes, setModes] = useState(() => Object.fromEntries(scan.suggestions.map(item => [item.id, item.defaultType])))
  const [message, setMessage] = useState('')
  const currentDoc = useEditorState({ editor, selector: ({ editor: current }) => current?.state.doc })
  const stale = scan.doc !== currentDoc
  const selectedItems = scan.suggestions.filter(item => selected.has(item.id))

  const rescan = () => {
    const result = runScan(editor)
    setScan(result)
    setSelected(new Set())
    setModes(Object.fromEntries(result.suggestions.map(item => [item.id, item.defaultType])))
    setMessage('')
  }

  const chooseAllHighConfidence = () => {
    const ids = scan.suggestions.filter(item => item.level === 'high').map(item => item.id)
    setSelected(new Set(ids))
    setMessage(`Đã chọn ${ids.length} gợi ý tin cậy cao để bạn duyệt; bản thảo chưa thay đổi.`)
  }

  const applySelected = () => {
    if (stale) {
      setMessage('Bản thảo đã thay đổi sau lần quét. Hãy quét lại để cập nhật vị trí trước khi chuyển.')
      return
    }
    if (!selectedItems.length) return
    try {
      editor.view.dispatch(closeHistory(editor.state.tr))
      const transaction = editor.state.tr
      for (const item of [...selectedItems].sort((a, b) => b.from - a.from)) {
        const mode = modes[item.id] === 'block' && item.blockEligible ? 'block' : 'inline'
        const nodeType = mode === 'block' ? editor.schema.nodes.blockMath : editor.schema.nodes.inlineMath
        if (!nodeType) throw new Error('Không tìm thấy loại node công thức trong editor.')
        const mathNode = nodeType.create({ latex: item.latex })
        if (mode === 'block') {
          const existing = transaction.doc.nodeAt(item.blockFrom)
          if (!existing || existing.nodeSize !== item.blockTo - item.blockFrom || existing.textContent.trim() !== item.source) {
            throw new Error('Một đoạn được chọn không còn khớp bản thảo. Hãy quét lại rồi thử lại.')
          }
          transaction.replaceRangeWith(item.blockFrom, item.blockTo, mathNode)
        } else {
          const currentText = transaction.doc.textBetween(item.from, item.to, '', '\uFFFC')
          if (currentText !== item.source) throw new Error('Một đoạn được chọn không còn khớp bản thảo. Hãy quét lại rồi thử lại.')
          transaction.replaceRangeWith(item.from, item.to, mathNode)
        }
      }
      if (!transaction.docChanged) return
      editor.view.dispatch(transaction.scrollIntoView())
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor.commands.focus()
      onClose()
    } catch (error) {
      setMessage(error.message || 'Không thể chuyển các gợi ý đã chọn. Hãy quét lại và thử lại.')
    }
  }

  return <div className="modal-backdrop studio-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="studio-dialog math-suggestion-dialog" role="dialog" aria-modal="true" aria-labelledby="math-suggestion-title">
      <header className="studio-dialog-head">
        <h2 id="math-suggestion-title"><ScanSearch size={20} strokeWidth={1.8} />Quét gợi ý LaTeX</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
      </header>
      <div className="studio-dialog-body">
        <p className="studio-dialog-note">Quét đoạn văn và tìm biểu thức có cấu trúc toán. App chỉ đề xuất; bạn chọn đoạn cần chuyển và chọn kiểu hiển thị. Mã, liên kết và công thức đã có được bỏ qua.</p>
        <div className="studio-manager-actions">
          <button type="button" className="btn" onClick={rescan}><RefreshCw size={14} /> Quét lại</button>
          <button type="button" className="btn" disabled={!scan.suggestions.some(item => item.level === 'high')} onClick={chooseAllHighConfidence}>Chọn gợi ý tin cậy cao</button>
        </div>
        {stale && <p role="alert" className="studio-notice">Bản thảo đã thay đổi; hãy quét lại để làm mới vị trí gợi ý.</p>}
        {message && <p role="status" className="studio-notice">{message}</p>}
        <p className="studio-dialog-note" role="status">Đã quét {scan.scannedBlocks} đoạn · {scan.suggestions.length} gợi ý · {scan.suggestions.filter(item => item.level === 'high').length} tin cậy cao · {scan.suggestions.filter(item => item.level === 'review').length} cần xem lại.{scan.truncated ? ' Kết quả đạt giới hạn quét; hãy quét lại sau khi xử lý các gợi ý.' : ''}</p>
        {scan.suggestions.length ? <div className="math-suggestion-list" role="group" aria-label="Gợi ý chuyển sang LaTeX">
          {scan.suggestions.map(item => {
            const mode = modes[item.id] === 'block' && item.blockEligible ? 'block' : 'inline'
            return <article className="math-suggestion-row" key={item.id}>
              <label className="math-suggestion-select">
                <input type="checkbox" aria-label={`Duyệt ${item.source}`} checked={selected.has(item.id)} disabled={stale} onChange={event => setSelected(previous => {
                  const next = new Set(previous)
                  if (event.target.checked) next.add(item.id)
                  else next.delete(item.id)
                  return next
                })} />
                <strong>{item.level === 'high' ? 'Tin cậy cao' : 'Cần xem lại'} · {Math.round(item.confidence * 100)}%</strong>
              </label>
              <p className="math-suggestion-context">…{item.context}…</p>
              <p className="math-suggestion-source"><code>{item.source}</code></p>
              <p className="studio-dialog-note">{item.reason}</p>
              <div className="studio-preview-box math-suggestion-preview" dangerouslySetInnerHTML={{ __html: preview(katexRenderer, item.latex, mode === 'block') }} />
              <label className="math-suggestion-mode">Kiểu chèn
                <select className="field" aria-label={`Kiểu chèn ${item.source}`} value={mode} disabled={stale} onChange={event => setModes(previous => ({ ...previous, [item.id]: event.target.value }))}>
                  <option value="inline">Trong dòng</option>
                  {item.blockEligible && <option value="block">Căn giữa, xuống dòng riêng</option>}
                </select>
              </label>
            </article>
          })}
        </div> : <div className="math-suggestion-empty">Chưa tìm thấy đoạn đủ dấu hiệu để gợi ý. Quét này không thay đổi nội dung bản thảo.</div>}
        <div className="studio-dialog-foot">
          <span className="label">Đã chọn {selectedItems.length} đoạn</span>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>Đóng</button>
            <button type="button" className="btn btn--solid" disabled={!selectedItems.length || stale} onClick={applySelected}><Check size={14} /> Chuyển {selectedItems.length} gợi ý</button>
          </div>
        </div>
      </div>
    </section>
  </div>
}
