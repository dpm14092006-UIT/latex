import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, FileText, Sigma, ChevronLeft, ChevronRight, LoaderCircle, Settings2 } from 'lucide-react'
import ZoomControls from './ZoomControls.jsx'
import { useTrackpadZoom } from '../hooks/useTrackpadZoom.js'

const PdfPageCanvas = memo(function PdfPageCanvas({ pdf, pageNumber, width, zoom, shouldRender, onRendered, onError }) {
  const canvasRef = useRef(null)
  const [rendering, setRendering] = useState(true)
  const [pageSize, setPageSize] = useState({ width: 595.28, height: 841.89 })

  useEffect(() => {
    if (!pdf || !width) return undefined
    let disposed = false
    let renderTask
    setRendering(true)
    async function render() {
      let page
      try {
        page = await pdf.getPage(pageNumber)
        if (disposed) return
        const base = page.getViewport({ scale: 1 })
        setPageSize(current => current.width === base.width && current.height === base.height ? current : { width: base.width, height: base.height })
        if (!shouldRender) return
        const scale = Math.max(.1, Math.min((width - 40) / base.width, 1.5)) * zoom
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = Math.ceil(viewport.width * ratio)
        canvas.height = Math.ceil(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        renderTask = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: [ratio, 0, 0, ratio, 0, 0], background: '#fff' })
        await renderTask.promise
        if (disposed) return
        setRendering(false)
        onRendered()
      } catch (cause) {
        if (!disposed) { setRendering(false); onError(cause, pdf) }
      } finally {
        page?.cleanup()
      }
    }
    render()
    return () => { disposed = true; renderTask?.cancel() }
  }, [pdf, pageNumber, width, zoom, shouldRender, onRendered, onError])

  const scale = Math.max(.1, Math.min((width - 40) / pageSize.width, 1.5)) * zoom
  const size = { width: pageSize.width * scale, height: pageSize.height * scale, boxSizing: 'content-box' }

  if (!shouldRender) return <div className="studio-pdf-page studio-pdf-page-placeholder" data-pdf-page={pageNumber} style={size} aria-label={`Trang ${pageNumber}`} />

  return <div className="studio-pdf-page" data-pdf-page={pageNumber} style={size} aria-busy={rendering}>
    <canvas ref={canvasRef} aria-label={`Trang ${pageNumber} của tài liệu PDF`} />
    {rendering && <span className="studio-pdf-page-loading"><LoaderCircle size={14} className="animate-spin" />Đang hiển thị trang {pageNumber}…</span>}
  </div>
})

async function findLastImagePage(pdf, imageOperators) {
  for (let pageNumber = pdf.numPages; pageNumber >= 1; pageNumber -= 1) {
    const page = await pdf.getPage(pageNumber)
    try {
      const { fnArray = [] } = await page.getOperatorList()
      if (fnArray.some(operator => imageOperators.has(operator))) return pageNumber
    } finally {
      page.cleanup()
    }
  }
  return 0
}

function PdfViewer({ src, imageCount, imageFocusKey, imageSyncWarning, controlsCollapsed = false }) {
  const savedScrollRef = useRef(0)
  const containerRef = useRef(null)
  const canvasStageRef = useRef(null)
  const pageStackRef = useRef(null)
  const pendingImagePageRef = useRef(null)
  const focusedImageKeyRef = useRef(imageFocusKey)
  const imageFocusRequestRef = useRef({ imageCount, imageFocusKey })
  imageFocusRequestRef.current = { imageCount, imageFocusKey }
  const [pdf, setPdf] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  useTrackpadZoom(canvasStageRef, setZoom)
  const [navigation, setNavigation] = useState('scroll')
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(true)
  const [imageMissing, setImageMissing] = useState(false)
  const onPageRendered = useCallback(() => {
    const stage = canvasStageRef.current
    if (!stage || navigation !== 'scroll') return
    const pages = pageStackRef.current?.children
    if (!pages?.length) return
    const viewportY = stage.getBoundingClientRect().top + stage.clientHeight * .4
    let low = 0
    let high = pages.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const bounds = pages[middle].getBoundingClientRect()
      const center = (bounds.top + bounds.bottom) / 2
      if (center < viewportY) low = middle + 1
      else high = middle - 1
    }
    const candidates = [high, low].filter(index => index >= 0 && index < pages.length)
    let bestPage = null
    let bestDistance = Infinity
    for (const index of candidates) {
      const bounds = pages[index].getBoundingClientRect()
      const distance = viewportY < bounds.top ? bounds.top - viewportY : viewportY > bounds.bottom ? viewportY - bounds.bottom : 0
      if (distance < bestDistance) {
        bestDistance = distance
        bestPage = index + 1
      }
    }
    if (bestPage) setPageNumber(current => current === bestPage ? current : bestPage)
  }, [navigation])
  // A new PDF destroys the previous document while its pages may still be rendering; their
  // "destroyed" rejections arrive after the reload cleared the error and must not be shown.
  const loadedPdfRef = useRef(null)
  const onPageError = useCallback((cause, source) => {
    if (source === loadedPdfRef.current) setError(cause.message || 'Không thể dựng trang PDF.')
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let disposed = false
    let task
    const stage = canvasStageRef.current
    const controller = new AbortController()
    const { imageCount: imageCountAtLoad, imageFocusKey: imageFocusKeyAtLoad } = imageFocusRequestRef.current
    const shouldFocusImage = imageCountAtLoad > 0 && focusedImageKeyRef.current !== imageFocusKeyAtLoad
    pendingImagePageRef.current = null
    setPdf(null)
    setError('')
    if (imageCountAtLoad === 0 || shouldFocusImage) setImageMissing(false)
    setRendering(true)
    async function load() {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        if (disposed) return
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const response = await fetch(src, { signal: controller.signal })
        const data = new Uint8Array(await response.arrayBuffer())
        if (disposed) return
        task = pdfjs.getDocument({ data })
        const document = await task.promise
        if (disposed) return

        loadedPdfRef.current = document
        setPdf(document)
        setPageNumber(number => Math.min(number, document.numPages))
        setRendering(false)
        if (shouldFocusImage) {
          const imageOperators = new Set([
            pdfjs.OPS.paintImageMaskXObject,
            pdfjs.OPS.paintImageMaskXObjectGroup,
            pdfjs.OPS.paintImageXObject,
            pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.paintInlineImageXObjectGroup,
            pdfjs.OPS.paintImageXObjectRepeat,
            pdfjs.OPS.paintImageMaskXObjectRepeat,
          ])
          void findLastImagePage(document, imageOperators).then(imagePage => {
            if (disposed) return
            focusedImageKeyRef.current = imageFocusKeyAtLoad
            if (!imagePage) {
              setImageMissing(true)
              return
            }
            pendingImagePageRef.current = imagePage
            setPageNumber(imagePage)
          }).catch(cause => {
            if (!disposed) setError(cause.message || 'Không thể xác định trang chứa ảnh.')
          })
        }
      } catch (cause) { if (!disposed) { setError(cause.message); setRendering(false) } }
    }
    load()
    return () => { savedScrollRef.current = stage?.scrollTop || 0; disposed = true; loadedPdfRef.current = null; controller.abort(); task?.destroy() }
  }, [src])

  useEffect(() => {
    if (!pdf || !savedScrollRef.current || pendingImagePageRef.current !== null) return undefined
    const frame = requestAnimationFrame(() => canvasStageRef.current?.scrollTo({ top: savedScrollRef.current, behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [pdf])

  useEffect(() => {
    const pageNumberToShow = pendingImagePageRef.current
    if (!pdf || navigation !== 'scroll' || pageNumberToShow === null) return undefined
    const frame = requestAnimationFrame(() => {
      const stage = canvasStageRef.current
      const target = stage?.querySelector(`[data-pdf-page="${pageNumberToShow}"]`)
      if (!stage || !target) return
      const paddingTop = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0
      const top = target.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - paddingTop
      stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      pendingImagePageRef.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [pdf, navigation, pageNumber])

  useEffect(() => {
    if (navigation === 'page') canvasStageRef.current?.scrollTo({ top: 0 })
  }, [navigation])

  const navigateToPage = page => {
    const nextPage = Math.max(1, Math.min(pdf?.numPages || 1, page))
    setPageNumber(nextPage)
    if (navigation === 'scroll') {
      requestAnimationFrame(() => {
        const stage = canvasStageRef.current
        const target = stage?.querySelector(`[data-pdf-page="${nextPage}"]`)
        if (!stage || !target) return
        const paddingTop = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0
        const top = target.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - paddingTop
        stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      })
    }
  }

  const allPageNumbers = useMemo(() => Array.from({ length: pdf?.numPages || 0 }, (_, index) => index + 1), [pdf?.numPages])
  const visiblePages = navigation === 'scroll' ? allPageNumbers : pdf ? [pageNumber] : []

  return <div className="studio-pdf-viewer" ref={containerRef}>
    <div className="studio-pdf-controls" hidden={controlsCollapsed}>
      <div className="studio-pdf-page-controls"><button type="button" aria-label="Trang trước" disabled={!pdf || pageNumber <= 1} onClick={() => navigateToPage(pageNumber - 1)}><ChevronLeft size={16} /></button><span>Trang <b>{pageNumber}</b> / {pdf?.numPages || '…'}</span><button type="button" aria-label="Trang tiếp" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => navigateToPage(pageNumber + 1)}><ChevronRight size={16} /></button></div>
      <div className="studio-pdf-view-controls">
        <div className="studio-pdf-modes" role="group" aria-label="Cách xem PDF">
          <button type="button" onClick={() => setNavigation('scroll')} aria-pressed={navigation === 'scroll'}>Cuộn</button>
          <button type="button" onClick={() => setNavigation('page')} aria-pressed={navigation === 'page'}>Từng trang</button>
        </div>
        <ZoomControls
          className="studio-pdf-zoom-controls"
          value={zoom}
          onChange={setZoom}
          label="Thu phóng PDF"
          subject="PDF"
          fitLabel="Vừa chiều rộng"
        />
      </div>
    </div>
    {imageMissing && !imageSyncWarning && <p className="studio-alert" role="status">Bản thảo có ảnh nhưng PDF không có trang chứa ảnh. Hãy kiểm tra LaTeX source và biên dịch lại.</p>}
    <div ref={canvasStageRef} className="studio-pdf-canvas" data-navigation={navigation} aria-label="Các trang PDF" aria-busy={rendering} onScroll={onPageRendered}>
      {rendering && <span className="studio-pdf-loading" role="status"><LoaderCircle size={14} className="animate-spin" />Đang hiển thị trang…</span>}
      <div ref={pageStackRef} className="studio-pdf-page-stack">
      {visiblePages.map(number => <PdfPageCanvas key={number} pdf={pdf} pageNumber={number} width={width} zoom={zoom} shouldRender={navigation === 'page' || Math.abs(number - pageNumber) <= 1} onRendered={onPageRendered} onError={onPageError} />)}
      </div>
      {error && <p className="studio-alert" role="alert">Không hiển thị được PDF: {error}</p>}
    </div>
  </div>
}

export default function PdfPreviewPane({
  collapsibleTools = false,
  compileState,
  pdfStale,
  pdfShared = false,
  pdfMode,
  onPdfModeChange,
  compileBlocked,
  onUpdate,
  latexOpen,
  onToggleLatex,
  sourceEdited,
  effectiveLatex,
  compileError,
  onRetry,
  pdfUrl,
  images = [],
  imageFocusKey,
  imageSyncWarning = '',
  compileLog = '',
}) {
  const [controlsCollapsed, setControlsCollapsed] = useState(() => {
    if (!collapsibleTools) return false
    try { return localStorage.getItem('noir-pdf-tools-expanded') === '0' } catch { return false }
  })
  const toggleControls = () => {
    const next = !controlsCollapsed
    try { localStorage.setItem('noir-pdf-tools-expanded', next ? '0' : '1') } catch { /* Keep the session preference if storage is unavailable. */ }
    setControlsCollapsed(next)
  }
  const statusLabel = compileState === 'ready' ? (pdfShared ? 'Đã nhận qua LAN' : 'Đã cập nhật') : compileState === 'error' ? 'Cần kiểm tra' : compileState === 'blocked' ? 'Chờ xác nhận' : compileState === 'compiling' ? 'Đang cập nhật' : 'Chưa cập nhật'
  const statusTone = compileState === 'ready' ? 'ready' : compileState === 'error' ? 'error' : compileState === 'compiling' ? 'busy' : 'idle'
  const loadingTitle = compileState === 'error' ? 'Chưa tạo được PDF' : compileState === 'compiling' ? 'Đang tạo PDF' : 'PDF chưa được tạo'
  const loadingDescription = compileState === 'error'
    ? 'Kiểm tra thông báo lỗi rồi chỉnh sửa tài liệu.'
    : 'Tiếp tục soạn thảo; công thức hiển thị ngay trong bản thảo. Bấm Cập nhật PDF khi cần xem bản in.'

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Bản PDF xem trước">
      {collapsibleTools && <button type="button" className="btn btn--icon noir-pdf-tools-toggle" aria-label={controlsCollapsed ? 'Mở công cụ PDF' : 'Thu gọn công cụ PDF'} aria-expanded={!controlsCollapsed} title={`${controlsCollapsed ? 'Mở' : 'Thu gọn'} công cụ PDF · ${statusLabel}`} onClick={toggleControls}><Settings2 size={14} /><span className="sr-only" role="status">{statusLabel}</span></button>}
      <div className="studio-panel-head" hidden={controlsCollapsed}>
        <div className="studio-panel-title">
          <h2>Bản in PDF</h2>
          <span className="studio-panel-status" data-tone={statusTone} role="status">{statusLabel}</span>
        </div>
        <div className="studio-panel-actions">
          <select className="studio-panel-select" aria-label="Chế độ cập nhật PDF" value={pdfMode} onChange={event => onPdfModeChange(event.target.value)} title={pdfMode === 'manual' ? 'PDF chỉ cập nhật khi bạn yêu cầu hoặc xuất tệp.' : pdfMode === 'live' ? 'PDF tự cập nhật sau khi ngừng gõ khoảng 1 giây; mỗi lượt cách nhau ít nhất 2 giây.' : 'Đợi ngừng gõ 5 giây; các lượt tự động cách nhau ít nhất 30 giây. Sửa ít trong cùng trang được cập nhật sau 60 giây. Source riêng ước lượng theo độ dài LaTeX; số trang PDF có thể khác bản thảo.'}>
            <option value="live">Tự động · theo bản thảo</option>
            <option value="2">Tự động · 2 trang</option>
            <option value="1">Tự động · 1 trang</option>
            <option value="manual">Thủ công</option>
          </select>
          <button type="button" className="btn btn--sm btn--icon" onClick={onToggleLatex} aria-pressed={latexOpen} title={latexOpen ? 'Ẩn LaTeX' : 'Xem LaTeX'} aria-label={latexOpen ? 'Ẩn LaTeX' : 'Xem LaTeX'}><FileCode2 size={13} /></button>
          <button type="button" className="btn btn--sm btn--solid" aria-label="Cập nhật PDF" onClick={onUpdate} disabled={compileBlocked}>{compileState === 'compiling' ? 'Xếp bản mới nhất' : 'Cập nhật PDF'}</button>
        </div>
      </div>
      {pdfStale && <p className="studio-alert" role="status">Có thay đổi chưa cập nhật vào PDF. Bên dưới là bản PDF gần nhất.</p>}
      {latexOpen && (
        <div className="studio-drawer">
          <div className="flex items-center justify-between gap-2">
            <span className="label">{sourceEdited ? 'Source đang dùng' : 'Source tự tạo'}</span>
            <button type="button" className="btn btn--sm" onClick={() => navigator.clipboard?.writeText(effectiveLatex)}><FileText size={12} />Sao chép</button>
          </div>
          <pre>{effectiveLatex}</pre>
        </div>
      )}
      {compileLog && <details className="studio-compile-log"><summary>Nhật ký biên dịch</summary><pre>{compileLog}</pre></details>}

      {compileError && <div className="studio-alert max-h-28 overflow-auto" role="alert"><code>{compileError}</code>{!compileBlocked && <button type="button" onClick={onRetry} className="btn btn--sm ml-auto">Thử lại</button>}</div>}
      {imageSyncWarning && <div className="studio-alert" role="alert">{imageSyncWarning}</div>}
      <div className="min-h-0 flex-1 overflow-hidden">
        {pdfUrl ? (
          <PdfViewer src={pdfUrl} imageCount={images.length} imageFocusKey={imageFocusKey} imageSyncWarning={imageSyncWarning} controlsCollapsed={controlsCollapsed} />
        ) : (
          <div className="studio-empty studio-pdf-canvas">
            <div className="studio-empty-mark"><Sigma size={24} /></div>
            <strong>{loadingTitle}</strong>
            <span>{loadingDescription}</span>
            <button type="button" className="btn btn--solid" onClick={onUpdate} disabled={compileBlocked || compileState === 'compiling'}>{compileState === 'compiling' ? 'Đang tạo bản in…' : 'Tạo bản xem trước'}</button>
          </div>
        )}
      </div>
    </section>
  )
}
