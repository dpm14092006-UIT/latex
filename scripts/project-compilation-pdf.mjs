import assert from 'node:assert/strict'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createTask, createProject } from '../src/services/WorkspaceData.js'
import { compileProject } from '../src/services/ProjectCompilation.js'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const text = value => ({ type: 'text', text: value })
const document = (title, formula, label) => ({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [text(title)] },
  { type: 'paragraph', content: [text('This section belongs to the combined manuscript.')] },
  { type: 'blockMath', attrs: { latex: formula, label } },
] })
const project = createProject('Combined manuscript', createTask('First', document('First section', 'x=1', 'eq:first')))
project.tasks.push(createTask('Second', document('Second section', 'y=2', 'eq:second')))
project.tasks[1].compilationPageBreak = true
project.tasks[0].settings.numberedEquations = true
project.tasks[1].document.content.push({ type: 'paragraph', content: [text('See equation '), { type: 'crossReference', attrs: { target: 'eq:first' } }] })
const summary = compileProject(project)
assert.deepEqual(summary.errors, [])
const serialization = toLatex(summary.document, summary.title, undefined, summary.settings)
const backend = await startGoBackendForTests()
let loading
try {
  const bytes = await backend.compileLatex(serialization.latex, serialization.images, { fresh: true })
  loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await loading.promise
  assert.equal(pdf.numPages, 2)
  const pages = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index)
    pages.push((await page.getTextContent()).items.map(item => item.str).join(' '))
  }
  assert.match(pages[0], /First section/)
  assert.match(pages[0], /\(1\)/)
  assert.match(pages[1], /Second section/)
  assert.match(pages[1], /\(2\)/)
  assert.match(pages[1], /See equation\s+1/)
  assert.doesNotMatch(pages.join(' '), /\?\?/)
  console.log('Real compilation PDF passed: two tabs, page break, continuous equation numbering and cross-tab reference.')
} finally {
  await loading?.destroy()
  await backend.close()
}
