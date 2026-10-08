import assert from 'node:assert/strict'
import { _electron as electron, chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer as createPortServer } from 'node:net'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { buildDesktop } from './build-desktop.mjs'
import { createServer, request as forwardRequest } from 'node:http'

if (!process.env.DESKTOP_EXE) await buildDesktop()
const output = resolve('artifacts/lan-sync-desktop')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(tmpdir(), 'vietlatex-sync-desktop-'))
const running = new Set(), errors = []
let proxy, exchangeStarted
const fixture = (name, text) => {
  const task = createTask(name, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const project = createProject(name, task)
  return { version: 1, projects: [project], activeProjectId: project.id, customTemplates: [], documentTemplates: [] }
}
const a = fixture('Máy Windows', 'Nội dung ban đầu Windows'), b = fixture('Máy MacBook', 'Nội dung ban đầu MacBook')
async function launch(name, value) {
  const userData = join(directory, name); await mkdir(userData, { recursive: true })
  if (value) await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify(value))
  const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true' }; delete env.ELECTRON_RUN_AS_NODE
  let app
  if (process.env.DESKTOP_EXE) {
    // Release fuses disable the Node inspector used by Playwright's Electron driver.
    // Attach to Chromium's loopback debugger instead; do not weaken the release fuses.
    const allocator = createPortServer(); await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
    const port = allocator.address().port; await new Promise(resolve => allocator.close(resolve))
    const child = spawn(process.env.DESKTOP_EXE, [`--remote-debugging-port=${port}`, '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
      const deadline = Date.now() + 20000
      while (child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      if (child.exitCode === null) child.kill()
      await browser.close().catch(() => {})
    } }
  } else app = await electron.launch({ args: ['.'], env, timeout: 45000 })
  running.add(app)
  if (!process.env.DESKTOP_EXE) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.webContents.setBackgroundThrottling(false); window.hide() }))
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor()
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
async function sync(page) { await panel(page); await page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click(); await page.getByText('Đã đồng bộ và lưu trên máy.', { exact: true }).waitFor() }
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
      setTimeout(() => response.pipe(res), req.url === '/exchange' ? 250 : 0)
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
  await sync(host.page)
  const received = await host.page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.equal(received.projects.length, 2)
  assert.ok(received.projects.some(project => project.id === b.projects[0].id))
  await edit(client.page, 'Sửa trên máy MacBook rồi gửi tới Windows')
  await sync(client.page)
  await sync(host.page)
  await host.page.getByRole('button', { name: 'Tài liệu', exact: true }).click()
  await host.page.getByRole('dialog').getByRole('button', { name: /^Máy MacBook/ }).click()
  await host.page.waitForFunction(() => document.querySelector('.tiptap')?.textContent.includes('Sửa trên máy MacBook'))
  await host.page.getByRole('button', { name: 'Tin cậy và biên dịch', exact: true }).waitFor()
  // Both editors now refer to the same stable task ID.
  await edit(host.page, 'Bản Windows cạnh tranh')
  await edit(client.page, 'Bản MacBook cạnh tranh')
  await sync(host.page)
  await sync(client.page)
  await client.page.getByRole('heading', { name: /Xung đột cần xử lý/ }).waitFor()
  await client.page.screenshot({ path: join(output, 'conflict.png') })
  await client.page.getByRole('button', { name: 'Giữ cả hai', exact: true }).first().click()
  const both = await waitSnapshot(client.page, snapshot => JSON.stringify(snapshot.projects).includes('bản xung đột'))
  const texts = JSON.stringify(both.projects)
  assert.match(texts, /Bản Windows cạnh tranh/); assert.match(texts, /Bản MacBook cạnh tranh/)
  await panel(client.page)
  let startTimer
  const started = new Promise((resolve, reject) => { exchangeStarted = () => { clearTimeout(startTimer); resolve() }; startTimer = setTimeout(() => reject(new Error('Lượt kiểm tra mạng chưa bắt đầu sau 15 giây.')), 15000) })
  await client.page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click()
  await started
  await edit(client.page, 'Tiếp tục gõ trong lúc phản hồi mạng đang chờ')
  await waitSnapshot(client.page, snapshot => JSON.stringify(snapshot.projects).includes('Tiếp tục gõ trong lúc'))
  await client.page.waitForTimeout(500)
  await sync(client.page)
  await sync(host.page)
  const liveTyping = await host.page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.match(JSON.stringify(liveTyping.projects), /Tiếp tục gõ trong lúc/)
  await close(host)
  await edit(client.page, 'Nội dung offline chờ máy chủ mở lại')
  await panel(client.page)
  await client.page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click()
  await client.page.getByText(/ECONNREFUSED|Không kết nối được|socket hang up|lỗi 503/).first().waitFor({ timeout: 35000 })
  const saved = JSON.parse(await readFile(join(client.userData, 'workspace-v1.json'), 'utf8'))
  assert.match(JSON.stringify(saved), /Nội dung offline/)
  host = await launch('host')
  await sync(client.page)
  await sync(host.page)
  const final = await host.page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.match(JSON.stringify(final), /Nội dung offline/)
  await client.page.screenshot({ path: join(output, 'connected.png') })
  assert.deepEqual(errors, [])
  console.log('Two-desktop LAN passed: pairing, stable IDs, remote edits, trust gate, conflict keep-both, typing during network I/O, offline save and host restart.')
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
