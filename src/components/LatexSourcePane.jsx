import { lazy, Suspense, useRef, useState } from 'react'
import { AlertCircle, CircleCheck, Copy, Download, FileCode2, RotateCcw, Upload } from 'lucide-react'
import { exportLatexProject } from '../services/ArchiveService.js'
import { MAX_LATEX_SOURCE_BYTES } from '../services/DocumentLimits.js'
const SourceEditor = lazy(() => import('./SourceEditor.jsx'))

export default function LatexSourcePane({ readOnly = false, exportBlocked = false, effectiveLatex, sourceEdited, sourceSyncStatus, onChange, onReset, images = [], assets = [], documentTitle = 'tai-lieu', identity, errorLine, onImportSource }) {
  const fileInput = useRef(null)
  const [copyState, setCopyState] = useState('Sao chép')
  const [fileMessage, setFileMessage] = useState(null)
  const copy = async () => {
    try { await navigator.clipboard.writeText(effectiveLatex); setCopyState('Đã sao chép') }
    catch { setCopyState('Không thể sao chép') }
  }
  const openFile = async event => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    try {
      if (file.size > MAX_LATEX_SOURCE_BYTES) throw new Error('Source LaTeX vượt quá giới hạn 800 KB.')
      const value = (await file.text()).replace(/^\uFEFF/u, '')
      if (!value.trim()) throw new Error('Tệp LaTeX đang trống.')
      if (new TextEncoder().encode(value).length > MAX_LATEX_SOURCE_BYTES) throw new Error('Source LaTeX vượt quá giới hạn 800 KB.')
      ;(onImportSource || onChange)(value, file.name)
      setCopyState('Sao chép')
      setFileMessage({ kind: 'success', text: `Đã mở ${file.name}` })
    } catch (error) {
      setFileMessage({ kind: 'error', text: error.message || 'Không thể mở tệp LaTeX.' })
    } finally {
      input.value = ''
    }
  }
  const exportBundle = async () => {
    try {
      await exportLatexProject(effectiveLatex, images, assets, documentTitle)
      setFileMessage({ kind: 'success', text: 'Đã tải gói LaTeX kèm ảnh (.zip)' })
    } catch (error) {
      setFileMessage({ kind: 'error', text: error.message || 'Không thể tạo gói LaTeX.' })
    }
  }
  const lineCount = effectiveLatex.split(/\r?\n/).length

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Chỉnh sửa mã LaTeX">
      <div className="studio-panel-head">
        <div className="studio-panel-title">
          <strong>LaTeX</strong>
          <span className="studio-panel-meta">{lineCount} dòng</span>
          <span className="studio-panel-status" data-tone={sourceEdited ? 'busy' : 'ready'} role="status">{sourceEdited ? 'Source riêng' : 'Đồng bộ bản thảo'}</span>
        </div>
        <div className="studio-panel-actions">
          <button type="button" className="btn btn--sm btn--icon" onClick={copy} title={copyState === 'Sao chép' ? 'Sao chép mã LaTeX' : copyState} aria-label="Sao chép mã LaTeX"><Copy size={13} /></button>
          <button type="button" className="btn btn--sm btn--icon" disabled={readOnly} onClick={() => fileInput.current?.click()} title="Mở tệp .tex từ máy" aria-label="Mở tệp .tex"><Upload size={13} /></button>
          <input ref={fileInput} type="file" accept=".tex,text/plain" hidden onChange={openFile} />
          <button type="button" disabled={exportBlocked} className="btn btn--sm btn--solid" onClick={exportBundle} title="Tải source LaTeX cùng ảnh trong bản thảo"><Download size={12} /><span>Tải .zip</span></button>
          <button type="button" className="btn btn--sm btn--icon" onClick={() => { setFileMessage(null); setCopyState('Sao chép'); onReset() }} disabled={!sourceEdited} title="Khôi phục source tạo từ bản thảo" aria-label="Khôi phục source"><RotateCcw size={13} /></button>
        </div>
      </div>

      <Suspense fallback={<p className="studio-panel-bar" role="status">Đang tải trình sửa LaTeX…</p>}><SourceEditor readOnly={readOnly} value={effectiveLatex} onChange={value => { setCopyState('Sao chép'); setFileMessage(null); onChange(value) }} onLimitError={text => setFileMessage({ kind: 'error', text })} identity={identity} errorLine={errorLine} /></Suspense>

      {(sourceSyncStatus?.kind !== 'idle' || fileMessage || copyState !== 'Sao chép') && <div className="studio-panel-foot">
        {sourceSyncStatus?.kind !== 'idle' && <span role={sourceSyncStatus.kind === 'error' ? 'alert' : 'status'} aria-live="polite" data-tone={sourceSyncStatus.kind === 'error' ? 'error' : sourceSyncStatus.kind === 'ready' ? 'ready' : 'busy'}>
          {sourceSyncStatus.kind === 'error' ? <AlertCircle size={12} /> : sourceSyncStatus.kind === 'pending' ? <FileCode2 size={12} /> : <CircleCheck size={12} />}
          {sourceSyncStatus.text}
        </span>}
        {(fileMessage || copyState !== 'Sao chép') && <span role={fileMessage?.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
          {fileMessage?.kind === 'error' ? <AlertCircle size={12} /> : <CircleCheck size={12} />}
          {fileMessage?.text || copyState}
        </span>}
      </div>}
    </section>
  )
}
