import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { createServer } from 'vite'
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { primaryKey } from './platform-keys.mjs'

const userData = await mkdtemp(join(tmpdir(), 'vietlatex-e2e-'))
const output = resolve(process.env.DESKTOP_SMOKE_OUTPUT || 'artifacts/desktop-smoke')
const captureScreenshots = process.env.DESKTOP_SMOKE_SCREENSHOTS === '1'
if (captureScreenshots) await mkdir(output, { recursive: true })
let server, app
const errors = []
const env = { ...process.env, VIETLATEX_USER_DATA: userData }
if (process.env.DESKTOP_RENDERER_URL) env.ELECTRON_RENDERER_URL = process.env.DESKTOP_RENDERER_URL
delete env.ELECTRON_RUN_AS_NODE
async function launch() {
  if (process.env.DESKTOP_EXE) return electron.launch({ executablePath: process.env.DESKTOP_EXE, env, timeout: 45_000 })
  if (!server && !process.env.DESKTOP_RENDERER_URL && process.env.VIETLATEX_TEST_PACKAGED_RENDERER !== 'true') {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
    await server.listen()
    env.ELECTRON_RENDERER_URL = `http://127.0.0.1:${server.httpServer.address().port}`
  }
  return electron.launch({ args: ['.'], env, timeout: 45_000 })
}
async function rendererWindow() {
  // Development also opens detached DevTools. Wait for the application URL
  // instead of accepting the first transient target from Electron.
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const page = app.windows().find(page => !page.isClosed() && /^(?:vietlatex:|http:\/\/127\.0\.0\.1:)/.test(page.url()))
    if (page) return page
    if (app.process().exitCode !== null) throw new Error(`Electron exited before its renderer was ready (${app.process().exitCode}).`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Electron renderer did not become ready within 45 seconds.')
}
try {
  app = await launch()
  let page = await rendererWindow()
  if (!captureScreenshots) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()))
  await app.evaluate(({ app, session }) => {
    globalThis.testDownloads = []
    session.defaultSession.on('will-download', (_event, item) => {
      const path = `${app.getPath('userData')}/${item.getFilename()}`
      item.setSavePath(path)
      item.once('done', (_event, state) => globalThis.testDownloads.push({ path, state }))
    })
  })
  const runningVersion = await app.evaluate(({ app }) => app.getVersion())
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), `Viết & Công thức — ${runningVersion}`)
  page.on('pageerror', error => errors.push(error.message))
  if (process.env.VIETLATEX_TEST_PACKAGED_RENDERER === 'true') assert.equal(new URL(page.url()).protocol, 'vietlatex:')
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor({ timeout: 30_000 })
  if (process.platform === 'darwin') {
    assert.equal(await page.evaluate(() => window.desktopAPI.platform), 'darwin')
    await page.getByRole('button', { name: 'In đậm (⌘+B)', exact: true }).first().waitFor()
    const draft = page.locator('.tiptap')
    await draft.fill('Phím tắt trên Mac')
    await draft.press(`${primaryKey}+A`)
    await draft.press(`${primaryKey}+B`)
    assert.equal(await draft.locator('strong').innerText(), 'Phím tắt trên Mac')
    await draft.press(`${primaryKey}+Z`)
    assert.equal(await draft.locator('strong').count(), 0)
    await draft.press(`${primaryKey}+Shift+C`)
    const references = page.getByRole('dialog')
    await references.waitFor()
    assert.match(await references.innerText(), /⌘\+Shift\+C/)
    await references.getByRole('button', { name: 'Đóng', exact: true }).click()
    await draft.press(`${primaryKey}+K`)
    await page.getByRole('dialog', { name: 'Bảng lệnh', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Đóng bảng lệnh', exact: true }).click()
  }
  const expandPdfTools = page.getByRole('button', { name: 'Mở công cụ PDF', exact: true })
  if (await expandPdfTools.count()) await expandPdfTools.click()
  const manuscriptZoom = page.getByRole('combobox', { name: 'Thu phóng bản thảo' })
  await manuscriptZoom.waitFor()
  assert.equal(await manuscriptZoom.inputValue(), '1', 'bản thảo bắt đầu ở mức 100%')
  await page.getByRole('button', { name: 'Phóng to bản thảo' }).click()
  await page.waitForFunction(() => document.querySelector('.studio-paper')?.style.zoom === '1.1')
  assert.equal(await manuscriptZoom.inputValue(), '1.1', 'nút phóng to phải tăng tỷ lệ bản thảo')
  await page.getByRole('button', { name: 'Thu nhỏ bản thảo' }).click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.studio-paper')).zoom === '1')
  assert.equal(await manuscriptZoom.inputValue(), '1', 'nút thu nhỏ phải trả tỷ lệ về 100%')
  const manuscriptPinchZoomIn = await page.locator('.studio-paper-stage').evaluate(stage => {
    let prevented = true
    for (let index = 0; index < 4; index += 1) {
      const event = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true })
      stage.dispatchEvent(event)
      prevented &&= event.defaultPrevented
    }
    return prevented
  })
  assert.equal(manuscriptPinchZoomIn, true, 'bản thảo phải chặn zoom trình duyệt mặc định khi nhận pinch')
  await page.waitForFunction(() => document.querySelector('.studio-paper')?.style.zoom === '1.1')
  assert.equal(await manuscriptZoom.inputValue(), '1.1', 'pinch phải phóng to bản thảo')
  const manuscriptScroll = await page.locator('.studio-paper-stage').evaluate(stage => {
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    stage.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(manuscriptScroll, false, 'cuộn hai ngón bình thường phải tiếp tục cuộn trang')
  assert.equal(await manuscriptZoom.inputValue(), '1.1', 'cuộn bình thường không được đổi zoom bản thảo')
  await page.locator('.studio-paper-stage').evaluate(stage => {
    for (let index = 0; index < 4; index += 1) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.studio-paper')).zoom === '1')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.webContents.setBackgroundThrottling(false)))
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).fill('E2E — công thức và dữ liệu')
  await page.locator('.tiptap').fill('Bản thảo tiếng Việt được lưu khi đóng ứng dụng.')
  await page.getByRole('tab', { name: 'Chèn', exact: true }).or(page.getByRole('button', { name: 'Chèn', exact: true })).first().click()
  await page.getByRole('button', { name: 'Chèn công thức toán học', exact: true }).click()
  await page.locator('math-field').waitFor({ timeout: 20_000 })
  await page.waitForFunction(() => document.querySelector('math-field')?.setValue)
  await page.locator('math-field').evaluate(field => { field.value = 'x^2+1'; field.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.getByRole('dialog').getByRole('button', { name: 'Chèn công thức', exact: true }).click()
  await page.locator('.tiptap .katex').first().waitFor()
  await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Trang & tác giả', exact: true }).click()
  await page.getByLabel('Tác giả', { exact: true }).fill('Nguyễn Văn Kiểm Tra')
  await page.getByLabel('Đánh số công thức căn giữa').check()
  await page.getByRole('button', { name: 'Sao lưu', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo điểm khôi phục', exact: true }).click()
  await page.getByText('Đã tạo bản sao lưu.', { exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Mở bản khôi phục', exact: true }).count())
  await page.getByRole('button', { name: 'Hệ thống', exact: true }).click()
  await page.getByText(/Pandoc \/ Word: pandoc/).waitFor({ timeout: 20_000 })
  if (captureScreenshots) await page.screenshot({ path: join(output, 'system.png') })
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'LaTeX', exact: true }).first().click()
  await page.locator('.cm-content').waitFor()
  assert.match(await page.locator('.cm-content').innerText(), /Nguyễn Văn Kiểm Tra/)
  await page.getByRole('button', { name: 'Xuất PDF', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Xuất PDF"]').disabled, { timeout: 45_000 })
  await page.waitForFunction(() => { const canvas = document.querySelector('.studio-pdf-page canvas'); return canvas && canvas.width > 100 && !document.querySelector('.studio-pdf-page-loading') }, { timeout: 45_000 })
  const pdfStatusColor = await page.locator('.studio-panel-status[data-tone="ready"]').evaluate(element => getComputedStyle(element).color)
  const statusChannels = pdfStatusColor.match(/^rgb\((\d+), (\d+), (\d+)\)$/)
  assert.ok(statusChannels, 'PDF status must expose an opaque text color')
  const statusBackground = await page.locator('.studio-panel-status[data-tone="ready"]').evaluate(element => getComputedStyle(element).backgroundColor)
  const backgroundChannels = statusBackground.match(/^rgb\((\d+), (\d+), (\d+)\)$/)
  assert.ok(backgroundChannels, 'PDF status must have an opaque background')
  const luminance = channels => channels.slice(1).map(Number).map(value => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const textLuminance = luminance(statusChannels), backgroundLuminance = luminance(backgroundChannels)
  assert.ok((Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05) >= 4.5, 'PDF status text must meet 4.5:1 contrast')
  assert.match(await page.locator('.aurora-workflow-status').innerText(), /PDF đã cập nhật/)
  const pdfZoom = page.getByRole('combobox', { name: 'Thu phóng PDF' })
  const pdfCanvas = page.locator('.studio-pdf-page canvas').first()
  const initialPdfWidth = await pdfCanvas.evaluate(canvas => Number.parseFloat(canvas.style.width))
  assert.equal(await pdfZoom.inputValue(), '1', 'PDF starts in fit-width mode')
  await page.getByRole('button', { name: 'Phóng to PDF' }).click()
  await page.waitForFunction(width => Number.parseFloat(document.querySelector('.studio-pdf-page canvas')?.style.width || '0') > width, initialPdfWidth)
  assert.equal(await pdfZoom.inputValue(), '1.1', 'zoom-in button must enlarge the rendered PDF')
  await page.getByRole('button', { name: 'Thu nhỏ PDF' }).click()
  await page.waitForFunction(width => Math.abs(Number.parseFloat(document.querySelector('.studio-pdf-page canvas')?.style.width || '0') - width) < 1, initialPdfWidth)
  assert.equal(await pdfZoom.inputValue(), '1', 'zoom-out button must restore fit-width mode')
  const pdfPinchZoomIn = await page.locator('.studio-pdf-canvas').evaluate(stage => {
    let prevented = true
    for (let index = 0; index < 4; index += 1) {
      const event = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true })
      stage.dispatchEvent(event)
      prevented &&= event.defaultPrevented
    }
    return prevented
  })
  assert.equal(pdfPinchZoomIn, true, 'PDF must prevent browser zoom when receiving a pinch')
  await page.waitForFunction(width => Number.parseFloat(document.querySelector('.studio-pdf-page canvas')?.style.width || '0') > width, initialPdfWidth)
  assert.equal(await pdfZoom.inputValue(), '1.1', 'pinch must enlarge the rendered PDF')
  const pdfScroll = await page.locator('.studio-pdf-canvas').evaluate(stage => {
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    stage.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(pdfScroll, false, 'scrolling normally must remain available in the PDF')
  assert.equal(await pdfZoom.inputValue(), '1.1', 'regular PDF scrolling must not change zoom')
  await page.locator('.studio-pdf-canvas').evaluate(stage => {
    for (let index = 0; index < 4; index += 1) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(width => Math.abs(Number.parseFloat(document.querySelector('.studio-pdf-page canvas')?.style.width || '0') - width) < 1, initialPdfWidth)
  if (captureScreenshots) await page.screenshot({ path: join(output, 'source-pdf.png') })
  // Import a TeX archive through the actual UI; compilation must wait for trust.
  const bundle = join(userData, 'source.zip')
  await writeFile(bundle, zipSync({ 'main.tex': strToU8('\\documentclass{article}\\begin{document}Imported project\\end{document}'), 'data.txt': strToU8('resource') }))
  await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Xuất bản thảo Word', exact: true }).click()
  await page.getByText(/Đã xuất Word/).waitFor({ timeout: 35_000 })
  let wordResult
  for (let i = 0; i < 100; i++) {
    wordResult = await app.evaluate(() => globalThis.testDownloads.find(item => item.path.endsWith('.docx')))
    if (wordResult) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(wordResult?.state, 'completed', 'Electron phải ghi tệp Word thành công')
  const wordPath = wordResult.path
  assert.match(strFromU8(unzipSync(new Uint8Array(await readFile(wordPath)))['word/document.xml']), /m:oMath/)
  await page.locator('input[type=file][accept=".docx"]').setInputFiles(wordPath)
  await page.getByText(/Đã nhập bản thảo Word/).waitFor()
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'Tin cậy và biên dịch' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Xuất PDF', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Tin cậy và biên dịch' }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Xuất PDF"]').disabled, { timeout: 45_000 })
  await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Tài liệu', exact: true }).click()
  await page.locator('input[type=file][accept=".zip"]').setInputFiles(bundle)
  await page.getByText(/Đã nhập main và 1 tài nguyên/).waitFor()
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'Tin cậy và biên dịch' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Xuất PDF', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Tin cậy và biên dịch' }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Xuất PDF"]').disabled, { timeout: 45_000 })
  // Switch back and exercise rename/duplicate/delete without touching real user data.
  await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByRole('button', { name: /E2E — công thức và dữ liệu/ }).first().click()
  await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByTitle('Nhân bản tài liệu', { exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /E2E — công thức và dữ liệu — bản sao/ }).waitFor()
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
  await page.locator('.tiptap').fill('Nội dung cuối cùng trước khi đóng.')
  // Native close invokes the final save handshake.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().startsWith('devtools:'))?.close())
  // macOS keeps the app alive after its last window closes; test an explicit quit too.
  if (process.platform === 'darwin') {
    await new Promise(resolve => setTimeout(resolve, 1000))
    await app.evaluate(({ app }) => app.quit())
  }
  await new Promise((resolveExit, reject) => {
    if (app.process().exitCode !== null) return resolveExit()
    const timer = setTimeout(() => reject(new Error('Ứng dụng không đóng sau khi flush.')), 20_000)
    app.process().once('exit', () => { clearTimeout(timer); resolveExit() })
  })
  app = null
  const snapshot = JSON.parse(await readFile(join(userData, 'workspace-v1.json'), 'utf8'))
  assert.ok(snapshot.projects.flatMap(project => project.tasks).some(task => JSON.stringify(task.document).includes('Nội dung cuối cùng')))
  app = await launch()
  page = await rendererWindow()
  if (!captureScreenshots) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()))
  await page.locator('.tiptap').waitFor({ timeout: 30_000 })
  assert.match(await page.locator('.tiptap').innerText(), /Nội dung cuối cùng/)
  if (captureScreenshots) await page.screenshot({ path: join(output, 'restored-editor.png') })
  assert.deepEqual(errors, [])
  console.log('Desktop smoke passed: formula, settings, native backup, source/PDF, Word download with OMML, trusted archive import, duplicate, final flush and reopen.')
} catch (error) {
  const pages = app?.windows() || []
  await mkdir(output, { recursive: true })
  await pages[0]?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  console.error('Desktop diagnostics:', await pages[0]?.evaluate(() => ({ url: location.href, title: document.title, text: document.body.innerText.slice(0, 1500) })).catch(() => null), errors)
  console.error(error)
  process.exitCode = 1
} finally {
  if (app) {
    const timer = setTimeout(() => app.process().kill(), 5000)
    try { await app.close().catch(() => {}) } finally { clearTimeout(timer) }
  }
  await server?.close()
  await rm(userData, { recursive: true, force: true }).catch(() => {})
}
