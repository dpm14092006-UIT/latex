/* global document, getSelection, innerWidth */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createProject, createTask } from '../src/services/WorkspaceData.js'

const output = 'artifacts/document-frame'
await mkdir(output, { recursive: true })
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const task = createTask('Thiết kế một bản thảo rõ ràng', { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Mở đầu' }] },
  paragraph('Một không gian viết rõ ràng giúp ý tưởng trở thành tài liệu hoàn chỉnh.'),
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Phương pháp nghiên cứu' }] },
  paragraph('Khung tài liệu kết nối cấu trúc nội dung với bố cục trang và bản in.'),
  { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Chỉ tiêu')] }, { type: 'tableCell', content: [paragraph('Kết quả')] }] }] },
] })
task.settings = { ...task.settings, author: 'VietLaTeX Studio', abstractEnabled: true, abstract: 'Trực quan hóa cấu trúc và trang tài liệu.' }
const project = createProject('Không gian nghiên cứu', task)
const longTask = createTask('Bản thảo dài', { type: 'doc', content: [
  ...Array.from({ length: 180 }, (_, index) => paragraph(`Đoạn kiểm tra ${index + 1}`)),
  { type: 'pageBreak' },
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Đường' }, { type: 'text', text: 'dẫn cuối cùng', marks: [{ type: 'bold' }] }] },
] })
project.tasks.push(longTask)
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(project => {
    if (localStorage.getItem('latex-workspace-v1')) return
    localStorage.setItem('latex-workspace-v1', JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write' }))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, project)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.locator('.tiptap').waitFor()
  const toggle = page.getByRole('button', { name: 'Khung tài liệu', exact: true })
  await toggle.click()
  let frame = page.getByRole('complementary', { name: 'Khung tài liệu', exact: true })
  await frame.waitFor()
  assert.equal(await frame.locator('.document-frame-map li').count(), 6)
  await frame.getByRole('button', { name: 'H2 Phương pháp nghiên cứu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap h2')?.contains(getSelection()?.anchorNode))
  assert.equal(await frame.getByRole('button', { name: 'H2 Phương pháp nghiên cứu', exact: true }).getAttribute('aria-current'), 'location')
  await frame.getByRole('button', { name: 'Bảng Bảng dữ liệu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap table')?.contains(getSelection()?.anchorNode))
  await frame.getByRole('button', { name: 'fx E = mc^2', exact: true }).click()
  await page.locator('.tiptap .ProseMirror-selectednode[data-type="block-math"]').waitFor()
  await page.screenshot({ path: `${output}/structure-dark.png` })
  // Editing while the inspector is open updates the map and leaves application shortcuts usable.
  await frame.getByRole('button', { name: 'H2 Phương pháp nghiên cứu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap h2')?.contains(getSelection()?.anchorNode))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.type(' 2026')
  await frame.getByRole('button', { name: 'H2 Phương pháp nghiên cứu 2026', exact: true }).waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.getByRole('textbox', { name: 'Tìm lệnh', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await frame.getByRole('tab', { name: 'Trang & lề', exact: true }).click()
  assert.equal(await page.locator('#frame-panel-structure').getAttribute('hidden'), '')
  assert.equal(await page.locator('#frame-panel-page').isVisible(), true)
  await page.screenshot({ path: `${output}/page-before-settings.png` })
  await frame.getByLabel('Khổ giấy', { exact: true }).selectOption('a5paper')
  await frame.getByLabel('Lề đều (mm)', { exact: true }).fill('')
  await frame.getByLabel('Lề đều (mm)', { exact: true }).pressSequentially('20')
  await frame.getByLabel('In mục lục trong PDF', { exact: true }).check()
  await frame.getByRole('img', { name: 'Sơ đồ trang A5, lề 20 mm', exact: true }).waitFor()
  await page.screenshot({ path: `${output}/page-dark.png` })
  await page.getByRole('button', { name: 'Nền trắng', exact: true }).click()
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${output}/page-light.png` })
  await page.waitForTimeout(600)
  await page.reload()
  await toggle.click()
  frame = page.getByRole('complementary', { name: 'Khung tài liệu', exact: true })
  await frame.getByRole('tab', { name: 'Trang & lề', exact: true }).click()
  assert.equal(await frame.getByLabel('Khổ giấy', { exact: true }).inputValue(), 'a5paper')
  assert.equal(await frame.getByLabel('Lề đều (mm)', { exact: true }).inputValue(), '20')
  assert.equal(await frame.getByLabel('In mục lục trong PDF', { exact: true }).isChecked(), true)
  await page.getByRole('tab', { name: 'Tổng hợp', exact: true }).click()
  assert.equal(await frame.getByLabel('Khổ giấy', { exact: true }).isDisabled(), true)
  await page.getByRole('tab', { name: 'Thiết kế một bản thảo rõ ràng', exact: true }).click()
  // Resizing an open side panel produces a native modal drawer, with a focus trap and Escape.
  await page.setViewportSize({ width: 390, height: 844 })
  frame = page.getByRole('dialog', { name: 'Khung tài liệu', exact: true })
  await frame.waitFor()
  assert.equal(await frame.getAttribute('aria-modal'), 'true')
  assert.equal(await frame.getByLabel('Khổ giấy', { exact: true }).isDisabled(), false)
  await page.screenshot({ path: `${output}/mobile.png` })
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab')
    assert.equal(await frame.evaluate(node => node.contains(document.activeElement)), true)
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#document-frame').count(), 0)
  await toggle.click()
  frame = page.getByRole('dialog', { name: 'Khung tài liệu', exact: true })
  await frame.getByRole('button', { name: 'H1 Mở đầu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap h1')?.contains(getSelection()?.anchorNode))
  assert.equal(await page.locator('#document-frame').count(), 0)
  // Source and preview modes navigate back to the actual manuscript before selecting a block.
  await page.setViewportSize({ width: 1680, height: 1050 })
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await toggle.click()
  frame = page.getByRole('complementary', { name: 'Khung tài liệu', exact: true })
  await frame.getByRole('button', { name: 'H1 Mở đầu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap h1')?.contains(getSelection()?.anchorNode))
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await page.locator('.cm-content').press('End')
  await page.locator('.cm-content').press('Space')
  await frame.getByRole('tab', { name: 'Trang & lề', exact: true }).click()
  await frame.getByText('PDF đang dùng LaTeX riêng.', { exact: false }).waitFor()
  assert.equal(await frame.getByLabel('Khổ giấy', { exact: true }).isDisabled(), true)
  // A long manuscript remains navigable past the initial rendering window; search
  // covers the entire document and does not change the page-layout illustration.
  await page.getByRole('tab', { name: 'Bản thảo dài', exact: true }).click()
  await frame.getByRole('tab', { name: 'Cấu trúc', exact: true }).click()
  assert.equal(await frame.locator('.document-frame-map li').count(), 160)
  await frame.getByRole('button', { name: 'Hiện thêm 22 khối (22 khối còn lại)', exact: true }).click()
  assert.equal(await frame.locator('.document-frame-map li').count(), 182)
  await frame.getByRole('button', { name: '↵ Ngắt trang', exact: true }).waitFor()
  const search = frame.getByRole('searchbox', { name: 'Tìm khối trong tài liệu', exact: true })
  await search.fill('duongdan cuoi')
  assert.equal(await frame.locator('.document-frame-map li').count(), 1)
  await frame.getByRole('button', { name: 'H1 Đườngdẫn cuối cùng', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap h1')?.contains(getSelection()?.anchorNode))
  await search.fill('nội dung không có')
  await frame.getByRole('status').filter({ hasText: 'Không tìm thấy khối phù hợp.' }).waitFor()
  await frame.getByRole('tab', { name: 'Trang & lề', exact: true }).click()
  assert.equal(await frame.locator('.document-frame-mini-body span').count(), 10)
  await page.screenshot({ path: `${output}/long-document-page.png` })
  await frame.getByRole('tab', { name: 'Cấu trúc', exact: true }).click()
  await search.fill('')
  await page.screenshot({ path: `${output}/long-document-structure.png` })
  await frame.getByRole('button', { name: 'Đóng khung tài liệu', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Bảng lệnh', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tìm lệnh', exact: true }).fill('Khung tài liệu')
  assert.equal(await page.locator('#workspace-navigation').isVisible(), false, 'launching an action dismisses the mobile navigation drawer')
  await page.getByRole('button', { name: 'Khung tài liệu: cấu trúc, trang và lề', exact: true }).click()
  frame = page.getByRole('dialog', { name: 'Khung tài liệu', exact: true })
  await frame.getByRole('searchbox', { name: 'Tìm khối trong tài liệu', exact: true }).fill('duongdan')
  await frame.getByRole('button', { name: 'H1 Đườngdẫn cuối cùng', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tiptap h1')?.contains(getSelection()?.anchorNode))
  assert.equal(await page.locator('.mono-shell').getAttribute('inert'), null)
  await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.getByRole('textbox', { name: 'Tìm lệnh', exact: true }).waitFor()
  assert.equal(await page.locator('#workspace-navigation').isVisible(), false, 'the command keyboard shortcut also dismisses the mobile drawer')
  await page.keyboard.press('Escape')
  // Drawer actions that open other dialogs also release the document background.
  await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Tài liệu mới', exact: true }).first().click()
  assert.equal(await page.locator('#workspace-navigation').isVisible(), false)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.mono-shell').getAttribute('inert'), null)
  assert.deepEqual(errors, [])
  console.log('Document frame UI passed: live map, exact selection, settings persistence, summary/source locks, keyboard, responsive drawer, light/dark layout, complete long-document navigation and accent-insensitive search.')
} finally {
  await browser?.close()
  await server.close()
}
