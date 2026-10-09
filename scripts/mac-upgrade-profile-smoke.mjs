// Run the packaged app against a copy of an existing profile; never edit the original.
/* global window */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { upgradeSnapshot } from './upgrade-snapshot.mjs'

if (process.platform !== 'darwin' || !process.env.DESKTOP_EXE || !process.env.UPGRADE_PROFILE) {
  throw new Error('Cần macOS, DESKTOP_EXE và UPGRADE_PROFILE để kiểm tra bản sao hồ sơ.')
}
const original = resolve(process.env.UPGRADE_PROFILE, 'workspace-v1.json')
const bytes = await readFile(original)
const expected = sanitizeWorkspace(JSON.parse(bytes))
assert.ok(expected)
const directory = await mkdtemp(join(tmpdir(), 'vietlatex-upgrade-copy-'))
await writeFile(join(directory, 'workspace-v1.json'), bytes)
// A new temporary LAN profile starts with sharing off, avoiding the real peers.
const allocator = createServer()
await new Promise(done => allocator.listen(0, '127.0.0.1', done))
const port = allocator.address().port
await new Promise(done => allocator.close(done))
const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', VIETLATEX_USER_DATA: directory, VIETLATEX_TEST_HIDE_WINDOW: 'true', VIETLATEX_WARM_TEX: '0' }
const appArgs = process.env.UPGRADE_DEV === 'true' ? [resolve('.')] : []
if (appArgs.length) env.VIETLATEX_TEST_PACKAGED_RENDERER = 'true'
for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'XELATEX_PATH', 'PANDOC_PATH', 'VIETLATEX_RESOURCES_PATH', 'VIETLATEX_APP_PATH']) delete env[name]
const child = spawn(process.env.DESKTOP_EXE, [...appArgs, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--disable-background-timer-throttling'], { cwd: tmpdir(), env, stdio: ['ignore', 'ignore', 'pipe'] })
let diagnostics = '', browser, exited = false
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-8000) })
const exit = new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { exited = true; done({ code, signal }) }) })
try {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline && !exited) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break } catch { await delay(150) }
  }
  assert.ok(browser, diagnostics)
  let page
  while (Date.now() < deadline) {
    page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('vietlatex:'))
    if (page) break
    await delay(100)
  }
  assert.ok(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).waitFor({ timeout: 30000 })
  const loaded = await page.evaluate(() => window.desktopAPI.loadWorkspace())
  assert.ok(isDeepStrictEqual(upgradeSnapshot(loaded), upgradeSnapshot(expected)), 'all existing documents load intact')
  await delay(2000)
  child.kill('SIGTERM')
  const result = await Promise.race([exit, delay(20000).then(() => null)])
  assert.ok(result, 'new app must flush and quit cleanly')
  assert.equal(result.code, 0)
  const saved = sanitizeWorkspace(JSON.parse(await readFile(join(directory, 'workspace-v1.json'))))
  // Timestamps can change on normal autosave; compare document data itself.
  const stable = upgradeSnapshot
  if (!isDeepStrictEqual(stable(saved), stable(expected))) {
    const paths = []
    const differences = (before, after, path = '') => {
      if (isDeepStrictEqual(before, after) || paths.length >= 50) return
      if (before && after && typeof before === 'object' && typeof after === 'object') {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) differences(before[key], after[key], `${path}.${key}`)
      } else paths.push(path)
    }
    differences(stable(expected), stable(saved))
    console.error(JSON.stringify({ changedPaths: paths }))
  }
  assert.ok(isDeepStrictEqual(stable(saved), stable(expected)), 'upgrade must preserve documents, source, settings, citations and assets')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ profileCopyUpgrade: 'passed', projects: expected.projects.length, documents: expected.projects.reduce((count, project) => count + project.tasks.length, 0), originalProfileModified: false }))
} finally {
  if (!exited) { child.kill('SIGKILL'); await exit.catch(() => {}) }
  await browser?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
