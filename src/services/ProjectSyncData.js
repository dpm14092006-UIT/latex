import { createHash } from 'node:crypto'

// Each project owns its received layout copies. A shared layout must never
// silently change the layout of an unrelated, private project on this machine.
export function projectTemplatePrefix(projectId) {
  return `layout-sync-${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}-`
}
function templateId(projectId, id) {
  const prefix = projectTemplatePrefix(projectId)
  if (id.startsWith(prefix)) return id
  return `${prefix}${createHash('sha256').update(id).digest('hex').slice(0, 32)}`
}
export function projectSnapshot(workspace, projectId) {
  const original = workspace.projects.find(item => item.id === projectId)
  const templates = [], mapped = new Map()
  for (const task of original?.tasks || []) {
    const template = (workspace.documentTemplates || []).find(item => item.id === task.activeDocumentTemplateId)
    if (template && !mapped.has(template.id)) {
      const id = templateId(projectId, template.id)
      mapped.set(template.id, id); templates.push({ ...template, id })
    }
  }
  // Keep project-owned conflict copies until the user explicitly removes them.
  for (const template of workspace.documentTemplates || []) {
    if (template.id.startsWith(projectTemplatePrefix(projectId)) && !mapped.has(template.id)) {
      mapped.set(template.id, template.id); templates.push(template)
    }
  }
  const project = original && { ...original, tasks: original.tasks.map(task => ({ ...task, activeDocumentTemplateId: mapped.get(task.activeDocumentTemplateId) || (task.activeDocumentTemplateId?.startsWith('layout-') ? '' : task.activeDocumentTemplateId || '') })) }
  return { version: 1, projects: project ? [project] : [], activeProjectId: projectId, customTemplates: [], documentTemplates: templates }
}
export function mergeProjectWorkspace(local, received, projectId) {
  if (received.projects.some(item => item.id !== projectId)) throw new Error('Dữ liệu nhận vượt phạm vi project.')
  const project = received.projects.find(item => item.id === projectId)
  if (!project) throw new Error('Không nhận được project được chia sẻ.')
  const privateIds = new Set(local.projects.filter(item => item.id !== projectId).flatMap(item => [item.id, ...item.tasks.map(task => task.id)]))
  if (privateIds.has(projectId) || project.tasks.some(task => privateIds.has(task.id))) throw new Error('ID tài liệu nhận trùng với project riêng trên máy. Chưa áp dụng dữ liệu.')
  const prefix = projectTemplatePrefix(projectId)
  if (project.tasks.some(task => task.activeDocumentTemplateId?.startsWith('layout-') && !task.activeDocumentTemplateId.startsWith(prefix))) throw new Error('Tài liệu nhận không được tham chiếu mẫu của project riêng.')
  if ((received.documentTemplates || []).some(item => !item.id.startsWith(prefix))) throw new Error('Mẫu nhận không thuộc project được chia sẻ.')
  const projects = local.projects.some(item => item.id === projectId) ? local.projects.map(item => item.id === projectId ? project : item) : [...local.projects, project]
  const templates = [...(local.documentTemplates || []).filter(item => !item.id.startsWith(prefix)), ...(received.documentTemplates || [])]
  // Keep the active project/tab and all private projects as they were.
  return { ...local, projects, documentTemplates: templates, activeProjectId: local.projects.some(item => item.id === local.activeProjectId) ? local.activeProjectId : projectId }
}
