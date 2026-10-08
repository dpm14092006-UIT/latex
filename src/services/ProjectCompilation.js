import { sanitizeSettings } from './DocumentSettings.js'
import { isValidDocument } from './DocumentData.js'
import { validateAssets } from './ProjectAssets.js'
import { parseBibtex, formatBibtexEntry } from './Bibliography.js'

// A derived view, never a stored task: source tabs remain the only content owners.
export function compileProject(project) {
  const tasks = project.tasks.filter(task => task.includeInCompilation !== false)
  const content = [], assets = new Map(), references = new Map(), labels = new Set(), errors = []
  for (const task of tasks) {
    if (task.sourceEdited) errors.push(`“${task.title}” đang dùng source riêng. Chuyển sang “Dùng lại bản thảo” trong tab đó trước khi tổng hợp.`)
    if (content.length && task.compilationPageBreak) content.push({ type: 'pageBreak' })
    const document = structuredClone(task.document)
    const visit = node => {
      if (node.attrs?.label) {
        if (labels.has(node.attrs.label)) errors.push(`Nhãn “${node.attrs.label}” bị trùng trong “${task.title}”.`)
        labels.add(node.attrs.label)
      }
      node.content?.forEach(visit)
    }
    visit(document)
    content.push(...document.content)
    for (const asset of task.assets || []) {
      const key = asset.filename.toLowerCase()
      if (assets.has(key) && assets.get(key).data !== asset.data) errors.push(`Tài nguyên “${asset.filename}” có nội dung khác nhau giữa các tab.`)
      else assets.set(key, asset)
    }
    for (const entry of parseBibtex(task.settings?.bibliography || '')) {
      const previous = references.get(entry.key)
      if (previous && (previous.type !== entry.type || JSON.stringify(Object.entries(previous.fields).sort()) !== JSON.stringify(Object.entries(entry.fields).sort()))) errors.push(`Trích dẫn “${entry.key}” có nội dung khác nhau giữa các tab.`)
      else references.set(entry.key, entry)
    }
  }
  if (!tasks.length) errors.push('Chọn ít nhất một tab để tổng hợp.')
  const document = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
  if (!isValidDocument(document)) errors.push('Bản tổng hợp vượt giới hạn tài liệu hoặc chứa nội dung không hợp lệ.')
  try { validateAssets([...assets.values()]) } catch (error) { errors.push(error.message) }
  const settings = sanitizeSettings(tasks[0]?.settings)
  settings.bibliography = [...references.values()].map(formatBibtexEntry).join('\n\n')
  return {
    id: `compilation-${project.id}`, title: `${project.name} — Tổng hợp`, document,
    settings, assets: [...assets.values()], sourceDraft: '', sourceEdited: false,
    sourceDraftBackup: false, activeDocumentTemplateId: tasks[0]?.activeDocumentTemplateId || '',
    sourceTrusted: tasks.every(task => task.sourceTrusted !== false), errors,
  }
}
