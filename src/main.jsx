import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useEditor } from '@tiptap/react'
import { Extension, mergeAttributes, Node as TiptapNode } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import Placeholder from '@tiptap/extension-placeholder'
import Mathematics from '@tiptap/extension-mathematics'
import { TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { AcademicAttributes, AcademicTable, Citation, CrossReference, Footnote } from './services/AcademicNodes.js'
import { richTextExtensions } from './services/RichTextExtensions.js'
import { sanitizeSettings } from './services/DocumentSettings.js'
import { assetBudgetError, base64ByteLength, validateAssetFileBatch, validateAssets, bytesToBase64 } from './services/ProjectAssets.js'
import { acceptsSourceEdit, MAX_DOCUMENT_IMAGES, MAX_TOTAL_DOCUMENT_IMAGE_BYTES } from './services/DocumentLimits.js'
import { exportWorkspace, importWorkspace, importLatexProject } from './services/ArchiveService.js'
import { readLatexSource, readWord, writeWord } from './services/WordDocument.js'
import { updateMathNode } from './services/MathNodeTransforms.js'
import { bibtexForCompile, parseBibtex, resolveCitationStyle } from './services/Bibliography.js'
import { CITATION_REFRESH } from './services/AcademicNodes.js'
import ReferencesDialog from './components/ReferencesDialog.jsx'
import StudioManager from './components/StudioManager.jsx'
import { BookOpen, Eye, FileCode2, FileDown, FilePenLine, FolderPlus, GripVertical, PanelTopOpen, Settings2, Sigma } from 'lucide-react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { normalizeFormulaInput, standaloneLatexPaste } from './math-input.js'
import { containsUntrustedLatex, isClipboardPasteTransaction, UNTRUSTED_LATEX_INSERT_META, UNTRUSTED_LATEX_PASTE_META, UNTRUSTED_LATEX_TEMPLATE_META } from './services/UntrustedLatex.js'
import {
  builtInDocumentTemplates,
  builtInTemplates,
  defaultDocumentTemplate,
  delimitedMathReplacements,
  imageStats,
  normalizeDocumentDelimiters,
  normalizeDocumentHeadings,
  normalizeHeadingNode,
  reconcileEditorImagesIntoLatexSource,
  starter,
  textIn,
  toLatex,
} from './services/DocumentSerializer.js'
import { isValidDocument, sanitizeDocumentTemplates, sanitizeFormulaTemplates } from './services/DocumentData.js'
import { LocalDocumentStore } from './services/LocalDocumentStore.js'
import { workspaceRecords, sameRecord, rebaseSyncWorkspace } from './services/LanSyncData.js'
import { createProject, createTask, loadWorkspace, updateWorkspaceTask, writeWorkspaceData, editWorkspace, mergeWorkspace, sanitizeWorkspace } from './services/WorkspaceData.js'
import { LatexCompiler } from './services/LatexCompiler.js'
import { PdfCompileScheduler, estimateSourcePages, sameCompileInput } from './services/PdfCompileScheduler.js'
import { ImageEncoder } from './services/ImageEncoder.js'
import DocumentHeader from './components/DocumentHeader.jsx'
import StudioNavigation from './components/StudioNavigation.jsx'
import WorkflowBar from './components/WorkflowBar.jsx'
import ProjectTabs from './components/ProjectTabs.jsx'
import { compileProject } from './services/ProjectCompilation.js'
import CommandPalette from './components/CommandPalette.jsx'
import EditorPane from './components/EditorPane.jsx'
import PdfPreviewPane from './components/PdfPreviewPane.jsx'
import LatexSourcePane from './components/LatexSourcePane.jsx'
import { DocumentTemplatesDialog, FormulaDialog, FormulaLibraryDialog, WorkspaceDialog } from './components/DocumentDialogs.jsx'
import MathSuggestionDialog from './components/MathSuggestionDialog.jsx'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/newsreader/wght-italic.css'
import 'katex/dist/katex.min.css'
import './styles.css'
import './monochrome.css'
import './obsidian.css'
import './noir.css'
import './aurora.css'

// LaTeX và bộ kiểm tra workspace chỉ có ba cấp tiêu đề; h4–h6 dán từ web/Word hạ về cấp 3.
const ThreeLevelHeading = Heading.extend({
  parseHTML() {
    return [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${level}`, attrs: { level: Math.min(level, 3) } }))
  },
}).configure({ levels: [1, 2, 3] })

const ImageBlock = TiptapNode.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      filename: { default: '', rendered: false },
    }
  },
  parseHTML() { return [{ tag: 'img[data-latex-image]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { 'data-latex-image': 'true', class: 'latex-image-block' })]
  },
})

function findMathRanges(state, options) {
  const nodes = []
  const blocks = []
  state.doc.forEach((node, position) => { nodes.push({ node, position }); blocks.push(node.toJSON()) })
  return delimitedMathReplacements(blocks, options).map(({ start, end, nodes: replacement }) => ({
    from: nodes[start].position,
    to: nodes[end].position + nodes[end].node.nodeSize,
    replacement: replacement.map(node => state.schema.nodeFromJSON(node)),
  }))
}
function convertDelimitedMath(state, options) {
  const ranges = findMathRanges(state, options)
  if (!ranges.length) return null
  const transaction = state.tr
  for (const range of ranges.reverse()) transaction.replaceWith(range.from, range.to, range.replacement)
  return transaction
}

function changedDocumentRanges(transactions, doc) {
  const maps = transactions.flatMap(transaction => transaction.mapping.maps)
  const ranges = []
  maps.forEach((map, mapIndex) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      let from = newStart
      let to = newEnd
      for (let nextMap = mapIndex + 1; nextMap < maps.length; nextMap += 1) {
        from = maps[nextMap].map(from, -1)
        to = maps[nextMap].map(to, 1)
      }
      const limit = doc.content.size
      from = Math.max(0, Math.min(limit, from))
      to = Math.max(from, Math.min(limit, to))
      ranges.push({ from, to })
    })
  })
  return ranges
}

function changedTopLevelBlocks(transactions, doc) {
  if (!doc.childCount) return []
  const blocks = new Map()
  for (const { from, to } of changedDocumentRanges(transactions, doc)) {
    const startInfo = doc.content.findIndex(from)
    const endInfo = doc.content.findIndex(to)
    const startIndex = Math.max(0, startInfo.index - 1)
    const endIndex = Math.min(doc.childCount - 1, endInfo.index + 1)
    let position = startInfo.offset
    for (let index = startInfo.index - 1; index >= startIndex; index -= 1) {
      position -= doc.child(index).nodeSize
    }
    for (let index = startIndex; index <= endIndex; index += 1) {
      const node = doc.child(index)
      blocks.set(index, { index, from: position, node })
      position += node.nodeSize
    }
  }
  return [...blocks.values()]
}

function changedTextContainsFormulaDelimiter(transactions, doc) {
  return changedDocumentRanges(transactions, doc).some(({ from, to }) => {
    const contextFrom = Math.max(0, from - 1)
    const contextTo = Math.min(doc.content.size, to + 1)
    return /[$\\[\]()]/u.test(doc.textBetween(contextFrom, contextTo, '\n', ' '))
  })
}

const FormulaDelimiters = Extension.create({
  name: 'formulaDelimiters',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: { handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain')
        const {$from} = view.state.selection
        if (!text || $from.parent.type.spec.code || $from.parent.type.name === 'codeBlock' || $from.marks().some(mark => mark.type.spec.code)) return false
        const parsed = standaloneLatexPaste(text, normalizeFormulaInput)
        if (!parsed) return false
        const name = parsed.type === 'inline' ? 'inlineMath' : 'blockMath'
        const mathNode = view.state.schema.nodes[name]
        if (!mathNode) return false
        const transaction = view.state.tr.replaceSelectionWith(mathNode.create({ latex: parsed.latex }))
          .setMeta(UNTRUSTED_LATEX_PASTE_META, true)
          .scrollIntoView()
        if (!transaction.docChanged) return false
        event.preventDefault()
        view.dispatch(transaction)
        return true
      } },
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged)) return null
        if (!changedTextContainsFormulaDelimiter(transactions, newState.doc)) return null
        const pasted = transactions.some(isClipboardPasteTransaction)
        const conversion = convertDelimitedMath(newState, { bareFormulas: pasted })
        if (conversion && pasted) conversion.setMeta(UNTRUSTED_LATEX_PASTE_META, true)
        return conversion
      },
    })]
  },
})

const HeadingRecognition = Extension.create({
  name: 'headingRecognition',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged)) return null
        const activeIndex = newState.selection.$from.depth ? newState.selection.$from.index(0) : -1
        const replacements = []
        for (const { index, from, node } of changedTopLevelBlocks(transactions, newState.doc)) {
          if (index === activeIndex && node.type.name !== 'heading') continue
          const source = node.toJSON()
          const normalized = normalizeHeadingNode(source)
          if (normalized !== source) {
            const replacement = newState.schema.nodeFromJSON(normalized)
            replacements.push({
              from,
              to: from + node.nodeSize,
              node: replacement,
              updateAttributes: node.type.name === 'heading' && replacement.type === node.type,
            })
          }
        }
        if (!replacements.length) return null
        const transaction = newState.tr
        for (const replacement of replacements.reverse()) {
          if (replacement.updateAttributes) {
            transaction.setNodeMarkup(replacement.from, replacement.node.type, replacement.node.attrs, replacement.node.marks)
          } else {
            transaction.replaceWith(replacement.from, replacement.to, replacement.node)
          }
        }
        return transaction.docChanged ? transaction : null
      },
    })]
  },
})


function createTemplateId(prefix) {
  return `${prefix}${crypto.randomUUID()}`
}

function createLayoutStorage(storage) {
  return {
    getItem(key) {
      try {
        const value = storage.getItem(key)
        if (!value) return null
        const parsed = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const entries = Object.values(parsed)
        const flatLayout = entries.length > 0 && entries.every(Number.isFinite)
        const groupedLayouts = entries.length > 0 && entries.every(entry =>
          entry && typeof entry === 'object' && Array.isArray(entry.layout) && entry.layout.every(Number.isFinite),
        )
        return flatLayout || groupedLayouts ? value : null
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try { storage.setItem(key, value) } catch {
        // Browser persistence is best-effort; the desktop store remains the durable copy.
      }
    },
  }
}

function App({ initialWorkspace }) {
  const storeRef = useRef(null)
  if (!storeRef.current) storeRef.current = new LocalDocumentStore(window.localStorage)
  const store = storeRef.current
  const [dockPlacement, setDockPlacement] = useState(() => store.readText('noir-dock-placement', 'top') === 'bottom' ? 'bottom' : 'top')
  useEffect(() => {
    document.documentElement.dataset.dock = dockPlacement
    store.writeText('noir-dock-placement', dockPlacement)
  }, [dockPlacement, store])
  const restoredWorkspace = initialWorkspace?.version === 1 ? initialWorkspace : null
  const [workspace, setWorkspace] = useState(() => loadWorkspace(store, restoredWorkspace))
  const workspaceRef = useRef(workspace)
  const activeProject = workspace.projects.find(project => project.id === workspace.activeProjectId) || workspace.projects[0]
  const [summaryMode, setSummaryMode] = useState(false)
  const summaryModeRef = useRef(summaryMode)
  summaryModeRef.current = summaryMode
  const compilation = useMemo(() => summaryMode ? compileProject(activeProject) : null, [activeProject, summaryMode])
  const activeTask = summaryMode ? compilation : activeProject.tasks.find(task => task.id === activeProject.activeTaskId) || activeProject.tasks[0]
  const layoutStorageRef = useRef(null)
  if (!layoutStorageRef.current) layoutStorageRef.current = createLayoutStorage(store.storage)
  const compilerRef = useRef(null)
  if (!compilerRef.current) compilerRef.current = new LatexCompiler()
  const compiler = compilerRef.current
  const imageEncoderRef = useRef(null)
  if (!imageEncoderRef.current) imageEncoderRef.current = new ImageEncoder()
  const [title, setTitle] = useState(() => activeTask.title)
  const [saved, setSaved] = useState(true)
  const [mode, setMode] = useState(() => ['write', 'preview', 'split', 'source'].includes(restoredWorkspace?.mode) ? restoredWorkspace.mode : 'split')
  const [activeTab, setActiveTab] = useState(() => ['write', 'source', 'preview'].includes(restoredWorkspace?.activeTab) ? restoredWorkspace.activeTab : 'write')
  const [theme, setTheme] = useState(() => {
    const themeDefaultsUpdated = store.readText('latex-theme-default-migrated', '') === '1'
    if (!themeDefaultsUpdated) return 'dark'
    const savedTheme = store.readText('latex-theme', restoredWorkspace?.theme ?? 'dark')
    return savedTheme === 'light' ? 'light' : 'dark'
  })
  const [focusMode, setFocusMode] = useState(false)
  const [isCompact, setIsCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const navOpen = isCompact ? mobileNavOpen : !navCollapsed
  const closeNavigation = useCallback(() => setMobileNavOpen(false), [])
  const toggleNavigation = () => isCompact ? setMobileNavOpen(value => !value) : setNavCollapsed(value => !value)
  const [commandOpen, setCommandOpen] = useState(false)
  const [managerContext, setManagerContext] = useState(null)
  const [pendingHeading, setPendingHeading] = useState(null)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'editor-preview-layout', storage: layoutStorageRef.current })
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [mathScanOpen, setMathScanOpen] = useState(false)
  const [formulaInputMode, setFormulaInputMode] = useState('visual')
  const [mathliveReady, setMathliveReady] = useState(false)
  const mathFieldRef = useRef(null)
  const formulaPastedUntrustedRef = useRef(false)
  const pendingInsertionSelectionRef = useRef(null)
  const openReferencesDialogRef = useRef(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [newTemplateOpen, setNewTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateLatex, setTemplateLatex] = useState('')
  const [templateType, setTemplateType] = useState('block')
  const [formula, setFormula] = useState('X_t^{selected} = S_t^{(n)} ∪ E_t^{(k)}')
  const [katexRenderer, setKatexRenderer] = useState(null)
  const [formulaType, setFormulaType] = useState('inline')
  const [latexOpen, setLatexOpen] = useState(() => Boolean(restoredWorkspace?.latexOpen))
  const [sourceDraft, setSourceDraft] = useState(() => activeTask.sourceDraft)
  const [sourceEdited, setSourceEdited] = useState(() => activeTask.sourceEdited)
  const [sourceDraftBackup, setSourceDraftBackup] = useState(() => activeTask.sourceDraftBackup)
  const [sourceSyncStatus, setSourceSyncStatus] = useState({ kind: 'idle', text: '' })
  const sourceEditedRef = useRef(sourceEdited)
  sourceEditedRef.current = sourceEdited
  const sourceDraftRef = useRef(sourceDraft)
  sourceDraftRef.current = sourceDraft
  const sourceSyncRequestRef = useRef(0)
  const lastSourceSyncRef = useRef({ taskId: '', sourceDraft: '', status: null })
  const [sourceTrusted, setSourceTrusted] = useState(() => activeTask.sourceTrusted !== false)
  const [settings, setSettings] = useState(() => sanitizeSettings(activeTask.settings))
  const [assets, setAssets] = useState(() => activeTask.assets || [])
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const [managerOpen, setManagerOpen] = useState(false)
  const [referencesDialog, setReferencesDialog] = useState(null)
  const [workspaceNotice, setWorkspaceNotice] = useState(initialWorkspace?.recoveryMessage || '')
  const [syncStatus, setSyncStatus] = useState(null)
  const syncBusyRef = useRef(null)
  const syncCanApplyRef = useRef(true)
  const syncActionRef = useRef(null)
  const [compileLog, setCompileLog] = useState('')
  const [compileErrorLine, setCompileErrorLine] = useState(null)
  const [editingFormulaPosition, setEditingFormulaPosition] = useState(null)
  const [documentTemplates, setDocumentTemplates] = useState(() => sanitizeDocumentTemplates(restoredWorkspace?.documentTemplates ?? store.readJson('latex-document-templates', [])))
  const [activeDocumentTemplateId, setActiveDocumentTemplateId] = useState(() => activeTask.activeDocumentTemplateId)
  const activeDocumentTemplateIdRef = useRef(activeDocumentTemplateId)
  activeDocumentTemplateIdRef.current = activeDocumentTemplateId
  const [documentTemplatesOpen, setDocumentTemplatesOpen] = useState(false)
  const [addingDocumentTemplate, setAddingDocumentTemplate] = useState(false)
  const [documentTemplateName, setDocumentTemplateName] = useState('')
  const [documentTemplateSource, setDocumentTemplateSource] = useState('')
  const [imageError, setImageError] = useState('')
  const [imageFocusVersion, setImageFocusVersion] = useState(0)
  const [imageSourceWarning, setImageSourceWarning] = useState('')
  const [workspaceDialogType, setWorkspaceDialogType] = useState(null)
  const [workspaceFrame, setWorkspaceFrame] = useState(() => ({ templateId: '', documentTitle: '', settings: sanitizeSettings({ abstractEnabled: true }) }))
  const [workspaceItemName, setWorkspaceItemName] = useState('')
  const uploadInputRef = useRef(null)
  const imageInsertPositionRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [pdfUrl, setPdfUrl] = useState('')
  const pdfBlobRef = useRef(null)
  const pdfSchedulerRef = useRef(null)
  const [pdfStale, setPdfStale] = useState(false)
  const [editorPageCount, setEditorPageCount] = useState(1)
  const [pdfMode, setPdfMode] = useState(() => {
    const value = store.readText('latex-pdf-batch-mode', '2')
    return ['manual', '1', '2'].includes(value) ? value : '2'
  })
  const [compileState, setCompileState] = useState('waiting')
  const [compileError, setCompileError] = useState('')
  const [compileRetry, setCompileRetry] = useState(0)
  const consumedRetryRef = useRef(0)
  const [customTemplates, setCustomTemplates] = useState(() => sanitizeFormulaTemplates(restoredWorkspace?.customTemplates ?? store.readJson('latex-custom-templates', [])))
  const [docData, setDocData] = useState(() => {
    const storedDocument = activeTask.document
    return normalizeDocumentHeadings(normalizeDocumentDelimiters(isValidDocument(storedDocument) ? storedDocument : starter))
  })
  const docSnapshotTimerRef = useRef(0)
  const docSnapshotVersionRef = useRef(0)
  const editor = useEditor({
    extensions: [
      Extension.create({
        name: 'compilationReadOnly',
        addProseMirrorPlugins() {
          return [new Plugin({ filterTransaction: transaction => !summaryModeRef.current || !transaction.docChanged || transaction.getMeta('compilationLoad') === true })]
        },
      }),
      StarterKit.configure({ heading: false }),
      ThreeLevelHeading,
      Placeholder.configure({ placeholder: 'Bắt đầu viết nội dung của bạn…' }),
      Mathematics.configure({
        blockOptions: { katexOptions: { throwOnError: false }, onClick: (node, pos) => { if (summaryModeRef.current) return; pendingInsertionSelectionRef.current = null; formulaPastedUntrustedRef.current = false; setFormula(node.attrs.latex); setFormulaType('block'); setEditingFormulaPosition(pos); setFormulaOpen(true) } },
        inlineOptions: { katexOptions: { throwOnError: false }, onClick: (node, pos) => { if (summaryModeRef.current) return; pendingInsertionSelectionRef.current = null; formulaPastedUntrustedRef.current = false; setFormula(node.attrs.latex); setFormulaType('inline'); setEditingFormulaPosition(pos); setFormulaOpen(true) } },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
      ...richTextExtensions,
      AcademicAttributes, Citation, CrossReference, Footnote,
      AcademicTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ImageBlock,
      FormulaDelimiters,
      HeadingRecognition,
    ],
    content: docData,
    editorProps: {
      attributes: { spellcheck: 'false' },
    },
    onCreate: ({ editor: createdEditor }) => {
      // A source-backed task must finish importing its LaTeX before the draft
      // editor runs any normalization that could be mistaken for a user edit.
      if (sourceEditedRef.current) return
      const transaction = convertDelimitedMath(createdEditor.state)
      if (transaction) createdEditor.view.dispatch(transaction)
    },
    onUpdate: ({ editor: updatedEditor, transaction, appendedTransactions }) => {
      if (summaryModeRef.current) return
      const version = ++docSnapshotVersionRef.current
      window.clearTimeout(docSnapshotTimerRef.current)
      docSnapshotTimerRef.current = window.setTimeout(() => {
        if (version !== docSnapshotVersionRef.current) return
        docSnapshotTimerRef.current = 0
        setDocData(updatedEditor.getJSON())
      }, 120)
      const wasSourceEdited = sourceEditedRef.current
      if (wasSourceEdited) {
        // Keep rich-text edits and the PDF in sync. The custom source remains
        // in sourceDraft so it can be restored if the user needs it again.
        sourceSyncRequestRef.current += 1
        sourceEditedRef.current = false
        setSourceDraftBackup(Boolean(sourceDraftRef.current.trim()))
        setSourceEdited(false)
        setSourceSyncStatus({ kind: 'idle', text: '' })
      }
      if (containsUntrustedLatex(transaction, appendedTransactions)) {
        setSourceTrusted(false)
      } else if (wasSourceEdited && !assetsRef.current.length && (!activeDocumentTemplateIdRef.current || builtInDocumentTemplates.some(template => template.id === activeDocumentTemplateIdRef.current))) {
        setSourceTrusted(true)
      }
      setSaved(false)
    },
  })
  useEffect(() => { editor?.setEditable(!summaryMode) }, [editor, summaryMode])
  const editorTaskIdRef = useRef(activeTask.id)
  const rememberEditorSelection = () => {
    const state = editor?.state
    if (!state) return null
    const selection = { from: state.selection.from, to: state.selection.to, doc: state.doc, taskId: activeTask.id }
    pendingInsertionSelectionRef.current = selection
    return selection
  }
  const openReferencesDialog = (tab = 'cite', editing = null) => {
    if (summaryModeRef.current) return
    const insertionSelection = editing ? null : rememberEditorSelection()
    if (editing) pendingInsertionSelectionRef.current = null
    setReferencesDialog({ tab, editing, insertionSelection })
  }
  openReferencesDialogRef.current = openReferencesDialog
  const closeReferencesDialog = () => {
    pendingInsertionSelectionRef.current = null
    setReferencesDialog(null)
  }
  useEffect(() => {
    if (!editor || editorTaskIdRef.current === activeTask.id) return
    sourceSyncRequestRef.current += 1
    docSnapshotVersionRef.current += 1
    window.clearTimeout(docSnapshotTimerRef.current)
    docSnapshotTimerRef.current = 0
    editor.chain().setMeta('compilationLoad', true).setContent(activeTask.document, { emitUpdate: false }).run()
    editorTaskIdRef.current = activeTask.id
  // The task ID guard prevents replacing the live editor when its persisted document snapshot changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeTask.id])
  useEffect(() => () => {
    docSnapshotVersionRef.current += 1
    window.clearTimeout(docSnapshotTimerRef.current)
  }, [])
  const activeDocumentTemplate = builtInDocumentTemplates.find(item => item.id === activeDocumentTemplateId)
    || documentTemplates.find(item => item.id === activeDocumentTemplateId)
  const deferredDocData = useDeferredValue(docData)
  const deferredTitle = useDeferredValue(title)
  const serialization = useMemo(() => toLatex(deferredDocData, deferredTitle, activeDocumentTemplate?.source, settings), [deferredDocData, deferredTitle, activeDocumentTemplate?.source, settings])
  const citationStyle = resolveCitationStyle(settings.citationStyle, activeDocumentTemplate?.source)
  const compileAssets = useMemo(() => settings.bibliography.trim()
    ? [...assets.filter(asset => asset.filename.toLowerCase() !== 'references.bib'), { filename: 'references.bib', data: bytesToBase64(new TextEncoder().encode(bibtexForCompile(settings.bibliography, citationStyle))) }]
    : assets, [assets, settings.bibliography, citationStyle])
  // Citation labels in the editor follow the reference list and style; refresh them when either changes.
  const citationEntries = useMemo(() => parseBibtex(settings.bibliography), [settings.bibliography])
  useEffect(() => {
    const storage = editor?.storage.citation
    if (!storage || editor.isDestroyed) return
    storage.entries = citationEntries
    storage.style = citationStyle
    storage.onOpen = target => openReferencesDialogRef.current?.('cite', target?.keys ? target : null)
    editor.view.dispatch(editor.state.tr.setMeta(CITATION_REFRESH, true).setMeta('addToHistory', false))
  }, [editor, citationEntries, citationStyle])
  const compileAssetError = useMemo(() => summaryMode && compilation.errors.length ? compilation.errors.join(' ') : assetBudgetError(compileAssets), [compileAssets, summaryMode, compilation])
  const latex = serialization.latex
  const effectiveLatex = sourceEdited ? sourceDraft : latex
  const sourceDraftBackupAvailable = !sourceEdited && sourceDraftBackup
  useEffect(() => {
    const requestId = ++sourceSyncRequestRef.current
    const taskId = activeTask.id
    if (!sourceEdited || !sourceDraft.trim() || !editor || editor.isDestroyed) {
      setSourceSyncStatus({ kind: 'idle', text: '' })
      return undefined
    }
    if (lastSourceSyncRef.current.taskId === taskId && lastSourceSyncRef.current.sourceDraft === sourceDraft) {
      setSourceSyncStatus(current => current.kind === 'pending'
        ? lastSourceSyncRef.current.status || { kind: 'ready', text: 'Bản thảo đã được cập nhật từ LaTeX.' }
        : current)
      return undefined
    }

    setSourceSyncStatus({ kind: 'pending', text: 'Đang cập nhật bản thảo…' })
    const timer = window.setTimeout(async () => {
      try {
        const result = await readLatexSource(sourceDraft, serialization.images, assets)
        if (requestId !== sourceSyncRequestRef.current || !sourceEditedRef.current || editor.isDestroyed) return
        if (!isValidDocument(result.document)) throw new Error('Nội dung LaTeX chưa thể chuyển thành bản thảo.')
        docSnapshotVersionRef.current += 1
        window.clearTimeout(docSnapshotTimerRef.current)
        docSnapshotTimerRef.current = 0
        editor.commands.setContent(result.document, { emitUpdate: false })
        setDocData(result.document)
        if (result.title) setTitle(result.title)
        setSettings(current => {
          const metadata = result.metadata
          const next = {
            ...current,
            author: metadata.author,
            date: metadata.date,
            abstractEnabled: metadata.abstractEnabled,
            abstract: metadata.abstract,
            ...(metadata.abstractTitle ? { abstractTitle: metadata.abstractTitle } : {}),
          }
          return Object.keys(next).every(key => next[key] === current[key]) ? current : next
        })
        const details = result.warnings.slice(0, 3).join('; ')
        const syncStatus = {
          kind: result.warnings.length ? 'warning' : 'ready',
          text: result.warnings.length ? `Đã cập nhật bản thảo; một số phần được giản lược: ${details}` : 'Bản thảo đã được cập nhật từ LaTeX.',
        }
        lastSourceSyncRef.current = { taskId, sourceDraft, status: syncStatus }
        setSourceSyncStatus(syncStatus)
      } catch (error) {
        if (requestId !== sourceSyncRequestRef.current || !sourceEditedRef.current || editor.isDestroyed) return
        const detail = String(error?.message || 'Không thể đọc source LaTeX.').replace(/\s+/gu, ' ').slice(0, 180)
        setSourceSyncStatus({ kind: 'error', text: `Chưa cập nhật bản thảo: ${detail}` })
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [activeTask.id, editor, sourceEdited, sourceDraft, serialization.images, assets])
  useEffect(() => {
    if (!sourceEdited) {
      setImageSourceWarning('')
      return
    }
    const result = reconcileEditorImagesIntoLatexSource(sourceDraft, serialization.images, serialization.imageAnchors)
    setImageSourceWarning(result.unplacedImages.length
      ? `Không thể xác định vị trí của ${result.unplacedImages.join(', ')} trong Source riêng vì không tìm thấy đoạn văn bản quanh ảnh. Ảnh vẫn ở bản thảo nhưng chưa được đưa vào PDF. Hãy khôi phục source tự sinh hoặc thêm \\includegraphics tại vị trí mong muốn.`
      : '')
    if (result.source !== sourceDraft) setSourceDraft(result.source)
  }, [sourceEdited, sourceDraft, serialization.images, serialization.imageAnchors])
  const normalizedFormula = normalizeFormulaInput
  const outline = useMemo(
    () => (normalizeDocumentHeadings(deferredDocData).content || [])
      .filter(node => node.type === 'heading')
      .map((node, index) => ({
        label: textIn(node) || `Tiêu đề ${index + 1}`,
        level: node.attrs?.level || 1,
      })),
    [deferredDocData],
  )
  const wordCount = useMemo(() => {
    const text = textIn(deferredDocData).trim()
    return text ? text.split(/\s+/).length : 0
  }, [deferredDocData])
  const formulaCount = useMemo(() => {
    let count = 0
    const visit = node => {
      if (node?.type === 'inlineMath' || node?.type === 'blockMath') count += 1
      for (const child of node?.content || []) visit(child)
    }
    visit(deferredDocData)
    return count
  }, [deferredDocData])
  const imageSummary = useMemo(() => imageStats(deferredDocData), [deferredDocData])
  const writeWorkspace = useCallback(next => {
    workspaceRef.current = next
    setWorkspace(next)
    setSaved(false)
    return true
  }, [])
  const saveCurrentTaskSnapshot = useCallback(() => {
    if (summaryModeRef.current) return true
    const current = workspaceRef.current
    const project = current.projects.find(item => item.id === activeProject.id)
    const task = project?.tasks.find(item => item.id === activeTask.id)
    if (!project || !task) return false
    const next = updateWorkspaceTask(current, project.id, task.id, {
      title,
      document: editor && editorTaskIdRef.current === task.id ? editor.getJSON() : docData,
      sourceDraft,
      sourceEdited,
      sourceDraftBackup,
      activeDocumentTemplateId,
      settings, assets, sourceTrusted,
      updatedAt: Date.now(),
    })
    return writeWorkspace(next)
  }, [title, docData, sourceDraft, sourceEdited, sourceDraftBackup, activeDocumentTemplateId, activeProject.id, activeTask.id, settings, assets, sourceTrusted, editor, writeWorkspace])
  const loadTaskIntoEditor = task => {
    sourceSyncRequestRef.current += 1
    docSnapshotVersionRef.current += 1
    window.clearTimeout(docSnapshotTimerRef.current)
    docSnapshotTimerRef.current = 0
    setTitle(task.title)
    setDocData(normalizeDocumentHeadings(normalizeDocumentDelimiters(isValidDocument(task.document) ? task.document : starter)))
    setSourceDraft(task.sourceDraft)
    sourceDraftRef.current = task.sourceDraft
    setSourceSyncStatus({ kind: 'idle', text: '' })
    setSourceDraftBackup(task.sourceDraftBackup)
    sourceEditedRef.current = task.sourceEdited
    setSourceEdited(task.sourceEdited)
    setActiveDocumentTemplateId(task.activeDocumentTemplateId)
    setSettings(sanitizeSettings(task.settings))
    setAssets(task.assets || [])
    setSourceTrusted(task.sourceTrusted !== false)
    setSaved(true)
    setImageError('')
    setPdfUrl('')
    setCompileError('')
    setCompileLog('')
    setCompileErrorLine(null)
    setCompileState('waiting')
  }
  const switchToTask = (projectId, taskId) => {
    saveCurrentTaskSnapshot()
    summaryModeRef.current = false
    setSummaryMode(false)
    const current = workspaceRef.current
    const project = current.projects.find(item => item.id === projectId)
    const task = project?.tasks.find(item => item.id === taskId)
    if (!project || !task) return
    const next = {
      ...current,
      activeProjectId: project.id,
      projects: current.projects.map(item => item.id === project.id ? { ...item, activeTaskId: task.id } : item),
    }
    writeWorkspace(next)
    loadTaskIntoEditor(task)
  }
  const createWorkspaceItem = () => {
    const name = workspaceItemName.trim()
    if (!name || !workspaceDialogType) return
    saveCurrentTaskSnapshot()
    const current = workspaceRef.current
    let next
    const selectedTemplate = [...builtInDocumentTemplates, ...documentTemplates].find(item => item.id === workspaceFrame.templateId)
    const task = createTask(workspaceDialogType === 'project' ? workspaceFrame.documentTitle.trim() || name : name, structuredClone(selectedTemplate?.starterDocument || (workspaceDialogType === 'task' ? { type: 'doc', content: [{ type: 'paragraph' }] } : starter)))
    task.settings = sanitizeSettings(workspaceFrame.settings)
    task.activeDocumentTemplateId = selectedTemplate?.id || ''
    task.sourceTrusted = !selectedTemplate?.untrusted
    if (workspaceDialogType === 'project') {
      const project = createProject(name, task)
      next = { ...current, projects: [...current.projects, project], activeProjectId: project.id }
    } else {
      const project = current.projects.find(item => item.id === current.activeProjectId)
      if (!project) return
      next = {
        ...current,
        projects: current.projects.map(item => item.id === project.id ? {
          ...item,
          tasks: [...item.tasks, task],
          activeTaskId: task.id,
        } : item),
      }
    }
    summaryModeRef.current = false
    setSummaryMode(false)
    writeWorkspace(next)
    loadTaskIntoEditor(task)
    setWorkspaceDialogType(null)
    setActiveTab('write')
    if (mode === 'source' || mode === 'preview') setMode('write')
    setWorkspaceItemName('')
  }
  useEffect(() => {
    const timer = window.setTimeout(() => saveCurrentTaskSnapshot(), 220)
    return () => window.clearTimeout(timer)
  }, [saveCurrentTaskSnapshot])
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f3f4f9')
    store.writeText('latex-theme', theme)
    store.writeText('latex-theme-default-migrated', '1')
  }, [theme, store])
  const latestWorkspaceRef = useRef(null)
  latestWorkspaceRef.current = {
    version: 1,
    projects: workspace.projects,
    activeProjectId: workspace.activeProjectId,
    activeTaskId: activeTask.id,
    title,
    document: docData,
    sourceDraft,
    sourceEdited,
    sourceDraftBackup,
    theme,
    customTemplates,
    documentTemplates,
    activeDocumentTemplateId,
    mode,
    activeTab,
    latexOpen,
    settings, assets, sourceTrusted,
  }
  const workspaceRevisionRef = useRef(0)
  const workspaceDirtyRef = useRef(false)
  const workspaceWriteQueueRef = useRef(Promise.resolve())
  const persistWorkspaceRef = useRef(null)
  persistWorkspaceRef.current = force => {
    const save = async () => {
      if (!force && !workspaceDirtyRef.current) return true
      const revision = workspaceRevisionRef.current
      const latest = latestWorkspaceRef.current
      const current = workspaceRef.current
      const project = current.projects.find(item => item.id === latest.activeProjectId)
      const task = project?.tasks.find(item => item.id === latest.activeTaskId)
      const snapshot = project && task ? updateWorkspaceTask(current, project.id, task.id, {
        title: latest.title,
        document: editor && editorTaskIdRef.current === task.id ? editor.getJSON() : latest.document,
        sourceDraft: latest.sourceDraft,
        sourceEdited: latest.sourceEdited,
        sourceDraftBackup: latest.sourceDraftBackup,
        activeDocumentTemplateId: latest.activeDocumentTemplateId,
        settings: latest.settings, assets: latest.assets, sourceTrusted: latest.sourceTrusted,
        updatedAt: Date.now(),
      }) : current
      workspaceRef.current = snapshot
      const workspace = {
        ...latestWorkspaceRef.current,
        projects: snapshot.projects,
        activeProjectId: snapshot.activeProjectId,
        savedAt: new Date().toISOString(),
      }
      let nativeSaved = false
      if (window.desktopAPI?.saveWorkspace) {
        try { nativeSaved = (await window.desktopAPI.saveWorkspace(workspace))?.saved === true }
        catch (error) { console.error('Không thể ghi bản sao tiến trình cục bộ:', error) }
      }
      const localSaved = [
        nativeSaved || writeWorkspaceData(store, { projects: workspace.projects, activeProjectId: workspace.activeProjectId, savedAt: workspace.savedAt }),
        store.writeText('latex-theme', workspace.theme),
        store.writeJson('latex-custom-templates', workspace.customTemplates),
        store.writeJson('latex-document-templates', workspace.documentTemplates),
      ].every(Boolean)
      const persisted = window.desktopAPI?.saveWorkspace ? nativeSaved : localSaved
      if (revision === workspaceRevisionRef.current) {
        workspaceDirtyRef.current = !persisted
        setSaved(persisted)
        if (!persisted) setImageError('Không thể lưu tiến trình trên máy. Hãy kiểm tra dung lượng ổ đĩa rồi thử lại.')
      }
      return persisted
    }
    const pending = workspaceWriteQueueRef.current.catch(() => false).then(save)
    workspaceWriteQueueRef.current = pending
    return pending
  }
  useEffect(() => {
    workspaceRevisionRef.current += 1
    workspaceDirtyRef.current = true
    setSaved(false)
    const timer = window.setTimeout(() => { void persistWorkspaceRef.current?.(false) }, 300)
    return () => window.clearTimeout(timer)
  }, [title, docData, sourceDraft, sourceEdited, sourceDraftBackup, theme, customTemplates, documentTemplates, activeDocumentTemplateId, mode, activeTab, latexOpen, workspace, settings, assets, sourceTrusted])
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (workspaceDirtyRef.current) void persistWorkspaceRef.current?.(false)
    }, 1500)
    const flush = () => { void persistWorkspaceRef.current?.(true) }
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    const unregisterClose = window.desktopAPI?.onFlushBeforeClose(async () => {
      try {
        const saved = await persistWorkspaceRef.current?.(true)
        window.desktopAPI.completeClose(saved === true)
      } catch (error) {
        console.error('Không thể hoàn tất lần lưu trước khi đóng:', error)
        window.desktopAPI.completeClose(false)
      }
    })
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility)
      unregisterClose?.()
    }
  }, [])
  useEffect(() => { const media = window.matchMedia('(max-width: 900px)'); const onChange = event => setIsCompact(event.matches); media.addEventListener('change', onChange); return () => media.removeEventListener('change', onChange) }, [])
  useEffect(() => {
    const keyboard = event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey) return
      if (document.querySelector('.modal-backdrop [role="dialog"]')) return
      event.preventDefault()
      event.stopPropagation()
      setCommandOpen(value => !value)
    }
    window.addEventListener('keydown', keyboard, true)
    return () => window.removeEventListener('keydown', keyboard, true)
  }, [])
  useEffect(() => {
    if (!formulaOpen && !mathScanOpen && !libraryOpen && !documentTemplatesOpen && !workspaceDialogType && !managerOpen && !referencesDialog) return
    const dialog = document.querySelector('.modal-backdrop [role="dialog"]')
    if (!dialog) return
    const previouslyFocused = document.activeElement
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), math-field, [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length && !node.closest('[hidden], [inert]'))
    const initialTarget = focusable().find(node => node.matches('input, select, textarea, math-field')) || focusable()[0]
    initialTarget?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') { pendingInsertionSelectionRef.current = null; setFormulaOpen(false); setMathScanOpen(false); setLibraryOpen(false); setDocumentTemplatesOpen(false); setWorkspaceDialogType(null); setManagerOpen(false); setManagerContext(null); setReferencesDialog(null); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus?.() }
  }, [formulaOpen, mathScanOpen, libraryOpen, documentTemplatesOpen, workspaceDialogType, managerOpen, referencesDialog])
  useEffect(() => {
    if (!formulaOpen || mathliveReady) return
    import('mathlive')
      .then(({ MathfieldElement }) => {
        MathfieldElement.fontsDirectory = new URL('./mathlive/fonts/', document.baseURI).href
        MathfieldElement.soundsDirectory = null
        setMathliveReady(true)
      })
      .catch(error => {
        console.error('Không thể tải MathLive:', error)
        setFormulaInputMode('latex')
      })
  }, [formulaOpen, mathliveReady])
  useEffect(() => {
    if (!formulaOpen || !mathliveReady || formulaInputMode !== 'visual' || !mathFieldRef.current) return
    const field = mathFieldRef.current
    const normalized = normalizeFormulaInput(formula)
    if (field.value !== normalized) field.value = normalized
    field.smartMode = true
    field.mathModeSpace = '\\;'
    const onInput = () => setFormula(field.value)
    const onPaste = event => {
      formulaPastedUntrustedRef.current = true
      const clipboard = event.clipboardData
      const text = clipboard?.getData('text/plain')
      if (!text?.trim()) return
      const html = clipboard.getData('text/html') || ''
      const formats = Array.from(clipboard.types || []).join(' ')
      if (/mathml|latex|asciimath/i.test(formats) || /<(?:math\b|span\b[^>]*(?:mathjax|katex))/i.test(html)) return
      event.preventDefault()
      event.stopPropagation()
      const value = normalizeFormulaInput(text)
      if (!field.insert(value, { format: 'latex', selectionMode: 'after' })) setFormula(value)
    }
    field.addEventListener('input', onInput)
    field.addEventListener('paste', onPaste, true)
    return () => { field.removeEventListener('input', onInput); field.removeEventListener('paste', onPaste, true) }
  }, [formulaOpen, formulaInputMode, mathliveReady, formula])
  useEffect(() => {
    if (!(formulaOpen || libraryOpen) || katexRenderer) return
    import('katex')
      .then(module => setKatexRenderer(() => module.default))
      .catch(error => console.error('Không thể tải KaTeX:', error))
  }, [formulaOpen, libraryOpen, katexRenderer])
  const captureCompileInput = useCallback(() => {
    // Manual update/export reads the editor itself, not its deferred 120 ms snapshot.
    const live = toLatex(editor?.getJSON() || docData, title, activeDocumentTemplate?.source, settings)
    const source = sourceEditedRef.current
      ? reconcileEditorImagesIntoLatexSource(sourceDraftRef.current, live.images, live.imageAnchors).source
      : live.latex
    return {
      id: activeTask.id, source, images: live.images, assets: compileAssets,
      pageCount: sourceEdited ? estimateSourcePages(source) : editorPageCount,
      blocked: !sourceTrusted ? 'Source nhập từ ngoài đang chờ bạn xác nhận tin cậy.'
        : compileAssetError ? `Không thể biên dịch với cấu hình tài nguyên hiện tại. ${compileAssetError}` : '',
    }
  }, [editor, docData, title, activeDocumentTemplate?.source, settings, activeTask.id, compileAssets, sourceTrusted, sourceEdited, compileAssetError, editorPageCount])
  const latestCompileCaptureRef = useRef(captureCompileInput)
  useLayoutEffect(() => { latestCompileCaptureRef.current = captureCompileInput }, [captureCompileInput])
  useEffect(() => {
    const scheduler = new PdfCompileScheduler({
      compile: (...args) => compiler.compile(...args),
      onState: state => {
        setCompileState(state.status)
        setCompileError(state.error)
        setCompileLog(state.log)
        setCompileErrorLine(state.line)
        setPdfStale(state.stale)
        if (pdfBlobRef.current !== state.blob) {
          pdfBlobRef.current = state.blob
          setPdfUrl(state.blob ? URL.createObjectURL(state.blob) : '')
        }
      },
    })
    pdfSchedulerRef.current = scheduler
    return () => { scheduler.dispose(); pdfSchedulerRef.current = null }
  }, [compiler])
  useEffect(() => {
    pdfSchedulerRef.current?.setMode(pdfMode)
    store.writeText('latex-pdf-batch-mode', pdfMode)
  }, [pdfMode, store])
  useEffect(() => {
    pdfSchedulerRef.current?.update(captureCompileInput())
  }, [captureCompileInput, effectiveLatex, sourceEdited])
  useEffect(() => {
    if (consumedRetryRef.current === compileRetry) return
    consumedRetryRef.current = compileRetry
    void pdfSchedulerRef.current?.request(captureCompileInput(), { fresh: true }).catch(() => {})
  }, [compileRetry, captureCompileInput])
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  useEffect(() => {
    if (activeDocumentTemplateId && ![...builtInDocumentTemplates, ...documentTemplates].some(item => item.id === activeDocumentTemplateId)) setActiveDocumentTemplateId('')
  }, [activeDocumentTemplateId, documentTemplates])
  const insertMath = (value, type, untrusted = false, untrustedMeta = UNTRUSTED_LATEX_TEMPLATE_META) => {
    if (!editor || !value.trim()) return
    const latexValue = normalizeFormulaInput(value)
    const saved = pendingInsertionSelectionRef.current
    const useSaved = saved?.taskId === activeTask.id && saved.doc === editor.state.doc
    const selection = useSaved ? saved : editor.state.selection
    const { from, to } = selection
    const chain = editor.chain()
    if (type === 'block') {
      const mathNode = editor.schema.nodes.blockMath.create({ latex: latexValue })
      chain.command(({ tr }) => {
        tr.replaceRangeWith(from, to, mathNode)
        return true
      })
    } else {
      chain.insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex: latexValue } })
    }
    if (untrusted) chain.setMeta(untrustedMeta, true)
    chain.run()
    pendingInsertionSelectionRef.current = null
    editor.commands.focus()
  }
  const insertFormula = () => {
    if (!editor || !formula.trim()) return
    if (editingFormulaPosition !== null) {
      const transaction = updateMathNode(editor.state, editingFormulaPosition, normalizeFormulaInput(formula), formulaType)
      if (transaction) {
        if (formulaPastedUntrustedRef.current) transaction.setMeta(UNTRUSTED_LATEX_INSERT_META, true)
        editor.view.dispatch(transaction.scrollIntoView())
      }
      formulaPastedUntrustedRef.current = false
      setEditingFormulaPosition(null); closeFormula(); return
    }
    insertMath(formula, formulaType, formulaPastedUntrustedRef.current, UNTRUSTED_LATEX_INSERT_META)
    formulaPastedUntrustedRef.current = false
    closeFormula()
  }
  const saveTemplate = () => {
    if (!templateName.trim() || !templateLatex.trim()) return
    if (templateName.trim().length > 120 || templateLatex.length > 12_000) { setImageError('Tên mẫu tối đa 120 ký tự; công thức tối đa 12.000 ký tự.'); return }
    const item = { id: createTemplateId('custom-'), name: templateName.trim(), latex: normalizeFormulaInput(templateLatex), type: templateType }
    const next = [...customTemplates, item]
    if (!store.writeJson('latex-custom-templates', next)) {
      setImageError('Không đủ dung lượng lưu mẫu công thức. Hãy xóa bớt mẫu hoặc ảnh rồi thử lại.')
      return
    }
    setCustomTemplates(next)
    setTemplateName(''); setTemplateLatex(''); setNewTemplateOpen(false)
  }
  const removeTemplate = (id) => {
    const next = customTemplates.filter(item => item.id !== id)
    if (!store.writeJson('latex-custom-templates', next)) {
      setImageError('Không thể cập nhật mẫu công thức trên máy.')
      return
    }
    setCustomTemplates(next)
  }
  const applyDocumentTemplate = id => {
    const selectedBuiltIn = builtInDocumentTemplates.find(item => item.id === id)
    if (selectedBuiltIn?.starterDocument) {
      const currentDocument = editor?.getJSON() || docData
      const previousTemplate = builtInDocumentTemplates.find(item => item.id === activeDocumentTemplateIdRef.current)
      const currentNodes = Array.isArray(currentDocument?.content) ? currentDocument.content : []
      const blankParagraph = node => node?.type === 'paragraph'
        && !(node.content || []).some(child => child.type !== 'text' || String(child.text || '').trim())
      const sameOutlineNode = (actual, expected) => {
        if (actual?.type !== expected?.type) return false
        if (expected.type === 'heading') return Number(actual.attrs?.level) === Number(expected.attrs?.level) && textIn(actual).trim() === textIn(expected).trim()
        return expected.type === 'paragraph' && blankParagraph(actual)
      }
      let contentToKeep = currentNodes
      const previousOutline = previousTemplate?.starterDocument?.content || []
      if (previousOutline.length && currentNodes.length >= previousOutline.length
        && previousOutline.every((node, index) => sameOutlineNode(currentNodes[index], node))) {
        let firstKeptNode = previousOutline.length
        const stagingHeading = currentNodes[firstKeptNode]
        if (stagingHeading?.type === 'heading' && Number(stagingHeading.attrs?.level) === 1
          && textIn(stagingHeading).trim() === 'Nội dung hiện có (chưa sắp xếp)') firstKeptNode++
        contentToKeep = currentNodes.slice(firstKeptNode)
      }
      const hasExistingContent = contentToKeep.some(node => node.type !== 'paragraph' || !blankParagraph(node))
      const nextDocument = {
        type: 'doc',
        content: [
          ...selectedBuiltIn.starterDocument.content,
          ...(hasExistingContent ? [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Nội dung hiện có (chưa sắp xếp)' }] },
            ...contentToKeep,
          ] : []),
        ],
      }
      docSnapshotVersionRef.current += 1
      window.clearTimeout(docSnapshotTimerRef.current)
      docSnapshotTimerRef.current = 0
      editor?.commands.setContent(nextDocument, { emitUpdate: false })
      setDocData(nextDocument)
    }
    setActiveDocumentTemplateId(id)
    if (sourceEdited && sourceDraft.trim()) setSourceDraftBackup(true)
    sourceEditedRef.current = false
    setSourceEdited(false)
    const builtIn = !id || builtInDocumentTemplates.some(item => item.id === id)
    const custom = documentTemplates.find(item => item.id === id)
    setSourceTrusted(current => {
      if (custom?.untrusted) return false
      if (assets.length || (!builtIn && !custom)) return current
      return true
    })
    store.remove('latex-source-mode')
    setDocumentTemplatesOpen(false)
  }
  const saveDocumentTemplate = () => {
    const source = documentTemplateSource.trim()
    if (!documentTemplateName.trim() || !source.includes('{{content}}')) return
    if (documentTemplateName.trim().length > 120 || new TextEncoder().encode(source).length > 800 * 1024) { setImageError('Tên mẫu tối đa 120 ký tự; source tối đa 800 KB.'); return }
    const item = { id: createTemplateId('layout-'), name: documentTemplateName.trim(), source }
    const next = [...documentTemplates, item]
    try {
      if (!store.writeJson('latex-document-templates', next)) throw new Error('Không thể lưu mẫu LaTeX.')
      setDocumentTemplates(next)
      applyDocumentTemplate(item.id)
      setDocumentTemplateName(''); setDocumentTemplateSource(''); setAddingDocumentTemplate(false)
    } catch {
      setImageError('Không đủ dung lượng lưu mẫu LaTeX. Hãy xóa bớt mẫu hoặc ảnh rồi thử lại.')
    }
  }
  const removeDocumentTemplate = id => {
    const next = documentTemplates.filter(item => item.id !== id)
    setDocumentTemplates(next)
    if (activeDocumentTemplateId === id) setActiveDocumentTemplateId('')
  }
  const insertImageFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editor) return
    setImageError('')
    if (!file.type.startsWith('image/')) { setImageError('Hãy chọn một tệp hình ảnh.'); return }
    if (file.size > 15 * 1024 * 1024) { setImageError('Ảnh gốc vượt quá 15 MB. Hãy chọn ảnh nhỏ hơn.'); return }
    if (imageSummary.count >= MAX_DOCUMENT_IMAGES) { setImageError(`Mỗi tài liệu có thể lưu tối đa ${MAX_DOCUMENT_IMAGES} ảnh.`); return }
    try {
      const src = await imageEncoderRef.current.encode(file)
      const latest = imageStats(editor.getJSON())
      if (latest.count >= MAX_DOCUMENT_IMAGES) { setImageError(`Mỗi tài liệu có thể lưu tối đa ${MAX_DOCUMENT_IMAGES} ảnh.`); return }
      const encodedImage = src.slice(src.indexOf(',') + 1)
      if (latest.storedBytes + base64ByteLength(encodedImage) > MAX_TOTAL_DOCUMENT_IMAGE_BYTES) { setImageError('Ảnh vượt quá dung lượng lưu trên máy. Hãy xóa bớt ảnh trong tài liệu.'); return }
      const position = imageInsertPositionRef.current ?? editor.state.selection.to
      const mime = src.match(/^data:image\/(png|jpeg)/)?.[1]
      if (!mime || !['png', 'jpeg'].includes(mime)) throw new Error('Định dạng ảnh sau khi chuyển đổi không được hỗ trợ.')
      const inserted = editor.chain().focus().insertContentAt(position, { type: 'imageBlock', attrs: { src, alt: file.name, filename: file.name } }).run()
      if (!inserted) throw new Error('Không thể chèn ảnh vào vị trí hiện tại.')
      setImageFocusVersion(version => version + 1)
      imageInsertPositionRef.current = null
    } catch (error) { setImageError(error.message || 'Không thể chèn ảnh.') }
  }
  const exportPdf = async () => {
    if (exporting || !sourceTrusted || compileAssetError) return
    const scheduler = pdfSchedulerRef.current
    const documentId = activeTask.id
    setExporting(true)
    try {
      const filename = `${title.replace(/[\\/:*?"<>|]/g, '').trim() || 'tai-lieu'}.pdf`
      let blob
      // If editing continued during compilation, export only after the latest revision is ready.
      let current = false
      do {
        const input = latestCompileCaptureRef.current()
        if (input.id !== documentId) throw new DOMException('Đã chuyển tài liệu.', 'AbortError')
        blob = await scheduler.request(input)
        const latest = latestCompileCaptureRef.current()
        if (latest.id !== documentId) throw new DOMException('Đã chuyển tài liệu.', 'AbortError')
        if (latest.blocked) throw new Error(latest.blocked)
        current = sameCompileInput(scheduler.result?.input, latest)
      } while (!current)
      if (window.desktopAPI?.savePdf) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await window.desktopAPI.savePdf(bytes, filename)
      } else {
        const url = URL.createObjectURL(blob)
        const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(error)
        alert(`Chưa thể lưu PDF. ${error.message || 'Hãy thử lại.'}`)
      }
    } finally {
      setExporting(false)
    }
  }
  const updateSource = value => {
    if (summaryModeRef.current) return
    if (!acceptsSourceEdit(effectiveLatex, value)) {
      setImageError('Source LaTeX vượt giới hạn 800 KB. Hãy giảm nội dung trước khi biên dịch.')
      return
    }
    sourceSyncRequestRef.current += 1
    sourceEditedRef.current = true
    sourceDraftRef.current = value
    setSourceSyncStatus({ kind: 'pending', text: 'Đang cập nhật bản thảo…' })
    setSourceDraftBackup(false)
    setSourceDraft(value)
    setSourceEdited(true)
  }
  const resetSource = () => {
    if (sourceEdited && !window.confirm('Quay về source tạo từ bản thảo? Hãy sao lưu trước nếu cần giữ source riêng.')) return
    sourceSyncRequestRef.current += 1
    sourceEditedRef.current = false
    sourceDraftRef.current = ''
    setSourceSyncStatus({ kind: 'idle', text: '' })
    setSourceDraft('')
    setSourceDraftBackup(false)
    setSourceEdited(false)
    const usesBuiltInTemplate = !activeDocumentTemplateId || builtInDocumentTemplates.some(template => template.id === activeDocumentTemplateId)
    setSourceTrusted(current => assets.length || !usesBuiltInTemplate ? current : true)
    store.writeText('latex-source', latex)
    store.remove('latex-source-mode')
  }
  const restoreSourceDraft = () => {
    if (!sourceDraftBackup || !sourceDraft.trim()) return
    sourceEditedRef.current = true
    setSourceDraftBackup(false)
    setSourceEdited(true)
    setSourceTrusted(false)
  }
  const format = (action, options) => { if (summaryModeRef.current) return; const chain = editor?.chain().focus(); if (!chain) return; (options ? chain[action](options) : chain[action]()).run() }
  const openFormula = () => {
    if (summaryModeRef.current) return
    rememberEditorSelection()
    formulaPastedUntrustedRef.current = false
    setEditingFormulaPosition(null)
    setFormulaType('inline')
    setFormulaInputMode('visual')
    setFormula('X_t^{selected} = S_t^{(n)} ∪ E_t^{(k)}')
    setFormulaOpen(true)
  }
  const closeFormula = () => { pendingInsertionSelectionRef.current = null; setFormulaOpen(false) }
  const openFormulaLibrary = () => { if (summaryModeRef.current) return; rememberEditorSelection(); setLibraryOpen(true) }
  const closeFormulaLibrary = () => { pendingInsertionSelectionRef.current = null; setLibraryOpen(false) }
  const jumpToHeading = index => {
    if (isCompact) setActiveTab('write')
    else if (mode === 'preview' || mode === 'source') setMode('write')
    setPendingHeading(index)
  }
  const currentView = isCompact ? activeTab : mode
  const toggleFocusMode = () => setFocusMode(value => !value)
  useEffect(() => {
    if (pendingHeading === null || currentView === 'preview' || currentView === 'source') return
    const frame = requestAnimationFrame(() => {
      let headingIndex = 0
      editor?.state.doc.forEach((node, position) => {
        if (node.type.name !== 'heading') return
        if (headingIndex === pendingHeading) editor.commands.setTextSelection(position + 1)
        headingIndex += 1
      })
      editor?.commands.focus(undefined, { scrollIntoView: false })
      editor?.view.dom.querySelectorAll('h1, h2, h3')[pendingHeading]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPendingHeading(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingHeading, currentView, editor])
  const requestImage = () => {
    imageInsertPositionRef.current = editor?.state.selection.to ?? null
    uploadInputRef.current?.click()
  }
  const captureWorkspace = () => {
    saveCurrentTaskSnapshot()
    return { ...latestWorkspaceRef.current, projects: workspaceRef.current.projects, activeProjectId: workspaceRef.current.activeProjectId, version: 1, savedAt: new Date().toISOString() }
  }
  const snapshotWorkspace = async () => {
    if (!await persistWorkspaceRef.current?.(true)) throw new Error('Không lưu được workspace; thao tác đã dừng để bảo vệ dữ liệu.')
    if (window.desktopAPI?.backupWorkspace) await window.desktopAPI.backupWorkspace()
    else await exportWorkspace(captureWorkspace())
  }
  const activateWorkspace = (next, keepSummary = false) => {
    const showSummary = keepSummary && summaryModeRef.current
    summaryModeRef.current = showSummary
    setSummaryMode(showSummary)
    writeWorkspace(next)
    const project = next.projects.find(item => item.id === next.activeProjectId) || next.projects[0]
    const task = showSummary ? compileProject(project) : project.tasks.find(item => item.id === project.activeTaskId) || project.tasks[0]
    loadTaskIntoEditor(task)
    // Also refresh when the active id stays the same (rename or restored settings).
    editor?.chain().setMeta('compilationLoad', true).setContent(task.document, { emitUpdate: false }).run()
  }
  syncCanApplyRef.current = !formulaOpen && !mathScanOpen && !libraryOpen && !documentTemplatesOpen && !workspaceDialogType && !referencesDialog
  syncActionRef.current = async (action, value) => {
    if (action === 'auto' && !syncCanApplyRef.current) return
    if (syncBusyRef.current) {
      if (action === 'auto') return
      await syncBusyRef.current
      return syncActionRef.current?.(action, value)
    }
    if (!window.desktopAPI?.exchangeSync) return
    let finishSync
    syncBusyRef.current = new Promise(resolve => { finishSync = resolve })
    try {
      let status = await window.desktopAPI.syncStatus()
      setSyncStatus(status)
      if (action === 'auto' && status.mode === 'off') return
      if (!await persistWorkspaceRef.current?.(action !== 'auto')) throw new Error('Chưa lưu được dữ liệu; lượt đồng bộ đã dừng để bảo vệ bản thảo.')
      const captureForSync = () => {
        const latest = latestWorkspaceRef.current, current = workspaceRef.current
        const next = !summaryModeRef.current ? updateWorkspaceTask(current, latest.activeProjectId, latest.activeTaskId, {
          title: latest.title, document: editor && editorTaskIdRef.current === latest.activeTaskId ? editor.getJSON() : latest.document,
          sourceDraft: latest.sourceDraft, sourceEdited: latest.sourceEdited, sourceDraftBackup: latest.sourceDraftBackup,
          activeDocumentTemplateId: latest.activeDocumentTemplateId, settings: latest.settings, assets: latest.assets, sourceTrusted: latest.sourceTrusted,
        }) : current
        return { ...latest, projects: next.projects, activeProjectId: next.activeProjectId, version: 1 }
      }
      const submitted = captureForSync()
      if (action === 'invite') return await window.desktopAPI.syncInvitation(value)
      if (action === 'host' || action === 'join' || action === 'off') {
        status = await window.desktopAPI.configureSync(action === 'host' ? 'host' : action === 'join' ? 'client' : 'off', submitted, value)
        setSyncStatus(status)
        if (action === 'off') return
      }
      if (action === 'revoke') { setSyncStatus(await window.desktopAPI.revokeSyncPeer(value)); return }
      if (action === 'resolve') await window.desktopAPI.resolveSync(value.id, value.choice, value.currentRev)
      const result = await window.desktopAPI.exchangeSync(submitted)
      if (!result.workspace) return
      // Citation/formula dialogs may have captured positions in the current document.
      // Keep the received revision pending until those dialogs close.
      if (!syncCanApplyRef.current) { setSyncStatus(result.status); return }
      const live = captureForSync()
      const rebased = rebaseSyncWorkspace(submitted, live, result.workspace)
      const changed = !sameRecord(workspaceRecords(live), workspaceRecords(rebased.workspace))
      // Save the remote merge before acknowledging. A crash cannot acknowledge unseen data.
      // Native persistence is queued with autosave; the live editor is captured again on the next tick.
      if (changed) await window.desktopAPI.backupWorkspace()
      const latest = captureForSync()
      const final = rebaseSyncWorkspace(live, latest, rebased.workspace)
      const accepted = { ...final.workspace, savedAt: new Date().toISOString() }
      const apply = !sameRecord(workspaceRecords(latest), workspaceRecords(accepted))
      if (apply) {
        // Applying state is synchronous here; autosave will capture typing during the native write.
        setDocumentTemplates(accepted.documentTemplates || [])
        setCustomTemplates(accepted.customTemplates || [])
        activateWorkspace(accepted, true)
      }
      if (apply && !(await window.desktopAPI.saveWorkspace(accepted))?.saved) throw new Error('Không lưu được dữ liệu vừa đồng bộ.')
      setSyncStatus(await window.desktopAPI.acknowledgeSync(result.receipt))
      if (rebased.recovered + final.recovered) setWorkspaceNotice('Đã giữ bản sửa trong lúc đồng bộ thành bản sao. Kiểm tra các tab có tên “bản sửa trong lúc đồng bộ”.')
      else if (result.status.conflicts.length) setWorkspaceNotice(`Có ${result.status.conflicts.length} xung đột. Mở Quản lý tài liệu → Đồng bộ LAN để xử lý.`)
    } catch (error) {
      setSyncStatus(current => ({ ...current, error: error.message }))
      if (action !== 'auto') throw error
    } finally { syncBusyRef.current = null; finishSync() }
  }
  useEffect(() => {
    if (!window.desktopAPI?.syncStatus) return
    void window.desktopAPI.syncStatus().then(setSyncStatus).catch(error => setSyncStatus({ mode: 'off', error: error.message }))
    const tick = () => { void syncActionRef.current?.('auto') }
    const timer = window.setInterval(tick, 5000)
    window.addEventListener('online', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('online', tick) }
  }, [])
  const workspaceAction = async (action, projectId, taskId, name) => {
    if (action.startsWith('delete-')) await snapshotWorkspace()
    saveCurrentTaskSnapshot()
    activateWorkspace(editWorkspace(workspaceRef.current, action, projectId, taskId, name), true)
  }
  const appendIncoming = async incoming => {
    saveCurrentTaskSnapshot()
    const templateIdMap = new Map()
    const additions = (incoming.documentTemplates || []).map(template => { const id = createTemplateId('layout-'); templateIdMap.set(template.id, id); return { ...template, id, untrusted: true } })
    const imported = { ...incoming, projects: incoming.projects.map(project => ({ ...project, tasks: project.tasks.map(task => ({ ...task, activeDocumentTemplateId: templateIdMap.get(task.activeDocumentTemplateId) || (builtInDocumentTemplates.some(item => item.id === task.activeDocumentTemplateId) ? task.activeDocumentTemplateId : '') })) })) }
    setDocumentTemplates(current => [...current, ...additions])
    setCustomTemplates(current => [...current, ...(incoming.customTemplates || []).map(template => ({ ...template, id: createTemplateId('custom-'), untrusted: true }))])
    activateWorkspace(mergeWorkspace(workspaceRef.current, imported))
  }
  const addImportedDocument = (task, projectName) => {
    saveCurrentTaskSnapshot()
    const project = createProject(projectName, task)
    activateWorkspace({ ...workspaceRef.current, projects: [...workspaceRef.current.projects, project], activeProjectId: project.id })
  }
  const importLatex = async file => {
    const value = await importLatexProject(file)
    const task = { ...createTask(value.title), sourceDraft: value.latex, sourceEdited: true, sourceTrusted: false, assets: value.assets }
    addImportedDocument(task, value.title)
    return `Đã nhập ${value.title} và ${value.assets.length} tài nguyên. Xác nhận tin cậy để biên dịch.`
  }
  const importWord = async file => {
    const value = await readWord(file)
    addImportedDocument({ ...createTask(file.name.replace(/\.docx$/i, ''), value.document), sourceTrusted: false }, 'Nhập từ Word')
    return `Đã nhập bản thảo Word. ${value.warnings.join(' ')}`
  }
  const updateAssets = async (action, value) => {
    if (action === 'remove') { setAssets(current => current.filter(asset => asset.filename !== value)); return }
    if (!value.length) return
    const budgetIncoming = settings.bibliography.trim()
      ? value.filter(file => file.name.toLowerCase() !== 'references.bib')
      : value
    validateAssetFileBatch(budgetIncoming, compileAssets)
    const incoming = []
    for (const file of value) incoming.push({ filename: file.name, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) })
    setAssets(validateAssets([...assets, ...incoming]))
    setSourceTrusted(false)
    return `Đã thêm ${incoming.length} tệp. Xác nhận tin cậy trước khi biên dịch tài nguyên mới.`
  }
  const clearCache = async () => {
    if (window.desktopAPI?.clearCompileCache) await window.desktopAPI.clearCompileCache()
    else {
      const response = await fetch('/api/cache/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || `Không thể xóa cache (HTTP ${response.status}).`)
      }
    }
    setCompileRetry(value => value + 1)
  }
  const editorPane = <EditorPane
    compactTools
    readOnly={summaryMode}
    editor={editor}
    documentId={activeTask.id}
    title={title}
    settings={settings}
    onEditAbstract={() => { setManagerContext({ tab: 'settings' }); setManagerOpen(true) }}
    onPageCountChange={setEditorPageCount}
    focusMode={focusMode}
    onFormat={format}
    uploadInputRef={uploadInputRef}
    imageError={imageError}
    onImageChange={insertImageFile}
    onRequestImage={requestImage}
    onOpenFormula={openFormula}
    onOpenMathScan={() => editor && setMathScanOpen(true)}
    onOpenManager={() => setManagerOpen(true)}
    onOpenReferences={tab => openReferencesDialog(tab || 'cite')}
    onOpenFormulaLibrary={openFormulaLibrary}
    onOpenDocumentTemplates={() => setDocumentTemplatesOpen(true)}
    onToggleFocus={toggleFocusMode}
    outline={outline}
    onJumpToHeading={jumpToHeading}
    sourceEdited={sourceEdited}
    sourceSyncStatus={sourceSyncStatus}
    onResetSource={resetSource}
    sourceDraftBackupAvailable={sourceDraftBackupAvailable}
    onRestoreSourceDraft={restoreSourceDraft}
  />
  const previewPane = <PdfPreviewPane
    collapsibleTools
    compileState={compileState}
    pdfStale={pdfStale}
    pdfMode={pdfMode}
    onPdfModeChange={setPdfMode}
    compileBlocked={!sourceTrusted || Boolean(compileAssetError)}
    onUpdate={() => { void pdfSchedulerRef.current?.request(captureCompileInput()).catch(() => {}) }}
    latexOpen={latexOpen}
    onToggleLatex={() => setLatexOpen(value => !value)}
    sourceEdited={sourceEdited}
    effectiveLatex={effectiveLatex}
    compileError={compileError}
    onRetry={() => setCompileRetry(value => value + 1)}
    pdfUrl={pdfUrl}
    images={serialization.images}
    imageFocusKey={`${activeTask.id}:${imageFocusVersion}:${imageSummary.count}`}
    imageSyncWarning={imageSourceWarning}
    compileLog={compileLog}
  />
  const sourcePane = <LatexSourcePane
    readOnly={summaryMode}
    exportBlocked={summaryMode && Boolean(compileAssetError)}
    effectiveLatex={effectiveLatex}
    sourceEdited={sourceEdited}
    images={serialization.images}
    documentTitle={title}
    onChange={updateSource}
    onReset={resetSource}
    assets={compileAssets}
    identity={activeTask.id}
    errorLine={compileErrorLine}
    sourceSyncStatus={sourceSyncStatus}
    onImportSource={(value, filename) => { const name = (filename || 'Source nhập').replace(/\.tex$/i, ''); addImportedDocument({ ...createTask(name), sourceDraft: value, sourceEdited: true, sourceTrusted: false }, name) }}
  />
  const changeView = view => { if (isCompact) setActiveTab(view === 'split' ? 'write' : view); else setMode(view) }
  const modalOpen = Boolean(formulaOpen || mathScanOpen || libraryOpen || documentTemplatesOpen || workspaceDialogType || managerOpen || referencesDialog)
  const createItem = type => { setWorkspaceItemName(''); setWorkspaceFrame({ templateId: '', documentTitle: '', settings: sanitizeSettings({ abstractEnabled: true }) }); setWorkspaceDialogType(type) }
  const openManager = (context = null) => { setManagerContext(context); setManagerOpen(true) }
  const commandItems = [
    { id: 'insert-citation', label: 'Chèn trích dẫn (Ctrl+Shift+C)', Icon: BookOpen, run: () => openReferencesDialog('cite') },
    { id: 'references', label: 'Danh mục tài liệu tham khảo', Icon: BookOpen, run: () => openReferencesDialog('library') },
    { id: 'scan-citations', label: 'Quét trích dẫn chưa liên kết REF', Icon: BookOpen, run: () => openReferencesDialog('scan') },
    { id: 'new-task', label: 'Tạo tài liệu mới', Icon: FilePenLine, run: () => createItem('task') },
    { id: 'new-project', label: 'Tạo dự án mới', Icon: FolderPlus, run: () => createItem('project') },
    ...workspace.projects.flatMap(project => project.tasks.map(task => ({
      id: `open-${project.id}-${task.id}`,
      label: `Mở ${task.title || 'Chưa đặt tên'} · ${project.name}`,
      Icon: FilePenLine,
      run: () => switchToTask(project.id, task.id),
    }))),
    { id: 'formula', label: 'Chèn công thức', Icon: Sigma, run: openFormula },
    { id: 'templates', label: 'Mẫu tài liệu', Icon: BookOpen, disabled: summaryMode, run: () => setDocumentTemplatesOpen(true) },
    { id: 'write', label: 'Soạn thảo', Icon: FilePenLine, run: () => changeView('write') },
    { id: 'source', label: 'Mã LaTeX', Icon: FileCode2, run: () => changeView('source') },
    { id: 'preview', label: 'Xem bản in PDF', Icon: Eye, run: () => changeView('preview') },
    { id: 'export', label: 'Xuất PDF', Icon: FileDown, disabled: exporting || !sourceTrusted || Boolean(compileAssetError), run: exportPdf },
    { id: 'scan-math', label: 'Quét công thức và gợi ý LaTeX', Icon: Sigma, disabled: summaryMode || !editor, run: () => editor && setMathScanOpen(true) },
    { id: 'manager', label: 'Quản lý tài liệu và sao lưu', Icon: Settings2, run: () => openManager() },
    { id: 'focus', label: focusMode ? 'Thoát chế độ tập trung' : 'Chế độ tập trung', Icon: PanelTopOpen, run: toggleFocusMode },
  ]
  return (
    <div className={`studio-app mono-root${focusMode ? ' mono-focus' : ''}${!navOpen ? ' mono-nav-collapsed' : ''}`}>
      {!focusMode && <StudioNavigation
        wordCount={wordCount} formulaCount={formulaCount} imageCount={imageSummary.count}
        summary={summaryMode}
        projects={workspace.projects} activeProject={activeProject} activeTaskId={activeTask.id} currentTitle={title}
        outline={outline} open={navOpen} onToggle={toggleNavigation} onClose={closeNavigation} isCompact={isCompact}
        onSelect={switchToTask} onProjectChange={id => { const project = workspaceRef.current.projects.find(item => item.id === id); if (project) switchToTask(id, project.activeTaskId) }}
        onCreateProject={() => createItem('project')} onCreateTask={() => createItem('task')} onJump={jumpToHeading}
        onTemplates={() => setDocumentTemplatesOpen(true)}
        onDelete={() => { if (!summaryMode) openManager({ deleting: { action: 'delete-task', projectId: activeProject.id, taskId: activeTask.id, name: title } }) }}
        onCommand={() => setCommandOpen(true)} blocked={modalOpen}
      />}
      <div className="mono-shell" inert={modalOpen || (!focusMode && isCompact && mobileNavOpen)}>
      {!focusMode ? <DocumentHeader
        dockPlacement={dockPlacement}
        onToggleDock={() => setDockPlacement(value => value === 'top' ? 'bottom' : 'top')}
        readOnly={summaryMode}
        onOpenManager={() => openManager()} title={title} projectName={activeProject.name}
        onTitleChange={event => { if (!summaryMode) setTitle(event.target.value) }} saved={saved} theme={theme}
        onToggleTheme={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
        exporting={exporting} canExport={sourceTrusted && !compileAssetError} onExport={exportPdf}
        mode={currentView} onModeChange={changeView} onToggleFocus={toggleFocusMode}
        onToggleNav={toggleNavigation} navOpen={navOpen} isCompact={isCompact}
      /> : <div className="studio-focus-strip">
        <button type="button" className="studio-focus-exit" onClick={toggleFocusMode} title="Mở lại thanh trên và thanh trạng thái" aria-label="Mở lại giao diện"><PanelTopOpen size={14} /><span>Mở lại giao diện</span></button>
        <strong className="studio-focus-title" title={title}>{title}</strong>
        <span className="studio-save studio-focus-save" role="status" data-saving={!saved}>{saved ? 'Đã lưu' : 'Đang lưu…'}</span>
      </div>}

      {!sourceTrusted && <div className="studio-trust-banner" role="status"><span>Tài liệu, source hoặc tài nguyên nhập từ ngoài chưa được biên dịch. XeLaTeX cục bộ có thể đọc tệp trên máy; chỉ tiếp tục khi bạn tin cậy tài liệu.</span><button type="button" onClick={() => { setSourceTrusted(true); setCompileRetry(value => value + 1) }}>Tin cậy và biên dịch</button></div>}
      {workspaceNotice && <div className="studio-trust-banner" role="status"><span>{workspaceNotice}</span><button type="button" onClick={() => setWorkspaceNotice('')}>Đã hiểu</button></div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="studio-workspace">
            <ProjectTabs key={activeProject.id} project={activeProject} activeId={activeTask.id} currentTitle={title} summary={summaryMode}
              onSelect={switchToTask} onCreate={() => createItem('task')} onAction={workspaceAction}
              onSummary={() => { saveCurrentTaskSnapshot(); const project = workspaceRef.current.projects.find(item => item.id === activeProject.id); summaryModeRef.current = true; setSummaryMode(true); loadTaskIntoEditor(compileProject(project)) }} />
            {summaryMode && compilation.errors.length > 0 && <div className="studio-trust-banner" role="alert">{compilation.errors.join(' ')}</div>}
            {!focusMode && <WorkflowBar mode={currentView} onModeChange={changeView} compileState={compileState} pdfStale={pdfStale} sourceEdited={sourceEdited} />}
            <div className="mono-workspace-content min-h-0 flex-1 overflow-hidden">
              {!isCompact && currentView === 'split'
                ? <Group
                    className="flex h-full min-h-0 w-full"
                    orientation="horizontal"
                    defaultLayout={defaultLayout}
                    onLayoutChanged={(layout, meta) => {
                      onLayoutChanged(layout, meta)
                    }}
                  >
                    <Panel id="editor" defaultSize="53%" minSize="32%" className="flex min-h-0 min-w-0">
                      {editorPane}
                    </Panel>
                    <Separator className="studio-separator" aria-label="Kéo để thay đổi độ rộng hai khung"><span><GripVertical size={11} /></span></Separator>
                    <Panel id="preview" defaultSize="47%" minSize="32%" className="flex min-h-0 min-w-0">{previewPane}</Panel>
                  </Group>
                : currentView === 'write' ? editorPane : currentView === 'source' ? sourcePane : previewPane}
            </div>

            {!focusMode && <footer className="studio-statusbar" role="status">
              <span><span><b>{wordCount.toLocaleString('vi-VN')}</b> từ</span><span>/</span><span><b>{formulaCount}</b> công thức</span><span>/</span><span><b>{imageSummary.count}</b> ảnh</span></span><span>Lưu trên máy · Tiếng Việt</span>            </footer>}
        </main>
      </div>

      </div>
      {commandOpen && <CommandPalette commands={commandItems} onClose={() => setCommandOpen(false)} />}

      <FormulaDialog
        editing={editingFormulaPosition !== null}
        open={formulaOpen}
        onClose={closeFormula}
        formula={formula}
        onFormulaChange={setFormula}
        formulaType={formulaType}
        onFormulaTypeChange={setFormulaType}
        inputMode={formulaInputMode}
        onInputModeChange={mode => {
          if (mode === 'recognize') formulaPastedUntrustedRef.current = false
          setFormulaInputMode(mode)
        }}
        mathFieldRef={mathFieldRef}
        onUntrustedPaste={() => { formulaPastedUntrustedRef.current = true }}
        mathliveReady={mathliveReady}
        katexRenderer={katexRenderer}
        onInsert={insertFormula}
        normalizeFormula={normalizedFormula}
      />
      {mathScanOpen && editor && <MathSuggestionDialog editor={editor} katexRenderer={katexRenderer} onClose={() => setMathScanOpen(false)} />}
      <FormulaLibraryDialog
        open={libraryOpen}
        onClose={closeFormulaLibrary}
        builtInTemplates={builtInTemplates}
        customTemplates={customTemplates}
        katexRenderer={katexRenderer}
        onInsert={(value, type, untrusted) => { insertMath(value, type, untrusted); closeFormulaLibrary() }}
        onRemove={removeTemplate}
        adding={newTemplateOpen}
        onAdd={setNewTemplateOpen}
        name={templateName}
        onNameChange={setTemplateName}
        latex={templateLatex}
        onLatexChange={setTemplateLatex}
        type={templateType}
        onTypeChange={setTemplateType}
        onSave={saveTemplate}
      />
      <DocumentTemplatesDialog
        open={documentTemplatesOpen}
        onClose={() => setDocumentTemplatesOpen(false)}
        templates={[...builtInDocumentTemplates, ...documentTemplates]}
        activeId={activeDocumentTemplateId}
        onApply={applyDocumentTemplate}
        onRemove={removeDocumentTemplate}
        adding={addingDocumentTemplate}
        onAdd={setAddingDocumentTemplate}
        name={documentTemplateName}
        onNameChange={setDocumentTemplateName}
        source={documentTemplateSource}
        onSourceChange={setDocumentTemplateSource}
        onSave={saveDocumentTemplate}
        defaultTemplate={defaultDocumentTemplate}
      />
      {managerOpen && <StudioManager readOnly={summaryMode} open initialTab={managerContext?.tab} initialDelete={managerContext?.deleting} onClose={() => { setManagerOpen(false); setManagerContext(null) }} workspace={workspace} title={title} editor={summaryMode ? null : editor}
        onSelect={switchToTask} onAction={workspaceAction} settings={settings} onSettings={summaryMode ? () => {} : setSettings} assets={assets} onAssets={summaryMode ? () => {} : updateAssets}
        onSnapshot={snapshotWorkspace} onRestore={async id => { const backup = await window.desktopAPI.readBackup(id); const valid = sanitizeWorkspace(backup); if (!valid) throw new Error('Bản khôi phục không hợp lệ.'); await appendIncoming({ ...backup, ...valid }) }}
        onExport={async () => { await exportWorkspace(captureWorkspace()); return 'Đã xuất gói sao lưu.' }}
        onImport={async file => { await appendIncoming(await importWorkspace(file)); return 'Đã nhập bản sao các dự án.' }}
        onImportLatex={importLatex} onImportWord={importWord} onExportWord={async () => { await writeWord(editor?.getJSON() || docData, title, settings, activeDocumentTemplate?.source); return 'Đã xuất Word. Trích dẫn và danh mục tài liệu theo kiểu đã chọn; tham chiếu chéo được giữ dưới dạng tên nhãn — hãy rà soát bố cục trong Word.' }}
        onOpenReferences={tab => { setManagerOpen(false); setManagerContext(null); openReferencesDialog(tab) }}
        clearCache={clearCache} notice={workspaceNotice} syncStatus={syncStatus} onSyncAction={(action, value) => syncActionRef.current(action, value)} />}
      {referencesDialog && <ReferencesDialog open key={`${referencesDialog.tab}-${referencesDialog.editing?.pos ?? 'new'}`} initialTab={referencesDialog.tab} editing={referencesDialog.editing} insertionSelection={referencesDialog.insertionSelection} editor={editor}
        settings={settings} onSettings={setSettings} templateSource={activeDocumentTemplate?.source} sourceEdited={sourceEdited} onClose={closeReferencesDialog} />}
      <WorkspaceDialog
        type={workspaceDialogType}
        frame={workspaceFrame}
        onFrameChange={setWorkspaceFrame}
        templates={[...builtInDocumentTemplates, ...documentTemplates]}
        value={workspaceItemName}
        onChange={setWorkspaceItemName}
        onClose={() => { setWorkspaceDialogType(null); setWorkspaceItemName('') }}
        onSave={createWorkspaceItem}
      />
    </div>
  )
}

const reactRoot = import.meta.hot?.data.reactRoot ?? createRoot(document.getElementById('root'))
if (import.meta.hot) import.meta.hot.data.reactRoot = reactRoot
async function startApp() {
  let initialWorkspace = null
  try {
    initialWorkspace = await window.desktopAPI?.loadWorkspace?.() ?? null
    if (initialWorkspace?.projects) {
      const valid = sanitizeWorkspace(initialWorkspace)
      if (!valid || valid.projects.length !== initialWorkspace.projects.length || valid.projects.some((project, index) => project.tasks.length !== initialWorkspace.projects[index].tasks.length)) throw new Error('Workspace có tài liệu không hợp lệ. Hãy giữ tệp hiện tại và khôi phục từ thư mục backups.')
    }
  }
  catch (error) { reactRoot.render(<div className="p-8"><h1>Không thể khôi phục dữ liệu</h1><p>{error.message}</p><p>Ứng dụng đã dừng ghi dữ liệu để giữ nguyên tệp hiện có. Kiểm tra thư mục dữ liệu và các tệp trong backups trước khi mở lại.</p><button type="button" onClick={() => window.location.reload()}>Thử mở lại</button></div>); return }
  reactRoot.render(<App initialWorkspace={initialWorkspace} />)
}
void startApp()
