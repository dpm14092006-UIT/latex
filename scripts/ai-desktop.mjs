import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright'
import { createTask, createProject } from '../src/services/WorkspaceData.js'

// Drives the Gemini assistant in the desktop app against a local mock of the
// Gemini API: key entry, encrypted storage, sending a selection with a formula,
// replacing it, and undo. Set AI_DESKTOP_SHOW=1 to show the window and save screenshots.
const KEY = `test_${'k'.repeat(32)}`
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-ai-desktop-'))
const output = resolve('artifacts/ai-desktop')
await mkdir(output, { recursive: true })
const requests = []
let releaseGeneration
let generationStarted
const generating = new Promise(resolve => { generationStarted = resolve })
const server = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    requests.push({ url: request.url, key: request.headers['x-goog-api-key'], body: body ? JSON.parse(body) : null })
    response.setHeader('content-type', 'application/json')
    if (request.headers['x-goog-api-key'] !== KEY) { response.statusCode = 400; return response.end(JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }] } })) }
    if (request.url.startsWith('/models?')) return response.end(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }] }))
    releaseGeneration = () => response.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'The result $x^2$ holds by \\cite{knuth}.' }] } }] }))
    generationStarted()
  })
})
await new Promise(done => server.listen(0, '127.0.0.1', done))

const task = createTask('AI', { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Kết quả ' }, { type: 'inlineMath', attrs: { latex: 'x^2' } }, { type: 'text', text: ' đúng.' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Đoạn thứ hai giữ nguyên.' }] },
] })
const project = createProject('AI desktop', task)
await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write', pdfMode: 'manual' }))
const show = process.env.AI_DESKTOP_SHOW === '1'
const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_BUILT_RENDERER: 'true', VIETLATEX_TEST_GEMINI_API: `http://127.0.0.1:${server.address().port}`, ...(show ? {} : { VIETLATEX_TEST_HIDE_WINDOW: 'true' }) }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const pageErrors = []
let app
try {
  app = await electron.launch({ args: ['.', '--built-renderer'], env, timeout: 45_000 })
  const page = await app.firstWindow()
  page.on('pageerror', error => pageErrors.push(error.message))
  page.setDefaultTimeout(20_000)
  await page.locator('.tiptap').getByText('Đoạn thứ hai').waitFor()

  // Not connected yet: the panel points to settings.
  await page.locator('.tiptap p').first().click()
  await page.getByRole('button', { name: 'Trợ lý AI', exact: true }).click()
  await page.getByRole('dialog', { name: 'Trợ lý AI Gemini' }).getByRole('button', { name: 'Nhập API key' }).click()
  const manager = page.getByRole('dialog', { name: 'Quản lý không gian làm việc' })
  await manager.getByLabel('API key Gemini').fill('wrong_key_000000000000000000000')
  await manager.getByRole('button', { name: 'Kiểm tra và lưu' }).click()
  await manager.getByText('API key Gemini không hợp lệ hoặc đã bị thu hồi.').waitFor()
  await manager.getByLabel('API key Gemini').fill(KEY)
  await manager.getByRole('button', { name: 'Kiểm tra và lưu' }).click()
  await manager.getByText('Đã kết nối Gemini.').waitFor()
  assert.equal(await manager.getByLabel('Model').inputValue(), 'models/gemini-2.5-flash')
  const stored = await readFile(join(userData, 'ai-v1.json'), 'utf8')
  assert.ok(!stored.includes(KEY), 'the key is stored encrypted')
  if (show) await page.screenshot({ path: join(output, 'settings.png') })
  await manager.getByRole('button', { name: 'Đóng' }).first().click()

  // Send the caret paragraph, replace it, then undo.
  await page.locator('.tiptap p').first().click()
  await page.getByRole('button', { name: 'Trợ lý AI', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Trợ lý AI Gemini' })
  await panel.getByLabel('Thao tác').selectOption('to-english')
  await panel.getByText(/Sẽ gửi \d+ ký tự/).waitFor()
  await panel.getByRole('button', { name: 'Gửi tới Gemini' }).click()
  await generating
  // Reopening the assistant while a response is pending used to capture a new
  // selection and associate the previous response with that different text.
  assert.equal(await page.getByRole('button', { name: 'Trợ lý AI', exact: true }).isDisabled(), true)
  assert.equal(await panel.getByRole('button', { name: 'Đóng trợ lý AI' }).isDisabled(), true)
  releaseGeneration()
  await panel.getByLabel('Kết quả từ Gemini').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Trợ lý AI', exact: true }).isEnabled(), true)
  assert.equal(await panel.getByLabel('Kết quả từ Gemini').inputValue(), 'The result $x^2$ holds by \\cite{knuth}.')
  if (show) await page.screenshot({ path: join(output, 'result.png') })
  const generate = requests.find(item => item.url.endsWith(':generateContent'))
  assert.equal(generate.url, '/models/gemini-2.5-flash:generateContent')
  assert.equal(generate.body.contents[0].parts[0].text, 'Kết quả $x^2$ đúng.')
  assert.ok(requests.every(item => !item.url.includes(KEY)), 'the key never appears in a URL')
  await panel.getByRole('button', { name: 'Thay vùng đã chọn' }).click()
  const first = page.locator('.tiptap p').first()
  await first.getByText(/The result/).waitFor()
  assert.match(await first.innerText(), /holds by/)
  assert.equal(await first.locator('[data-type="inline-math"], .tiptap-mathematics-render').count() > 0, true, 'the formula is still a formula node')
  assert.equal(await page.locator('.tiptap p').nth(1).innerText(), 'Đoạn thứ hai giữ nguyên.')
  assert.ok(await page.locator('.tiptap').evaluate(editor => editor.contains(editor.ownerDocument.activeElement)), 'focus returns to the editor')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await first.getByText('Kết quả').waitFor()

  // Repeated source text can leave the old offsets pointing at an identical
  // substring after an insertion. The original document identity must match
  // before applying a response, rather than only comparing that substring.
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  const source = page.locator('.cm-content')
  await source.click()
  await source.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('alpha alpha')
  for (let index = 0; index < 5; index++) await source.press('Shift+ArrowLeft')
  await page.getByRole('button', { name: 'Trợ lý AI', exact: true }).click()
  await panel.getByText('Sẽ gửi 5 ký tự tới Google', { exact: true }).waitFor()
  const sourceGenerating = new Promise(resolve => { generationStarted = resolve })
  await panel.getByRole('button', { name: 'Gửi tới Gemini' }).click()
  await sourceGenerating
  await source.press('Home')
  await page.keyboard.insertText('alpha ')
  assert.equal(await source.innerText(), 'alpha alpha alpha')
  releaseGeneration()
  await panel.getByLabel('Kết quả từ Gemini').waitFor()
  await panel.getByRole('button', { name: 'Thay vùng đã chọn' }).click()
  await panel.getByText('Source đã thay đổi; hãy chọn lại đoạn cần thay.').waitFor()
  assert.equal(await source.innerText(), 'alpha alpha alpha', 'a response cannot replace a different identical substring after source offsets move')
  assert.deepEqual(pageErrors, [])
  console.log('AI desktop passed: encrypted key, invalid-key message, model choice, formula/citation replacement and undo, locked pending selection, stale source result rejected.')
} finally {
  await app?.evaluate(({ app }) => app.quit()).catch(() => {})
  await app?.close().catch(() => {})
  server.close()
  assert.ok(userData.startsWith(join(tmpdir(), 'vietlatex-ai-desktop-')))
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
