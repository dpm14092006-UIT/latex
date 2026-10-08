import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { MAX_LATEX_SOURCE_BYTES } from '../src/services/DocumentLimits.js'
/* global window, getComputedStyle */

const ref = 'Avogaro, A., Capogrosso, L., Fummi, F., Cristani, M. (2025). MDiFF: Exploiting Multimodal Score-Based Diffusion Models for New Fashion Product Performance Forecasting. In: Del Bue, A., Canton, C., Pont-Tuset, J., Tommasi, T. (eds) Computer Vision – ECCV 2024 Workshops. ECCV 2024. Lecture Notes in Computer Science, vol 15623. Springer, Cham. https://doi.org/10.1007/978-3-031-91569-7_21'
const manuscript = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Giữ văn bản ' }, { type: 'citation', attrs: { key: 'smith2025' } },
  { type: 'text', text: ' và ' }, { type: 'citation', attrs: { key: 'lee2024' } },
] }] }
const bibliography = '@book{smith2025,author={Smith, John},year={2025},title={First}}\n@book{lee2024,author={Lee, Jane},year={2024},title={Second}}'
const draft = createTask('Bản thảo kiểm tra', manuscript)
draft.settings.bibliography = bibliography
const manual = createTask('Source riêng kiểm tra', manuscript)
manual.settings.bibliography = bibliography
manual.sourceEdited = true
manual.sourceTrusted = false
manual.sourceDraft = String.raw`\documentclass{article}
\begin{document}
Source retained \cite{smith2025}.
\end{document}`
const project = createProject('Review fixes', draft)
project.tasks.push(manual)
const server = await createServer({ server: { host: '127.0.0.1', port: 5192, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/doi', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Offline regression' }) }))
  await page.route('**/api/latex/parse', route => {
    const source = route.request().postData() || ''
    if (source.includes('% parser failure')) {
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic parse failure' }) })
    }
    if (source.includes('% source-sync-ui')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        'pandoc-api-version': [1, 23, 1], meta: {},
        blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Source parsed from LaTeX' }] }],
      }) })
    }
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Source marker required for this UI test' }) })
  })
  await page.addInitScript(data => {
    if (!localStorage.getItem('latex-workspace-v1')) localStorage.setItem('latex-workspace-v1', JSON.stringify(data))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, { version: 1, projects: [project], activeProjectId: project.id, mode: 'write', activeTab: 'write' })
  await page.goto('http://127.0.0.1:5192')
  const editor = page.locator('.tiptap')
  await editor.waitFor()
  await editor.click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('Mới ')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+Shift+c')
  let insertionDialog = page.getByRole('dialog')
  await insertionDialog.locator('.cite-item').filter({ hasText: 'First' }).getByRole('checkbox').check()
  await insertionDialog.getByLabel('Cách cite', { exact: true }).selectOption('narrative')
  await insertionDialog.getByRole('button', { name: 'Chèn', exact: true }).click()
  await editor.locator('[data-type="citation"]').nth(2).waitFor()
  assert.equal(await editor.locator('[data-type="citation"]').count(), 3)
  assert.ok((await editor.innerText()).includes('Mới Giữ văn bản'))
  await editor.locator('[data-type="citation"]').last().click()
  insertionDialog = page.getByRole('dialog')
  assert.equal(await insertionDialog.getByLabel('Cách cite', { exact: true }).inputValue(), 'narrative')
  await insertionDialog.getByLabel('Cách cite', { exact: true }).selectOption('parenthetical')
  await insertionDialog.getByRole('button', { name: 'Cập nhật', exact: true }).click()
  assert.equal(await editor.locator('[data-type="citation"]').last().getAttribute('data-citation-mode'), 'parenthetical')
  await page.keyboard.press('Control+z')
  assert.equal(await editor.locator('[data-type="citation"]').last().getAttribute('data-citation-mode'), 'narrative')
  await page.keyboard.press('Control+z')
  assert.equal(await editor.locator('[data-type="citation"]').count(), 2)
  await page.keyboard.press('Control+Shift+c')
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Xóa cite trong bản thảo (2)', exact: true }).click()
  assert.equal(await editor.locator('[data-type="citation"]').count(), 0)
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
  await editor.click()
  await page.keyboard.press('Control+z')
  assert.equal(await editor.locator('[data-type="citation"]').count(), 2)
  assert.ok((await editor.innerText()).includes('Mới Giữ văn bản'))

  await page.keyboard.press('Control+Shift+c')
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Thêm tài liệu', exact: true }).click()
  await dialog.locator('#cite-import').fill(ref)
  await dialog.getByRole('button', { name: 'Thêm vào danh mục', exact: true }).click()
  await dialog.getByText(/1 tài liệu được nhận diện từ văn bản vì không tra được DOI/).waitFor()
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].settings.bibliography.includes('Computer Vision – ECCV 2024 Workshops'))
  const bib = await page.evaluate(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects[0].tasks[0].settings.bibliography)
  assert.ok(bib.includes(bibliography))
  assert.ok(bib.includes('year = {2025}'))
  assert.ok(bib.includes('publisher = {Springer}'))

  await page.locator('.mono-doc-item').filter({ hasText: manual.title }).click()
  await editor.click()
  await page.keyboard.press('Control+Shift+c')
  dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByRole('button', { name: 'Xóa cite trong bản thảo (2)', exact: true }).isDisabled(), true)
  await dialog.getByText('PDF đang dùng source riêng.', { exact: false }).waitFor()
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  const source = page.locator('.cm-content')
  await source.waitFor()
  const original = await source.innerText()
  assert.match(original, /Source retained/)
  await source.click()
  await source.press('Control+End')
  await source.evaluate((element, payload) => {
    const clipboardData = new window.DataTransfer()
    clipboardData.setData('text/plain', payload)
    element.dispatchEvent(new window.ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, 'ế'.repeat(Math.ceil(MAX_LATEX_SOURCE_BYTES / 3)))
  await page.getByText('Source LaTeX vượt giới hạn 800 KB.', { exact: false }).waitFor()
  assert.equal(await source.innerText(), original, 'oversized UTF-8 paste leaves the previous source intact')
  await page.keyboard.insertText('\n% allowed edit')
  assert.match(await source.innerText(), /allowed edit/)
  await source.press('Control+z')
  assert.equal(await source.innerText(), original)

  const syncedSource = `${original}\n% source-sync-ui`
  await source.click()
  await source.press('Control+End')
  await page.keyboard.insertText('\n% source-sync-ui')
  await page.getByText('Bản thảo đã được cập nhật từ LaTeX.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
  await editor.getByText('Source parsed from LaTeX', { exact: true }).waitFor()

  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n% parser failure')
  await page.getByText('Chưa cập nhật bản thảo: Synthetic parse failure', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
  assert.ok((await editor.innerText()).includes('Source parsed from LaTeX'), 'parse errors keep the last valid composer content')

  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  const failedSource = page.locator('.cm-content')
  await failedSource.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(syncedSource)
  await page.getByText('Bản thảo đã được cập nhật từ LaTeX.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
  assert.ok((await editor.innerText()).includes('Source parsed from LaTeX'))
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' Draft edit')
  await page.getByText('PDF đang đồng bộ với bản thảo. Source riêng trước đó vẫn được giữ lại.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Khôi phục source riêng', exact: true }).click()
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  assert.match(await page.locator('.cm-content').innerText(), /source-sync-ui/)
  assert.doesNotMatch(await page.locator('.cm-content').innerText(), /parser failure/)

  await page.getByRole('button', { name: 'Dự án mới', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tên dự án', { exact: true }).fill('Khung nghiên cứu')
  await dialog.getByLabel('Tiêu đề tài liệu đầu tiên').fill('Visual Style Forecasting')
  await dialog.getByLabel('Tác giả', { exact: true }).fill('Group 1 – Research Proposal')
  await dialog.getByLabel('Ngày hiển thị').fill('October 2026')
  assert.equal(await dialog.getByLabel('Thêm Abstract vào tài liệu').isChecked(), true)
  await dialog.getByLabel('Nội dung Abstract').fill('Fast fashion forecasting.\n\nMethods and contributions.')
  await dialog.getByLabel('Thêm mục lục sau Abstract').check()
  await dialog.getByRole('button', { name: 'Tạo dự án', exact: true }).click()
  await page.locator('.studio-abstract-heading').waitFor()
  assert.equal(await page.locator('.studio-abstract-heading').evaluate(element => getComputedStyle(element).textAlign), 'center')
  assert.equal(await page.locator('.studio-abstract-preview > p').first().evaluate(element => getComputedStyle(element).textAlign), 'justify')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('latex-workspace-v1')).projects.some(item => item.name === 'Khung nghiên cứu' && item.tasks[0].settings.abstract.includes('Methods')))
  await page.reload()
  await page.locator('.studio-abstract-preview').getByText('Methods and contributions.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sửa Abstract', exact: true }).click()
  dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByLabel('Nội dung Abstract').inputValue(), 'Fast fashion forecasting.\n\nMethods and contributions.')
  await dialog.getByLabel('Tiêu đề phần tóm tắt').selectOption('Tóm tắt')
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  assert.equal(await page.locator('.studio-abstract-heading').innerText(), 'Tóm tắt')
  assert.deepEqual(errors, [])
  console.log('Review fixes UI passed: LaTeX-to-draft sync, failed-parse retention, source backup/restore, bulk cite undo, offline DOI fallback, UTF-8 limits and abstract persistence/alignment.')
} finally {
  await browser?.close()
  await server.close()
}
