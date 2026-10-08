import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookMarked, FileUp, Plus, Quote, Search, Trash2, X } from 'lucide-react'
import {
  CITATION_STYLES, citationDiagnostics, citationLabel, citationNumbers, citationOccurrences,
  describeEntry, entrySearchText, extractDoi, parseBibtex,
  isAuthorYearStyle, removeBibtexEntry, resolveCitationStyle,
} from '../services/Bibliography.js'
import { importReferences } from '../services/ReferenceImport.js'
import { citationEditTransaction } from '../services/CitationEditing.js'
import CitationScanPanel from './CitationScanPanel.jsx'
import { closeHistory } from '@tiptap/pm/history'
import { removeAllCitationTransaction } from '../services/CitationLinker.js'

const MAX_BIBTEX = 500_000

function EntryText({ entry, missing }) {
  if (missing) return <span><span className="cite-item-title">{entry.key}</span><span className="cite-item-meta">Chưa có trong danh mục tài liệu</span></span>
  const info = describeEntry(entry)
  return <span>
    <span className="cite-item-title">{info.title || entry.key}</span>
    <span className="cite-item-meta">{[info.authors, info.year, info.venue].filter(Boolean).join(' · ')}</span>
    <span className="cite-item-meta"><code>{entry.key}</code>{info.doi ? ` · doi:${info.doi}` : info.url ? ` · ${info.url}` : ''}</span>
  </span>
}

export default function ReferencesDialog({ open, initialTab = 'cite', editing = null, insertionSelection = null, editor, settings, onSettings, templateSource, sourceEdited = false, onClose }) {
  const [tab, setTab] = useState(initialTab)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => editing?.keys || [])
  const [citationMode, setCitationMode] = useState(editing?.mode || 'parenthetical')
  const [active, setActive] = useState(0)
  const [importText, setImportText] = useState('')
  const [sourceImportLabel, setSourceImportLabel] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const searchRef = useRef(null)
  const fileRef = useRef(null)
  const listRef = useRef(null)
  const latestSettingsRef = useRef(settings)
  latestSettingsRef.current = settings
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const bibliography = settings.bibliography
  const entries = useMemo(() => parseBibtex(bibliography), [bibliography])
  const style = resolveCitationStyle(settings.citationStyle, templateSource)
  // Serialize once per document version, not on every keystroke in the dialog's fields: the dialog's own
  // edits (remove all, key renames) produce a new ProseMirror doc and re-render through setMessage/onSettings.
  const editorDoc = open && editor && !editor.isDestroyed ? editor.state.doc : null
  const doc = useMemo(() => editorDoc ? editorDoc.toJSON() : null, [editorDoc])
  const occurrences = useMemo(() => citationOccurrences(doc), [doc])
  const citationCount = occurrences.length
  const numbers = useMemo(() => citationNumbers(occurrences, entries, style), [occurrences, entries, style])
  const diagnostics = useMemo(() => citationDiagnostics(doc, entries), [doc, entries])
  const byKey = useMemo(() => new Map(entries.map(entry => [entry.key, entry])), [entries])

  const ordered = useMemo(() => {
    const cited = entries.filter(entry => numbers.has(entry.key)).sort((a, b) => numbers.get(a.key) - numbers.get(b.key))
    const rest = entries.filter(entry => !numbers.has(entry.key))
    if (isAuthorYearStyle(style)) return [...entries].sort((a, b) => entrySearchText(a).localeCompare(entrySearchText(b), 'vi'))
    return [...cited, ...rest]
  }, [entries, numbers, style])
  const filtered = useMemo(() => {
    const words = query.toLocaleLowerCase('vi').split(/\s+/).filter(Boolean)
    return words.length ? ordered.filter(entry => { const text = entrySearchText(entry); return words.every(word => text.includes(word)) }) : ordered
  }, [ordered, query])
  const previewNumbers = useMemo(() => {
    if (!selected.length || !editorDoc) return numbers
    try {
      const proposed = citationEditTransaction(editor.state, { keys: selected, mode: citationMode, editing, insertionSelection })
      if (proposed) return citationNumbers(citationOccurrences(proposed.doc.toJSON()), entries, style)
    } catch { /* The apply action reports stale selections without modifying the document. */ }
    return numbers
  }, [selected, editorDoc, editor, citationMode, editing, insertionSelection, entries, style, numbers])

  // The app's modal focus trap focuses the first field on open; on close, hand the caret back to the editor
  // (after the trap restores focus) so typing continues right after the citation.
  useEffect(() => () => { window.requestAnimationFrame(() => { if (editor && !editor.isDestroyed && !document.querySelector('.modal-backdrop [role="dialog"]')) editor.commands.focus() }) }, [editor])
  useEffect(() => { listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' }) }, [active])
  if (!open) return null

  const authorYear = isAuthorYearStyle(style)
  const numberText = (key, fallback) => numbers.has(key) ? (authorYear ? '✓' : `[${numbers.get(key)}]`) : fallback
  const toggle = key => setSelected(value => value.includes(key) ? value.filter(item => item !== key) : [...value, key])
  const updateBibliography = text => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text).length
    if (bytes > MAX_BIBTEX && bytes >= encoder.encode(bibliography).length) { setMessage('Danh mục BibTeX vượt quá 500 KB tính theo UTF-8. Thao tác vừa nhập chưa được áp dụng.'); return }
    onSettings({ ...settings, bibliography: text })
  }

  const removeAllCitations = () => {
    if (!editor || editor.isDestroyed || sourceEdited) return
    const result = removeAllCitationTransaction(editor.state)
    if (!result) return
    editor.view.dispatch(result.transaction)
    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.commands.focus()
    setMessage(`Đã xóa ${result.count} vị trí trích dẫn khỏi bản thảo. Danh mục tài liệu vẫn được giữ nguyên; nhấn Ctrl+Z để hoàn tác riêng thao tác xóa.`)
  }

  const applyCitation = keysToInsert => {
    if (!editor || editor.isDestroyed) return
    const keys = keysToInsert.filter(key => byKey.has(key) || editing?.keys?.includes(key))
    try {
      if (keys.some(key => diagnostics.duplicates.includes(key) || diagnostics.invalidKeys.includes(key))) throw Error('Khóa REF bị trùng hoặc không hợp lệ. Hãy sửa BibTeX trong Danh mục trước khi cite.')
      const transaction = citationEditTransaction(editor.state, { keys, mode: citationMode, editing, insertionSelection })
      if (!transaction) return
      editor.view.dispatch(transaction)
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor.commands.focus()
      onClose()
    } catch (error) { setMessage(error.message) }
  }

  const runImport = async text => {
    if (!text.trim()) return
    setBusy(true); setMessage('')
    try {
      const result = await importReferences(text, bibliography, setMessage)
      if (!mountedRef.current) return
      if (latestSettingsRef.current.bibliography !== bibliography) throw Error('Danh mục đã thay đổi trong lúc nhập. Hãy nhập lại để giữ các chỉnh sửa mới.')
      if (Object.keys(result.keyRenames).length && editor && !editor.isDestroyed) {
        const transaction = editor.state.tr
        let changed = false
        editor.state.doc.descendants((node, position) => {
          if (node.type.name !== 'citation') return
          const nextKey = String(node.attrs.key || '').split(',').map(key => result.keyRenames[key] || key).join(',')
          if (nextKey !== node.attrs.key) { transaction.setNodeMarkup(position, undefined, { ...node.attrs, key: nextKey }); changed = true }
        })
        if (changed) editor.view.dispatch(transaction)
      }
      const maps = (latestSettingsRef.current.citationSourceMaps || []).map(map => ({
        ...map,
        numbers: Object.fromEntries(Object.entries(map.numbers || {}).map(([number, keys]) => [number, Array.isArray(keys) ? keys.map(key => result.keyRenames[key] || key) : keys])),
      }))
      if (Object.keys(result.sourceNumbers).length) maps.push({ id: crypto.randomUUID(), label: sourceImportLabel.trim() || `Danh mục nhập ${maps.length + 1}`, numbers: result.sourceNumbers })
      onSettings({ ...latestSettingsRef.current, bibliography: result.text, citationSourceMaps: maps.slice(-50) })
      if (tab === 'cite') setSelected(value => [...new Set([...value.map(key => result.keyRenames[key] || key), ...result.addedKeys])])
      setImportText('')
      setSourceImportLabel('')
      setAddOpen(false)
      setMessage([
        result.added ? `Đã thêm ${result.added} tài liệu.` : result.updated ? `Đã cập nhật ${result.updated} tài liệu trùng DOI.` : result.addedKeys.length ? 'Tài liệu đã có sẵn trong danh mục.' : '',
        ...result.errors,
        result.parsedFromText ? `${result.parsedFromText} tài liệu được nhận diện từ văn bản${extractDoi(text) ? ' vì không tra được DOI' : ''}; hãy kiểm tra tác giả, năm, tiêu đề và thông tin xuất bản trong BibTeX.` : '',
      ].filter(Boolean).join(' '))
    } catch (error) {
      setMessage(error.message || 'Không thêm được tài liệu.')
    } finally { setBusy(false) }
  }

  const onSearchKey = event => {
    // Enter that commits an IME composition (Vietnamese Telex/VNI) must not insert a citation.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(filtered.length - 1, value + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)) }
    else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); if (filtered[active]) toggle(filtered[active].key) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      if (selected.length || editing) applyCitation(selected)
      else if (filtered[active]) applyCitation([filtered[active].key])
    }
  }

  const preview = selected.length ? citationLabel(selected, previewNumbers, byKey, style, citationMode) : ''
  const styleSelect = <label className="cite-preview">Kiểu trích dẫn{' '}
    <select value={settings.citationStyle} onChange={event => onSettings({ ...settings, citationStyle: event.target.value })}>
      {CITATION_STYLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>
  const addPanel = <div className="cite-dialog">
    <input className="field" aria-label="Tên danh mục số gốc khi nhập" placeholder="Tên danh mục số gốc (tùy chọn, ví dụ: Bài báo A)" maxLength={160} disabled={busy} value={sourceImportLabel} onChange={event => setSourceImportLabel(event.target.value)} />
    <label className="label" htmlFor="cite-import">Dán BibTeX, RIS, DOI (mỗi dòng một) hoặc danh sách tài liệu dạng [1] …, [2] …</label>
    <textarea id="cite-import" className="field" rows={6} spellCheck={false} value={importText} onChange={event => setImportText(event.target.value)} placeholder={'10.1109/5.771073\n@article{key, author={…}, title={…}, year={2024}}\n[1] A. Nguyen and B. Tran, “Tiêu đề bài báo,” Tên tạp chí, vol. 3, pp. 1–9, 2024.'} />
    <div className="studio-manager-actions">
      <button type="button" className="btn btn--solid" disabled={busy || !importText.trim()} onClick={() => runImport(importText)}><Plus size={14} /> Thêm vào danh mục</button>
      <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={14} /> Nhập tệp .bib / .txt / .ris</button>
      <input ref={fileRef} hidden type="file" accept=".bib,.txt,.ris" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > MAX_BIBTEX) { setMessage('Tệp vượt quá 500 KB.'); return } await runImport(await file.text()) }} />
    </div>
  </div>

  return <div className="modal-backdrop studio-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="studio-dialog" style={{ maxWidth: 720, width: '100%' }} role="dialog" aria-modal="true" aria-labelledby="references-title" aria-busy={busy}>
      <header className="studio-dialog-head">
        <h2 id="references-title"><Quote size={20} strokeWidth={1.8} />{editing ? 'Sửa trích dẫn' : 'Trích dẫn & tài liệu tham khảo'}</h2>
        <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Đóng"><X size={16} /></button>
      </header>
      <div className="studio-dialog-body">
        {!editing && <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'cite'} className={tab === 'cite' ? 'is-active' : ''} onClick={() => setTab('cite')}><Quote size={13} /> Chèn trích dẫn</button>
          <button type="button" role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'is-active' : ''} onClick={() => setTab('library')}><BookMarked size={13} /> Danh mục ({entries.length})</button>
          <button type="button" role="tab" aria-selected={tab === 'scan'} className={tab === 'scan' ? 'is-active' : ''} onClick={() => setTab('scan')}><Search size={13} /> Quét trích dẫn</button>
        </div>}
        {message && <p className="studio-notice" role="status">{message}</p>}
        {tab === 'scan' && <>{styleSelect}<CitationScanPanel editor={editor} entries={entries} settings={settings} onSettings={onSettings} /></>}

        {tab === 'cite' && <div className="cite-dialog">
          {diagnostics.duplicates.length > 0 && <p className="studio-notice" role="status">Khóa REF bị trùng: {diagnostics.duplicates.join(', ')}. Sửa danh mục trước khi dùng các khóa này để cite.</p>}
          <div className="cite-search">
            <input ref={searchRef} className="field" type="search" aria-label="Tìm tài liệu" placeholder="Tìm theo tác giả, năm, tiêu đề, DOI…" value={query} onChange={event => { setQuery(event.target.value); setActive(0) }} onKeyDown={onSearchKey} />
            {!editing && <button type="button" className="btn" onClick={() => setAddOpen(value => !value)} aria-expanded={addOpen}><Plus size={14} /> Thêm tài liệu</button>}
          </div>
          {addOpen && addPanel}
          <div ref={listRef} className="cite-list" role="group" aria-label="Tài liệu tham khảo">
            {filtered.map((entry, index) => <label key={entry.key + index} className={'cite-item' + (index === active ? ' is-active' : '')} onMouseEnter={() => setActive(index)} onDoubleClick={() => applyCitation(selected.includes(entry.key) ? selected : [...selected, entry.key])}>
              <input type="checkbox" checked={selected.includes(entry.key)} onChange={() => toggle(entry.key)} />
              <span className="cite-item-number">{numberText(entry.key, 'mới')}</span>
              <EntryText entry={entry} />
            </label>)}
            {editing?.keys?.filter(key => !byKey.has(key)).map(key => <label key={key} className="cite-item"><input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} /><span className="cite-item-number">?</span><EntryText entry={{ key }} missing /></label>)}
            {!filtered.length && <div className="cite-empty">{entries.length ? 'Không có tài liệu khớp.' : 'Chưa có tài liệu nào. Bấm “Thêm tài liệu” để dán DOI, BibTeX, RIS hoặc danh sách tham khảo.'}</div>}
          </div>
          <span className="sr-only" role="status">{filtered.length ? `Kết quả ${Math.min(active + 1, filtered.length)} trên ${filtered.length}: ${describeEntry(filtered[Math.min(active, filtered.length - 1)]).title || filtered[Math.min(active, filtered.length - 1)].key}` : 'Không có tài liệu khớp.'}</span>
          <label className="cite-preview">Cách cite<select aria-label="Cách cite" value={citationMode} onChange={event => setCitationMode(event.target.value)}><option value="parenthetical">Trong ngoặc — (Smith, 2025) / [1]</option><option value="narrative">Tường thuật — Smith (2025) / Smith [1]</option></select></label>
          <div className="cite-selected">
            {selected.map(key => <span key={key} className="cite-chip">{key}<button type="button" aria-label={`Bỏ ${key}`} onClick={() => toggle(key)}><X size={11} /></button></span>)}
            {preview && <span className="cite-preview">→ hiển thị {preview}</span>}
          </div>
          <div className="studio-dialog-foot">
            {styleSelect}
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={onClose}>Hủy</button>
              {!editing && <button type="button" className="btn" disabled={!citationCount || sourceEdited} title={sourceEdited ? 'Quay về bản thảo trước khi xóa citation; source riêng có thể có các lệnh cite được viết thủ công.' : 'Xóa các trích dẫn đã chèn trong bản thảo; giữ nguyên danh mục tài liệu.'} onClick={removeAllCitations}><Trash2 size={14} /> Xóa cite trong bản thảo ({citationCount})</button>}
              {editing && <button type="button" className="btn" onClick={() => applyCitation([])}><Trash2 size={14} /> Xóa trích dẫn</button>}
              <button type="button" className="btn btn--solid" disabled={!selected.length && !editing} onClick={() => applyCitation(selected)}>{editing ? 'Cập nhật' : `Chèn${selected.length > 1 ? ` ${selected.length} tài liệu` : ''}`}</button>
            </div>
          </div>
          <p className="cite-preview">Bôi đen câu cần trích dẫn rồi nhấn Ctrl+Shift+C: trích dẫn được chèn ngay sau đoạn đã chọn. ↑/↓ để di chuyển, Shift+Enter để chọn thêm, Enter để chèn. Số thứ tự tự đánh lại khi bạn thêm hoặc xóa trích dẫn.</p>
          {sourceEdited && <p className="studio-notice" role="status">PDF đang dùng source riêng. Để xóa tất cả citation của bản thảo, hãy chọn “Dùng lại bản thảo” trước. Các lệnh cite viết trong source riêng được sửa trong trình LaTeX.</p>}
        </div>}

        {tab === 'library' && <div className="cite-dialog">
          {styleSelect}
          {(diagnostics.missing.length > 0 || diagnostics.duplicates.length > 0 || diagnostics.invalidKeys.length > 0 || diagnostics.unused.length > 0) && <div className="cite-diagnostics">
            {diagnostics.missing.length > 0 && <span className="is-bad"><AlertTriangle size={12} /> Trích dẫn chưa có trong danh mục: {diagnostics.missing.join(', ')}</span>}
            {diagnostics.duplicates.length > 0 && <span className="is-bad"><AlertTriangle size={12} /> Khóa bị trùng: {diagnostics.duplicates.join(', ')}</span>}
            {diagnostics.invalidKeys.length > 0 && <span className="is-bad"><AlertTriangle size={12} /> Khóa không dùng được trong \cite: {diagnostics.invalidKeys.join(', ')}</span>}
            {diagnostics.unused.length > 0 && <span>Chưa được trích dẫn ({diagnostics.unused.length}) — BibTeX sẽ không in các mục này: {diagnostics.unused.slice(0, 12).join(', ')}{diagnostics.unused.length > 12 ? '…' : ''}</span>}
          </div>}
          {addPanel}
          <div>
            {ordered.map((entry, index) => <div className="cite-ref-row" key={entry.key + index}>
              <span className="cite-item-number">{numberText(entry.key, '—')}</span>
              <EntryText entry={entry} />
              <div className="studio-manager-actions">
                <button type="button" title="Chèn trích dẫn tài liệu này" onClick={() => applyCitation([entry.key])}><Quote size={14} /></button>
                <button type="button" title="Xóa khỏi danh mục" onClick={() => { updateBibliography(removeBibtexEntry(bibliography, entry.key)); setMessage(`Đã xóa ${entry.key}.${numbers.has(entry.key) ? ' Trích dẫn trong bài sẽ hiện [?] cho tới khi bạn thêm lại.' : ''}`) }}><Trash2 size={14} /></button>
              </div>
            </div>)}
          </div>
          <button type="button" className="btn" onClick={() => setRawOpen(value => !value)} aria-expanded={rawOpen}><Search size={14} /> {rawOpen ? 'Ẩn' : 'Sửa'} BibTeX trực tiếp</button>
          {rawOpen && <textarea className="field" rows={12} spellCheck={false} aria-label="BibTeX" value={bibliography} onChange={event => updateBibliography(event.target.value.slice(0, MAX_BIBTEX))} />}
        </div>}
      </div>
    </section>
  </div>
}
