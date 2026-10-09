import { isValidDocument } from './DocumentData.js'
import { starter } from './DocumentSerializer.js'
import { normalizeDocumentContent } from './RichTextFormats.js'
import { sanitizeSettings } from './DocumentSettings.js'
import { MAX_ASSETS, MAX_TOTAL_ASSET_BYTES, base64ByteLength, validateAssets } from './ProjectAssets.js'
import { MAX_DOCUMENT_IMAGES, MAX_TOTAL_DOCUMENT_IMAGE_BYTES } from './DocumentLimits.js'

const MAX_DOCUMENT_NODES = 100_000

export const WORKSPACE_STORAGE_KEY = 'latex-workspace-v1'

function makeId(prefix) {
  return `${prefix}${crypto.randomUUID()}`
}

function cleanName(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback
}

function clearLegacyWorkspaceKeys(store, keepDocument = false) {
  const keys = ['latex-title', 'latex-source', 'latex-source-mode', 'latex-active-document-template']
  if (!keepDocument) keys.unshift('latex-document')
  for (const key of keys) store.remove(key)
}

export function writeWorkspaceData(store, workspace) {
  if (store.writeJson(WORKSPACE_STORAGE_KEY, workspace)) {
    clearLegacyWorkspaceKeys(store)
    return true
  }
  if (store.writeJson('latex-document', workspace)) {
    clearLegacyWorkspaceKeys(store, true)
    return true
  }
  return false
}

function persistWorkspaceMigration(store, workspace, savedAt) {
  writeWorkspaceData(store, savedAt ? { ...workspace, savedAt } : workspace)
}

function documentWithChild(parentType, child) {
  const paragraph = content => ({ type: 'paragraph', content })
  const listItem = content => ({ type: 'listItem', content })
  const tableRow = content => ({ type: 'tableRow', content })
  const table = content => ({ type: 'table', content })
  switch (parentType) {
    case 'doc': return { type: 'doc', content: [child] }
    case 'paragraph': return { type: 'doc', content: [paragraph([child])] }
    case 'heading': return { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [child] }] }
    case 'bulletList':
    case 'orderedList': return { type: 'doc', content: [{ type: parentType, content: [child] }] }
    case 'listItem': return { type: 'doc', content: [{ type: 'bulletList', content: [listItem([child])] }] }
    case 'blockquote': return { type: 'doc', content: [{ type: 'blockquote', content: [child] }] }
    case 'codeBlock': return { type: 'doc', content: [{ type: 'codeBlock', content: [child] }] }
    case 'table': return { type: 'doc', content: [table([child])] }
    case 'tableRow': return { type: 'doc', content: [table([tableRow([child])])] }
    case 'tableCell':
    case 'tableHeader': return { type: 'doc', content: [table([tableRow([{ type: parentType, content: [child] }])])] }
    default: return null
  }
}

function repairDocumentNode(node, parentType, depth, budget) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 128 || ++budget.visited > MAX_DOCUMENT_NODES) return null
  const repaired = { ...node }
  if (Array.isArray(node.content)) {
    const content = []
    for (const child of node.content) {
      if (budget.visited >= MAX_DOCUMENT_NODES) break
      const validChild = repairDocumentNode(child, node.type, depth + 1, budget)
      if (validChild) content.push(validChild)
    }
    repaired.content = content
  } else if (node.content !== undefined) return null
  if (repaired.type === 'heading' && Number.isSafeInteger(repaired.attrs?.level) && repaired.attrs.level > 3 && repaired.attrs.level <= 6) {
    repaired.attrs = { ...repaired.attrs, level: 3 }
  }
  const wrapped = documentWithChild(parentType, repaired)
  return wrapped && isValidDocument(wrapped) ? repaired : null
}

function documentNodeCounts(node) {
  let nodes = 0, images = 0, imageBytes = 0
  const pending = [node]
  while (pending.length) {
    const current = pending.pop()
    nodes += 1
    if (current?.type === 'imageBlock') {
      images += 1
      if (typeof current.attrs?.src === 'string') {
        const match = /^data:image\/(?:png|jpeg);base64,/.exec(current.attrs.src)
        if (match) imageBytes += base64ByteLength(current.attrs.src.slice(match[0].length))
      }
    }
    if (Array.isArray(current?.content)) for (const child of current.content) pending.push(child)
  }
  return { nodes, images, imageBytes }
}

function sanitizeDocument(value) {
  if (isValidDocument(value)) return normalizeDocumentContent(value)
  const document = value
  if (!document || document.type !== 'doc' || !Array.isArray(document.content)) return normalizeDocumentContent(starter)

  const content = []
  const budget = { visited: 0 }
  let nodeCount = 0, imageCount = 0, imageBytes = 0
  for (const node of document.content) {
    if (budget.visited >= MAX_DOCUMENT_NODES) break
    const repaired = repairDocumentNode(node, 'doc', 1, budget)
    if (!repaired) continue
    const counts = documentNodeCounts(repaired)
    if (nodeCount + counts.nodes > MAX_DOCUMENT_NODES || imageCount + counts.images > MAX_DOCUMENT_IMAGES || imageBytes + counts.imageBytes > MAX_TOTAL_DOCUMENT_IMAGE_BYTES) continue
    content.push(repaired)
    nodeCount += counts.nodes
    imageCount += counts.images
    imageBytes += counts.imageBytes
  }
  return normalizeDocumentContent({ type: 'doc', content: content.length ? content : structuredClone(starter.content) })
}

function sanitizeAssets(value) {
  if (!Array.isArray(value)) return []
  const assets = [], names = new Set()
  let totalBytes = 0
  for (const candidate of value) {
    if (assets.length >= MAX_ASSETS) break
    try {
      const [asset] = validateAssets([candidate])
      const name = asset.filename.toLowerCase()
      const size = base64ByteLength(asset.data)
      if (names.has(name) || totalBytes + size > MAX_TOTAL_ASSET_BYTES) continue
      assets.push(asset)
      names.add(name)
      totalBytes += size
    } catch { /* Keep valid assets from a partially damaged project. */ }
  }
  return assets
}

function sanitizeTask(value, seenIds) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || seenIds.has(value.id)) return null
  const document = sanitizeDocument(value.document)
  seenIds.add(value.id)
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title.slice(0, 160) : 'Chưa đặt tên',
    document,
    sourceDraft: typeof value.sourceDraft === 'string' ? value.sourceDraft : '',
    sourceEdited: value.sourceEdited === true,
    sourceDraftBackup: value.sourceDraftBackup === true,
    activeDocumentTemplateId: typeof value.activeDocumentTemplateId === 'string' ? value.activeDocumentTemplateId : '',
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    settings: sanitizeSettings(value.settings),
    assets: sanitizeAssets(value.assets),
    sourceTrusted: value.sourceTrusted !== false,
    includeInCompilation: value.includeInCompilation !== false,
    compilationPageBreak: value.compilationPageBreak === true,
  }
}

export function sanitizeWorkspace(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.projects)) return null
  const seenIds = new Set()
  const projects = value.projects.flatMap(project => {
    if (!project || typeof project !== 'object' || typeof project.id !== 'string' || !project.id || seenIds.has(project.id) || !Array.isArray(project.tasks)) return []
    seenIds.add(project.id)
    const tasks = project.tasks.map(task => sanitizeTask(task, seenIds)).filter(Boolean)
    if (!tasks.length) return []
    const activeTaskId = tasks.some(task => task.id === project.activeTaskId) ? project.activeTaskId : tasks[0].id
    return [{
      id: project.id,
      name: cleanName(project.name, 'Dự án chưa đặt tên'),
      tasks,
      activeTaskId,
    }]
  })
  if (!projects.length) return null
  const activeProjectId = projects.some(project => project.id === value.activeProjectId) ? value.activeProjectId : projects[0].id
  return { projects, activeProjectId }
}

export function createTask(title = 'Tài liệu mới', document = starter) {
  return {
    id: makeId('task-'),
    title: cleanName(title, 'Tài liệu mới'),
    document: normalizeDocumentContent(document),
    sourceDraft: '',
    sourceEdited: false,
    sourceDraftBackup: false,
    activeDocumentTemplateId: '',
    updatedAt: Date.now(),
    settings: sanitizeSettings(),
    assets: [],
    sourceTrusted: true,
  }
}

export function editWorkspace(workspace, action, projectId, taskId, name = '') {
  const next = structuredClone(workspace)
  const project = next.projects.find(item => item.id === projectId)
  if (!project) return next
  const task = project.tasks.find(item => item.id === taskId)
  if (action === 'rename-project') project.name = cleanName(name, project.name)
  if (action === 'rename-task' && task) task.title = cleanName(name, task.title)
  if (action === 'include-compilation' && task) task.includeInCompilation = task.includeInCompilation === false
  if (action === 'page-break-compilation' && task) task.compilationPageBreak = !task.compilationPageBreak
  if ((action === 'move-task-left' || action === 'move-task-right') && task) {
    const index = project.tasks.indexOf(task)
    const target = index + (action === 'move-task-left' ? -1 : 1)
    if (target >= 0 && target < project.tasks.length) {
      project.tasks.splice(index, 1)
      project.tasks.splice(target, 0, task)
    }
  }
  if (action === 'duplicate-task' && task) {
    const copy = { ...structuredClone(task), id: makeId('task-'), title: `${task.title} — bản sao`, updatedAt: Date.now() }
    project.tasks.push(copy)
    project.activeTaskId = copy.id
    next.activeProjectId = project.id
  }
  if (action === 'duplicate-project') {
    const copy = { ...structuredClone(project), id: makeId('project-'), name: `${project.name} — bản sao` }
    copy.tasks = copy.tasks.map(item => ({ ...item, id: makeId('task-') }))
    copy.activeTaskId = copy.tasks[0].id
    next.projects.push(copy)
    next.activeProjectId = copy.id
  }
  if (action === 'delete-task') {
    project.tasks = project.tasks.filter(item => item.id !== taskId)
    if (!project.tasks.length) project.tasks = [createTask()]
    if (!project.tasks.some(item => item.id === project.activeTaskId)) project.activeTaskId = project.tasks[0].id
  }
  if (action === 'delete-project') {
    next.projects = next.projects.filter(item => item.id !== projectId)
    if (!next.projects.length) next.projects = [createProject()]
    if (!next.projects.some(item => item.id === next.activeProjectId)) next.activeProjectId = next.projects[0].id
  }
  return next
}

export function mergeWorkspace(current, incoming) {
  const projects = incoming.projects.map(project => {
    const tasks = project.tasks.map(task => ({ ...task, id: makeId('task-'), sourceTrusted: false }))
    return { ...project, id: makeId('project-'), tasks, activeTaskId: tasks[0].id }
  })
  return { ...current, projects: [...current.projects, ...projects], activeProjectId: projects[0]?.id || current.activeProjectId }
}

export function createProject(name = 'Dự án mới', task = createTask()) {
  return {
    id: makeId('project-'),
    name: cleanName(name, 'Dự án mới'),
    tasks: [task],
    activeTaskId: task.id,
  }
}

export function loadWorkspace(store, restoredWorkspace = null) {
  const restored = sanitizeWorkspace(restoredWorkspace)
  const canonicalValue = store.readJson(WORKSPACE_STORAGE_KEY, null)
  const canonicalWorkspace = sanitizeWorkspace(canonicalValue)
  const fallbackValue = store.readJson('latex-document', null)
  const fallbackWorkspace = sanitizeWorkspace(fallbackValue)
  const canonicalAt = Date.parse(canonicalValue?.savedAt || '') || 0
  const fallbackAt = Date.parse(fallbackValue?.savedAt || '') || 0
  const useFallback = Boolean(fallbackWorkspace && (!canonicalWorkspace || fallbackAt > canonicalAt || (fallbackAt === canonicalAt && fallbackAt > 0)))
  const storedValue = useFallback ? fallbackValue : canonicalValue
  const stored = useFallback ? fallbackWorkspace : canonicalWorkspace
  const storedAt = Date.parse(storedValue?.savedAt || '') || 0
  const restoredAt = Date.parse(restoredWorkspace?.savedAt || '') || 0
  if (restored && (!stored || restoredAt >= storedAt)) return restored

  if (stored) return stored

  const legacyDocument = restoredWorkspace?.document ?? store.readJson('latex-document', starter)
  const legacyTask = createTask(
    typeof restoredWorkspace?.title === 'string' ? restoredWorkspace.title : store.readText('latex-title', 'Untitled'),
    isValidDocument(legacyDocument) ? legacyDocument : starter,
  )
  legacyTask.sourceDraft = typeof restoredWorkspace?.sourceDraft === 'string' ? restoredWorkspace.sourceDraft : store.readText('latex-source', '')
  legacyTask.sourceEdited = typeof restoredWorkspace?.sourceEdited === 'boolean' ? restoredWorkspace.sourceEdited : store.readText('latex-source-mode') === 'manual'
  legacyTask.activeDocumentTemplateId = typeof restoredWorkspace?.activeDocumentTemplateId === 'string' ? restoredWorkspace.activeDocumentTemplateId : store.readText('latex-active-document-template', '')
  const project = createProject('Dự án của tôi', legacyTask)
  const workspace = { projects: [project], activeProjectId: project.id }
  persistWorkspaceMigration(store, workspace, restoredWorkspace?.savedAt)
  return workspace
}

export function updateWorkspaceTask(workspace, projectId, taskId, update) {
  return {
    ...workspace,
    projects: workspace.projects.map(project => project.id !== projectId ? project : {
      ...project,
      tasks: project.tasks.map(task => task.id !== taskId ? task : { ...task, ...update }),
    }),
  }
}
