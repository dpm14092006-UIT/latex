/* global window */
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createPresetTable, TABLE_PRESETS } from '../src/services/TableStyles.js'
import { builtInDocumentTemplates, toLatex } from '../src/services/DocumentSerializer.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json'), config = require('../electron-builder.config.cjs')
const executable = process.env.DESKTOP_EXE || join(config.directories.output, 'mac-universal', `${pkg.build.productName}.app`, 'Contents', 'MacOS', pkg.build.productName)
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-mac-install-'))
const output = join('artifacts', 'mac-smoke')
await mkdir(output, { recursive: true })
let child, browser, exited, page
let diagnostics = ''
const errors = []
async function backendPid() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,comm='])
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (match && Number(match[2]) === child.pid && match[3].endsWith('/vietlatex-backend')) return Number(match[1])
  }
  throw new Error('Không tìm thấy backend của phiên app kiểm thử.')
}
async function launch() {
  const allocator = createServer()
  await new Promise(done => allocator.listen(0, '127.0.0.1', done))
  const port = allocator.address().port
  await new Promise(done => allocator.close(done))
  const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_HIDE_WINDOW: 'true', VIETLATEX_WARM_TEX: '0' }
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'XELATEX_PATH', 'PANDOC_PATH', 'VIETLATEX_APP_PATH', 'VIETLATEX_RESOURCES_PATH', 'TEXMFVAR', 'TEXMFCONFIG', 'TEXMFCNF']) delete env[name]
  child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] })
  exited = new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })) })
  child.stdout.resume()
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes.toString()).slice(-12000) })
  const deadline = Date.now() + Number(process.env.MAC_SMOKE_STARTUP_TIMEOUT || 45000)
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break } catch { await delay(150) }
  }
  if (!browser) throw new Error(`App không mở được (exit=${child.exitCode}, signal=${child.signalCode}): ${diagnostics}`)
  let page
  while (Date.now() < deadline) {
    page = browser.contexts()[0]?.pages().find(page => page.url().startsWith('vietlatex:'))
    if (page) break
    await delay(100)
  }
  assert.ok(page, diagnostics)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) console.error('Renderer:', message.text()) })
  page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText))
  page.setDefaultTimeout(30000)
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).waitFor()
  return page
}
async function quit() {
  const backend = await backendPid()
  child.kill('SIGTERM')
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('App không lưu/thoát trong 20 giây.')), 20000) })
  let result
  try { result = await Promise.race([exited, timeout]) } finally { clearTimeout(timer) }
  assert.equal(result.code, 0, diagnostics)
  assert.throws(() => process.kill(backend, 0), error => error.code === 'ESRCH', 'backend must exit with the app')
  await browser.close().catch(() => {})
  browser = undefined
}
try {
  page = await launch()
  const environment = await page.evaluate(() => window.desktopAPI.environment())
  assert.equal(environment.platform, 'darwin')
  assert.equal(environment.version, pkg.version)
  assert.equal(environment.compiler.available, true, JSON.stringify(environment))
  assert.equal(environment.word.available, true, JSON.stringify(environment))
  assert.ok(environment.compiler.executable.includes('.app/Contents/Resources/tex/'), 'uses bundled TeX without Terminal PATH')
  const firstBackend = await backendPid()
  process.kill(firstBackend, 'SIGKILL')
  await delay(300)
  const recovered = await page.evaluate(() => window.desktopAPI.environment())
  assert.equal(recovered.compiler.available, true, 'backend restarts after an unexpected crash')
  assert.notEqual(await backendPid(), firstBackend)
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).fill('MacBook — tiếng Việt và công thức')
  await page.locator('.tiptap').fill('Tài liệu tiếng Việt được lưu trên MacBook.')
  const bibliography = '@article{smith2026, author={Smith, Jane}, title={Research Methods}, journal={Journal of Studies}, year={2026}}'
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '3.1.1 Kiểm tra tiếng Việt' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Xin chào MacBook: ' }, { type: 'inlineMath', attrs: { latex: 'x^2+1' } }, { type: 'citation', attrs: { key: 'smith2026' } }] },
  ] }
  const cases = [{ id: 'default', name: 'Mẫu mặc định' }, { id: 'apa', name: 'APA 7th / Biber', citationStyle: 'apa' }, ...builtInDocumentTemplates]
  for (const template of cases) {
    const { latex, images } = toLatex(doc, 'Bộ cài MacBook', template.source, { bibliography, citationStyle: template.citationStyle || 'unsrt', abstractEnabled: true, abstract: 'Biên dịch độc lập trên macOS.', tableOfContents: true })
    const result = await page.evaluate(async ({ latex, images, bibliography, id }) => {
      const assets = [{ filename: 'references.bib', data: btoa(bibliography) }]
      const result = await window.desktopAPI.compileLatex(latex, images, id, assets, true)
      return { ...result, pdf: result.pdf ? Array.from(result.pdf) : null }
    }, { latex, images, bibliography, id: `mac-${template.id}` })
    assert.equal(result.ok, true, `${template.name}: ${result.error}\n${result.log || ''}`)
    assert.equal(Buffer.from(result.pdf).subarray(0, 5).toString(), '%PDF-')
    console.log(`Packaged PDF: ${template.name}, ${result.pdf.length} bytes`)
  }
  // Exercise the upstream table library with the bundled TeX, including the
  // new colortbl dependency; string-only serializer tests cannot catch missing packages.
  const tableDocument = { type: 'doc', content: TABLE_PRESETS.map(preset => {
    const table = createPresetTable(preset, { rows: 2 })
    table.attrs.caption = preset.label
    for (const row of table.content.slice(preset.noHeader ? 0 : 1)) {
      for (const cell of row.content) cell.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Dữ liệu MacBook' }] }]
    }
    return table
  }) }
  const tableSource = toLatex(tableDocument, 'Thư viện bảng trên macOS')
  const tablePdf = await page.evaluate(({ latex, images }) => window.desktopAPI.compileLatex(latex, images, 'mac-table-library', [], true).then(result => ({ ...result, pdf: result.pdf ? Array.from(result.pdf) : null })), tableSource)
  assert.equal(tablePdf.ok, true, `${tablePdf.error}\n${tablePdf.log || ''}`)
  await writeFile(join(output, 'table-library.pdf'), Buffer.from(tablePdf.pdf))
  const tableLoading = getDocument({ data: Uint8Array.from(tablePdf.pdf), useSystemFonts: true })
  try {
    const pdf = await tableLoading.promise
    let text = ''
    for (let number = 1; number <= pdf.numPages; number += 1) text += (await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str).join(' ')
    for (const preset of TABLE_PRESETS) assert.ok(text.includes(preset.label), `Missing table caption: ${preset.label}`)
    assert.ok(text.includes('Dữ liệu MacBook'))
    console.log(`Packaged PDF: all six table styles and captions, ${pdf.numPages} pages`)
  } finally { await tableLoading.destroy() }
  const wordResult = await page.evaluate(async () => {
    const ast = { 'pandoc-api-version': [1, 23, 1], meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Tiếng Việt' }, { t: 'Space' }, { t: 'Math', c: [{ t: 'InlineMath' }, 'x^2+1'] }] }] }
    const { bytes } = await window.desktopAPI.convertWord('export', ast)
    const imported = await window.desktopAPI.convertWord('import', new Uint8Array(bytes))
    return { bytes: Array.from(bytes), imported }
  })
  assert.match(strFromU8(unzipSync(Uint8Array.from(wordResult.bytes))['word/document.xml']), /m:oMath/)
  assert.match(JSON.stringify(wordResult.imported), /Tiếng|Việt/)
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  if (await page.getByRole('button', { name: 'Mở công cụ PDF', exact: true }).count()) await page.getByRole('button', { name: 'Mở công cụ PDF', exact: true }).click()
  await page.getByRole('combobox', { name: 'Chế độ cập nhật PDF', exact: true }).selectOption('manual')
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.locator('.studio-pdf-canvas canvas').first().waitFor({ timeout: 60000 })
  await page.screenshot({ path: join(output, 'installed-pdf.png') })
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).fill('MacBook — đã lưu trước khi đóng')
  await quit()
  const saved = JSON.parse(await readFile(join(userData, 'workspace-v1.json'), 'utf8'))
  assert.match(JSON.stringify(saved), /MacBook — đã lưu trước khi đóng/)
  page = await launch()
  assert.equal(await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).inputValue(), 'MacBook — đã lưu trước khi đóng')
  await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
  assert.match(await page.locator('.tiptap').innerText(), /Tài liệu tiếng Việt/)
  await page.evaluate(() => window.close())
  await delay(500)
  assert.equal(child.exitCode, null, 'macOS keeps the app alive after closing its window')
  await quit()
  assert.deepEqual(errors, [])
  console.log('Packaged macOS app passed: Finder PATH, bundled PDF/templates/citations, Word round-trip, PDF preview, save on quit, reopen and macOS window lifecycle.')
} catch (error) {
  console.error(diagnostics)
  console.error(await page?.locator('body').innerText().catch(() => 'Renderer unavailable'))
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (child?.exitCode === null) { child.kill('SIGKILL'); await exited.catch(() => {}) }
  await browser?.close().catch(() => {})
  await rm(userData, { recursive: true, force: true })
}
