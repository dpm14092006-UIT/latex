import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer as createPortServer } from 'node:net'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { buildDesktop } from './build-desktop.mjs'
import { createServer, request as forwardRequest } from 'node:http'

if (!process.env.DESKTOP_EXE) await buildDesktop()
const output = resolve('artifacts/lan-sync-desktop')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(tmpdir(), 'vietlatex-sync-desktop-'))
const running = new Set(), errors = []
let proxy, exchangeStarted, exchangeDelay = 250
const fixture = (name, text) => {
  const task = createTask(name, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const project = createProject(name, task)
  return { version: 1, projects: [project], activeProjectId: project.id, customTemplates: [], documentTemplates: [] }
}
const a = fixture('MacBook A', 'Nội dung ban đầu MacBook A'), b = fixture('Máy MacBook', 'Nội dung ban đầu MacBook')
async function launch(name, value) {
  const userData = join(directory, name); await mkdir(userData, { recursive: true })
  if (value) await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify(value))
  const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true' }; delete env.ELECTRON_RUN_AS_NODE
  let app
  {
    // Release fuses disable the Node inspector used by Playwright's Electron driver.
    // Attach to Chromium's loopback debugger instead; do not weaken the release fuses.
    const allocator = createPortServer(); await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
    const port = allocator.address().port; await new Promise(resolve => allocator.close(resolve))
    const executable = process.env.DESKTOP_EXE || createRequire(import.meta.url)('electron')
    const child = spawn(executable, [...(process.env.DESKTOP_EXE ? [] : ['.']), `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = '', browser
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-5000) })
    child.stdout.resume()
    const deadline = Date.now() + 45000
    while (!browser && Date.now() < deadline && child.exitCode === null) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }) } catch { await new Promise(resolve => setTimeout(resolve, 150)) }
    }
    if (!browser) { child.kill(); throw new Error(`Không mở được app đóng gói: ${diagnostics}`) }
    let page
    while (!page && Date.now() < deadline) { page = browser.contexts()[0]?.pages().find(page => page.url().startsWith('vietlatex:')); if (!page) await new Promise(resolve => setTimeout(resolve, 100)) }
    if (!page) { await browser.close(); child.kill(); throw new Error(`Không tìm thấy renderer đóng gói: ${diagnostics}`) }
    app = { process: () => child, windows: () => [page], firstWindow: async () => page, close: async () => {
      await page.evaluate(() => window.close()).catch(() => {})
      if (process.platform === 'darwin') child.kill('SIGTERM')
      const deadline = Date.now() + 20000
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); throw new Error(`App không thoát sau khi lưu và dừng backend: ${diagnostics}`) }
      await browser.close().catch(() => {})
    } }
  }
  running.add(app)
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor()
  // Simulate a suspended five-second renderer timer. Neither hidden app may
  // rely on renderer intervals or test-only Chromium unthrottling switches.
  await page.addInitScript(() => {
    const original = window.setInterval.bind(window)
    window.setInterval = (callback, delay, ...args) => original(delay === 5000 ? () => {} : callback, delay, ...args)
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => { const url = create(blob); if (blob.type === 'application/pdf') window.lanTestPdfUrl = url; return url }
  })
  await page.reload()
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor()
  await page.evaluate(() => {
    window.lanNativeTicks = 0
    window.desktopAPI.onSyncTick(() => { window.lanNativeTicks++ })
  })
  return { app, page, userData }
}
async function close(instance) {
  const timer = setTimeout(() => instance.app.process().kill(), 10000)
  await instance.app.close(); clearTimeout(timer); running.delete(instance.app)
}
async function panel(page) {
  if (!await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Đồng bộ LAN', exact: true }).click()
}
async function sync(page) { await panel(page); await page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click(); await page.getByText(/^(Đã đồng bộ và lưu trên máy\.|Đã lưu trên máy\. Còn \d+ xung đột)/, { exact: false }).waitFor() }
async function edit(page, text) { if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await page.locator('.tiptap').fill(text) }
async function waitSnapshot(page, predicate) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.desktopAPI.loadWorkspace())
    if (predicate(snapshot)) return snapshot
    await page.waitForTimeout(100)
  }
  throw new Error('Dữ liệu đồng bộ chưa được ghi vào workspace sau 30 giây.')
}
function nextExchange() {
  let timer
  return new Promise((resolve, reject) => {
    exchangeStarted = () => { clearTimeout(timer); resolve() }
    timer = setTimeout(() => { exchangeStarted = null; reject(new Error('Lượt kiểm tra mạng chưa bắt đầu sau 15 giây.')) }, 15000)
  })
}
try {
  let host = await launch('host', a)
  const client = await launch('client', b)
  await panel(host.page)
  await host.page.getByRole('button', { name: 'Làm máy chủ LAN', exact: true }).click()
  await host.page.getByText(/Máy này làm máy chủ/).waitFor()
  const invitation = await host.page.evaluate(async () => {
    const status = await window.desktopAPI.syncStatus()
    return window.desktopAPI.syncInvitation(status.addresses[0] || '127.0.0.1')
  })
  // A delayed relay exercises typing while an actual encrypted response is in flight.
  const inviteData = JSON.parse(Buffer.from(invitation.code.slice(14), 'base64url').toString('utf8'))
  proxy = createServer((req, res) => {
    const forward = forwardRequest({ hostname: inviteData.host, port: inviteData.port, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers)
      setTimeout(() => response.pipe(res), req.url === '/exchange' ? exchangeDelay : 0)
    })
    forward.on('error', () => { res.writeHead(503); res.end('{}') })
    req.pipe(forward)
    if (req.url === '/exchange' && exchangeStarted) { const notify = exchangeStarted; exchangeStarted = null; notify() }
  })
  await new Promise(resolve => proxy.listen(0, '0.0.0.0', resolve))
  const relayCode = `vietlatex-lan:${Buffer.from(JSON.stringify({ ...inviteData, port: proxy.address().port })).toString('base64url')}`
  await panel(client.page)
  await client.page.getByLabel('Mã ghép từ máy chủ').fill(relayCode)
  await client.page.getByRole('button', { name: 'Ghép với máy chủ', exact: true }).click()
  await client.page.getByText(/Đã ghép máy/).waitFor()
  const received = await waitSnapshot(host.page, snapshot => snapshot.projects.some(project => project.id === b.projects[0].id))
  assert.equal(received.projects.length, 2)
  assert.ok(received.projects.some(project => project.id === b.projects[0].id))
  await edit(client.page, 'Sửa trên máy MacBook rồi gửi tới MacBook A')
  await waitSnapshot(host.page, snapshot => JSON.stringify(snapshot.projects).includes('Sửa trên máy MacBook rồi gửi tới MacBook A'))
  await edit(host.page, 'Tự động gửi từ máy chủ trong nền')
  await waitSnapshot(client.page, snapshot => JSON.stringify(snapshot.projects).includes('Tự động gửi từ máy chủ trong nền'))
  assert.ok(await host.page.evaluate(() => window.lanNativeTicks) >= 2, 'main-process clock polls the hidden host')
  assert.ok(await client.page.evaluate(() => window.lanNativeTicks) >= 2, 'main-process clock polls the hidden client')
  assert.equal(await host.page.getByRole('button', { name: 'Đồng bộ cuộn bản thảo và PDF', exact: true }).count(), 0)
  await panel(host.page)
  await host.page.getByRole('button', { name: 'Tài liệu', exact: true }).click()
  await host.page.getByRole('dialog').getByRole('button', { name: /^Máy MacBook/ }).click()
  await host.page.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Sửa trên máy MacBook'))
  await host.page.getByRole('button', { name: 'Tin cậy và biên dịch', exact: true }).waitFor()
  // The received manuscript stays untrusted, but the sender's compiled PDF
  // must render without running LaTeX on the receiver.
  if (await client.page.getByRole('dialog').count()) await client.page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await client.page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  // waitForFunction(fn, arg, options): the timeout must be the third argument.
  await client.page.waitForFunction(() => Boolean(window.lanTestPdfUrl), undefined, { timeout: 45000 })
  await client.page.locator('.studio-panel-status[data-tone="ready"]').waitFor({ timeout: 45000 })
  await host.page.locator('.studio-panel-status').filter({ hasText: 'Đã nhận qua LAN' }).waitFor({ timeout: 45000 })
  await host.page.locator('.studio-pdf-page canvas').first().waitFor()
  assert.equal(await host.page.getByRole('button', { name: 'Tin cậy và biên dịch', exact: true }).count(), 1)
  assert.equal(await host.page.getByRole('button', { name: 'Xuất PDF', exact: true }).isEnabled(), true)
  const pdfBytes = async page => page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(window.lanTestPdfUrl)).arrayBuffer())))
  assert.deepEqual(await pdfBytes(host.page), await pdfBytes(client.page), 'receiver renders exactly the sender PDF bytes')
  const pdfWorkspace = await host.page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.equal(pdfWorkspace.projects.flatMap(project => project.tasks).find(task => task.id === b.projects[0].tasks[0].id).sourceTrusted, false)
  await sync(client.page)
  // A fresh compile may produce new PDF bytes with unchanged source (fonts,
  // engine, timestamps). The receiver must replace its already displayed PDF.
  const senderWorkspace = await client.page.evaluate(() => window.desktopAPI.loadWorkspace())
  const senderTask = senderWorkspace.projects.flatMap(project => project.tasks).find(task => task.id === b.projects[0].tasks[0].id)
  const generated = toLatex(senderTask.document, senderTask.title, undefined, senderTask.settings)
  const replacement = [...await pdfBytes(client.page), ...Buffer.from('\n% LAN PDF revision test\n')]
  await client.page.evaluate(async ({ workspace, input, bytes }) => window.desktopAPI.publishSyncPdf(workspace, input, new Uint8Array(bytes)), {
    workspace: senderWorkspace, input: { id: senderTask.id, source: generated.latex, images: generated.images, assets: [] }, bytes: replacement,
  })
  let replacedBytes
  const pdfDeadline = Date.now() + 30000
  while (Date.now() < pdfDeadline) {
    replacedBytes = await pdfBytes(host.page).catch(() => [])
    if (replacedBytes.length === replacement.length) break
    await host.page.waitForTimeout(100)
  }
  assert.deepEqual(replacedBytes, replacement, 'a new PDF replaces the previous PDF even when source is unchanged')
  await sync(client.page)
  // Both editors now refer to the same stable task ID.
  await edit(host.page, 'Bản MacBook A cạnh tranh')
  await edit(client.page, 'Bản MacBook cạnh tranh')
  await sync(host.page)
  await panel(client.page)
  await client.page.getByRole('heading', { name: /Xung đột cần xử lý/ }).waitFor()
  await sync(client.page)
  assert.equal(await client.page.getByText('Đã đồng bộ và lưu trên máy.', { exact: true }).count(), 0, 'conflicts never display a delivery-success message')
  await client.page.getByText(/Còn \d+ xung đột chưa đồng bộ/).waitFor()
  await client.page.screenshot({ path: join(output, 'conflict.png') })
  // A user's conflict choice must wait for an in-flight automatic exchange.
  exchangeDelay = 2000
  const automaticExchange = nextExchange()
  await client.page.evaluate(() => window.dispatchEvent(new Event('online')))
  await automaticExchange
  await client.page.getByRole('button', { name: 'Giữ cả hai', exact: true }).first().click()
  const both = await waitSnapshot(client.page, snapshot => JSON.stringify(snapshot.projects).includes('bản xung đột'))
  exchangeDelay = 250
  const texts = JSON.stringify(both.projects)
  assert.match(texts, /Bản MacBook A cạnh tranh/); assert.match(texts, /Bản MacBook cạnh tranh/)
  await panel(client.page)
  const started = nextExchange()
  await client.page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click()
  await started
  await edit(client.page, 'Tiếp tục gõ trong lúc phản hồi mạng đang chờ')
  await waitSnapshot(client.page, snapshot => JSON.stringify(snapshot.projects).includes('Tiếp tục gõ trong lúc'))
  await client.page.waitForTimeout(500)
  await sync(client.page)
  await sync(host.page)
  const liveTyping = await host.page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.match(JSON.stringify(liveTyping.projects), /Tiếp tục gõ trong lúc/)
  await sync(client.page)
  await close(host)
  // The prior success result must change when a later background exchange fails.
  await client.page.getByText(/ECONNREFUSED|Không kết nối được|socket hang up|lỗi 503/).first().waitFor({ timeout: 35000 })
  assert.equal(await client.page.getByText('Đã đồng bộ và lưu trên máy.', { exact: true }).count(), 0, 'a prior success message cannot survive an automatic network failure')
  await edit(client.page, 'Nội dung offline chờ máy chủ mở lại')
  await panel(client.page)
  await client.page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click()
  await client.page.getByText(/ECONNREFUSED|Không kết nối được|socket hang up|lỗi 503/).first().waitFor({ timeout: 35000 })
  await waitSnapshot(client.page, snapshot => JSON.stringify(snapshot.projects).includes('Nội dung offline chờ máy chủ mở lại'))
  const saved = JSON.parse(await readFile(join(client.userData, 'workspace-v1.json'), 'utf8'))
  assert.match(JSON.stringify(saved), /Nội dung offline/)
  host = await launch('host')
  await sync(client.page)
  await sync(host.page)
  const final = await host.page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.match(JSON.stringify(final), /Nội dung offline/)
  await client.page.screenshot({ path: join(output, 'connected.png') })
  assert.deepEqual(errors, [])
  console.log('Two-desktop LAN passed: native background transfer both directions, exact compiled PDF displayed/exportable without granting source trust, pairing, stable IDs, truthful conflicts, concurrent typing, offline save and restart.')
} catch (error) {
  for (const app of running) {
    const page = app.windows()[0]
    console.error(await page?.evaluate(() => document.body.innerText.slice(-5000)).catch(() => null))
    await page?.screenshot({ path: join(output, `failure-${running.size}-${app.process().pid}.png`) }).catch(() => {})
  }
  throw error
} finally {
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
  for (const app of running) {
    const timer = setTimeout(() => app.process().kill(), 5000)
    await app.close().catch(() => {}); clearTimeout(timer)
  }
  await rm(directory, { recursive: true, force: true })
}
