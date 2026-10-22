import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { buildDesktop } from './build-desktop.mjs'

const require = createRequire(import.meta.url)
const { createRelayServer } = require('../electron/sync-relay-server.cjs')
const packaged = Boolean(process.env.DESKTOP_EXE)
if (!packaged) await buildDesktop()
const directory = await mkdtemp(join(tmpdir(), 'vietlatex-internet-desktop-'))
const output = resolve(packaged ? 'artifacts/project-sync-packaged' : 'artifacts/project-sync-desktop')
await mkdir(output, { recursive: true })
const relay = createRelayServer()
await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve))
const relayUrl = `http://127.0.0.1:${relay.server.address().port}`
const calls = [], apps = [], errors = []
relay.server.on('request', req => { if (req.url.endsWith('/call')) calls.push(req.headers['x-sync-path']) })
async function launch(name) {
  const allocator = createServer()
  await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
  const port = allocator.address().port
  await new Promise(resolve => allocator.close(resolve))
  const profile = join(directory, name)
  const env = { ...process.env, VIETLATEX_USER_DATA: profile, VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true', VIETLATEX_DISABLE_UPDATE_CHECK: 'true', VIETLATEX_TEST_SYNC_RELAY_ONLY: 'true', VIETLATEX_SYNC_RELAY_URL: relayUrl }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(process.env.DESKTOP_EXE || require('electron'), [...(packaged ? [] : ['.', '--built-renderer']), `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const instance = { child, profile }; apps.push(instance)
  let stderr = '', browser
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000) }); child.stdout.resume()
  const deadline = Date.now() + 45000
  while (!browser && child.exitCode === null && Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }) } catch { await delay(100) }
  }
  assert.ok(browser, stderr)
  instance.browser = browser
  let page
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0]?.pages().find(page => page.url().startsWith('vietlatex:'))
    if (!page) await delay(100)
  }
  assert.ok(page, stderr); instance.page = page
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor()
  return instance
}
async function panel(page) {
  if (!await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Đồng bộ dự án', exact: true }).click()
  await page.getByRole('button', { name: 'Đồng bộ', exact: true }).click()
}
async function saved(instance, text) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try { const value = JSON.parse(await readFile(join(instance.profile, 'workspace-v1.json'), 'utf8')); if (JSON.stringify(value).includes(text)) return value } catch { /* first save pending */ }
    await delay(200)
  }
  assert.fail(`Expected saved content: ${text}`)
}
async function stop(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) return
  instance.child.kill('SIGTERM')
  const deadline = Date.now() + 15000
  while (instance.child.exitCode === null && instance.child.signalCode === null && Date.now() < deadline) await delay(100)
  if (instance.child.exitCode === null && instance.child.signalCode === null) { instance.child.kill('SIGKILL'); throw new Error('Desktop failed to stop cleanly') }
  await instance.browser?.close()
}
try {
  const host = await launch('host'), client = await launch('client')
  assert.equal(await host.page.getByRole('button', { name: 'Đồng bộ dự án', exact: true }).isVisible(), true)
  assert.equal(await host.page.locator('.aurora-insights').count(), 0)
  await host.page.screenshot({ path: join(output, 'toolbar.png') })
  await host.page.locator('.tiptap').fill('Project đồng bộ qua Internet 2026')
  await saved(host, 'Project đồng bộ qua Internet 2026')
  await client.page.locator('.tiptap').fill('Tài liệu riêng không chia sẻ')
  const privateSnapshot = await saved(client, 'Tài liệu riêng không chia sẻ')
  const privateId = privateSnapshot.projects[0].id
  await panel(host.page)
  await host.page.getByRole('button', { name: 'Bật đồng bộ project', exact: true }).click()
  await host.page.getByRole('button', { name: 'Thêm thiết bị', exact: true }).click()
  const code = await host.page.getByRole('textbox', { name: 'Mã mời thêm thiết bị', exact: true }).inputValue()
  assert.ok(code.startsWith('vietlatex-sync:'))
  await panel(client.page)
  await client.page.getByRole('textbox', { name: 'Mã kết nối project', exact: true }).fill(code)
  await client.page.getByRole('button', { name: 'Kết nối project', exact: true }).click()
  await host.page.getByRole('button', { name: 'Cho phép thiết bị', exact: true }).click({ timeout: 20000 })
  const received = await saved(client, 'Project đồng bộ qua Internet 2026')
  assert.equal(received.projects.length, 2)
  assert.equal(received.activeProjectId, privateId)
  assert.ok(received.projects.some(project => project.id === privateId && JSON.stringify(project).includes('Tài liệu riêng không chia sẻ')))
  await client.page.getByText(packaged ? /Đã kết nối · qua (Internet|LAN)/ : 'Đã kết nối · qua Internet', { exact: false }).waitFor()
  await client.page.screenshot({ path: join(output, 'connected.png') })
  // Open the received document through the normal project picker.
  await client.page.getByRole('button', { name: 'Tài liệu', exact: true }).click()
  const shared = received.projects.find(project => project.id !== privateId)
  await client.page.locator('.studio-project-card').nth(received.projects.findIndex(project => project.id === shared.id)).getByRole('button', { name: shared.tasks[0].title, exact: false }).first().click()
  await client.page.locator('.tiptap').fill('Sửa từ laptop qua máy chủ chuyển tiếp')
  await saved(host, 'Sửa từ laptop qua máy chủ chuyển tiếp')
  const hostStored = JSON.parse(await readFile(join(host.profile, 'workspace-v1.json'), 'utf8'))
  assert.ok(!JSON.stringify(hostStored).includes('Tài liệu riêng không chia sẻ'))
  assert.ok(calls.includes('/pair'))
  if (!packaged) assert.ok(calls.includes('/exchange'))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, packaged, projectsOnRecipient: received.projects.length, privateProjectPreserved: true, encryptedRelayPairAndExchange: !packaged, screenshot: join(output, 'connected.png') }))
} finally {
  await Promise.allSettled(apps.map(stop))
  await relay.stop(); await rm(directory, { recursive: true, force: true })
}
