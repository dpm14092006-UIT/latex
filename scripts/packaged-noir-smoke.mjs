/* global window, document */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const exe = resolve(process.env.DESKTOP_EXE || `release-desktop/VietLatex-Studio-${version}/Viet Latex Studio.exe`)
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-packaged-noir-'))
const output = resolve('artifacts/noir-packaged')
await mkdir(output, { recursive: true })
const socket = createServer()
await new Promise(done => socket.listen(0, '127.0.0.1', done))
const port = socket.address().port
await new Promise(done => socket.close(done))
let child, browser, exitPromise
const errors = []
async function launch() {
  const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_HIDE_WINDOW: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  child = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: 'ignore' })
  exitPromise = new Promise((done, reject) => { child.once('exit', done); child.once('error', reject) })
  const deadline = Date.now() + 45000
  let ready = false
  while (Date.now() < deadline) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { /* Wait for Chromium in the packaged process. */ }
    if (ready) break
    if (child.exitCode !== null) throw new Error(`Packaged app exited: ${child.exitCode}`)
    await delay(200)
  }
  assert.ok(ready, 'packaged EXE exposes its renderer for inspection')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts()[0].pages()[0]
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).waitFor()
  assert.equal(new URL(page.url()).protocol, 'vietlatex:')
  assert.equal((await page.evaluate(() => window.desktopAPI.environment())).version, version)
  return page
}
async function close(page) {
  await page.evaluate(() => window.close())
  await Promise.race([exitPromise, delay(15000).then(() => { throw new Error('Packaged app did not flush and close') })])
  await browser.close()
  browser = undefined
}
try {
  let page = await launch()
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).fill('Kiểm tra EXE Noir — tiếng Việt')
  await page.locator('.tiptap').fill('Bản desktop đóng gói giữ dữ liệu tiếng Việt và toàn bộ công cụ.')
  await page.getByRole('button', { name: 'Chèn', exact: true }).click()
  await page.getByRole('button', { name: 'Chèn công thức toán học', exact: true }).click()
  await page.locator('math-field').waitFor()
  await page.waitForFunction(() => document.querySelector('math-field')?.setValue)
  await page.locator('math-field').evaluate(field => { field.value = 'x^2+1'; field.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.getByRole('dialog').getByRole('button', { name: 'Chèn công thức', exact: true }).click()
  await page.locator('.tiptap .katex').first().waitFor()
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  if (await page.getByRole('button', { name: 'Mở công cụ PDF', exact: true }).count()) await page.getByRole('button', { name: 'Mở công cụ PDF', exact: true }).click()
  await page.getByRole('combobox', { name: 'Chế độ cập nhật PDF', exact: true }).selectOption('manual')
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.locator('.studio-pdf-canvas canvas').first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Đặt thanh chế độ bên dưới', exact: true }).click()
  await page.getByRole('button', { name: 'Thu gọn công cụ PDF', exact: true }).click()
  await page.screenshot({ path: join(output, 'real-exe-pdf.png') })
  const wordBytes = await page.evaluate(async () => {
    const ast = { 'pandoc-api-version': [1, 23, 1], meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'VietLaTeX' }, { t: 'Space' }, { t: 'Math', c: [{ t: 'InlineMath' }, 'x^2+1'] }] }] }
    return Array.from((await window.desktopAPI.convertWord('export', ast)).bytes)
  })
  assert.match(strFromU8(unzipSync(Uint8Array.from(wordBytes))['word/document.xml']), /m:oMath/)
  await page.getByRole('button', { name: 'Quản lý tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Sao lưu', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo điểm khôi phục', exact: true }).click()
  await page.getByText('Đã tạo bản sao lưu.', { exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Mở bản khôi phục', exact: true }).count())
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).fill('EXE — đã lưu trước khi đóng')
  await close(page)
  page = await launch()
  assert.equal(await page.getByRole('textbox', { name: 'Tên tài liệu', exact: true }).inputValue(), 'EXE — đã lưu trước khi đóng')
  assert.equal(await page.locator('html').getAttribute('data-dock'), 'bottom')
  await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
  assert.match(await page.locator('.tiptap').innerText(), /Bản desktop đóng gói/)
  await page.locator('.tiptap .katex').first().waitFor()
  await page.screenshot({ path: join(output, 'reopened.png') })
  assert.deepEqual(errors, [])
  await close(page)
  console.log(`Actual packaged EXE ${version} passed: native backend, real PDF, formula, Word OMML, backup, dock and document persistence, graceful close and reopen.`)
} finally {
  await browser?.close()
  if (child && child.exitCode === null) { child.kill(); await exitPromise }
  await rm(userData, { recursive: true, force: true })
}
