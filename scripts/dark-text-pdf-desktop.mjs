/* global window, document, DataTransfer, ClipboardEvent, getComputedStyle */
import assert from 'node:assert/strict'
import { _electron as electron, chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { normalizeTextColor } from '../src/services/RichTextFormats.js'
import { documentEndKey, primaryKey } from './platform-keys.mjs'

const output = resolve('artifacts/dark-text-pdf')
const userData = await mkdtemp(join(tmpdir(), 'vietlatex-dark-text-'))
await mkdir(output, { recursive: true })
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const para = (value, marks) => ({ type: 'paragraph', content: [text(value, marks)] })
const legacy = { type: 'doc', content: [
  para('Legacy white text', [{ type: 'textStyle', attrs: { color: '#ffffff', fontSize: '14pt' } }, { type: 'bold' }]),
  para('Legacy theme text', [{ type: 'textStyle', attrs: { color: '#f2f2f2' } }]),
  para('Authored red', [{ type: 'textStyle', attrs: { color: '#c62828' } }]),
  para('Highlighted text', [{ type: 'textStyle', attrs: { color: '#ffffff' } }, { type: 'highlight', attrs: { color: '#fff59d' } }]),
  para('Black highlighted text', [{ type: 'textStyle', attrs: { color: '#000000' } }, { type: 'highlight', attrs: { color: '#fff59d' } }]),
  { type: 'paragraph' },
] }
// Bypass createTask's repair to exercise opening an actual legacy workspace.
const task = createTask('Màu chữ trên MacBook'); task.document = legacy
const project = createProject('Dark text regression', task)
await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write', pdfMode: 'manual', theme: 'dark' }))
const env = { ...process.env, VIETLATEX_USER_DATA: userData, VIETLATEX_TEST_PACKAGED_RENDERER: 'true', VIETLATEX_TEST_HIDE_WINDOW: 'true', VIETLATEX_WARM_TEX: '0' }
delete env.ELECTRON_RUN_AS_NODE
let app, browser, child, loading, page
const errors = []
const editorDoc = () => page.locator('.tiptap').evaluate(element => element.editor.getJSON())
function assertAutomaticForeground(doc) {
  const visit = node => {
    for (const mark of node.marks || []) if (mark.type === 'textStyle' && mark.attrs?.color) assert.ok(normalizeTextColor(mark.attrs.color), JSON.stringify(mark))
    for (const child of node.content || []) visit(child)
  }
  visit(doc)
}
try {
  if (process.env.DESKTOP_EXE) {
    const allocator = createServer()
    await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve))
    const port = allocator.address().port
    await new Promise(resolve => allocator.close(resolve))
    child = spawn(process.env.DESKTOP_EXE, [`--remote-debugging-port=${port}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-5000) })
    child.stdout.resume()
    const deadline = Date.now() + 45000
    while (!browser && Date.now() < deadline && child.exitCode === null) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }) } catch { await new Promise(resolve => setTimeout(resolve, 150)) }
    }
    assert.ok(browser, `Packaged application did not start: ${diagnostics}`)
    while (!page && Date.now() < deadline) {
      page = browser.contexts()[0]?.pages().find(item => item.url().startsWith('vietlatex:'))
      if (!page) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(page, `Packaged renderer did not start: ${diagnostics}`)
  } else {
    app = await electron.launch({ args: ['.'], env, timeout: 45000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.webContents.setBackgroundThrottling(false); window.hide() }))
    page = await app.firstWindow()
  }
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Tên tài liệu' }).waitFor({ timeout: 30000 })
  const editor = page.locator('.tiptap')
  await editor.waitFor()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  assertAutomaticForeground(await editorDoc())
  const highlightColors = await editor.locator('mark').evaluateAll(elements => elements.map(element => getComputedStyle(element.querySelector('span') || element).color))
  assert.deepEqual(highlightColors, ['rgb(0, 0, 0)', 'rgb(0, 0, 0)'], 'highlighted text stays readable on pale backgrounds in dark mode')
  assert.equal((await editorDoc()).content[0].content[0].marks.find(mark => mark.type === 'textStyle').attrs.fontSize, '14pt')
  await editor.locator('p').first().click()
  await editor.press(`${primaryKey}+ArrowRight`)
  await editor.pressSequentially(' inherited typing')
  await editor.press(documentEndKey)
  await editor.pressSequentially('Dark typed text')
  await editor.press('Enter')
  await editor.pressSequentially('Second dark line')
  await editor.press('Shift+Enter')
  await editor.pressSequentially('Tiếng Việt')
  await editor.press('Backspace')
  await editor.pressSequentially('t')
  await page.evaluate(() => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/html', '<p><span style="color: rgb(242, 242, 242)">Pasted theme text</span></p>')
    document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
  })
  await editor.pressSequentially(' paste inherited typing')
  const darkDocument = await editorDoc()
  assertAutomaticForeground(darkDocument)
  assert.match(JSON.stringify(darkDocument), /inherited typing/)
  assert.match(JSON.stringify(darkDocument), /Dark typed text/)
  const darkLatex = toLatex(darkDocument, 'Màu chữ trên MacBook').latex
  assert.doesNotMatch(darkLatex, /\\textcolor\[HTML\]\{(?:FFFFFF|F2F2F2|E0E0E0)\}/)
  assert.match(darkLatex, /\\textcolor\[HTML\]\{C62828\}/)
  await page.getByRole('button', { name: 'Nền trắng', exact: true }).click()
  assert.deepEqual(await editorDoc(), darkDocument, 'theme switching must not change document formatting')
  await page.getByRole('button', { name: 'Nền đen', exact: true }).click()
  assert.deepEqual(await editorDoc(), darkDocument)
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => {
      const url = original(blob)
      if (blob.type === 'application/pdf') window.darkTextPdfUrl = url
      return url
    }
  })
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  const tools = page.getByRole('button', { name: 'Mở công cụ PDF', exact: true })
  if (await tools.count()) await tools.click()
  await page.getByRole('combobox', { name: 'Chế độ cập nhật PDF', exact: true }).selectOption('manual')
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.waitForFunction(() => Boolean(window.darkTextPdfUrl), undefined, { timeout: 90000 })
  const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(window.darkTextPdfUrl)).arrayBuffer()))))
  await writeFile(join(output, 'dark-typing.pdf'), bytes)
  await writeFile(join(output, 'document.tex'), darkLatex)
  loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await loading.promise
  const rendered = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const pdfPage = await pdf.getPage(number)
    const ops = await pdfPage.getOperatorList()
    let fill = '#000000'
    const stack = []
    for (let index = 0; index < ops.fnArray.length; index += 1) {
      const fn = ops.fnArray[index], args = ops.argsArray[index]
      if (fn === OPS.save) stack.push(fill)
      else if (fn === OPS.restore) fill = stack.pop() || '#000000'
      else if (fn === OPS.setFillRGBColor) fill = typeof args[0] === 'string' ? args[0] : `#${Array.from(args).map(channel => channel.toString(16).padStart(2, '0')).join('')}`
      else if (fn === OPS.setFillGray) fill = Number(args[0]) === 0 ? '#000000' : '#ffffff'
      else if (fn === OPS.showText) {
        const value = args[0].map(glyph => typeof glyph === 'object' ? glyph.unicode || '' : '').join('')
        if (value.trim()) rendered.push({ text: value, color: fill.toLowerCase() })
      }
    }
  }
  const blackText = rendered.filter(item => item.color === '#000000').map(item => item.text).join(' ')
  for (const word of ['Legacy', 'white', 'theme', 'Dark', 'typed', 'Pasted', 'Highlighted']) assert.ok(blackText.includes(word), `PDF must paint ${word} black: ${JSON.stringify(rendered)}`)
  assert.ok(rendered.some(item => item.color === '#c62828' && /Authored|red/.test(item.text)), 'intentional red survives into PDF')
  assert.ok(rendered.every(item => normalizeTextColor(item.color)), `PDF has an invisible neutral foreground: ${JSON.stringify(rendered)}`)
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.studio-pdf-page canvas')
    return canvas?.width > 100 && !document.querySelector('.studio-pdf-page-loading')
  }, undefined, { timeout: 45000 })
  await page.screenshot({ path: join(output, 'dark-typing-pdf.png') })
  await page.waitForTimeout(600)
  const saved = await page.evaluate(() => window.desktopAPI.loadWorkspace())
  assertAutomaticForeground(saved.projects[0].tasks[0].document)
  assert.deepEqual(saved.projects[0].tasks[0].document, darkDocument, 'saved document retains typed content and repaired colors')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ packaged: Boolean(process.env.DESKTOP_EXE), colors: rendered, errors }, null, 2))
  console.log(`Dark text/PDF passed: legacy repair, real typing, inherited typing, Enter/Shift+Enter/Backspace, paste, theme toggling, persisted formatting and actual black/red PDF paint (packaged=${Boolean(process.env.DESKTOP_EXE)}).`)
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => 'Renderer unavailable'))
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await loading?.destroy()
  if (app || child) {
    const process = child || app.process()
    const exited = new Promise(resolve => { if (process.exitCode !== null || process.signalCode) resolve(); else process.once('exit', resolve) })
    process.kill('SIGTERM')
    const timer = setTimeout(() => process.kill('SIGKILL'), 20000)
    try { await exited } finally { clearTimeout(timer) }
  }
  await browser?.close().catch(() => {})
  await rm(userData, { recursive: true, force: true })
}
