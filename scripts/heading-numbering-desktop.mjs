import assert from 'node:assert/strict'
import { _electron as electron, chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createProject, createTask } from '../src/services/WorkspaceData.js'

const output = resolve(process.env.HEADING_OUTPUT || 'artifacts/heading-numbering-desktop')
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-headings-'))
await mkdir(output, { recursive: true })
const text = value => ({ type: 'text', text: value })
const task = process.env.HEADING_TASK_FIXTURE
  ? JSON.parse(await readFile(process.env.HEADING_TASK_FIXTURE, 'utf8'))
  : createTask('3. Data', { type: 'doc', content: [
    { type: 'paragraph', content: [text('An introductory paragraph.')] },
    { type: 'paragraph', content: [{ ...text('3.1 Dữ liệu vệ tinh'), marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, text('Nghiên cứu sử dụng 6 vệ tinh.')] },
    { type: 'heading', attrs: { level: 3, label: 'sec:night' }, content: [text('3.1.1 Night time light')] },
    { type: 'paragraph', content: [text('Satellite measurements.')] },
  ] })
const project = createProject('Heading numbering regression', task)
await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'split', pdfMode: 'manual' }))
const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true' }
delete env.ELECTRON_RUN_AS_NODE
let app, browser, child, loading, page
const errors = []
try {
  if (process.env.DESKTOP_EXE) {
    const allocator = createServer()
    await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
    const port = allocator.address().port
    await new Promise(resolve => allocator.close(resolve))
    child = spawn(process.env.DESKTOP_EXE, [`--remote-debugging-port=${port}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-5000) })
    child.stdout.resume()
    const deadline = Date.now() + 45000
    while (!browser && Date.now() < deadline && child.exitCode === null) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }) } catch { await new Promise(resolve => setTimeout(resolve, 150)) }
    }
    assert.ok(browser, `Packaged application did not start: ${diagnostics}`)
    while (!page && Date.now() < deadline) {
      page = browser.contexts()[0]?.pages().find(item => item.url().startsWith('vietlatex:'))
      if (!page) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(page, `Packaged renderer did not start: ${diagnostics}`)
  } else {
    app = await electron.launch({ args: ['.'], env, timeout: 45000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.webContents.setBackgroundThrottling(false); window.hide() }))
    page = await app.firstWindow()
  }
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor({ timeout: 30000 })
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => {
      const url = original(blob)
      if (blob.type === 'application/pdf') globalThis.numberingPdfUrl = url
      return url
    }
  })
  const outline = page.getByRole('navigation', { name: 'Mục lục bản thảo', exact: true })
  await outline.getByRole('button', { name: '3.1 Dữ liệu vệ tinh', exact: true }).waitFor()
  await outline.getByRole('button', { name: '3.1.1 Night time light', exact: true }).waitFor()
  assert.equal(await page.locator('.tiptap h2').first().innerText(), '3.1 Dữ liệu vệ tinh')
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.waitForFunction(() => Boolean(globalThis.numberingPdfUrl), undefined, { timeout: 90000 })
  const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(globalThis.numberingPdfUrl)).arrayBuffer()))))
  await writeFile(join(output, 'document.pdf'), bytes)
  loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await loading.promise
  const pages = []
  for (let index = 1; index <= pdf.numPages; index += 1) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str).join(' '))
  const pdfText = pages.join('\n')
  assert.match(pdfText, /3\.1\s+Dữ liệu vệ tinh/u)
  assert.match(pdfText, /3\.1\.1\s+Night time light/u)
  assert.doesNotMatch(pdfText, /0\.0\.1\s+Night time light/u)
  await page.screenshot({ path: join(output, 'numbering-fixed.png') })
  if (!process.env.HEADING_TASK_FIXTURE) {
    const editor = page.locator('.tiptap')
    await editor.fill('')
    await editor.pressSequentially('3.1 Dữ liệu vệ tinh')
    await editor.press('Shift+Enter')
    await editor.pressSequentially('Nội dung sau tiêu đề.')
    assert.equal(await editor.locator('h2').innerText(), '3.1 Dữ liệu vệ tinh')
    assert.match(await editor.locator('p').innerText(), /Nội dung sau tiêu đề\./u)
    await page.evaluate(() => {
      const clipboard = new globalThis.DataTransfer()
      clipboard.setData('text/html', '<p><strong>3.1 Dữ liệu vệ tinh</strong><br>Nội dung được dán.</p><p>3.1.1 Night time light</p>')
      globalThis.document.querySelector('.tiptap').dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
    })
    await editor.locator('h3').waitFor()
    assert.match(await editor.innerText(), /Nội dung được dán\./u)
  }
  assert.deepEqual(errors, [])
  const environment = await page.evaluate(() => globalThis.desktopAPI.environment())
  await writeFile(join(output, 'report.json'), JSON.stringify({ version: environment.version, packaged: Boolean(process.env.DESKTOP_EXE), heading: '3.1', subheading: '3.1.1', pages: pdf.numPages, errors }, null, 2))
  console.log(`Heading numbering passed: ${environment.version}, outline, Shift+Enter/Word structure and real PDF (packaged=${Boolean(process.env.DESKTOP_EXE)}).`)
} finally {
  await loading?.destroy()
  if (app) {
    const process = app.process()
    const exited = new Promise(resolve => {
      if (process.exitCode !== null) resolve()
      else process.once('exit', resolve)
    })
    process.kill('SIGTERM')
    const timer = setTimeout(() => process.kill('SIGKILL'), 20000)
    try { await exited } finally { clearTimeout(timer) }
  }
  if (child?.exitCode === null) {
    child.kill('SIGTERM')
    const deadline = Date.now() + 20000
    while (child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  await browser?.close().catch(() => {})
  await rm(userData, { recursive: true, force: true })
}
