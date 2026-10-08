/* global window, document, NodeFilter, DataTransfer, ClipboardEvent */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createTask, createProject } from '../src/services/WorkspaceData.js'
import { normalizeDocumentSpacing } from '../src/services/DocumentSpacing.js'
const previewTextKey = text => String(text || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase()

const output = resolve('artifacts/preview-layout')
await mkdir(output, { recursive: true })
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-preview-layout-'))
const para = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const prose = 'Chỉ số thực vật được đo theo quý. Dữ liệu vệ tinh có độ phân giải 250 m, phù hợp với nghiên cứu kinh tế tại Việt Nam. '
const task = createTask('Đồng bộ bản thảo', { type: 'doc', content: Array.from({ length: 24 }, (_, i) => para(`Đoạn ${i + 1}. ` + prose.repeat(4).replace(/ /g, '\u00a0'))) })
const project = createProject('Kiểm tra bố cục', task)
const fixture = process.env.PREVIEW_WORKSPACE
  ? JSON.parse(await readFile(process.env.PREVIEW_WORKSPACE, 'utf8'))
  : { version: 1, projects: [project], activeProjectId: project.id }
fixture.mode = 'split'
await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify(fixture))
const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_HIDE_WINDOW: 'true', VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_WARM_TEX: '0' }
delete env.ELECTRON_RUN_AS_NODE
let child, browser, page, loading
try {
  const allocator = createServer()
  await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
  const port = allocator.address().port
  await new Promise(resolve => allocator.close(resolve))
  const executable = process.env.DESKTOP_EXE || createRequire(import.meta.url)('electron')
  child = spawn(executable, [...(process.env.DESKTOP_EXE ? [] : ['.']), '--remote-debugging-port=' + port, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.resume(); child.stderr.resume()
  const deadline = Date.now() + 45000
  while (!browser && Date.now() < deadline && child.exitCode === null) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 1000 }) } catch { await new Promise(resolve => setTimeout(resolve, 150)) }
  }
  assert.ok(browser, 'application starts')
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0]?.pages().find(p => p.url().startsWith('vietlatex:'))
    if (!page) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(page, 'renderer starts')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('.tiptap').waitFor()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => { const url = original(blob); if (blob.type === 'application/pdf') window.previewTestPdfUrl = url; return url }
  })
  const openTools = page.getByRole('button', { name: 'Mở công cụ PDF', exact: true })
  if (await openTools.count()) await openTools.click()
  await page.getByRole('combobox', { name: 'Chế độ cập nhật PDF', exact: true }).selectOption('live')
  // Incoming LAN documents keep their trust gate. Only this isolated, known
  // prose fixture is approved for the PDF layout regression.
  const trustFixture = page.getByRole('button', { name: 'Tin cậy và biên dịch', exact: true })
  if (await trustFixture.count()) await trustFixture.click()
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.waitForFunction(() => Boolean(window.previewTestPdfUrl), undefined, { timeout: 90000 })
  const currentProject = fixture.projects.find(p => p.id === fixture.activeProjectId)
  const current = currentProject.tasks.find(t => t.id === currentProject.activeTaskId)
  const expected = normalizeDocumentSpacing(current.document)
  const actual = await page.locator('.tiptap').evaluate(el => el.editor.getJSON())
  const textOf = doc => (doc.content || []).map(n => (n.content || []).filter(c => c.type === 'text').map(c => c.text).join('')).join('')
  assert.equal(textOf(actual), textOf(expected), 'opening repairs spaces without losing letters or word separators')
  const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(window.previewTestPdfUrl)).arrayBuffer()))))
  await writeFile(join(output, 'preview.pdf'), bytes)
  loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await loading.promise
  let pdfText = '', items = 0
  const overflows = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const p = await pdf.getPage(number), viewport = p.getViewport({ scale: 1 })
    const content = await p.getTextContent()
    for (const item of content.items) {
      if (!item.str?.trim()) continue
      pdfText += item.str
      items++
      if (item.transform[4] < 40 || item.transform[4] + item.width > viewport.width - 40) overflows.push({ page: number, x: item.transform[4], width: item.width })
    }
  }
  assert.deepEqual(overflows, [], 'PDF text stays inside the page margins')
  const key = previewTextKey(pdfText)
  for (const node of expected.content.filter(n => n.type === 'paragraph')) {
    const value = previewTextKey((node.content || []).filter(c => c.type === 'text').map(c => c.text).join(''))
    if (value.length < 120) continue
    for (const fragment of [value.slice(0, 24), value.slice(-24)]) assert.ok(key.includes(fragment), 'PDF includes the beginning and end of each long paragraph')
  }
  await page.waitForFunction(() => document.querySelector('.studio-pdf-page canvas')?.width > 100 && !document.querySelector('.studio-pdf-page-loading'), undefined, { timeout: 45000 })
  // Inspect every glyph, including the first character after each page spacer.
  const clipped = await page.locator('.tiptap').evaluate(el => {
    const bounds = el.getBoundingClientRect(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const failures = [], range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('.studio-page-spacer')) continue
      for (let i = 0; i < node.textContent.length; i++) {
        if (/\s/u.test(node.textContent[i])) continue
        range.setStart(node, i); range.setEnd(node, i + 1)
        for (const rect of range.getClientRects()) if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) failures.push({ x: rect.x, right: rect.right })
      }
    }
    return failures.slice(0, 10)
  })
  assert.deepEqual(clipped, [], 'editor glyphs stay inside the text column')
  await page.waitForTimeout(500)
  assert.equal(await page.getByRole('button', { name: 'Đồng bộ cuộn bản thảo và PDF', exact: true }).count(), 0, 'scroll synchronization was removed')
  const initialPdfScroll = await page.locator('.studio-pdf-canvas').evaluate(el => el.scrollTop)
  await page.locator('.studio-paper-stage').evaluate(el => el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * .6, behavior: 'instant' }))
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.studio-pdf-canvas').evaluate(el => el.scrollTop), initialPdfScroll, 'editor scroll leaves PDF independent')
  const initialEditorScroll = await page.locator('.studio-paper-stage').evaluate(el => el.scrollTop)
  await page.locator('.studio-pdf-canvas').evaluate(el => el.scrollTo({ top: 100, behavior: 'instant' }))
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.studio-paper-stage').evaluate(el => el.scrollTop), initialEditorScroll, 'PDF scroll leaves editor independent')
  await page.getByRole('combobox', { name: 'Thu phóng PDF', exact: true }).selectOption('1.25')
  await page.waitForTimeout(300)
  const zoomGeometry = await page.locator('.studio-pdf-canvas').evaluate(stage => {
    const rect = stage.getBoundingClientRect()
    const pages = Array.from(stage.querySelectorAll('[data-pdf-page]')).map(el => el.getBoundingClientRect())
    return { clippedLeft: pages.some(p => p.left < rect.left - 1), widths: pages.map(p => p.width) }
  })
  assert.equal(zoomGeometry.clippedLeft, false, 'zoomed PDF left edge remains reachable')
  assert.ok(Math.max(...zoomGeometry.widths) - Math.min(...zoomGeometry.widths) < 2, 'placeholder and rendered pages use identical scaled dimensions')
  await page.getByRole('combobox', { name: 'Thu phóng PDF', exact: true }).selectOption('1')
  await page.getByRole('button', { name: 'Nền trắng', exact: true }).click()
  await page.screenshot({ path: join(output, 'preview.png') })
  // Check paste handling and automatic compile by editing the end of the document.
  const oldUrl = await page.evaluate(() => window.previewTestPdfUrl)
  await page.locator('.tiptap').evaluate(el => {
    el.editor.commands.focus('end')
    const data = new DataTransfer()
    data.setData('text/html', '<p>Đồng&nbsp;bộ&nbsp;mới&nbsp;được&nbsp;kiểm&nbsp;tra&nbsp;đầy&nbsp;đủ.</p>')
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  })
  await page.waitForFunction(old => window.previewTestPdfUrl !== old, oldUrl, { timeout: 45000 })
  await page.waitForTimeout(400)
  assert.ok(await page.locator('.studio-paper-stage').evaluate(el => el.scrollTop) > 100, 'PDF reload preserves the manuscript position')
  assert.ok((await page.locator('.tiptap').evaluate(el => JSON.stringify(el.editor.getJSON()))).includes('Đồng bộ mới được kiểm tra đầy đủ.'))
  const newest = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(window.previewTestPdfUrl)).arrayBuffer()))))
  const latestLoading = getDocument({ data: new Uint8Array(newest), useSystemFonts: true })
  const latestPdf = await latestLoading.promise
  let latestText = ''
  for (let number = 1; number <= latestPdf.numPages; number++) latestText += (await (await latestPdf.getPage(number)).getTextContent()).items.map(item => item.str || '').join('')
  assert.ok(previewTextKey(latestText).includes(previewTextKey('Đồng bộ mới được kiểm tra đầy đủ.')), 'automatic PDF contains the latest edit')
  await latestLoading.destroy()
  await page.locator('.studio-paper-stage').evaluate(el => el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * .7, behavior: 'instant' }))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(output, 'preview.png') })
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ pages: pdf.numPages, items, overflows, clipped, independentScrolling: true, automaticUpdate: true, errors }, null, 2))
  console.log('Preview regression passed: repaired NBSP, complete PDF text inside margins, editor glyph bounds, independent scrolling, paste and automatic PDF refresh.')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await loading?.destroy()
  await browser?.close().catch(() => {})
  if (child) {
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve))
    clearTimeout(timer)
  }
  await rm(userData, { recursive: true, force: true })
}
