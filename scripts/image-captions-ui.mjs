import assert from 'node:assert/strict'
import { primaryKey } from './platform-keys.mjs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createTask, createProject } from '../src/services/WorkspaceData.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
const task = createTask('Chú thích hình', { type: 'doc', content: [
  { type: 'imageBlock', attrs: { src: `data:image/png;base64,${png}`, alt: 'Ảnh cũ' } },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Forecast' }] }] }] }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Nội dung tiếp theo' }] },
] })
const project = createProject('Kiểm tra ảnh', task)
const fixture = { version: 1, projects: [project], activeProjectId: project.id, mode: 'split', activeTab: 'write', pdfMode: 'manual' }
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.UI_TEST_BROWSER ? { channel: process.env.UI_TEST_BROWSER } : {}) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(data => {
    if (!localStorage.getItem('latex-workspace-v1')) localStorage.setItem('latex-workspace-v1', JSON.stringify(data))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, fixture)
  await page.goto(server.resolvedUrls.local[0])
  const captions = page.getByRole('textbox', { name: 'Chú thích hình', exact: true })
  await captions.first().waitFor()
  assert.equal(await captions.count(), 1)
  assert.equal(await captions.first().inputValue(), '')
  assert.match(await captions.first().getAttribute('placeholder'), /Figure 1/)
  await captions.first().fill('Hình cũ: đồ thị A_B & 50%')
  const storedCaption = () => page.evaluate(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].document.content.find(node => node.type === 'imageBlock')?.attrs.caption)
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].document.content.find(node => node.type === 'imageBlock')?.attrs.caption === 'Hình cũ: đồ thị A_B & 50%')
  assert.equal(await storedCaption(), 'Hình cũ: đồ thị A_B & 50%')
  await page.reload()
  await captions.first().waitFor()
  assert.equal(await captions.first().inputValue(), 'Hình cũ: đồ thị A_B & 50%')
  await page.locator('.tiptap p').last().click()
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'plot.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await captions.nth(1).waitFor()
  assert.equal(await captions.nth(1).inputValue(), '')
  await captions.nth(1).fill('Hình mới')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].document.content.filter(node => node.type === 'imageBlock').some(node => node.attrs.caption === 'Hình mới'))
  await captions.nth(1).press(`${primaryKey}+z`)
  assert.equal(await captions.nth(1).inputValue(), '')
  await captions.nth(1).press(`${primaryKey}+Shift+z`)
  assert.equal(await captions.nth(1).inputValue(), 'Hình mới')
  const tableCaption = page.locator('.table-caption-field input')
  const tableNumber = page.locator('.table-number-field input')
  await tableNumber.fill('???')
  await tableNumber.press('Enter')
  assert.equal(await tableCaption.evaluate(input => input === input.ownerDocument.activeElement), true)
  await tableCaption.fill('Forecast comparison')
  await tableCaption.press(`${primaryKey}+z`)
  assert.equal(await tableCaption.inputValue(), '')
  assert.equal(await tableNumber.inputValue(), '???')
  await tableCaption.press(`${primaryKey}+Shift+z`)
  assert.equal(await tableCaption.inputValue(), 'Forecast comparison')
  await tableNumber.fill('5.2.2')
  await page.waitForFunction(() => {
    const table = JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].document.content.find(node => node.type === 'table')
    return table?.attrs.tableNumber === '5.2.2' && table.attrs.caption === 'Forecast comparison'
  })
  await page.reload()
  await tableCaption.waitFor()
  assert.equal(await tableNumber.inputValue(), '5.2.2')
  assert.equal(await tableCaption.inputValue(), 'Forecast comparison')
  const latex = await page.evaluate(async () => {
    const { toLatex } = await import('/src/services/DocumentSerializer.js')
    const document = JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].document
    return toLatex(document, 'Manual captions').latex
  })
  assert.match(latex, /\\caption\*\{Table 5\.2\.2\. Forecast comparison\}/)
  assert.doesNotMatch(latex, /\\tablename|\\thetable|\\caption\{/)
  await page.locator('.tiptap table td').first().click()
  await page.getByRole('button', { name: 'Chèn', exact: true }).click()
  assert.equal(await page.locator('.studio-table-meta-field input[aria-label="Table No."]').inputValue(), '5.2.2')
  await page.getByRole('button', { name: 'Kiểu bảng', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Thư viện bảng', exact: true })
  await library.getByRole('textbox', { name: 'Table No.', exact: true }).fill('S1')
  await library.getByRole('textbox', { name: 'Caption', exact: true }).click()
  assert.ok((await library.locator('.table-library-code').innerText()).includes('\\caption*{Table S1. Forecast comparison}'))
  await library.getByRole('button', { name: 'Xong', exact: true }).click()
  assert.equal(await tableNumber.inputValue(), 'S1')
  assert.equal(await tableCaption.inputValue(), 'Forecast comparison')
  assert.deepEqual(errors, [])
  console.log('Manual captions: image upload, table numbering, undo/redo, reload and LaTeX output passed.')
} finally {
  await browser?.close()
  await server.close()
}
