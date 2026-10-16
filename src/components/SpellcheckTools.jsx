import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { SpellcheckClient } from '../services/SpellcheckClient.js'
import { createSpellcheckPlugin, spellcheckPluginKey, showRichSpellcheckErrors } from '../services/SpellcheckExtension.js'
import { setSourceSpelling } from '../services/SourceSpellcheckExtension.js'
import { richSpellcheckSegments, locateSpellcheckErrors, replaceRichSpelling, replaceSpellingField } from '../services/SpellcheckSegments.js'
import { sanitizeSpellcheckSettings, parsePersonalWords, MAX_PERSONAL_FILE_BYTES } from '../services/SpellcheckSettings.js'
import { loadPersonalDictionary, mutatePersonalDictionary, watchPersonalDictionary } from '../services/PersonalDictionary.js'

const occurrenceKey = error => `${error.target.kind}:${error.target.from ?? error.target.pos ?? ''}:${error.from}:${error.original}`

export default function SpellcheckTools({ editor, sourceView, source, sourceMode, title, onTitle, settings, onSettings, readOnly = false, children }) {
  const preference = sanitizeSpellcheckSettings(settings.spellcheck)
  const enabled = preference.enabled && !readOnly
  const [version, setVersion] = useState(0)
  const [personal, setPersonal] = useState({ words: [], revision: 0 })
  const [dictionaryReady, setDictionaryReady] = useState(false)
  const [errors, setErrors] = useState([])
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [panel, setPanel] = useState(false)
  const [dictionaryPanel, setDictionaryPanel] = useState(false)
  const [wordInput, setWordInput] = useState('')
  const [wordFilter, setWordFilter] = useState('')
  const [fieldUndo, setFieldUndo] = useState(null)
  const [popup, setPopup] = useState(null)
  const [suggestions, setSuggestions] = useState(null)
  const [ignoredWords, setIgnoredWords] = useState(new Set())
  const [ignoredOnce, setIgnoredOnce] = useState(new Set())
  const [composing, setComposing] = useState(false)
  const client = useRef(null)
  const revision = useRef(0)
  const current = useRef(null)
  const importInput = useRef(null)
  const focusReturn = useRef(null)
  const popupRef = useRef(null)
  current.current = { source, editor, title, settings, errors, sourceMode, personal, locale: preference.locale }

  useEffect(() => {
    const worker = new SpellcheckClient()
    client.current = worker
    return () => { worker.destroy(); client.current = null }
  }, [])

  useEffect(() => {
    let active = true
    void loadPersonalDictionary().then(value => {
      if (!active) return
      setPersonal(value); setDictionaryReady(true)
      if (value.warning) setNotice(value.warning)
    }).catch(error => { if (active) { setNotice(error.message); setStatus('Không khả dụng: từ điển cá nhân không đọc được.') } })
    const stop = watchPersonalDictionary(value => { if (active) { setPersonal(value); setDictionaryReady(true) } })
    return () => { active = false; stop() }
  }, [])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.registerPlugin(createSpellcheckPlugin())
    const changed = ({ transaction }) => {
      if (!transaction.docChanged) return
      revision.current++; client.current?.cancel()
      setErrors([]); setPopup(null); setIgnoredOnce(new Set()); setVersion(value => value + 1)
    }
    editor.on('transaction', changed)
    return () => {
      editor.off('transaction', changed)
      if (!editor.isDestroyed) editor.unregisterPlugin(spellcheckPluginKey)
    }
  }, [editor])

  useEffect(() => {
    const surfaces = [editor?.view?.dom, sourceView?.dom].filter(Boolean)
    const begin = () => { revision.current++; client.current?.cancel(); setComposing(true); setErrors([]); setPopup(null) }
    const end = () => { setComposing(false); setVersion(value => value + 1) }
    for (const surface of surfaces) { surface.addEventListener('compositionstart', begin); surface.addEventListener('compositionend', end) }
    return () => { for (const surface of surfaces) { surface.removeEventListener('compositionstart', begin); surface.removeEventListener('compositionend', end) } }
  }, [editor, sourceView])

  useEffect(() => {
    revision.current++
    const requestRevision = revision.current
    setPopup(null); setErrors([]); setTruncated(false)
    client.current?.cancel()
    if (!enabled) { client.current?.destroy(); setStatus(readOnly ? 'Tổng hợp chỉ xem — kiểm tra ở tab gốc.' : 'Đã tắt'); return }
    if (!dictionaryReady || composing || !editor || (sourceMode && !sourceView)) return
    setStatus('Đang kiểm tra…')
    const timer = setTimeout(async () => {
      if (requestRevision !== revision.current) return
      const document = editor.state.doc
      const segments = sourceMode ? [] : richSpellcheckSegments(document, { title, abstract: settings.abstract, abstractEnabled: settings.abstractEnabled })
      try {
        const result = await client.current.request('scan', { locale: preference.locale, words: personal.words, source: sourceMode ? source : undefined, segments: segments.map(({ id, text }) => ({ id, text })) })
        if (requestRevision !== revision.current || editor.isDestroyed || editor.state.doc !== document || current.current.source !== source) return
        const caret = sourceMode ? sourceView?.hasFocus ? sourceView.state.selection.main.head : null : editor.view.hasFocus() ? editor.state.selection.from : null
        const located = (sourceMode ? result.errors : locateSpellcheckErrors(result.errors, segments)).filter(error => {
          if (ignoredWords.has(error.original) || ignoredOnce.has(occurrenceKey(error))) return false
          return caret == null || error.position == null || caret <= error.position || caret > error.position + error.original.length
        }).map((error, index) => ({ ...error, id: `spelling-${requestRevision}-${index}` }))
        setErrors(located); setTruncated(result.truncated); setStatus(located.length ? `${located.length} từ nghi sai` : 'Đã kiểm tra — không thấy lỗi chính tả')
      } catch (error) {
        if (requestRevision === revision.current && error.name !== 'AbortError') setStatus(`Không khả dụng: ${error.message}`)
      }
    }, 350)
    return () => { clearTimeout(timer); client.current?.cancel() }
  }, [enabled, readOnly, dictionaryReady, composing, editor, sourceView, sourceMode, source, title, settings.abstract, settings.abstractEnabled, preference.locale, personal, version, ignoredWords, ignoredOnce])

  useEffect(() => {
    showRichSpellcheckErrors(editor, sourceMode ? [] : errors)
    sourceView?.dispatch({ effects: setSourceSpelling.of(sourceMode ? errors : []) })
    return () => {
      showRichSpellcheckErrors(editor, [])
      sourceView?.dispatch({ effects: setSourceSpelling.of([]) })
    }
  }, [editor, sourceView, errors, sourceMode])

  const openError = useCallback(async (error, anchor) => {
    if (!error) return
    focusReturn.current = anchor instanceof HTMLElement ? anchor : null
    const rect = anchor?.getBoundingClientRect?.()
    const requestRevision = revision.current
    setPopup({ error, left: Math.max(8, Math.min(rect?.left || 24, window.innerWidth - 320)), top: Math.max(8, Math.min((rect?.bottom || 160) + 6, window.innerHeight - 300)) })
    setSuggestions(null)
    try {
      const state = current.current
      const result = await client.current.request('suggest', { word: error.original, locale: state.locale, words: state.personal.words })
      if (revision.current === requestRevision) setSuggestions(result.suggestions)
    } catch (error) { if (error.name !== 'AbortError') { setNotice(error.message); setSuggestions([]) } }
  }, [])

  useEffect(() => {
    const listener = event => {
      if (event.target.closest?.('input, textarea, select')) return
      const anchor = event.target.closest?.('[data-spellcheck-id]')
      if (!anchor) return
      const error = current.current.errors.find(item => item.id === anchor.dataset.spellcheckId)
      if (error) { event.preventDefault(); void openError(error, anchor) }
    }
    document.addEventListener('click', listener)
    return () => document.removeEventListener('click', listener)
  }, [openError])

  const closePopup = useCallback(() => {
    setPopup(null)
    if (focusReturn.current?.isConnected && focusReturn.current.matches('button, a[href], input, textarea, select, [tabindex]')) focusReturn.current.focus()
    else if (current.current.sourceMode) sourceView?.focus()
    else editor?.commands.focus()
  }, [editor, sourceView])

  useEffect(() => {
    if (!popup) return
    popupRef.current?.querySelector('button')?.focus()
    const dismiss = event => {
      if (event.key === 'Escape') { event.preventDefault(); closePopup() }
      if (event.key === 'Tab') {
        const buttons = [...popupRef.current.querySelectorAll('button:not(:disabled)')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const outside = event => { if (!popupRef.current?.contains(event.target) && !event.target.closest?.('[data-spellcheck-id]')) setPopup(null) }
    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside) }
  }, [popup, closePopup])

  const changeDictionary = async (action, input) => {
    try {
      const value = await mutatePersonalDictionary(action, input)
      setPersonal(value); setDictionaryReady(true); setWordInput(''); setNotice('Đã lưu từ điển cá nhân.'); setPopup(null)
    } catch (error) { setNotice(`Không lưu được: ${error.message}`) }
  }
  const replace = replacement => {
    const error = popup?.error
    if (!error || !enabled || !current.current.errors.some(item => item.id === error.id)) return
    let done = false
    if (error.target.kind === 'source') {
      const from = error.position, to = from + error.original.length
      if (sourceView?.state.doc.sliceString(from, to) === error.original) {
        sourceView.dispatch({ changes: { from, to, insert: replacement }, selection: { anchor: from + replacement.length }, annotations: isolateHistory.of('full') })
        sourceView.focus(); done = sourceView.state.doc.sliceString(from, from + replacement.length) === replacement
      }
    } else if (['title', 'abstract'].includes(error.target.kind)) {
      const value = error.target.kind === 'title' ? current.current.title : current.current.settings.abstract
      if (value.slice(error.from, error.to) === error.original) {
        const corrected = replaceSpellingField(value, error, replacement, error.target.kind === 'title' ? 160 : 20_000)
        if (corrected === null) { setNotice('Sửa này vượt giới hạn độ dài của trường. Hãy giảm nội dung trước.'); return }
        setFieldUndo({ kind: error.target.kind, before: value, after: corrected })
        if (error.target.kind === 'title') onTitle(corrected)
        else onSettings(previous => ({ ...previous, abstract: corrected }))
        done = true
      }
    } else done = replaceRichSpelling(editor, error, replacement)
    setPopup(null)
    if (!done) setNotice('Không áp dụng được sửa: nội dung đã thay đổi hoặc vượt giới hạn độ dài. Hãy kiểm tra lại.')
  }
  const jump = (error, anchor) => {
    if (error.target.kind === 'source' && sourceView) sourceView.dispatch({ selection: { anchor: error.position, head: error.position + error.original.length }, effects: EditorView.scrollIntoView(error.position, { y: 'center' }) })
    else if (error.position != null) editor?.commands.setTextSelection({ from: error.position, to: error.position + error.original.length })
    else if (error.target.kind === 'attribute') editor?.commands.setNodeSelection(error.target.pos)
    if (error.target.kind === 'rich' || error.target.kind === 'attribute') editor?.commands.scrollIntoView()
    void openError(error, anchor)
  }
  const exportWords = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, words: personal.words }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'english-personal-dictionary.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importWords = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > MAX_PERSONAL_FILE_BYTES) throw new Error('Tệp từ điển vượt giới hạn 1 MiB.')
      await changeDictionary('merge', parsePersonalWords(await file.text()))
    } catch (error) { setNotice(error.message) }
  }
  const filteredWords = personal.words.filter(word => word.toLowerCase().includes(wordFilter.toLowerCase()))
  const undoField = () => {
    if (!fieldUndo || readOnly) return
    const value = fieldUndo.kind === 'title' ? title : settings.abstract
    if (value !== fieldUndo.after) { setNotice('Trường đã được sửa tiếp; hãy dùng trình sửa của trường để hoàn tác.'); setFieldUndo(null); return }
    if (fieldUndo.kind === 'title') onTitle(fieldUndo.before)
    else onSettings(previous => ({ ...previous, abstract: fieldUndo.before }))
    setFieldUndo(null)
  }

  return <div className="spellcheck-tools" aria-label="Kiểm tra chính tả tiếng Anh">
    <div className="spellcheck-toolbar">
      <label><input type="checkbox" aria-label="Bật kiểm tra chính tả tiếng Anh" checked={preference.enabled} disabled={readOnly} onChange={event => onSettings(previous => ({ ...previous, spellcheck: { ...preference, enabled: event.target.checked } }))} /> Chính tả tiếng Anh</label>
      <select aria-label="Biến thể tiếng Anh" value={preference.locale} disabled={readOnly} onChange={event => onSettings(previous => ({ ...previous, spellcheck: { ...preference, locale: event.target.value } }))}><option value="en-US">Anh Mỹ</option><option value="en-GB">Anh Anh</option></select>
      <button type="button" disabled={!enabled} onClick={() => { setPanel(value => !value); setDictionaryPanel(false); setVersion(value => value + 1) }} aria-expanded={panel}>Kiểm tra {sourceMode ? 'LaTeX' : 'bản thảo'}{enabled && errors.length ? ` (${errors.length})` : ''}</button>
      <button type="button" onClick={() => { setPanel(true); setDictionaryPanel(value => !value) }}>Từ điển cá nhân</button>
      {fieldUndo && <button type="button" disabled={readOnly} onClick={undoField}>Hoàn tác sửa {fieldUndo.kind === 'title' ? 'tiêu đề' : 'Abstract'}</button>}
      {children}
      <span role="status" className="spellcheck-status">{readOnly ? 'Tổng hợp chỉ xem — kiểm tra ở tab gốc.' : preference.enabled ? status : 'Đã tắt'}</span>
    </div>
    {notice && !panel && <p className="spellcheck-notice" role="status">{notice} <button type="button" aria-label="Đóng thông báo chính tả" onClick={() => setNotice('')}>×</button></p>}
    {panel && <section className="spellcheck-panel" aria-label={dictionaryPanel ? 'Từ điển cá nhân tiếng Anh' : 'Danh sách lỗi chính tả'}>
      <div className="spellcheck-panel-head"><strong>{dictionaryPanel ? `Từ điển cá nhân (${personal.words.length})` : `${sourceMode ? 'LaTeX' : 'Bản thảo'} · ${status}`}</strong><button type="button" aria-label="Đóng bảng chính tả" onClick={() => setPanel(false)}>Đóng</button></div>
      {notice && <p role="status">{notice}</p>}
      {dictionaryPanel ? <>
        <form onSubmit={event => { event.preventDefault(); void changeDictionary('add', wordInput) }}><input aria-label="Từ cá nhân mới" maxLength={64} value={wordInput} onChange={event => setWordInput(event.target.value)} placeholder="Thuật ngữ hoặc tên riêng" /><button type="submit" disabled={!wordInput.trim()}>Thêm từ</button><button type="button" onClick={() => importInput.current.click()}>Nhập từ điển</button><button type="button" onClick={exportWords}>Xuất từ điển</button><input ref={importInput} type="file" accept=".json,.txt" hidden onChange={importWords} /></form>
        <p>Từ cá nhân được lưu trên máy. Dùng Nhập/Xuất để chuyển máy; danh sách này không nằm trong sao lưu .vls hoặc đồng bộ LAN.</p>
        <input aria-label="Tìm từ cá nhân" value={wordFilter} onChange={event => setWordFilter(event.target.value)} placeholder="Tìm trong từ điển…" />
        <ul className="spellcheck-word-list">{filteredWords.slice(0, 200).map(word => <li key={word}><span>{word}</span><button type="button" aria-label={`Xóa từ ${word}`} onClick={() => { void changeDictionary('remove', word) }}>Xóa</button></li>)}</ul>
        {filteredWords.length > 200 && <p>Hiển thị 200 từ đầu. Dùng tìm kiếm để thu hẹp danh sách.</p>}
      </> : <>
        <p>Chỉ kiểm tra chính tả tiếng Anh. Chọn từng lỗi để xem gợi ý; từ đúng nhưng dùng sai ngữ cảnh và ngữ pháp chưa được kiểm tra.</p>
        {sourceMode && <p>Macro chưa biết và vùng toán/mã được bỏ qua. Văn bản trong công thức cũng được bỏ qua.</p>}
        {truncated && <p role="status">Đã đạt giới hạn 2.000 lỗi. Sửa các lỗi hiện tại rồi kiểm tra lại.</p>}
        <ul className="spellcheck-error-list">{errors.slice(0, 200).map(error => <li key={error.id}><button type="button" onClick={event => jump(error, event.currentTarget)}><strong>{error.original}</strong><small>{error.label}</small><span>{error.context}</span></button></li>)}</ul>
        {errors.length > 200 && <p>Hiển thị 200 lỗi đầu; các lỗi còn lại vẫn được đánh dấu trong trình soạn thảo.</p>}
      </>}
    </section>}
    {popup && <div ref={popupRef} className="spellcheck-popover" role="dialog" aria-label={`Gợi ý chính tả: ${popup.error.original}`} style={{ left: popup.left, top: popup.top }}>
      <div className="spellcheck-panel-head"><strong>{popup.error.original}</strong><button type="button" aria-label="Đóng gợi ý chính tả" onClick={closePopup}>×</button></div>
      {suggestions === null ? <p role="status">Đang tìm gợi ý…</p> : suggestions.length ? <div className="spellcheck-suggestions">{suggestions.map(word => <button type="button" key={word} onClick={() => replace(word)}>{word}</button>)}</div> : <p>Không có gợi ý phù hợp.</p>}
      <button type="button" onClick={() => { setIgnoredOnce(previous => new Set([...previous, occurrenceKey(popup.error)])); closePopup() }}>Bỏ qua lần này</button>
      <button type="button" onClick={() => { setIgnoredWords(previous => new Set([...previous, popup.error.original])); closePopup() }}>Bỏ qua từ trong phiên tài liệu</button>
      <button type="button" onClick={() => { void changeDictionary('add', popup.error.original) }}>Thêm vào từ điển</button>
    </div>}
  </div>
}
