/* global window */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { createProject, createTask } from '../src/services/WorkspaceData.js'

const require = createRequire(import.meta.url)
const root = resolve('.')
const profile = await mkdtemp(join(tmpdir(), 'vietlatex-shortcuts-'))
const output = resolve('artifacts/keyboard-shortcuts-desktop')
await mkdir(output, { recursive: true })
const project = createProject('Kiểm tra phím tắt desktop', createTask('Phím tắt desktop', { type: 'doc', content: [{ type: 'paragraph' }] }))
await writeFile(join(profile, 'workspace-v1.json'), JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write', activeTab: 'write' }))
const allocator = createServer()
await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
const port = allocator.address().port
await new Promise(resolve => allocator.close(resolve))
const env = { ...process.env, VIETLATEX_USER_DATA: profile, VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true', VIETLATEX_DISABLE_UPDATE_CHECK: 'true' }
delete env.ELECTRON_RUN_AS_NODE
const executable = process.env.SHORTCUTS_DESKTOP_EXE || require('electron')
const child = spawn(executable, [...(process.env.SHORTCUTS_DESKTOP_EXE ? [] : ['.']), `--remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let stderr = '', browser, page
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000) })
child.stdout.resume()
try {
  const deadline = Date.now() + 45000
  while (!browser && child.exitCode === null && Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 800 }) } catch { await delay(100) }
  }
  assert.ok(browser, stderr)
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0]?.pages().find(item => item.url().startsWith('vietlatex:'))
    if (!page) await delay(100)
  }
  assert.ok(page, stderr)
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const draft = page.locator('.tiptap')
  await draft.waitFor()
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control'
  await draft.fill('Phím tắt chạy trên ứng dụng desktop')
  await draft.press(`${primary}+a`)
  await draft.press(`${primary}+b`)
  assert.equal(await draft.locator('strong').innerText(), 'Phím tắt chạy trên ứng dụng desktop')
  await draft.press(`${primary}+i`)
  assert.equal(await draft.locator('em').innerText(), 'Phím tắt chạy trên ứng dụng desktop')
  await draft.press(`${primary}+u`)
  assert.equal(await draft.locator('u').innerText(), 'Phím tắt chạy trên ứng dụng desktop')
  await draft.press(`${primary}+s`)
  await page.getByRole('button', { name: 'Phím tắt', exact: true }).click()
  const help = page.getByRole('dialog', { name: 'Phím tắt', exact: true })
  await help.waitFor()
  await help.getByRole('searchbox', { name: 'Tìm phím tắt', exact: true }).fill('in dam')
  assert.equal(await help.locator('dt').innerText(), 'In đậm')
  await page.screenshot({ path: join(output, 'help.png') })
  await page.keyboard.press('Escape')
  await draft.press('F1')
  await help.waitFor()
  await page.keyboard.press('F1')
  await help.waitFor({ state: 'detached' })
  await draft.press(`${primary}+Shift+m`)
  await page.getByRole('dialog', { name: 'Chèn công thức', exact: true }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click()
  const version = await page.evaluate(async () => (await window.desktopAPI.environment()).version)
  assert.equal(version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version)
  assert.deepEqual(errors, [])
  const stored = JSON.parse(await readFile(join(profile, 'workspace-v1.json'), 'utf8'))
  assert.ok(JSON.stringify(stored).includes('Phím tắt chạy trên ứng dụng desktop'))
  const report = { passed: true, version, executable, temporaryProfile: true, formatting: true, save: true, helpButtonAndF1: true, formulaShortcut: true, pageErrors: errors }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)+'\n')
  console.log(JSON.stringify(report))
} finally {
  await browser?.close().catch(() => {})
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  const deadline = Date.now() + 5000
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100)
  const relativeProfile = relative(resolve(tmpdir()), resolve(profile))
  assert.ok(relativeProfile && !relativeProfile.startsWith('..') && !isAbsolute(relativeProfile) && basename(profile).startsWith('vietlatex-shortcuts-'), 'Temporary profile must stay inside the task temp directory')
  await rm(profile, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
}
