/* global DataTransfer, ClipboardEvent, document, requestAnimationFrame */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { unzipSync, strFromU8 } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { importWordAst, toWordAst } from '../src/services/WordDocument.js'
import { tableNoteContent } from '../src/services/TableNoteContent.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const primary = process.platform === 'darwin' ? 'Meta' : 'Control'
const output = process.env.TABLE_NOTE_OUTPUT || 'artifacts/table-note-math'
await mkdir(output, { recursive: true })
const noteText = String.raw`The $\mathrm{NO}_2$ extraction scale does not represent TROPOMI's native observation resolution. For Q3/2026, CHIRPS observations covered July–August.`
const cell = (type, text) => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const makeTable = (caption, note) => ({ type: 'table', attrs: { caption, note }, content: [
  { type: 'tableRow', content: ['Indicator', 'Resolution'].map(text => cell('tableHeader', text)) },
  { type: 'tableRow', content: ['TROPOMI', '1 km'].map(text => cell('tableCell', text)) },
] })
const doc = { type: 'doc', content: [makeTable('Satellite indicators', noteText), makeTable('Second table', 'Other note'), { type: 'paragraph', content: [{ type: 'text', text: 'After tables' }] }] }
const project = createProject('Table note equations', createTask('Note editing', doc))
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser, backend
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1450, height: 1100 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(project => {
    if (!localStorage.getItem('latex-workspace-v1')) localStorage.setItem('latex-workspace-v1', JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write' }))
    localStorage.setItem('latex-theme-default-migrated', '1')
    localStorage.setItem('latex-theme', 'light')
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, project)
  await page.goto(server.resolvedUrls.local[0])
  const root = page.locator('.tiptap')
  const notes = page.getByRole('textbox', { name: 'Ghi chú bảng', exact: true })
  const first = notes.nth(0)
  const focusEnd = async note => {
    await note.evaluate(element => element.editor.commands.focus('end'))
    await note.evaluate(element => new Promise(resolve => requestAnimationFrame(() => resolve(document.activeElement === element)))).then(focused => assert.equal(focused, true))
  }
  await first.locator('.katex').waitFor()
  assert.equal(await root.count(), 1, 'nested note editors must not become document pagination roots')
  const data = () => root.evaluate(element => element.editor.getJSON())
  assert.equal((await data()).content[0].attrs.note, noteText, 'viewing an existing equation must not rewrite its saved note')
  assert.equal(await first.locator('.katex-error').count(), 0)
  assert.equal(await notes.nth(1).innerText(), 'Other note')

  const fillFormula = async (formula, editing = false) => {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'LaTeX', exact: true }).click()
    await dialog.locator('textarea:visible').fill(formula)
    assert.equal(await dialog.getByRole('button', { name: /Căn giữa/ }).count(), 0, 'table notes use inline equations')
    await dialog.getByRole('button', { name: editing ? 'Lưu công thức' : 'Chèn công thức', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  // Edit the existing equation using the normal visual/LaTeX formula dialog.
  await first.locator('[data-type="inline-math"]').click()
  await page.locator('math-field').waitFor()
  assert.equal(await page.locator('math-field').evaluate(element => element.value), String.raw`\mathrm{NO}_2`)
  await fillFormula(String.raw`\mathrm{NO}_2^2`, true)
  assert.match((await data()).content[0].attrs.note, /NO\}_2\^2/)
  await first.focus()
  await page.keyboard.press(`${primary}+z`)
  assert.equal((await data()).content[0].attrs.note, noteText, 'one undo restores the original equation')
  await page.keyboard.press(`${primary}+Shift+z`)
  assert.match((await data()).content[0].attrs.note, /NO\}_2\^2/)
  await page.keyboard.press(`${primary}+z`)

  // The inline button inserts at the note's own caret, without touching cells.
  await focusEnd(first)
  await page.keyboard.insertText(' Budget ')
  await page.getByRole('button', { name: 'Chèn công thức vào ghi chú', exact: true }).nth(0).click()
  await fillFormula(String.raw`p = \frac{n+k}{N}`)
  assert.match((await data()).content[0].attrs.note, /Budget \$p = \\frac\{n\+k\}\{N\}\$/)
  assert.equal((await data()).content[0].content[1].content[0].content[0].content[0].text, 'TROPOMI')

  // The document shortcut must route to the focused note, including another table.
  await focusEnd(notes.nth(1))
  await page.keyboard.press(`${primary}+Shift+m`)
  await fillFormula('x^2+1')
  assert.equal((await data()).content[1].attrs.note, 'Other note$x^2+1$', JSON.stringify((await data()).content.map(node=>node.attrs?.note)))

  // Clicking the normal ribbon tool must keep the note's saved caret.
  await focusEnd(notes.nth(1))
  await page.getByRole('button', { name: 'Chèn công thức toán học', exact: true }).click()
  await fillFormula('y_1')
  assert.equal((await data()).content[1].attrs.note, 'Other note$x^2+1$$y_1$')
  await focusEnd(notes.nth(1))
  await page.keyboard.insertText(' H₂')
  assert.equal(await notes.nth(1).locator('[data-type="inline-math"]').count(), 2, 'typing waits for the complete chemical token')
  await page.keyboard.insertText('O ')
  assert.equal(await notes.nth(1).locator('[data-type="inline-math"]').count(), 3)

  // Pasted inline math and Unicode chemical scripts render inside the note.
  await first.evaluate(element => {
    element.editor.commands.focus('end')
    const transfer = new DataTransfer()
    transfer.setData('text/plain', String.raw` with $\alpha+\beta$ and SO₄²⁻; prices $5 and $10.`)
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  })
  assert.equal(await first.locator('[data-type="inline-math"]').count(), 4)
  assert.match(await first.innerText(), /prices \$5 and \$10/)
  assert.equal(await first.locator('.katex-error').count(), 0)

  // Reject an oversized note without losing existing text, formula or selection.
  const beforeLimit = (await data()).content[0].attrs.note
  await first.evaluate(element => element.editor.commands.insertContent('x'.repeat(2001)))
  assert.equal((await data()).content[0].attrs.note, beforeLimit)
  await page.getByRole('button', { name: 'Chèn công thức vào ghi chú', exact: true }).nth(0).click()
  const oversizedDialog = page.getByRole('dialog')
  await oversizedDialog.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await oversizedDialog.locator('textarea:visible').fill('x'.repeat(2001))
  await oversizedDialog.getByRole('button', { name: 'Chèn công thức', exact: true }).click()
  assert.match(await oversizedDialog.getByRole('alert').innerText(), /2.000/)
  assert.equal((await data()).content[0].attrs.note, beforeLimit)
  await oversizedDialog.getByRole('button', { name: 'Đóng', exact: true }).click()

  // A read-only compilation view must also lock the nested note editors.
  await root.evaluate(element => element.editor.setEditable(false))
  await page.waitForFunction(() => document.querySelector('.table-note-content').getAttribute('contenteditable') === 'false')
  assert.equal(await page.locator('.table-note-formula').nth(0).isDisabled(), true)
  await first.evaluate(element => element.editor.commands.insertContent('Should not be saved'))
  assert.equal((await data()).content[0].attrs.note, beforeLimit)
  await root.evaluate(element => element.editor.setEditable(true))
  await page.waitForFunction(() => document.querySelector('.table-note-content').getAttribute('contenteditable') === 'true')

  const finalDoc = await data()
  await writeFile(`${output}/document.json`, JSON.stringify(finalDoc, null, 2))
  await page.locator('.styled-table').nth(0).screenshot({ path: `${output}/note-editor.png` })
  // Local autosave/reload must keep the inline math, not its visual text only.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].document.content[0].attrs.note.includes('prices'))
  await page.reload()
  await first.locator('.katex').first().waitFor()
  assert.equal((await data()).content[0].attrs.note, beforeLimit)
  await focusEnd(root)
  await page.keyboard.press(`${primary}+Shift+m`)
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: /Căn giữa/ }).count(), 1, 'leaving a note restores normal document formula insertion')
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click()

  backend = await startGoBackendForTests()
  const { latex } = toLatex(finalDoc, 'Table note math')
  assert.ok(latex.includes(String.raw`$p = \frac{n+k}{N}$`))
  const pdf = await backend.compileLatex(latex, [], { fresh: true })
  await writeFile(`${output}/note.pdf`, pdf)
  const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
  try {
    const document = await loading.promise
    const page = await document.getPage(1)
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ')
    assert.match(text, /extraction scale/)
    assert.doesNotMatch(text, /\\mathrm|\\frac|\$p/)
    const viewport = page.getViewport({ scale: 1.8 })
    const canvas = createCanvas(viewport.width, viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    await writeFile(`${output}/note-pdf.png`, canvas.toBuffer('image/png'))
  } finally { await loading.destroy() }

  const exported = await backend.convertWord('export', toWordAst(finalDoc, 'Table note math'))
  await writeFile(`${output}/note.docx`, exported.bytes)
  const xml = strFromU8(unzipSync(exported.bytes)['word/document.xml'])
  assert.ok((xml.match(/<m:oMath>/g) || []).length >= 5, 'DOCX must contain native editable Office equations')
  const { ast } = await backend.convertWord('import', exported.bytes)
  const imported = await importWordAst(ast)
  const allNodes = node => [node, ...(node.content || []).flatMap(allNodes)]
  const math = allNodes(imported.document).filter(node => node.type === 'inlineMath')
  assert.ok(math.length >= 5, 'equations must survive an actual Word round trip')
  assert.ok(math.some(node => /frac/.test(node.attrs.latex)))
  assert.deepEqual(errors, [])
  assert.equal(tableNoteContent('prices $5 and $10').some(node => node.type === 'inlineMath'), false)
  console.log('PASS note equations: existing source, visual editing, caret insertion, undo/redo, two tables, shortcut, paste, currency, size limit, autosave/reload, real PDF and native DOCX equations/roundtrip.')
} finally {
  await backend?.close()
  await browser?.close()
  await server.close()
}
