/* global window, document */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createProject, createTask } from '../src/services/WorkspaceData.js'

const output = resolve('artifacts/math-keyboard')
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 5195, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const project = createProject('Bàn phím công thức', createTask('Kiểm tra'))
  await page.addInitScript(data => {
    localStorage.setItem('latex-workspace-v1', JSON.stringify(data))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, {
    version: 1, projects: [project], activeProjectId: project.id, mode: 'write', activeTab: 'write', pdfMode: 'manual',
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5195')
  await page.locator('.tiptap').waitFor()
  const open = async () => {
    await page.getByRole('button', { name: 'Chèn công thức toán học', exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('math-field')?.setValue)
    await page.waitForFunction(() => document.activeElement === document.querySelector('math-field'))
  }
  const show = async () => {
    await page.locator('math-field').locator('[part="virtual-keyboard-toggle"]').click()
    await page.waitForFunction(() => {
      const keyboard = window.mathVirtualKeyboard
      return keyboard?.visible && keyboard.boundingRect.height > 0 && keyboard.boundingRect.bottom <= window.innerHeight + 1
    })
  }
  const hidden = () => page.waitForFunction(() => !window.mathVirtualKeyboard?.visible)
  const dialog = page.getByRole('dialog')

  await open()
  await show()
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    // Check real screen coordinates, not just DOM visibility: the keyboard
    // must never cover the field or its dismissal control, even after resize.
    await page.waitForFunction(() => {
      const keyboard = window.mathVirtualKeyboard.boundingRect
      const modal = document.querySelector('[role="dialog"]')?.getBoundingClientRect()
      const field = document.querySelector('math-field')?.getBoundingClientRect()
      const button = [...document.querySelectorAll('[role="dialog"] button')].find(item => item.textContent.includes('Đóng bàn phím'))?.getBoundingClientRect()
      return keyboard.height > 0 && keyboard.bottom <= window.innerHeight + 1 && modal && field && button
        && modal.top >= 0 && modal.bottom <= keyboard.top + 1
        && field.top >= modal.top && field.bottom <= modal.bottom
        && button.top >= modal.top && button.bottom <= modal.bottom
    })
    await page.screenshot({ path: resolve(output, `visible-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('button', { name: 'Đóng bàn phím', exact: true }).click()
  await hidden()
  assert.ok(await dialog.isVisible())
  await show()
  await page.evaluate(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  assert.ok(await page.evaluate(() => window.mathVirtualKeyboard.visible), 'IME Escape must not dismiss the keyboard')
  await page.keyboard.press('Escape')
  await hidden()
  assert.ok(await dialog.isVisible(), 'first Escape hides only the keyboard')
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 0)

  await open()
  await show()
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await hidden()
  assert.equal(await dialog.count(), 0)
  await page.evaluate(() => window.mathVirtualKeyboard.show())
  await hidden()

  await open()
  await show()
  await dialog.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await hidden()
  await dialog.getByRole('button', { name: 'Trực quan', exact: true }).click()
  await show()
  await page.locator('math-field').click()
  await page.waitForFunction(() => {
    const field = document.querySelector('math-field')
    return document.activeElement === field && field.shadowRoot?.activeElement?.isContentEditable
  })
  await page.keyboard.type('z')
  assert.match(await page.locator('math-field').evaluate(field => field.value), /z/)
  await dialog.getByRole('button', { name: 'Chèn công thức', exact: true }).click()
  await hidden()
  await page.locator('.tiptap .katex').waitFor()
  assert.equal(await dialog.count(), 0)
  assert.deepEqual(errors, [])
  console.log('Math keyboard passed: visible input at desktop/laptop/mobile sizes, close button, Escape/IME, mode switch, insertion and no orphan keyboard.')
} finally {
  await browser?.close()
  await server.close()
}
