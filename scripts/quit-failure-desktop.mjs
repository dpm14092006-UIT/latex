import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDesktop } from './build-desktop.mjs'

await buildDesktop()
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-quit-regression-'))
let app
try {
  const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_PACKAGED_RENDERER: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.'], env, timeout: 45000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()))
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor()
  await page.evaluate(() => window.desktopAPI.environment())
  await app.evaluate(({ ipcMain, dialog, app }) => {
    globalThis.quitSaveError = null
    dialog.showErrorBox = (title, message) => { globalThis.quitSaveError = { title, message } }
    ipcMain.removeHandler('workspace:save')
    ipcMain.handle('workspace:save', () => { throw new Error('TEST: disk write failure') })
    app.quit()
  })
  await page.waitForFunction(() => document.body.textContent.includes('Không thể lưu tiến trình trên máy'))
  assert.ok(await app.evaluate(() => globalThis.quitSaveError))
  const environment = await page.evaluate(() => window.desktopAPI.environment())
  assert.ok(environment.compiler, 'backend must remain available after cancelled quit')
  await page.locator('.tiptap').fill('Vẫn soạn thảo sau khi hủy thoát.')
  assert.match(await page.locator('.tiptap').innerText(), /Vẫn soạn thảo/)
  console.log('Quit regression passed: failed save cancels quit, retains the window and keeps backend available.')
} finally {
  if (app) await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('workspace:save')
    ipcMain.handle('workspace:save', () => ({ saved: true }))
  }).catch(() => {})
  const timer = app && setTimeout(() => app.process().kill(), 5000)
  await app?.close().catch(() => {})
  if (timer) clearTimeout(timer)
  await rm(userData, { recursive: true, force: true })
}
