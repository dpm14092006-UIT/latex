import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron, chromium } from 'playwright'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer as createPortAllocator } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { createTask, createProject } from '../src/services/WorkspaceData.js'
import { sanitizeSettings } from '../src/services/DocumentSettings.js'

const userData = await mkdtemp(join(tmpdir(), 'vietlatex-spelling-desktop-'))
const output = resolve('artifacts/spellcheck-desktop')
await mkdir(output, { recursive: true })
const task = createTask('English spelling', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We recieve teh quasifrobnicator result.' }, { type: 'inlineMath', attrs: { latex: 'recieve + x' } }] }] })
task.settings = sanitizeSettings({ spellcheck: { enabled: true, locale: 'en-US' } })
const project = createProject('Desktop spelling', task)
await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write', pdfMode: 'manual' }))
const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_BUILT_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let app, child, browser, exited
const pageErrors = []
async function launch() {
  if (!process.env.DESKTOP_EXE) return electron.launch({ args: ['.', '--built-renderer'], env, timeout: 45_000 })
  const allocator = createPortAllocator()
  await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
  const port = allocator.address().port
  await new Promise(resolve => allocator.close(resolve))
  // Packaged fuses disable main-process inspection. Connect only to renderer CDP.
  child = spawn(resolve(process.env.DESKTOP_EXE), [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  child.stdout.resume(); child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-5000) })
  exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', error => { diagnostics += error.message; resolve(-1) }) })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline && child.exitCode === null) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break } catch { await delay(150) }
  }
  if (!browser) throw new Error(`Không mở được bản đóng gói: ${diagnostics}`)
  let page
  while (Date.now() < deadline) {
    page = browser.contexts()[0]?.pages().find(page => page.url().startsWith('vietlatex:'))
    if (page) return { firstWindow: async () => page }
    await delay(100)
  }
  throw new Error(`Không tìm được renderer: ${diagnostics}`)
}
async function closeApp() {
  if (child) {
    // Windows SIGTERM force-stops a process; first wait for actual persisted writes.
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      else child.kill()
    }
    await exited
    await browser?.close().catch(() => {})
    child = null; browser = null
  } else if (app) {
    await app.evaluate(({ app }) => app.quit()).catch(() => {})
    await app.close().catch(() => {})
  }
  app = null
}
try {
  app = await launch()
  let page = await app.firstWindow()
  page.on('pageerror', error => pageErrors.push(error.message))
  page.setDefaultTimeout(30_000)
  await page.locator('.tiptap .spellcheck-error').filter({ hasText: 'teh' }).waitFor()
  assert.equal(new URL(page.url()).protocol, 'vietlatex:')
  const metadata = await page.evaluate(async () => {
    const response = await fetch(new URL('./spellcheck/manifest.json', location.href))
    return response.json()
  })
  assert.deepEqual(metadata.dictionaries.map(item => item.locale), ['en-US', 'en-GB'])
  await page.locator('.tiptap .spellcheck-error').filter({ hasText: 'teh' }).click()
  await page.getByRole('dialog', { name: 'Gợi ý chính tả: teh' }).getByRole('button', { name: 'the', exact: true }).click()
  assert.match(await page.locator('.tiptap').innerText(), /the quasifrobnicator/)
  await page.locator('.tiptap .spellcheck-error').filter({ hasText: 'quasifrobnicator' }).waitFor()
  await page.locator('.tiptap .spellcheck-error').filter({ hasText: 'quasifrobnicator' }).click()
  await page.getByRole('dialog', { name: 'Gợi ý chính tả: quasifrobnicator' }).getByRole('button', { name: 'Thêm vào từ điển', exact: true }).click()
  await page.waitForFunction(() => ![...document.querySelectorAll('.tiptap .spellcheck-error')].some(node => node.textContent === 'quasifrobnicator'))
  assert.ok(JSON.parse(await readFile(join(userData, 'spellcheck-v1.json'), 'utf8')).words.includes('quasifrobnicator'))
  await page.getByLabel('Biến thể tiếng Anh').selectOption('en-GB')
  // Hidden Windows windows do not produce compositor screenshots; UI captures live in spellcheck-ui.
  await writeFile(join(output, 'runtime.json'), JSON.stringify({ protocol: new URL(page.url()).protocol, dictionaries: metadata.dictionaries, packagedExecutable: Boolean(process.env.DESKTOP_EXE) }, null, 2))
  const saveDeadline = Date.now() + 10_000
  while (Date.now() < saveDeadline) {
    const snapshot = JSON.parse(await readFile(join(userData, 'workspace-v1.json'), 'utf8'))
    if (snapshot.projects[0].tasks[0].settings.spellcheck.locale === 'en-GB') break
    await delay(100)
  }
  await closeApp()
  const persisted = JSON.parse(await readFile(join(userData, 'workspace-v1.json'), 'utf8'))
  assert.equal(persisted.projects[0].tasks[0].settings.spellcheck.locale, 'en-GB')
  app = await launch()
  page = await app.firstWindow()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.locator('.tiptap .spellcheck-error').filter({ hasText: 'recieve' }).waitFor({ timeout: 30_000 })
  assert.equal(await page.locator('.tiptap .spellcheck-error').filter({ hasText: 'quasifrobnicator' }).count(), 0)
  assert.equal(await page.getByLabel('Biến thể tiếng Anh').inputValue(), 'en-GB')
  assert.equal(await page.locator('.katex .spellcheck-error').count(), 0)
  assert.deepEqual(pageErrors, [])
  console.log('Desktop spelling passed: vietlatex://, production CSP/worker/dictionaries, trusted IPC, atomic storage, app restart and locale persistence.')
} finally {
  await closeApp()
  assert.ok(userData.startsWith(join(tmpdir(), 'vietlatex-spelling-desktop-')))
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
