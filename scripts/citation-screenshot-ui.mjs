import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createProject, createTask } from '../src/services/WorkspaceData.js'

const group = '(Adel et al., 2026; Avogaro et al., 2025a, 2025b; Lee et al., 2026; Park et al., 2026; Rajendran & Hong, 2025)'
const task = createTask('Screenshot cite regression', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Newer work extends this direction ${group}. The manuscript remains intact.` }] }] })
task.settings.bibliography = `@article{Adel_2026,author={Adel, A and B, B and C, C},year={2026},title={Demand}}
@inbook{Avogaro_2024,author={Avogaro, A and Capogrosso, L and Fummi, F and Cristani, M},year={2024},title={Dif4FF}}
@inbook{Avogaro_2025,author={Avogaro, A and Capogrosso, L and Fummi, F and Cristani, M},year={2025},title={MDiFF}}
@article{Lee_2026,author={Lee, A and B, B and C, C},year={2026},title={Transformer}}
@article{Park_2026,author={Park, A and B, B and C, C},year={2026},title={Sales}}
@article{Rajendran_2025,author={Rajendran, A and Hong, B},year={2025},title={Forecast}}`
const project = createProject('Screenshot regression', task)
const server = await createServer({ server: { host: '127.0.0.1', port: 5193, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(data => {
    localStorage.setItem('latex-workspace-v1', JSON.stringify(data))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, { version: 1, projects: [project], activeProjectId: project.id, mode: 'write', activeTab: 'write' })
  await page.goto('http://127.0.0.1:5193')
  const editor = page.locator('.tiptap')
  await editor.click()
  await page.keyboard.press('Control+Shift+c')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'Quét trích dẫn', exact: true }).click()
  await dialog.getByRole('button', { name: 'Quét tài liệu', exact: true }).click()
  assert.equal(await dialog.locator('.citation-scan-row').count(), 1)
  await dialog.getByText(/Khớp chính xác 4\/6 nguồn/).waitFor()
  await dialog.getByLabel('Lọc kết quả quét').selectOption('partial')
  assert.equal(await dialog.locator('.citation-scan-row').count(), 1)
  await dialog.getByLabel('Lọc kết quả quét').selectOption('unresolved')
  assert.equal(await dialog.locator('.citation-scan-row').count(), 1)
  const a = dialog.getByLabel('Chọn nguồn cho Avogaro et al., 2025a', { exact: true })
  const b = dialog.getByLabel('Chọn nguồn cho Avogaro et al., 2025b', { exact: true })
  await a.selectOption('Avogaro_2025')
  await b.selectOption('Avogaro_2025')
  assert.equal(await dialog.locator('.citation-scan-selection input').isDisabled(), true)
  await dialog.getByText(/Hãy chọn hai REF khác nhau/).waitFor()
  await a.selectOption('Avogaro_2024')
  assert.equal(await dialog.locator('.citation-scan-selection input').isChecked(), false)
  await dialog.locator('.citation-scan-selection input').check()
  await dialog.getByRole('button', { name: 'Cite 1 vị trí đã duyệt', exact: true }).click()
  assert.equal(await editor.locator('[data-type="citation"]').getAttribute('data-key'), 'Adel_2026,Avogaro_2024,Avogaro_2025,Lee_2026,Park_2026,Rajendran_2025')
  assert.ok((await editor.innerText()).includes('The manuscript remains intact.'))
  await dialog.getByRole('button', { name: 'Hoàn tác liên kết', exact: true }).click()
  assert.ok((await editor.innerText()).includes(group))
  assert.equal(await editor.locator('[data-type="citation"]').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Screenshot group UI passed: 6 sources, partial/unresolved visibility, suffix collision protection, explicit review, linking and undo.')
} finally {
  await browser?.close()
  await server.close()
}
