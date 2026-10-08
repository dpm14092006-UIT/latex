import { primaryKey } from './platform-keys.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createTask, createProject } from '../src/services/WorkspaceData.js'

const server = await createServer({ server: { host: '127.0.0.1', port: 5186, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const project = createProject('Kiểm thử', createTask('Công thức'))
  await page.addInitScript(data => localStorage.setItem('latex-workspace-v1', JSON.stringify(data)), {
    version: 1, projects: [project], activeProjectId: project.id, mode: 'write', activeTab: 'write', pdfMode: 'manual',
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5186')
  await page.locator('.tiptap').waitFor()
  await page.getByRole('button', { name: 'Chèn công thức toán học', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Gõ thường', exact: true }).click()
  const input = dialog.getByLabel('Công thức cần nhận diện')
  assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'plain-formula')
  await input.fill('p >= N_train')
  assert.equal(await dialog.getByLabel('LaTeX nhận diện được').inputValue(), String.raw`p \geq N_{\mathrm{train}}`)
  await dialog.locator('.studio-preview-box .katex').waitFor()
  const compactSamples = [
    ['Macro-F1=F1Emerging+F1Stable+F1Declining3', String.raw`\text{Macro-F1} = \frac{\mathrm{F1}_{\text{Emerging}} + \mathrm{F1}_{\text{Stable}} + \mathrm{F1}_{\text{Declining}}}{3}`],
    ['Yc,t(4){Emerging,Stable,Declining}', String.raw`Y_{c,t}^{(4)} \in \{\text{Emerging}, \text{Stable}, \text{Declining}\}`],
    ['SalesPerActiveProductc,t=Salesc,tActiveProductsc,t', String.raw`\mathrm{SalesPerActiveProduct}_{c,t} = \frac{\mathrm{Sales}_{c,t}}{\mathrm{ActiveProducts}_{c,t}}`],
  ]
  for (const [plain, latex] of compactSamples) {
    await input.fill(plain)
    assert.equal(await dialog.getByLabel('LaTeX nhận diện được').inputValue(), latex)
    await dialog.locator('.studio-preview-box .katex').waitFor()
  }
  await input.fill('sqrt(')
  assert.ok(await dialog.getByRole('alert').isVisible())
  assert.ok(await dialog.getByRole('button', { name: 'Chèn công thức', exact: true }).isDisabled())
  await input.press(`${primaryKey}+Enter`)
  assert.ok(await dialog.isVisible())
  await input.fill('(a+b)/sqrt(x^2+1)')
  await dialog.getByRole('button', { name: 'Sửa mã LaTeX', exact: true }).click()
  assert.equal(await dialog.locator('textarea:visible').inputValue(), String.raw`\frac{a + b}{\sqrt{x^{2} + 1}}`)
  await dialog.getByRole('button', { name: 'Chèn công thức', exact: true }).click()
  await page.locator('.tiptap .katex').waitFor()
  assert.equal(await dialog.count(), 0)
  assert.equal(await page.locator('.tiptap .katex-error').count(), 0)
  await page.getByRole('button', { name: 'Chèn công thức toán học', exact: true }).first().click()
  await dialog.getByRole('button', { name: 'Gõ thường', exact: true }).click()
  await page.evaluate(() => navigator.clipboard.writeText('p >= N_train'))
  await input.press(`${primaryKey}+V`)
  assert.equal(await dialog.getByLabel('LaTeX nhận diện được').inputValue(), String.raw`p \geq N_{\mathrm{train}}`)
  await dialog.getByRole('button', { name: 'Chèn công thức', exact: true }).click()
  await page.locator('.tiptap .katex').nth(1).waitFor()
  assert.equal(await page.locator('.studio-trust-banner').count(), 0)
  await page.locator('.tiptap').fill('The score is x^2 + y^2 = z^2 for all cases.')
  await page.locator('.studio-ribbon-tabs').getByRole('button', { name: 'Chèn', exact: true }).click()
  await page.getByRole('button', { name: 'Quét công thức trong bản thảo và xem gợi ý LaTeX', exact: true }).click()
  const scanDialog = page.getByRole('dialog', { name: 'Quét gợi ý LaTeX' })
  await scanDialog.getByText('x^2 + y^2 = z^2', { exact: true }).waitFor()
  assert.match(await scanDialog.innerText(), /Có dấu quan hệ và toán hạng gọn/)
  await scanDialog.getByRole('checkbox', { name: 'Duyệt x^2 + y^2 = z^2' }).check()
  await scanDialog.getByRole('button', { name: 'Chuyển 1 gợi ý' }).click()
  await page.locator('.tiptap .katex').waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Quét gợi ý LaTeX' }).count(), 0)
  await page.locator('.tiptap').fill('x^2 + y^2 = z^2')
  await page.getByRole('button', { name: 'Quét công thức trong bản thảo và xem gợi ý LaTeX', exact: true }).click()
  const blockScanDialog = page.getByRole('dialog', { name: 'Quét gợi ý LaTeX' })
  const blockSuggestion = blockScanDialog.getByRole('checkbox', { name: 'Duyệt x^2 + y^2 = z^2' })
  await blockSuggestion.waitFor()
  assert.equal(await blockScanDialog.getByLabel('Kiểu chèn x^2 + y^2 = z^2').inputValue(), 'block')
  await blockSuggestion.check()
  await blockScanDialog.getByRole('button', { name: 'Chuyển 1 gợi ý' }).click()
  await page.locator('.tiptap [data-type="block-math"]').waitFor()
  assert.deepEqual(errors, [])
  console.log('Formula recognition UI: typed conversion, scan suggestions, inline/display review and insertion passed.')
} finally {
  await browser?.close()
  await server.close()
}
