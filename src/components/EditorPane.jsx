import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditorState } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, BookOpen, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Code, FileText, Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link, List, ListOrdered, ListTree, Minus, Omega, Paintbrush, PanelTopOpen, Plus, Quote, Redo2, TextQuote, Library, RemoveFormatting, Search, SeparatorHorizontal, Sigma, Strikethrough, Subscript, Superscript, Table2, Underline, Undo2, X } from 'lucide-react'
import { FONT_SIZES, HIGHLIGHT_COLORS, MATH_SYMBOLS, TEXT_COLORS, TEXT_SYMBOLS } from '../services/RichTextFormats.js'
import { useTrackpadZoom } from '../hooks/useTrackpadZoom.js'
import ZoomControls, { ZOOM_LEVELS } from './ZoomControls.jsx'

// Marks the format painter copies; links and code are content, not formatting.
const PAINTABLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'textStyle', 'highlight'])

const PAGE_HEIGHT = 1240
const PAGE_GAP = 36
const PAGE_STEP = PAGE_HEIGHT + PAGE_GAP
const PAGE_TOP_INSET = 58
const PAGE_BOTTOM_INSET = 96
const pagePaginationKey = new PluginKey('pagePagination')

const USABLE_PAGE_HEIGHT = PAGE_HEIGHT - PAGE_TOP_INSET - PAGE_BOTTOM_INSET
const pageOf = top => Math.max(0, Math.floor(Math.max(0, top - PAGE_TOP_INSET) / PAGE_STEP))
const pageTextStart = page => page * PAGE_STEP + PAGE_TOP_INSET
const pageTextEnd = page => page * PAGE_STEP + PAGE_HEIGHT - PAGE_BOTTOM_INSET
const roundSpace = value => Math.round(value * 10) / 10

function spacerDecoration(spacer) {
  if (spacer.kind === 'block') {
    return Decoration.node(spacer.from, spacer.to, { 'data-page-break-before': 'true', style: `--page-break-space: ${spacer.space}px` })
  }
  return Decoration.widget(spacer.from, () => {
    const element = document.createElement('span')
    element.className = 'studio-page-spacer'
    element.style.height = `${spacer.space}px`
    element.setAttribute('aria-hidden', 'true')
    element.contentEditable = 'false'
    return element
  }, { side: -1, ignoreSelection: true, key: `page-line-${spacer.from}-${spacer.space}` })
}

// Line boxes of a paragraph in paper units; KaTeX fragments overlap their line and merge into it.
function measureLines(dom, paperTop, zoom) {
  const range = document.createRange()
  range.selectNodeContents(dom)
  const rects = Array.from(range.getClientRects())
    .filter(rect => rect.height > 3)
    .map(rect => ({ top: (rect.top - paperTop) / zoom, bottom: (rect.bottom - paperTop) / zoom }))
    .sort((a, b) => a.top - b.top)
  const lines = []
  for (const rect of rects) {
    const line = lines.at(-1)
    if (line && rect.top < line.bottom - 2) line.bottom = Math.max(line.bottom, rect.bottom)
    else lines.push({ ...rect })
  }
  return lines
}

// Document position of the first character (or inline formula) laid out at or below `lineTop`.
function lineStartPosition(view, dom, lineTop, paperTop, zoom) {
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains('studio-page-spacer')) return NodeFilter.FILTER_REJECT
        return node.dataset.type === 'inline-math' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      }
      return node.parentElement?.closest('[data-type="inline-math"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  const range = document.createRange()
  const topOf = (node, offset) => {
    range.setStart(node, offset)
    range.setEnd(node, offset + 1)
    const rect = Array.from(range.getClientRects()).find(item => item.height > 3)
    return rect ? (rect.top - paperTop) / zoom : -Infinity
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const rect = node.getBoundingClientRect()
      if ((rect.bottom - paperTop) / zoom > lineTop + 2) return view.posAtDOM(node, 0)
      continue
    }
    const length = node.textContent.length
    if (!length || topOf(node, length - 1) < lineTop - 2) continue
    let low = 0
    let high = length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (topOf(node, middle) >= lineTop - 2) high = middle
      else low = middle + 1
    }
    // A wrapped line starts after the space that ended the previous one.
    return view.posAtDOM(node, low)
  }
  return null
}

// Word-style flow over the unspaced layout: paragraphs split between lines, other blocks move whole,
// a heading at the bottom of a page moves with the block that follows it, and blocks that cannot move
// (taller than a page) get paper painted across the gaps they cross.
function layoutPages(view, paper, zoom) {
  const paperTop = paper.getBoundingClientRect().top
  const blocks = []
  view.state.doc.forEach((node, from) => {
    const dom = view.nodeDOM(from)
    if (dom instanceof HTMLElement) blocks.push({ node, from, to: from + node.nodeSize, dom })
  })
  const spacers = []
  const bridges = new Set()
  let inserted = 0
  let contentBottom = PAGE_TOP_INSET
  const frontmatter = paper.querySelector('.studio-frontmatter')
  if (frontmatter) {
    contentBottom = (frontmatter.getBoundingClientRect().bottom - paperTop) / zoom
    for (let page = 0; page < pageOf(contentBottom); page++) bridges.add(page)
  }
  let forceBreak = false
  let heading = null
  for (let index = 0; index < blocks.length; index++) {
    const { node, from, to, dom } = blocks[index]
    const rect = dom.getBoundingClientRect()
    const naturalTop = (rect.top - paperTop) / zoom
    const height = rect.height / zoom
    const insertedBefore = inserted
    const spacerCount = spacers.length
    let top = naturalTop + inserted
    const page = pageOf(top)
    const afterPageBreak = forceBreak
    forceBreak = dom.hasAttribute('data-page-break')
    let split = false
    let movedToNextPage = false

    const crossesBottom = top + height > pageTextEnd(page) + 1
    if (top > pageTextStart(page) + 1 && (afterPageBreak || top > pageTextEnd(page) || crossesBottom)) {
      const lines = !afterPageBreak && top <= pageTextEnd(page) && node.type.name === 'paragraph' ? measureLines(dom, paperTop, zoom) : []
      if (lines.length > 1 && lines[0].bottom + inserted <= pageTextEnd(page) + 1) {
        split = true
        for (const line of lines.slice(1)) {
          const lineTop = line.top + inserted
          const linePage = pageOf(lineTop)
          if (line.bottom + inserted <= pageTextEnd(linePage) + 1) continue
          const position = lineStartPosition(view, dom, line.top, paperTop, zoom)
          if (position === null || position <= from || position >= to - 1) break
          const space = roundSpace(pageTextStart(linePage + 1) - lineTop)
          if (space <= 1) continue
          spacers.push({ kind: 'line', from: position, space })
          inserted += space
        }
      } else if (afterPageBreak || top > pageTextEnd(page) || height <= USABLE_PAGE_HEIGHT) {
        const space = roundSpace(pageTextStart(page + 1) - top)
        if (space > 1) {
          spacers.push({ kind: 'block', from, to, space })
          inserted += space
          top += space
          movedToNextPage = true
        }
      }
    }

    // Keep a heading with the block after it instead of leaving it alone at the bottom of a page.
    if (movedToNextPage && !afterPageBreak && heading && heading.page === page) {
      spacers.length = heading.spacerCount
      const headingTop = heading.naturalTop + heading.insertedBefore
      const space = roundSpace(pageTextStart(heading.page + 1) - headingTop)
      spacers.push({ kind: 'block', from: heading.from, to: heading.to, space })
      inserted = heading.insertedBefore + space
      forceBreak = false
      heading = null
      index -= 1
      continue
    }

    const bottom = naturalTop + inserted + height
    if (!split) {
      for (let gapIndex = Math.max(0, Math.floor(top / PAGE_STEP) - 1); gapIndex <= Math.floor(bottom / PAGE_STEP); gapIndex++) {
        if (top < (gapIndex + 1) * PAGE_STEP && bottom > gapIndex * PAGE_STEP + PAGE_HEIGHT) bridges.add(gapIndex)
      }
    }
    contentBottom = Math.max(contentBottom, bottom)
    heading = node.type.name === 'heading' && top > pageTextStart(pageOf(top)) + 1
      ? { from, to, naturalTop, insertedBefore, spacerCount, page: pageOf(top) }
      : null
  }
  return { spacers, bridges: Array.from(bridges).sort((a, b) => a - b), contentBottom }
}

const ribbonTabs = [
  { id: 'quick', label: 'Cơ bản' },
  { id: 'home', label: 'Trang chủ' },
  { id: 'insert', label: 'Chèn' },
  { id: 'references', label: 'Tham chiếu' },
  { id: 'layout', label: 'Bố cục' },
  { id: 'view', label: 'Xem' },
]

function ToolButton({ title, active, onClick, children, prominent = false, ariaExpanded }) {
  return (
    <button
      type="button"
      className={'studio-ribbon-tool' + (active ? ' is-active' : '') + (prominent ? ' is-prominent' : '')}
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ToolDivider() {
  return <span className="studio-ribbon-divider" aria-hidden="true" />
}

function RibbonGroup({ label, children }) {
  return <div className="studio-ribbon-group" role="group" aria-label={label}>{children}</div>
}

export default function EditorPane({
  editor,
  readOnly = false,
  documentId,
  title, settings = {}, onEditAbstract,
  onFormat,
  onPageCountChange,
  uploadInputRef,
  imageError,
  onImageChange,
  onRequestImage,
  onOpenFormula,
  onOpenMathScan,
  focusMode = false,
  compactTools = false,
  onOpenManager, onOpenReferences, onOpenFormulaLibrary, onOpenTableLibrary, onOpenDocumentTemplates, onToggleFocus,
  outline = [], onJumpToHeading, sourceEdited, sourceSyncStatus, onResetSource, sourceDraftBackupAvailable, onRestoreSourceDraft,
}) {
  const stageRef = useRef(null)
  const paperRef = useRef(null)
  const findInputRef = useRef(null)
  const paginationRefreshRef = useRef(null)
  const [ribbonOpen, setRibbonOpen] = useState(true)
  const [activeRibbonTab, setActiveRibbonTab] = useState('quick')
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [navigation, setNavigation] = useState('scroll')
  const [pageCount, setPageCount] = useState(1)
  const [activePage, setActivePage] = useState(0)
  const [pageBridges, setPageBridges] = useState([])
  useEffect(() => { onPageCountChange?.(pageCount) }, [onPageCountChange, pageCount])
  const focusToolbarWasOpenRef = useRef(null)
  const [showFind, setShowFind] = useState(false), [findText, setFindText] = useState(''), [replacement, setReplacement] = useState(''), [findMessage, setFindMessage] = useState('')
  useEffect(() => { if (showFind) findInputRef.current?.focus() }, [showFind])
  const [showLink, setShowLink] = useState(false), [linkUrl, setLinkUrl] = useState('')
  const [openMenu, setOpenMenu] = useState(null)
  const [tableSize, setTableSize] = useState([0, 0])
  const [painterMarks, setPainterMarks] = useState(null)
  const [zoom, setZoom] = useState(1)
  useTrackpadZoom(stageRef, setZoom)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const format = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      fontSize: current.getAttributes('textStyle').fontSize || '',
      color: current.getAttributes('textStyle').color || '',
      highlight: current.getAttributes('highlight').color || (current.isActive('highlight') ? '#fff59d' : ''),
      superscript: current.isActive('superscript'),
      subscript: current.isActive('subscript'),
      align: ['left', 'center', 'right', 'justify'].find(value => current.isActive({ textAlign: value })) || '',
      inList: current.isActive('listItem'),
      inTable: current.isActive('table'),
      ...Object.fromEntries(['bold', 'italic', 'underline', 'strike', 'bulletList', 'orderedList', 'blockquote', 'codeBlock'].map(name => [name, current.isActive(name)])),
      paragraphStyle: [1, 2, 3].map(level => current.isActive('heading', { level }) ? `heading-${level}` : '').find(Boolean) || 'paragraph',
      tableCaption: current.getAttributes('table').caption || '',
      tableLabel: current.getAttributes('table').label || '',
    } : {},
  }) || {}
  const chain = () => editor?.chain().focus()
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const menuAnchorRef = useRef(null)
  useLayoutEffect(() => {
    if (!openMenu) return undefined
    const place = () => {
      const anchor = menuAnchorRef.current
      const menu = anchor?.closest('.studio-menu-anchor')?.querySelector('.studio-menu')
      if (!menu || !anchor?.isConnected) return
      const rect = anchor.getBoundingClientRect()
      const width = menu.getBoundingClientRect().width
      const above = Math.max(0, rect.top - 14)
      const below = Math.max(0, window.innerHeight - rect.bottom - 14)
      const opensAbove = compactTools || (below < menu.scrollHeight && above > below)
      setMenuPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: opensAbove ? 'auto' : rect.bottom + 6,
        bottom: opensAbove ? window.innerHeight - rect.top + 6 : 'auto',
        maxHeight: Math.max(0, opensAbove ? above : below),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [openMenu, compactTools])
  // Menus are position: fixed because the ribbon scrolls horizontally and would clip them.
  const toggleMenu = (name, event) => {
    menuAnchorRef.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPosition({ left: `min(${Math.round(rect.left)}px, calc(100vw - 316px))`, top: Math.round(rect.bottom + 4) })
    setOpenMenu(value => value === name ? null : name)
  }
  const clearFormatting = () => chain()?.unsetAllMarks().unsetTextAlign().run()
  // First click copies the selection's formatting; the next click applies it.
  const formatPainter = () => {
    if (!editor) return
    if (!painterMarks) {
      setPainterMarks(editor.state.selection.$from.marks().filter(mark => PAINTABLE_MARKS.has(mark.type.name)))
      return
    }
    let next = chain().unsetAllMarks()
    for (const mark of painterMarks) next = next.setMark(mark.type.name, mark.attrs)
    next.run()
    setPainterMarks(null)
  }
  const insertSymbol = value => { chain()?.insertContent(value).run(); setOpenMenu(null) }
  const insertMathSymbol = latex => {
    if (!editor) return
    const { from, to } = editor.state.selection
    editor.chain().focus().insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex } }).run()
    setOpenMenu(null)
  }
  const insertDate = () => chain()?.insertContent(new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })).run()
  const insertTable = (rows, cols) => { chain()?.insertTable({ rows, cols, withHeaderRow: true }).run(); setOpenMenu(null); setTableSize([0, 0]) }
  const changeZoom = direction => setZoom(value => {
    const index = ZOOM_LEVELS.indexOf(value)
    return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))]
  })

  // Esc hides the tool panel; while a menu is open the first Esc only closes that menu.
  useEffect(() => {
    if (!ribbonOpen || openMenu) return undefined
    // An IME composition (Telex/VNI) or an open dialog owns Escape.
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('.modal-backdrop [role="dialog"]')) return
      setRibbonOpen(false)
      setOutlineOpen(false)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [ribbonOpen, openMenu])

  useEffect(() => {
    if (!openMenu) return undefined
    const close = event => { if (!event.target.closest?.('.studio-menu-anchor')) setOpenMenu(null) }
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); setOpenMenu(null); menuAnchorRef.current?.focus() } }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [openMenu])
  const paragraphStyle = format.paragraphStyle || 'paragraph'
  const applyParagraphStyle = value => {
    if (!editor) return
    if (value === 'paragraph') editor.chain().focus().setParagraph().run()
    else editor.chain().focus().setHeading({ level: Number(value.slice(-1)) }).run()
  }
  const search = (replaceAll = false) => {
    if (!editor || !findText) return
    const matches = []
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text.toLocaleLowerCase(), query = findText.toLocaleLowerCase()
      for (let from = text.indexOf(query); from !== -1; from = text.indexOf(query, from + query.length)) matches.push({ from: pos + from, to: pos + from + findText.length })
    })
    setFindMessage(`${matches.length} kết quả`)
    if (replaceAll) { const tr = editor.state.tr; for (const match of matches.reverse()) tr.insertText(replacement, match.from, match.to); editor.view.dispatch(tr); return }
    const match = matches.find(item => item.from >= editor.state.selection.to) || matches[0]
    if (match) editor.chain().focus().setTextSelection(match).scrollIntoView().run()
  }

  useLayoutEffect(() => {
    if (focusMode) {
      focusToolbarWasOpenRef.current = ribbonOpen
      setRibbonOpen(false)
    } else if (focusToolbarWasOpenRef.current !== null) {
      setRibbonOpen(focusToolbarWasOpenRef.current)
      focusToolbarWasOpenRef.current = null
    }
  // Capture the prior ribbon state only when focus mode changes; observing ribbonOpen would overwrite it after hiding the ribbon.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode])

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const view = editor.view
    let paginationTimer = 0

    // Page spacers are decorations: ProseMirror re-renders a block whose DOM attributes are changed by hand,
    // which silently dropped hand-set spacers and let text run into the gap between pages.
    // A block spacer pushes a whole block to the next page; a line spacer is a block-level widget placed
    // at the first character of the line that no longer fits, so a paragraph continues on the next page.
    const plugin = new Plugin({
      key: pagePaginationKey,
      state: {
        init: () => ({ spacers: [], decorations: DecorationSet.empty }),
        apply(transaction, value, _oldState, newState) {
          const spacers = transaction.getMeta(pagePaginationKey)
          if (spacers) return { spacers, decorations: DecorationSet.create(newState.doc, spacers.map(spacerDecoration)) }
          if (!transaction.docChanged) return value
          // Keep spacers in place until the next pass re-measures the edited layout.
          return { spacers: value.spacers, decorations: value.decorations.map(transaction.mapping, transaction.doc) }
        },
      },
      props: { decorations: state => pagePaginationKey.getState(state)?.decorations },
    })
    editor.registerPlugin(plugin)

    const paginate = () => {
      const paper = paperRef.current
      if (!paper || editor.isDestroyed || !view.dom.isConnected) return
      const stage = stageRef.current
      const zoom = zoomRef.current
      const scrollTop = stage?.scrollTop ?? 0
      // Measure the layout without spacers (CSS on the paper, which ProseMirror does not own), so each pass
      // starts from the natural flow instead of the previous pass's result.
      paper.classList.add('is-measuring-pages')
      let layout
      try {
        layout = layoutPages(view, paper, zoom)
      } finally {
        paper.classList.remove('is-measuring-pages')
        // The stage scrolls smoothly; restoring a clamped offset must not animate.
        if (stage && stage.scrollTop !== scrollTop) stage.scrollTo({ top: scrollTop, behavior: 'instant' })
      }

      const current = pagePaginationKey.getState(view.state)?.spacers || []
      const unchanged = current.length === layout.spacers.length && current.every((spacer, index) => {
        const next = layout.spacers[index]
        return spacer.kind === next.kind && spacer.from === next.from && Math.abs(spacer.space - next.space) < 1
      })
      if (!unchanged) view.dispatch(view.state.tr.setMeta(pagePaginationKey, layout.spacers).setMeta('addToHistory', false))

      setPageBridges(previous => previous.length === layout.bridges.length && previous.every((value, index) => value === layout.bridges[index]) ? previous : layout.bridges)
      const nextPageCount = Math.max(1, Math.ceil((layout.contentBottom + PAGE_BOTTOM_INSET) / PAGE_STEP))
      setPageCount(nextPageCount)
      const visiblePage = stage ? Math.floor((stage.scrollTop / zoom + Math.min(stage.clientHeight * 0.38 / zoom, PAGE_STEP - 1)) / PAGE_STEP) : 0
      setActivePage(Math.max(0, Math.min(nextPageCount - 1, visiblePage)))
    }

    // A timer rather than requestAnimationFrame: Electron pauses frames for hidden or occluded windows,
    // which left a document opened in the background unpaginated until the next edit.
    const schedulePagination = () => {
      if (paginationTimer) return
      paginationTimer = window.setTimeout(() => {
        paginationTimer = 0
        paginate()
      }, 100)
    }
    paginationRefreshRef.current = schedulePagination

    editor.on('update', schedulePagination)
    const resizeObserver = new ResizeObserver(schedulePagination)
    resizeObserver.observe(paperRef.current)
    resizeObserver.observe(view.dom)
    window.addEventListener('resize', schedulePagination)
    // KaTeX and web fonts change block heights after the first layout.
    document.fonts?.ready.then(schedulePagination)
    schedulePagination()

    return () => {
      editor.off('update', schedulePagination)
      resizeObserver.disconnect()
      window.removeEventListener('resize', schedulePagination)
      window.clearTimeout(paginationTimer)
      paginationTimer = -1
      if (paginationRefreshRef.current === schedulePagination) paginationRefreshRef.current = null
      if (!editor.isDestroyed) editor.unregisterPlugin(pagePaginationKey)
    }
  // Re-measure when zoom changes; block rects scale with it.
  }, [editor, zoom])

  useEffect(() => { paginationRefreshRef.current?.() }, [documentId, title, settings.abstractEnabled, settings.abstract, settings.abstractTitle, settings.author, settings.date])

  const goToPage = page => {
    const nextPage = Math.max(0, Math.min(pageCount - 1, page))
    stageRef.current?.scrollTo({ top: nextPage * PAGE_STEP * zoom, behavior: 'smooth' })
    setActivePage(nextPage)
  }

  return (
    <section className={`flex h-full min-h-0 w-full flex-col overflow-hidden ${focusMode ? 'studio-editor-focus' : ''}`} aria-label="Soạn thảo tài liệu" onKeyDown={event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const zoomShortcuts = { '=': () => changeZoom(1), '+': () => changeZoom(1), '-': () => changeZoom(-1), 0: () => setZoom(1) }
      // Zoom stays available in read-only summary mode, like the zoom buttons.
      const shortcuts = readOnly ? zoomShortcuts : {
        f: () => setShowFind(true),
        h: () => setShowFind(true),
        k: () => { setLinkUrl(editor?.getAttributes('link').href || ''); setShowLink(true) },
        ...zoomShortcuts,
      }
      if (!shortcuts[key] || (event.shiftKey && !['+', 'k'].includes(key))) return
      event.preventDefault()
      shortcuts[key]()
    }}>
      {sourceEdited
        ? <div className="studio-source-warning"><span>PDF đang dùng source riêng. Sửa LaTeX sẽ cập nhật bản thảo; sửa bản thảo sẽ chuyển PDF sang source tự tạo. Source riêng vẫn được giữ để khôi phục.{' '}
          <strong role={sourceSyncStatus?.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
            {sourceSyncStatus?.text || 'Đang khởi tạo đồng bộ từ LaTeX…'}
          </strong>
        </span><button type="button" onClick={onResetSource}>Dùng lại bản thảo</button></div>
        : sourceDraftBackupAvailable && <div className="studio-source-warning"><span>PDF đang đồng bộ với bản thảo. Source riêng trước đó vẫn được giữ lại.</span><button type="button" onClick={onRestoreSourceDraft}>Khôi phục source riêng</button></div>}
      <div className="studio-ribbon" hidden={readOnly}>
        <div className="studio-ribbon-head">
          <div className="mono-editor-label"><FileText size={14} /><strong>BẢN THẢO</strong></div>
          <nav className="studio-ribbon-tabs" aria-label="Thẻ công cụ soạn thảo">
            {/* Click a tab to open its tools; click again or press Esc to return to writing. */}
            {ribbonTabs.map(tab => {
              const open = ribbonOpen && activeRibbonTab === tab.id
              return <button type="button" key={tab.id} className={'studio-ribbon-tab' + (open ? ' is-active' : '')} onClick={() => { setOutlineOpen(false); setOpenMenu(null); setActiveRibbonTab(tab.id); setRibbonOpen(!open) }} aria-expanded={open} aria-controls="editor-format-toolbar" title={open ? 'Ẩn công cụ' : `Mở công cụ ${tab.label}`}>{tab.label}</button>
            })}
          </nav>
          {compactTools && <button type="button" className="noir-ribbon-toggle" aria-label={ribbonOpen ? 'Thu gọn công cụ soạn thảo' : 'Mở công cụ soạn thảo'} aria-expanded={ribbonOpen} aria-controls="editor-format-toolbar" title={ribbonOpen ? 'Thu gọn công cụ · Esc' : 'Mở công cụ soạn thảo'} onClick={() => { setOpenMenu(null); setOutlineOpen(false); setRibbonOpen(value => !value) }}><ChevronDown size={14} /></button>}
        </div>

        <div id="editor-format-toolbar" onScroll={() => setOpenMenu(null)} className="studio-ribbon-panel" role="toolbar" aria-label="Công cụ soạn thảo" hidden={!ribbonOpen}>
          {activeRibbonTab === 'quick' && <>
            <ToolButton title="Hoàn tác (Ctrl+Z)" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton>
            <ToolButton title="Làm lại (Ctrl+Shift+Z)" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton>
            <ToolDivider />
            <select className="studio-ribbon-select" value={paragraphStyle} onChange={event => applyParagraphStyle(event.target.value)} aria-label="Kiểu đoạn văn">
              <option value="paragraph">Đoạn văn</option><option value="heading-1">Tiêu đề 1</option><option value="heading-2">Tiêu đề 2</option><option value="heading-3">Tiêu đề 3</option>
            </select>
            <ToolDivider />
            <ToolButton title="In đậm (Ctrl+B)" active={format.bold} onClick={() => onFormat('toggleBold')}><Bold size={16} /></ToolButton>
            <ToolButton title="In nghiêng (Ctrl+I)" active={format.italic} onClick={() => onFormat('toggleItalic')}><Italic size={16} /></ToolButton>
            <ToolButton title="Gạch chân (Ctrl+U)" active={format.underline} onClick={() => onFormat('toggleUnderline')}><Underline size={16} /></ToolButton>
            <ToolDivider />
            <ToolButton title="Danh sách" active={format.bulletList} onClick={() => onFormat('toggleBulletList')}><List size={16} /></ToolButton>
            <ToolButton title="Trích dẫn" active={format.blockquote} onClick={() => onFormat('toggleBlockquote')}><Quote size={16} /></ToolButton>
            <ToolButton title="Chèn trích dẫn (Ctrl+Shift+C)" onClick={() => onOpenReferences?.('cite')}><TextQuote size={16} /></ToolButton>
            <ToolButton title="Liên kết (Ctrl+Shift+K)" onClick={() => { setLinkUrl(editor?.getAttributes('link').href || ''); setShowLink(value => !value) }}><Link size={16} /></ToolButton>
            <ToolDivider />
            <ToolButton title="Chèn công thức toán học" onClick={onOpenFormula}><Sigma size={17} /><span>Công thức</span></ToolButton>
          </>}
          {activeRibbonTab === 'home' && <>
            <RibbonGroup label="Lịch sử">
              <ToolButton title="Hoàn tác (Ctrl+Z)" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton>
              <ToolButton title="Làm lại (Ctrl+Shift+Z)" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton>
              <ToolButton title="Tìm và thay thế" active={showFind} onClick={() => setShowFind(value => !value)}><Search size={16} /></ToolButton>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Kiểu đoạn">
              <label className="sr-only" htmlFor="editor-paragraph-style">Kiểu đoạn văn</label>
              <select id="editor-paragraph-style" className="studio-ribbon-select" value={paragraphStyle} onChange={event => applyParagraphStyle(event.target.value)} aria-label="Kiểu đoạn văn">
                <option value="paragraph">Đoạn văn</option>
                <option value="heading-1">Tiêu đề 1</option>
                <option value="heading-2">Tiêu đề 2</option>
                <option value="heading-3">Tiêu đề 3</option>
              </select>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Phông chữ">
              <label className="sr-only" htmlFor="editor-font-size">Cỡ chữ</label>
              <select id="editor-font-size" className="studio-ribbon-select studio-ribbon-select-narrow" value={format.fontSize || ''} onChange={event => event.target.value ? chain()?.setFontSize(event.target.value).run() : chain()?.unsetFontSize().run()} title="Cỡ chữ" aria-label="Cỡ chữ">
                <option value="">Cỡ mặc định</option>
                {FONT_SIZES.map(size => <option key={size} value={size}>{size.replace('pt', '')}</option>)}
              </select>
              <ToolButton title="In đậm (Ctrl+B)" active={format.bold} onClick={() => onFormat('toggleBold')}><Bold size={16} /></ToolButton>
              <ToolButton title="In nghiêng (Ctrl+I)" active={format.italic} onClick={() => onFormat('toggleItalic')}><Italic size={16} /></ToolButton>
              <ToolButton title="Gạch chân (Ctrl+U)" active={format.underline} onClick={() => onFormat('toggleUnderline')}><Underline size={16} /></ToolButton>
              <ToolButton title="Gạch ngang (Ctrl+Shift+S)" active={format.strike} onClick={() => onFormat('toggleStrike')}><Strikethrough size={16} /></ToolButton>
              <ToolButton title="Chỉ số dưới (Ctrl+,)" active={format.subscript} onClick={() => onFormat('toggleSubscript')}><Subscript size={16} /></ToolButton>
              <ToolButton title="Chỉ số trên (Ctrl+.)" active={format.superscript} onClick={() => onFormat('toggleSuperscript')}><Superscript size={16} /></ToolButton>
              <div className="studio-menu-anchor">
                <ToolButton title="Màu chữ" active={openMenu === 'color'} ariaExpanded={openMenu === 'color'} onClick={event => toggleMenu('color', event)}><Baseline size={16} /><span className="studio-color-bar" style={{ background: format.color || 'currentColor' }} /></ToolButton>
                {openMenu === 'color' && <div style={menuPosition} className="studio-menu" role="menu" aria-label="Màu chữ">
                  <div className="studio-swatches">{TEXT_COLORS.map(([value, name]) => <button type="button" key={value} role="menuitem" className={'studio-swatch' + (format.color === value ? ' is-active' : '')} style={{ background: value }} title={name} aria-label={name} onClick={() => { chain()?.setColor(value).run(); setOpenMenu(null) }} />)}</div>
                  <button type="button" className="studio-menu-item" onClick={() => { chain()?.unsetColor().run(); setOpenMenu(null) }}>Màu tự động</button>
                </div>}
              </div>
              <div className="studio-menu-anchor">
                <ToolButton title="Tô sáng văn bản" active={openMenu === 'highlight'} ariaExpanded={openMenu === 'highlight'} onClick={event => toggleMenu('highlight', event)}><Highlighter size={16} /><span className="studio-color-bar" style={{ background: format.highlight || 'currentColor' }} /></ToolButton>
                {openMenu === 'highlight' && <div style={menuPosition} className="studio-menu" role="menu" aria-label="Màu tô sáng">
                  <div className="studio-swatches">{HIGHLIGHT_COLORS.map(([value, name]) => <button type="button" key={value} role="menuitem" className={'studio-swatch' + (format.highlight === value ? ' is-active' : '')} style={{ background: value }} title={name} aria-label={name} onClick={() => { chain()?.setHighlight({ color: value }).run(); setOpenMenu(null) }} />)}</div>
                  <button type="button" className="studio-menu-item" onClick={() => { chain()?.unsetHighlight().run(); setOpenMenu(null) }}>Không tô sáng</button>
                </div>}
              </div>
              <ToolButton title="Xóa định dạng" onClick={clearFormatting}><RemoveFormatting size={16} /></ToolButton>
              <ToolButton title={painterMarks ? 'Chọn văn bản rồi bấm lại để áp dụng định dạng' : 'Sao chép định dạng'} active={Boolean(painterMarks)} onClick={formatPainter}><Paintbrush size={16} /></ToolButton>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Đoạn văn">
              <ToolButton title="Danh sách" active={format.bulletList} onClick={() => onFormat('toggleBulletList')}><List size={17} /></ToolButton>
              <ToolButton title="Danh sách đánh số" active={format.orderedList} onClick={() => onFormat('toggleOrderedList')}><ListOrdered size={16} /></ToolButton>
              <ToolButton title="Giảm mức thụt lề (Shift+Tab)" onClick={() => chain()?.liftListItem('listItem').run()}><IndentDecrease size={16} /></ToolButton>
              <ToolButton title="Tăng mức thụt lề (Tab)" onClick={() => chain()?.sinkListItem('listItem').run()}><IndentIncrease size={16} /></ToolButton>
              <ToolButton title="Trích dẫn" active={format.blockquote} onClick={() => onFormat('toggleBlockquote')}><Quote size={16} /></ToolButton>
              <ToolButton title="Khối mã" active={format.codeBlock} onClick={() => onFormat('toggleCodeBlock')}><Code size={16} /></ToolButton>
              <ToolButton title="Căn trái (Ctrl+Shift+L)" active={format.align === 'left'} onClick={() => chain()?.setTextAlign('left').run()}><AlignLeft size={16} /></ToolButton>
              <ToolButton title="Căn giữa (Ctrl+Shift+E)" active={format.align === 'center'} onClick={() => chain()?.setTextAlign('center').run()}><AlignCenter size={16} /></ToolButton>
              <ToolButton title="Căn phải (Ctrl+Shift+R)" active={format.align === 'right'} onClick={() => chain()?.setTextAlign('right').run()}><AlignRight size={16} /></ToolButton>
              <ToolButton title="Căn đều hai bên (Ctrl+Shift+J)" active={format.align === 'justify'} onClick={() => chain()?.setTextAlign('justify').run()}><AlignJustify size={16} /></ToolButton>
            </RibbonGroup>
          </>}

          {activeRibbonTab === 'insert' && <>
            <RibbonGroup label="Trang">
              <ToolButton title="Ngắt trang (Ctrl+Enter)" onClick={() => chain()?.setPageBreak().run()}><SeparatorHorizontal size={17} /><span>Ngắt trang</span></ToolButton>
              <ToolButton title="Đường kẻ ngang" onClick={() => chain()?.setHorizontalRule().run()}><Minus size={17} /><span>Đường kẻ</span></ToolButton>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Nội dung">
              <div className="studio-menu-anchor">
                <ToolButton title="Chèn bảng" active={openMenu === 'table'} ariaExpanded={openMenu === 'table'} onClick={event => toggleMenu('table', event)}><Table2 size={17} /><span>Bảng</span><ChevronDown size={12} /></ToolButton>
                {openMenu === 'table' && <div style={menuPosition} className="studio-menu" role="dialog" aria-label="Chọn kích thước bảng">
                  <div className="studio-table-grid" onPointerLeave={() => setTableSize([0, 0])}>
                    {Array.from({ length: 8 * 10 }, (_, index) => {
                      const row = Math.floor(index / 10) + 1, col = (index % 10) + 1
                      return <button type="button" key={index} className={row <= tableSize[0] && col <= tableSize[1] ? 'is-active' : ''} aria-label={`Bảng ${row} × ${col}`} onPointerEnter={() => setTableSize([row, col])} onFocus={() => setTableSize([row, col])} onClick={() => insertTable(row, col)} />
                    })}
                  </div>
                  <p className="studio-menu-caption">{tableSize[0] ? `${tableSize[0]} hàng × ${tableSize[1]} cột` : 'Rê chuột để chọn kích thước'}</p>
                </div>}
              </div>
              <ToolButton title="Thư viện bảng: mẫu dựng sẵn, kiểu đường kẻ, căn cột và mã LaTeX" onClick={onOpenTableLibrary}><Table2 size={17} /><span>Thư viện bảng</span></ToolButton>
              <ToolButton title="Chèn hình ảnh" onClick={onRequestImage}><ImagePlus size={17} /><span>Hình ảnh</span></ToolButton>
              <ToolButton title="Chèn liên kết (Ctrl+Shift+K)" onClick={() => { setLinkUrl(editor?.getAttributes('link').href || ''); setShowLink(value => !value) }}><Link size={16} /><span>Liên kết</span></ToolButton>
            </RibbonGroup>
            {format.inTable && <>
              <ToolDivider />
              <RibbonGroup label="Chú thích bảng">
                <label className="studio-table-meta-field">
                  <span>Chú thích</span>
                  <input aria-label="Chú thích bảng" maxLength={500} defaultValue={format.tableCaption} key={`table-caption-${format.tableCaption}`} onBlur={event => {
                    const caption = event.currentTarget.value.trim()
                    if (caption !== format.tableCaption) editor?.chain().updateAttributes('table', { caption }).run()
                  }} />
                </label>
                <label className="studio-table-meta-field studio-table-meta-field-label">
                  <span>Nhãn</span>
                  <input aria-label="Nhãn bảng LaTeX" maxLength={100} placeholder="tab:budget" defaultValue={format.tableLabel} key={`table-label-${format.tableLabel}`} onBlur={event => {
                    const label = event.currentTarget.value.trim().replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 100)
                    if (label !== format.tableLabel) editor?.chain().updateAttributes('table', { label }).run()
                  }} />
                </label>
              </RibbonGroup>
            </>}
            <ToolDivider />
            <RibbonGroup label="Ký hiệu">
              <div className="studio-menu-anchor">
                <ToolButton title="Chèn ký tự đặc biệt" active={openMenu === 'symbols'} ariaExpanded={openMenu === 'symbols'} onClick={event => toggleMenu('symbols', event)}><Omega size={16} /><span>Ký hiệu</span><ChevronDown size={12} /></ToolButton>
                {openMenu === 'symbols' && <div style={menuPosition} className="studio-menu studio-menu-wide" role="menu" aria-label="Ký tự đặc biệt">
                  <p className="studio-menu-caption">Ký tự văn bản</p>
                  <div className="studio-symbol-grid">{TEXT_SYMBOLS.map(symbol => <button type="button" role="menuitem" key={symbol} onClick={() => insertSymbol(symbol)} aria-label={`Chèn ${symbol}`}>{symbol}</button>)}</div>
                  <p className="studio-menu-caption">Ký hiệu toán (chèn dạng công thức)</p>
                  <div className="studio-symbol-grid">{MATH_SYMBOLS.map(([symbol, latex]) => <button type="button" role="menuitem" key={latex} onClick={() => insertMathSymbol(latex)} title={latex} aria-label={`Chèn ${symbol}`}>{symbol}</button>)}</div>
                </div>}
              </div>
              <ToolButton title="Chèn ngày hôm nay" onClick={insertDate}><CalendarDays size={16} /><span>Ngày</span></ToolButton>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Công thức">
              <ToolButton title="Chèn công thức toán học" prominent onClick={onOpenFormula}><Sigma size={17} /><span>Chèn công thức</span><Plus size={12} /></ToolButton>
              <ToolButton title="Quét công thức trong bản thảo và xem gợi ý LaTeX" onClick={onOpenMathScan}><Search size={16} /><span>Quét công thức</span></ToolButton>
              <ToolButton title="Thư viện công thức" onClick={onOpenFormulaLibrary}><BookOpen size={16} /><span>Thư viện</span></ToolButton>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Mẫu">
              <ToolButton title="Chọn mẫu tài liệu" onClick={onOpenDocumentTemplates}><FileText size={16} /><span>Mẫu tài liệu</span></ToolButton>
            </RibbonGroup>
          </>}

          {activeRibbonTab === 'references' && <>
            <RibbonGroup label="Trích dẫn">
              <ToolButton prominent title="Chèn trích dẫn sau đoạn đang chọn (Ctrl+Shift+C)" onClick={() => onOpenReferences?.('cite')}><TextQuote size={17} /><span>Chèn trích dẫn</span></ToolButton>
              <ToolButton title="Quản lý danh mục tài liệu tham khảo, kiểu trích dẫn (IEEE, APA…)" onClick={() => onOpenReferences?.('library')}><Library size={17} /><span>Danh mục tài liệu</span></ToolButton>
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Tài liệu học thuật">
              <ToolButton title="Nhãn, tham chiếu chéo và chú thích" onClick={onOpenManager}><BookOpen size={17} /><span>Nhãn & chú thích</span></ToolButton>
              <ToolButton title="Mở mục lục tài liệu" active={outlineOpen} onClick={() => setOutlineOpen(value => !value)} aria-expanded={outlineOpen}><ListTree size={17} /><span>Mục lục</span></ToolButton>
            </RibbonGroup>
          </>}

          {activeRibbonTab === 'layout' && <>
            <RibbonGroup label="Thiết lập trang">
              <ToolButton title="Thiết lập tài liệu, trang và tác giả" onClick={onOpenManager}><FileText size={17} /><span>Thiết lập tài liệu</span></ToolButton>
              <ToolButton title="Chọn mẫu tài liệu" onClick={onOpenDocumentTemplates}><BookOpen size={16} /><span>Mẫu trang</span></ToolButton>
            </RibbonGroup>
          </>}

          {activeRibbonTab === 'view' && <>
            <RibbonGroup label="Cách xem trang">
              <button type="button" className={'studio-ribbon-choice' + (navigation === 'scroll' ? ' is-active' : '')} onClick={() => setNavigation('scroll')} aria-pressed={navigation === 'scroll'}>Cuộn liên tục</button>
              <button type="button" className={'studio-ribbon-choice' + (navigation === 'page' ? ' is-active' : '')} onClick={() => { setNavigation('page'); goToPage(activePage) }} aria-pressed={navigation === 'page'}>Từng trang</button>
              {navigation === 'page' && <div className="studio-page-stepper" role="group" aria-label="Chuyển trang">
                <button type="button" onClick={() => goToPage(activePage - 1)} disabled={activePage === 0} title="Trang trước" aria-label="Trang trước"><ChevronLeft size={16} /></button>
                <button type="button" onClick={() => goToPage(activePage + 1)} disabled={activePage >= pageCount - 1} title="Trang tiếp" aria-label="Trang tiếp"><ChevronRight size={16} /></button>
              </div>}
            </RibbonGroup>
            <ToolDivider />
            <RibbonGroup label="Điều hướng">
              <ToolButton title="Mở mục lục tài liệu" active={outlineOpen} onClick={() => setOutlineOpen(value => !value)} aria-expanded={outlineOpen}><ListTree size={17} /><span>Mục lục</span></ToolButton>
              <ToolButton title="Bật hoặc tắt chế độ tập trung" onClick={onToggleFocus}><PanelTopOpen size={16} /><span>Tập trung</span></ToolButton>
            </RibbonGroup>
          </>}
        </div>

        {outlineOpen && ribbonOpen && <div className="studio-outline-popover" aria-label="Mục lục tài liệu">
          <div className="studio-outline-popover-title"><strong>Mục lục</strong><span>{outline.length}</span></div>
          {outline.length ? <nav aria-label="Tiêu đề trong tài liệu">{outline.map((item, index) => <button type="button" key={index} onClick={() => { onJumpToHeading?.(index); setOutlineOpen(false) }} title={item.label} style={{ paddingLeft: item.level > 1 ? 22 : 10 }}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong></button>)}</nav> : <p>Thêm tiêu đề H1 hoặc H2 để tạo mục lục và di chuyển nhanh.</p>}
        </div>}
      </div>

      {!readOnly && showFind && <div className="studio-inline-tools" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setShowFind(false); editor?.commands.focus() } }}><input ref={findInputRef} aria-label="Tìm trong bản thảo" placeholder="Tìm nội dung…" value={findText} onChange={event => setFindText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search() }} /><input aria-label="Thay bằng" placeholder="Thay bằng…" value={replacement} onChange={event => setReplacement(event.target.value)} /><button type="button" onClick={() => search()}>Tìm tiếp</button><button type="button" onClick={() => { const selected = editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) || ''; if (findText && selected.toLocaleLowerCase() === findText.toLocaleLowerCase()) editor.chain().focus().insertContent(replacement).run(); search() }}>Thay</button><button type="button" onClick={() => search(true)}>Thay tất cả</button><span role="status">{findMessage}</span><button type="button" className="noir-inline-close" aria-label="Đóng tìm kiếm" title="Đóng tìm kiếm · Esc" onClick={() => { setShowFind(false); editor?.commands.focus() }}><X size={14} /></button></div>}
      {!readOnly && showLink && <div className="studio-inline-tools" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setShowLink(false); editor?.commands.focus() } }}><input aria-label="Địa chỉ liên kết" placeholder="https://…" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && /^(https?:\/\/|mailto:)/i.test(linkUrl)) { event.preventDefault(); editor?.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run(); setShowLink(false) } }} /><button type="button" disabled={!/^(https?:\/\/|mailto:)/i.test(linkUrl)} onClick={() => { editor?.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run(); setShowLink(false) }}>Áp dụng</button><button type="button" onClick={() => { editor?.chain().focus().unsetLink().run(); setShowLink(false) }}>Gỡ liên kết</button><button type="button" className="noir-inline-close" aria-label="Đóng công cụ liên kết" title="Đóng công cụ liên kết · Esc" onClick={() => { setShowLink(false); editor?.commands.focus() }}><X size={14} /></button></div>}
      {!readOnly && format.inTable && <div className="studio-inline-tools" role="toolbar" aria-label="Công cụ bảng">
        <button type="button" onClick={onOpenTableLibrary} title="Chọn kiểu bảng, căn cột, cỡ chữ, giãn dòng và xem mã LaTeX"><Table2 size={14} /> Kiểu bảng</button>
        {[['left', 'Căn trái ô', AlignLeft], ['center', 'Căn giữa ô', AlignCenter], ['right', 'Căn phải ô', AlignRight]].map(([value, label, Icon]) => <button type="button" key={value} title={label} aria-label={label} onClick={() => editor.chain().focus().setCellAttribute('align', value).run()}><Icon size={14} /></button>)}
        {[['toggleHeaderRow', 'Hàng tiêu đề'], ['addRowBefore', 'Hàng trước'], ['addRowAfter', 'Hàng sau'], ['addColumnBefore', 'Cột trước'], ['addColumnAfter', 'Cột sau'], ['mergeCells', 'Gộp ô'], ['splitCell', 'Tách ô'], ['deleteRow', 'Xóa hàng'], ['deleteColumn', 'Xóa cột'], ['deleteTable', 'Xóa bảng']].map(([command, label]) => <button type="button" key={command} onClick={() => editor.chain().focus()[command]().run()}>{label}</button>)}
      </div>}

      <input ref={uploadInputRef} type="file" accept="image/*" hidden onChange={onImageChange} />
      {imageError && <div className="studio-alert" role="status">{imageError}</div>}
      <div ref={stageRef} className="studio-paper-stage min-h-0 flex-1 overflow-auto px-3 py-6 sm:px-5 sm:py-7 lg:px-6" data-navigation={navigation} onScroll={() => {
        const stage = stageRef.current
        if (!stage) return
        const page = Math.floor((stage.scrollTop / zoom + Math.min(stage.clientHeight * 0.38 / zoom, PAGE_STEP - 1)) / PAGE_STEP)
        setActivePage(Math.max(0, Math.min(pageCount - 1, page)))
      }}>
        <div ref={paperRef} style={zoom === 1 ? undefined : { zoom }} className="studio-paper mx-auto min-h-[1240px] w-full px-7 pb-24 pt-[58px] sm:px-12 lg:px-14">
          {pageBridges.map(gapIndex => <div key={gapIndex} className="studio-page-bridge" aria-hidden="true" style={{ top: gapIndex * PAGE_STEP + PAGE_HEIGHT - 1, height: PAGE_GAP + 2 }} />)}
          {settings.abstractEnabled && <div className="studio-frontmatter" aria-label="Khung đầu tài liệu">
            <div className="studio-frontmatter-title">{title}</div>
            {settings.author && <p className="studio-frontmatter-meta">{settings.author}</p>}
            {settings.date && <p className="studio-frontmatter-meta">{settings.date}</p>}
            <section className="studio-abstract-preview" aria-label={settings.abstractTitle || 'Abstract'}>
              <div className="studio-abstract-heading">{settings.abstractTitle || 'Abstract'}</div>
              {settings.abstract?.trim() ? settings.abstract.trim().split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="studio-abstract-placeholder">Nhập nội dung Abstract trong Thiết lập tài liệu.</p>}
              <button type="button" className="studio-abstract-edit" disabled={readOnly} onClick={onEditAbstract}>Sửa Abstract</button>
            </section>
          </div>}
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="studio-panel-foot mono-editor-foot">
        <span className="studio-page-indicator" aria-live="polite">Trang {activePage + 1} / {pageCount}</span>
        <ZoomControls value={zoom} onChange={setZoom} label="Thu phóng bản thảo" subject="bản thảo" />
        <span>Tự động lưu · UTF-8</span>
      </footer>
    </section>
  )
}
