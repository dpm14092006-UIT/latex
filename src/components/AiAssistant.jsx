import { useCallback, useEffect, useRef, useState } from 'react'
import { aiResultToContent, selectionForAi } from '../services/AiSelection.js'

const ai = () => window.desktopAPI?.ai
// Electron prefixes errors thrown in the main process; show only our message.
const message = error => String(error?.message || error || 'Không thực hiện được.').replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
const ACTION_LABELS = [
  ['academic', 'Viết lại văn phong học thuật'], ['grammar', 'Sửa ngữ pháp và chính tả'], ['to-english', 'Dịch sang tiếng Anh'],
  ['to-vietnamese', 'Dịch sang tiếng Việt'], ['abstract', 'Tóm tắt thành Abstract'], ['explain-error', 'Giải thích lỗi biên dịch'],
]

// Settings tab: key entry, model choice. The key itself never comes back to the UI.
export function AiSettingsPanel() {
  const [status, setStatus] = useState(null), [models, setModels] = useState([]), [key, setKey] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const run = useCallback(async task => {
    setBusy(true); setNotice('')
    try { await task() } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }, [])
  const refresh = useCallback(() => run(async () => {
    const next = await ai().status()
    setStatus(next)
    setModels(next.configured ? await ai().models().catch(error => { setNotice(message(error)); return [] }) : [])
  }), [run])
  useEffect(() => { if (ai()) void refresh() }, [refresh])

  if (!ai()) return <p>Trợ lý AI chỉ chạy trong app (macOS và Windows), không chạy trong môi trường thử giao diện trên trình duyệt, vì API key cần kho khóa của hệ điều hành.</p>
  return <div className="ai-settings">
    <p>Kết nối <strong>Google Gemini</strong> bằng API key của bạn. Gói Gemini trả phí trong ứng dụng Google không dùng được cho app khác. Hãy tạo key miễn phí tại Google AI Studio; bản miễn phí có giới hạn lượt dùng, và Google có thể dùng nội dung gửi lên để cải thiện dịch vụ.</p>
    <p>Key được mã hóa bằng {navigator.userAgent.includes('Mac') ? 'Keychain của macOS' : 'DPAPI của Windows'} và chỉ gửi tới máy chủ Google. App chỉ gửi đoạn văn bạn chọn khi bạn bấm <em>Gửi tới Gemini</em>.</p>
    {status && !status.encryption && <p className="studio-notice">Hệ điều hành không cung cấp kho mã hóa, nên không thể lưu key.</p>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    {status?.configured
      ? <div className="studio-settings-grid">
          <label>Model<select value={status.model} disabled={busy || !models.length} onChange={event => run(async () => { const { model } = await ai().setModel(event.target.value); setStatus(previous => ({ ...previous, model })) })}>
            {!models.some(model => model.id === status.model) && <option value={status.model}>{status.model.replace(/^models\//, '')}</option>}
            {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select></label>
          <div className="studio-manager-actions"><button type="button" disabled={busy} onClick={refresh}>Kiểm tra kết nối</button><button type="button" disabled={busy} onClick={() => run(async () => { await ai().clearKey(); setStatus(previous => ({ ...previous, configured: false, model: '' })); setModels([]); setNotice('Đã xóa API key khỏi máy này.') })}>Xóa API key</button></div>
        </div>
      : <form className="studio-manager-actions" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await ai().setKey(key); setKey(''); setModels(result.models); setStatus(previous => ({ ...previous, configured: true, model: result.model })); setNotice('Đã kết nối Gemini.') }) }}>
          <label>API key Gemini<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder="Dán key từ Google AI Studio" /></label>
          <button type="submit" disabled={busy || !key.trim() || status?.encryption === false}>Kiểm tra và lưu</button>
          <button type="button" onClick={() => void window.desktopAPI.openHelp('gemini').catch(error => setNotice(message(error)))}>Mở Google AI Studio</button>
        </form>}
    {busy && <p role="status">Đang kết nối Gemini…</p>}
  </div>
}

export default function AiTools({ editor, sourceView, sourceMode, compileError, source, onSettings, readOnly, onOpenSettings }) {
  const [open, setOpen] = useState(false), [action, setAction] = useState('academic')
  const [request, setRequest] = useState(null), [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [configured, setConfigured] = useState(null)
  const panel = useRef(null)
  const available = Boolean(ai())

  // Captures what will be sent, so the user sees it before anything leaves the machine.
  const capture = useCallback(nextAction => {
    setResult(null); setNotice('')
    if (nextAction === 'explain-error') {
      if (!compileError) return setRequest(null)
      const line = Number(/(?:^|:)(\d+):/.exec(compileError)?.[1])
      const lines = source.split('\n')
      const context = Number.isSafeInteger(line) && line > 0 ? lines.slice(Math.max(0, line - 8), line + 4).map((text, index) => `${Math.max(1, line - 7) + index}: ${text}`).join('\n') : ''
      return setRequest({ kind: 'error', text: compileError.slice(0, 20_000), context })
    }
    if (sourceMode) {
      const range = sourceView?.state.selection.main
      if (!range || range.empty) return setRequest(null)
      return setRequest({ kind: 'source', text: sourceView.state.sliceDoc(range.from, range.to), from: range.from, to: range.to, original: sourceView.state.sliceDoc(range.from, range.to) })
    }
    if (!editor || editor.isDestroyed) return setRequest(null)
    const selection = nextAction === 'abstract' && editor.state.selection.empty ? { text: editor.getText({ blockSeparator: '\n\n' }).trim().slice(0, 20_000), whole: true } : selectionForAi(editor.state)
    if (!selection?.text) return setRequest(null)
    setRequest({ kind: 'rich', ...selection, doc: editor.state.doc })
  }, [compileError, editor, source, sourceMode, sourceView])

  const show = () => {
    setOpen(true)
    void ai().status().then(status => setConfigured(status.configured)).catch(() => setConfigured(false))
    capture(action)
  }
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector('select')?.focus()
    const escape = event => { if (event.key === 'Escape' && !busy) setOpen(false) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open, busy])

  const send = async () => {
    if (!request || request.tooLong) return
    setBusy(true); setNotice(''); setResult(null)
    try { setResult(await ai().generate({ action, text: request.text, context: request.context })) }
    catch (error) { setNotice(message(error)) }
    finally { setBusy(false) }
  }
  const replace = () => {
    if (!result || readOnly) return
    if (request.kind === 'source') {
      if (sourceView?.state.sliceDoc(request.from, request.to) !== request.original) return setNotice('Source đã thay đổi; hãy chọn lại đoạn cần thay.')
      sourceView.dispatch({ changes: { from: request.from, to: request.to, insert: result.text }, selection: { anchor: request.from, head: request.from + result.text.length } })
      sourceView.focus()
    } else {
      if (!editor || editor.isDestroyed || editor.state.doc !== request.doc) return setNotice('Bản thảo đã thay đổi; hãy chọn lại đoạn cần thay.')
      editor.chain().insertContentAt({ from: request.from, to: request.to }, aiResultToContent(result.text, { inline: request.inline })).run()
      // Focus synchronously: the panel button that had focus is about to unmount, and
      // undo must reach the editor's history rather than the browser's native undo.
      editor.view.focus()
    }
    setOpen(false)
  }
  const useAsAbstract = () => {
    if (!result || readOnly) return
    onSettings(previous => ({ ...previous, abstract: result.text.slice(0, 20_000), abstractEnabled: true }))
    setNotice('Đã đặt làm Abstract (xem Quản lý → Trang & tác giả).')
  }

  if (!available) return null
  const canReplace = result && !readOnly && action !== 'explain-error' && request && !request.whole && request.kind !== 'error'
  return <>
    <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => open ? setOpen(false) : show()}>Trợ lý AI</button>
    {open && <div ref={panel} className="ai-panel" role="dialog" aria-label="Trợ lý AI Gemini">
      <div className="spellcheck-panel-head"><strong>Trợ lý AI · Gemini</strong><button type="button" aria-label="Đóng trợ lý AI" disabled={busy} onClick={() => setOpen(false)}>Đóng</button></div>
      {configured === false ? <p>Chưa kết nối Gemini. <button type="button" onClick={() => { setOpen(false); onOpenSettings() }}>Nhập API key</button></p> : <>
        <label className="ai-row">Thao tác<select value={action} disabled={busy} onChange={event => { setAction(event.target.value); capture(event.target.value) }}>{ACTION_LABELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {request
          ? <details className="ai-preview"><summary>Sẽ gửi {request.text.length.toLocaleString('vi-VN')} ký tự{request.context ? ' kèm đoạn source quanh lỗi' : ''}{request.whole ? ' (toàn bộ bản thảo)' : ''} tới Google</summary><pre>{request.text.slice(0, 4000)}{request.text.length > 4000 ? '\n…' : ''}</pre></details>
          : <p>{action === 'explain-error' ? 'Chưa có lỗi biên dịch để giải thích.' : sourceMode ? 'Chọn đoạn source cần xử lý rồi mở lại.' : 'Đặt con trỏ vào đoạn văn hoặc chọn nội dung cần xử lý.'}</p>}
        {request?.tooLong && <p role="status">Nội dung vượt 20.000 ký tự; hãy chọn đoạn ngắn hơn.</p>}
        <div className="ai-actions">
          <button type="button" disabled={busy || !request || request.tooLong} onClick={send}>Gửi tới Gemini</button>
          {busy && <button type="button" onClick={() => void ai().cancel()}>Hủy</button>}
          <button type="button" disabled={busy} onClick={() => capture(action)}>Lấy lại vùng chọn</button>
        </div>
        {busy && <p role="status">Đang chờ Gemini…</p>}
        {notice && <p role="status">{notice}</p>}
        {result && <>
          <textarea className="ai-result" aria-label="Kết quả từ Gemini" value={result.text} onChange={event => setResult({ ...result, text: event.target.value })} rows={Math.min(14, result.text.split('\n').length + 2)} />
          {result.truncated && <p role="status">Kết quả bị cắt do quá dài; nên chọn đoạn ngắn hơn.</p>}
          <div className="ai-actions">
            {canReplace && <button type="button" onClick={replace}>Thay vùng đã chọn</button>}
            {action === 'abstract' && !readOnly && <button type="button" onClick={useAsAbstract}>Đặt làm Abstract</button>}
            <button type="button" onClick={() => void navigator.clipboard?.writeText(result.text).then(() => setNotice('Đã sao chép.'), () => setNotice('Không sao chép được.'))}>Sao chép</button>
          </div>
          <small>{result.model.replace(/^models\//, '')} · {(result.elapsedMs / 1000).toFixed(1)} giây · Hãy kiểm tra lại trước khi dùng; AI có thể sai.</small>
        </>}
      </>}
    </div>}
  </>
}
