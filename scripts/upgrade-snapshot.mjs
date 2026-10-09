import { sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { normalizeDocumentHeadings } from '../src/services/DocumentSerializer.js'

// Numbered paragraphs have been normalized to headings since 0.5.1.
// Accept that existing representation change, while still comparing all text,
// marks, formulas, source, citations, assets, settings and document identities.
export function upgradeSnapshot(value) {
  const workspace = sanitizeWorkspace(value)
  if (!workspace) throw new Error('Workspace không hợp lệ để kiểm tra nâng cấp.')
  return { ...workspace, projects: workspace.projects.map(project => ({
    ...project, tasks: project.tasks.map(({ updatedAt: _time, ...task }) => ({
      ...task, document: normalizeDocumentHeadings(task.document),
    })),
  })) }
}
