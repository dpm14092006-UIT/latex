import assert from 'node:assert/strict'
import { primaryKey } from './platform-keys.mjs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createTask, createProject } from '../src/services/WorkspaceData.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
const task = createTask('Chú thích hình', { type: 'doc', content: [
  { type: 'imageBlock', attrs: { src: `data:image/png;base64,${png}`, alt: 'Ảnh cũ' } },
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
  }, fixture)
  await page.goto(server.resolvedUrls.local[0])
  const captions = page.getByRole('textbox', { name: 'Chú thích hình', exact: true })
  await captions.first().waitFor()
  assert.equal(await captions.count(), 1)
  assert.equal(await captions.first().inputValue(), '')
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
  assert.deepEqual(errors, [])
  console.log('Image captions: existing image, upload, editing and reload passed.')
} finally {
  await browser?.close()
  await server.close()
}
