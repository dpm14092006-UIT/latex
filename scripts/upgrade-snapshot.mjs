import { sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { normalizeDocumentHeadings } from '../src/services/DocumentSerializer.js'
import { clampHeadingLevels, isValidDocument } from '../src/services/DocumentData.js'
import { validateAssets } from '../src/services/ProjectAssets.js'

// Numbered paragraphs have been normalized to headings since 0.5.1.
// Accept that existing representation change, while still comparing all text,
// marks, formulas, source, citations, assets, settings and document identities.
export function upgradeSnapshot(value) {
  const workspace = sanitizeWorkspace(value)
  if (!workspace) throw new Error('Workspace không hợp lệ để kiểm tra nâng cấp.')
  // Validate the original input before comparing sanitized snapshots. Otherwise
  // both sides can silently lose the same invalid content and appear equal.
  if (workspace.projects.length !== value.projects.length) throw new Error('Workspace có dự án bị bỏ khi đọc; dừng nâng cấp để bảo vệ dữ liệu gốc.')
  for (const [projectIndex, project] of value.projects.entries()) {
    if (project.tasks.length !== workspace.projects[projectIndex].tasks.length) throw new Error('Workspace có tài liệu bị bỏ khi đọc; dừng nâng cấp để bảo vệ dữ liệu gốc.')
    for (const task of project.tasks) {
      if (!isValidDocument(clampHeadingLevels(task.document))) throw new Error('Workspace có nội dung cần phục hồi; dừng nâng cấp để tránh so sánh bản đã bị rút gọn.')
      if (task.assets !== undefined) validateAssets(task.assets)
      if (task.sourceDraft !== undefined && typeof task.sourceDraft !== 'string') throw new Error('Workspace có source LaTeX không hợp lệ; dừng nâng cấp.')
      if (task.settings?.bibliography !== undefined && (typeof task.settings.bibliography !== 'string' || task.settings.bibliography.length > 500_000)) throw new Error('Workspace có BibTeX không hợp lệ hoặc quá lớn; dừng nâng cấp.')
    }
  }
  return { ...workspace, projects: workspace.projects.map(project => ({
    ...project, tasks: project.tasks.map(({ updatedAt: _time, ...task }) => ({
      ...task, document: normalizeDocumentHeadings(task.document),
    })),
  })) }
}
