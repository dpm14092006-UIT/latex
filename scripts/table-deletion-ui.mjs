import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createTask, createProject } from '../src/services/WorkspaceData.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const cell = (type, text) => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const values = [
  ['Source', 'Column to delete', 'GDP', 'Year'],
  ['UOB', 'Removed forecast A', '6.8', '2026'],
  ['MBS', 'Removed forecast B', '8.7', '2026'],
  ['SSI', 'Removed forecast C', '9.3', '2026'],
]
const table = { type: 'table', attrs: { tableNumber: '5.2.2', caption: 'Forecast comparison' }, content: values.map((row, index) => ({ type: 'tableRow', content: row.map(value => cell(index ? 'tableCell' : 'tableHeader', value)) })) }
const task = createTask('Table deletion', { type: 'doc', content: [table, { type: 'paragraph', content: [{ type: 'text', text: 'After table' }] }] })
const project = createProject('Table editing', task)
const fixture = { version: 1, projects: [project], activeProjectId: project.id, mode: 'write', activeTab: 'write' }
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser, backend
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(data => {
    if (!localStorage.getItem('latex-workspace-v1')) localStorage.setItem('latex-workspace-v1', JSON.stringify(data))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, fixture)
  await page.goto(server.resolvedUrls.local[0])
  const root = page.locator('.tiptap')
  await root.locator('table').waitFor()
  const grid = () => root.evaluate(element => {
    const table = element.editor.state.doc.firstChild
    return table.type.name === 'table' ? table.content.content.map(row => row.content.content.map(cell => cell.textContent)) : null
  })
  const select = (fromRow, fromCol, toRow, toCol) => root.evaluate((element, rect) => {
    const editor = element.editor
    const cells = []
    editor.state.doc.firstChild.forEach((row, rowOffset) => {
      const positions = []
      row.forEach((cell, offset) => positions.push(rowOffset + offset + 2))
      cells.push(positions)
    })
    editor.view.focus()
    editor.commands.setCellSelection({ anchorCell: cells[rect[0]][rect[1]], headCell: cells[rect[2]][rect[3]] })
  }, [fromRow, fromCol, toRow, toCol])
  const undo = () => root.evaluate(element => element.editor.commands.undo())

  assert.equal(await page.locator('.table-number-field input').getAttribute('placeholder'), '')
  const original = await root.locator('table').boundingBox()
  await select(0, 1, 3, 1)
  await page.keyboard.press('Delete')
  assert.deepEqual(await grid(), values.map(row => row.filter((_, index) => index !== 1)))
  const narrower = await root.locator('table').boundingBox()
  assert.ok(narrower.width < original.width - 30, `${original.width} -> ${narrower.width}`)
  const latex = await root.evaluate(async element => {
    const { toLatex } = await import('/src/services/DocumentSerializer.js')
    return toLatex(element.editor.getJSON(), 'Deleted column').latex
  })
  assert.doesNotMatch(latex, /Column to delete|Removed forecast/)
  assert.ok(latex.includes('UOB & 6.8 & 2026'))
  assert.ok(latex.includes('Table 5.2.2. Forecast comparison'))
  await undo()
  assert.deepEqual(await grid(), values)

  await select(1, 0, 2, 3)
  await page.keyboard.press('Backspace')
  assert.deepEqual(await grid(), [values[0], values[3]])
  assert.ok((await root.locator('table').boundingBox()).height < original.height - 20)
  const deletedRowsLatex = await root.evaluate(async element => {
    const { toLatex } = await import('/src/services/DocumentSerializer.js')
    return toLatex(element.editor.getJSON(), 'Deleted rows').latex
  })
  backend = await startGoBackendForTests()
  const bytes = await backend.compileLatex(deletedRowsLatex, [], { fresh: true })
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  try {
    const pdf = await loading.promise
    const items = (await (await pdf.getPage(1)).getTextContent()).items
    const header = items.find(item => item.str === 'Source')
    const remainingRow = items.find(item => item.str === 'SSI')
    assert.ok(header && remainingRow)
    assert.ok(Math.abs(header.transform[5] - remainingRow.transform[5]) < 35, 'deleted rows must leave no blank gap in PDF')
    assert.doesNotMatch(items.map(item => item.str).join(' '), /UOB|MBS/)
  } finally { await loading.destroy() }
  await undo()
  assert.deepEqual(await grid(), values)

  // A partial rectangle clears its contents without deleting unrelated cells.
  await select(1, 1, 2, 2)
  await page.keyboard.press('Delete')
  assert.deepEqual(await grid(), values.map((row, r) => row.map((value, c) => r >= 1 && r <= 2 && c >= 1 && c <= 2 ? '' : value)))
  await undo()

  // Ordinary text editing still deletes one character inside the cell.
  await root.evaluate(element => { element.editor.view.focus(); element.editor.commands.setTextSelection(4) })
  await page.keyboard.press('Delete')
  assert.equal((await grid())[0][0], 'ource')
  await undo()

  await select(0, 0, 3, 3)
  await page.keyboard.press('Delete')
  assert.equal(await root.locator('table').count(), 0)
  await undo()
  assert.deepEqual(await grid(), values)

  // Explicit full-page layout remains full width after structural deletion.
  await select(0, 1, 3, 1)
  await root.evaluate(element => element.editor.commands.updateAttributes('table', { tableWidth: 'full' }))
  const full = await root.locator('table').boundingBox()
  await page.keyboard.press('Delete')
  assert.equal((await grid())[0].length, 3)
  assert.ok(Math.abs((await root.locator('table').boundingBox()).width - full.width) < 2)
  assert.deepEqual(errors, [])
  console.log('Table deletion: full rows/columns shrink, real PDF has no deleted-row gap, partial cells/text, undo and full-width layout passed.')
} finally {
  await backend?.close()
  await browser?.close()
  await server.close()
}
