import test from 'node:test'
import assert from 'node:assert/strict'
import { compileProject } from '../src/services/ProjectCompilation.js'
import { createTask, createProject, editWorkspace, sanitizeWorkspace, mergeWorkspace } from '../src/services/WorkspaceData.js'
import { toLatex } from '../src/services/DocumentSerializer.js'

const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const fixture = () => {
  const project = createProject('Luận văn', createTask('Mở đầu', doc('Nội dung A')))
  project.tasks.push(createTask('Kết luận', doc('Nội dung B')))
  return { projects: [project], activeProjectId: project.id }
}

test('compilation preserves order, math and source documents; one LaTeX wrapper', () => {
  const workspace = fixture(), project = workspace.projects[0]
  project.tasks[1].compilationPageBreak = true
  project.tasks[1].document.content.push({ type: 'blockMath', attrs: { latex: 'x^2' } })
  const before = structuredClone(project)
  const result = compileProject(project)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.document.content.map(node => node.type), ['paragraph', 'pageBreak', 'paragraph', 'blockMath'])
  const latex = toLatex(result.document, result.title, undefined, result.settings).latex
  assert.equal(latex.match(/\\begin\{document\}/g).length, 1)
  assert.ok(latex.indexOf('Nội dung A') < latex.indexOf('Nội dung B'))
  assert.match(latex, /x\^2/)
  assert.deepEqual(project, before)
})

test('selection, page breaks and order survive save, import and duplication', () => {
  let workspace = fixture(), project = workspace.projects[0], task = project.tasks[1]
  workspace = editWorkspace(workspace, 'move-task-left', project.id, task.id)
  workspace = editWorkspace(workspace, 'include-compilation', project.id, task.id)
  workspace = editWorkspace(workspace, 'page-break-compilation', project.id, task.id)
  const restored = sanitizeWorkspace(JSON.parse(JSON.stringify(workspace)))
  assert.equal(restored.projects[0].tasks[0].id, task.id)
  assert.equal(restored.projects[0].tasks[0].includeInCompilation, false)
  assert.equal(restored.projects[0].tasks[0].compilationPageBreak, true)
  assert.equal(compileProject(restored.projects[0]).document.content.length, 1)
  const imported = mergeWorkspace(restored, restored)
  assert.equal(imported.projects[1].tasks[0].includeInCompilation, false)
  const copy = editWorkspace(restored, 'duplicate-project', project.id)
  assert.equal(copy.projects[1].tasks[0].compilationPageBreak, true)
})

test('combines references/assets, deduplicates identical entries, rejects collisions and raw source', () => {
  const project = fixture().projects[0]
  for (const task of project.tasks) {
    task.settings.bibliography = '@book{ref, title={A}, author={Nguyen}, year={2025}}'
    task.assets = [{ filename: 'notes.txt', data: btoa('same') }]
  }
  const result = compileProject(project)
  assert.deepEqual(result.errors, [])
  assert.equal(result.assets.length, 1)
  assert.equal((result.settings.bibliography.match(/@book/g) || []).length, 1)
  project.tasks[1].settings.bibliography = '@book{ref, title={B}}'
  project.tasks[1].assets[0].data = btoa('different')
  project.tasks[1].sourceEdited = true
  assert.equal(compileProject(project).errors.length, 3)
  project.tasks.forEach(task => { task.includeInCompilation = false })
  assert.match(compileProject(project).errors.join(' '), /ít nhất một tab/)
})
