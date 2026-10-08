import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

let server, browser, backend
let releaseHeld
const requests = [], errors = []
try {
  backend = await startGoBackendForTests()
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch({ ...(process.env.PDF_SMOKE_BROWSER && process.env.PDF_SMOKE_BROWSER !== 'chromium' ? { channel: process.env.PDF_SMOKE_BROWSER } : {}), headless: true })
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/compile', async route => {
    const input = route.request().postDataJSON()
    requests.push(input)
    if (requests.length === 3) await new Promise(resolve => { releaseHeld = resolve })
    const pdf = await backend.compileLatex(input.latex, input.images, { assets: input.assets, fresh: input.fresh })
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf })
  })
  await page.goto(server.resolvedUrls.local[0])
  await page.locator('.tiptap').fill(String.raw`Live formula \(x^2+1\) and normal text a/b.`)
  await page.locator('.tiptap .katex').waitFor()
  await page.waitForTimeout(1200)
  assert.equal(requests.length, 0, 'math renders immediately without compiling PDF')
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  assert.equal(await page.getByLabel('Chế độ cập nhật PDF').inputValue(), '2')
  await page.getByLabel('Chế độ cập nhật PDF').selectOption('manual')
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  await page.locator('.studio-panel-status[data-tone="ready"]').filter({ hasText: 'Đã cập nhật' }).waitFor({ timeout: 30000 })
  assert.equal(requests.length, 1)
  await page.locator('.studio-pdf-page canvas').first().waitFor({ timeout: 15000 })

  await page.locator('.tiptap').fill(String.raw`Latest export marker \(\frac{a}{b}\).`)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Xuất PDF', exact: true }).click()
  const download = await downloaded
  assert.match(requests.at(-1).latex, /Latest export marker/)
  assert.equal(requests.length, 2)
  const bytes = await readFile(await download.path())
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')

  await page.locator('.tiptap').fill('Third version before a slow compile.')
  await page.getByText('Có thay đổi chưa cập nhật vào PDF.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Cập nhật PDF', exact: true }).click()
  while (!releaseHeld) await page.waitForTimeout(20)
  await page.locator('.tiptap').fill('Fourth version replaces queued edits.')
  await page.waitForTimeout(300)
  assert.equal(requests.length, 3, 'no overlapping compile on edits')
  const updatePdfButton = page.getByRole('button', { name: 'Cập nhật PDF', exact: true })
  await page.locator('button[aria-label="Cập nhật PDF"]').filter({ hasText: 'Xếp bản mới nhất' }).waitFor()
  await updatePdfButton.click()
  releaseHeld()
  await page.locator('.studio-panel-status[data-tone="ready"]').filter({ hasText: 'Đã cập nhật' }).waitFor({ timeout: 30000 })
  assert.equal(requests.length, 4)
  assert.match(requests.at(-1).latex, /Fourth version/)

  await page.locator('.tiptap').fill(String.raw`Uncompiled draft \(E=mc^2\).`)
  await page.getByText('Có thay đổi chưa cập nhật vào PDF.', { exact: false }).waitFor()
  await page.locator('.tiptap .katex').waitFor()
  await mkdir('artifacts/pdf-batching', { recursive: true })
  await page.screenshot({ path: 'artifacts/pdf-batching/stale-preview.png', fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  await page.getByLabel('Chế độ cập nhật PDF').waitFor()
  assert.equal(await page.getByLabel('Chế độ cập nhật PDF').inputValue(), 'manual')
  await page.waitForTimeout(1000)
  assert.equal(requests.length, 4, 'manual preference survives reload without compile')
  assert.deepEqual(errors, [])
  console.log('PDF batching UI passed: immediate math, no keystroke compile, manual update, fresh export, latest-only queue, stale preview, persisted mode.')
} finally {
  releaseHeld?.()
  await browser?.close()
  await server?.close()
  await backend?.close()
}
