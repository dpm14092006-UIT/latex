import test from 'node:test'
import assert from 'node:assert/strict'
import { upgradeSnapshot } from './upgrade-snapshot.mjs'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { normalizeDocumentHeadings } from '../src/services/DocumentSerializer.js'

const fixture = text => {
  const task = createTask('Tài liệu', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const project = createProject('Dự án', task)
  return { version: 1, projects: [project], activeProjectId: project.id }
}
test('upgrade comparison accepts the established numbered-heading representation', () => {
  const before = fixture('3.1 Dữ liệu vệ tinh')
  const after = structuredClone(before)
  after.projects[0].tasks[0].document = normalizeDocumentHeadings(after.projects[0].tasks[0].document)
  after.projects[0].tasks[0].updatedAt += 1000
  assert.deepEqual(upgradeSnapshot(after), upgradeSnapshot(before))
})
test('upgrade comparison detects content, source, bibliography and identity changes', () => {
  const before = fixture('Nội dung phải giữ')
  for (const field of ['text', 'sourceDraft', 'bibliography', 'id']) {
    const after = structuredClone(before), task = after.projects[0].tasks[0]
    if (field === 'text') task.document.content[0].content[0].text = 'Nội dung khác'
    if (field === 'sourceDraft') task.sourceDraft = 'source khác'
    if (field === 'bibliography') task.settings.bibliography = '@article{a,title={Khác}}'
    if (field === 'id') { task.id = 'task-new'; after.projects[0].activeTaskId = task.id }
    assert.notDeepEqual(upgradeSnapshot(after), upgradeSnapshot(before), field)
  }
})
test('upgrade comparison rejects automatic rewriting of existing Unicode prose', () => {
  const before = fixture('Nồng độ NO₂ được đo.')
  const after = structuredClone(before)
  after.projects[0].tasks[0].document.content[0].content = [
    { type: 'text', text: 'Nồng độ ' },
    { type: 'inlineMath', attrs: { latex: String.raw`\mathrm{NO}_{2}` } },
    { type: 'text', text: ' được đo.' },
  ]
  assert.notDeepEqual(upgradeSnapshot(after), upgradeSnapshot(before))
})

test('upgrade preflight rejects raw content that sanitizer would silently drop on both sides', () => {
  for (const corrupt of [
    task => { task.document.content.push({ type: 'unknownBlock', content: [{ type: 'text', text: 'Không được mất' }] }) },
    task => { task.assets = [{ filename: '../hidden.txt', data: 'YWJj' }] },
    task => { task.sourceDraft = { latex: 'original' } },
    task => { task.settings.bibliography = 'x'.repeat(500_001) },
  ]) {
    const raw = fixture('Nội dung gốc')
    corrupt(raw.projects[0].tasks[0])
    assert.throws(() => upgradeSnapshot(raw))
  }
  const duplicate = fixture('Nội dung gốc')
  duplicate.projects[0].tasks.push(structuredClone(duplicate.projects[0].tasks[0]))
  assert.throws(() => upgradeSnapshot(duplicate), /bị bỏ/u)
})

test('upgrade preflight keeps the established h4-h6 migration compatible', () => {
  const raw = fixture('Tiêu đề cũ')
  raw.projects[0].tasks[0].document.content[0] = { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'Tiêu đề cũ' }] }
  assert.equal(upgradeSnapshot(raw).projects[0].tasks[0].document.content[0].attrs.level, 3)
})
