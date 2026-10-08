import { clampHeadingLevels, isValidDocument } from './DocumentData.js'
import { starter } from './DocumentSerializer.js'
import { normalizeDocumentContent } from './RichTextFormats.js'
import { sanitizeSettings } from './DocumentSettings.js'
import { validateAssets } from './ProjectAssets.js'

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

function sanitizeTask(value, seenIds) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || seenIds.has(value.id)) return null
  const document = clampHeadingLevels(value.document)
  if (!isValidDocument(document)) return null
  let assets
  try { assets = validateAssets(value.assets || []) } catch { return null }
  seenIds.add(value.id)
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title.slice(0, 160) : 'Chưa đặt tên',
    document: normalizeDocumentContent(document),
    sourceDraft: typeof value.sourceDraft === 'string' ? value.sourceDraft : '',
    sourceEdited: value.sourceEdited === true,
    sourceDraftBackup: value.sourceDraftBackup === true,
    activeDocumentTemplateId: typeof value.activeDocumentTemplateId === 'string' ? value.activeDocumentTemplateId : '',
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    settings: sanitizeSettings(value.settings),
    assets,
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
