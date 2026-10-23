/* global getComputedStyle */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { createProject, createTask } from '../src/services/WorkspaceData.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const output = process.env.TABLE_RENDER_OUTPUT || 'artifacts/table-form-fix'
await mkdir(output, { recursive: true })
const formula = String.raw`\hat y_t^{(m,n,k)} = f_{m,t}\left( y_{t-1}, \mathbf{x}_{sat,t}^{(n)}, \mathbf{x}_{econ,t-1}^{(k)} \right) \tag{1}`
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
// Imported Word tables can have bold tableCell nodes instead of tableHeader.
const table = {
  type: 'table', attrs: { tableStyle: null, tableNumber: '3', caption: 'Forecasting models and estimation settings' },
  content: [
    ['Model', 'Hyperparameter selection'],
    ['Bayesian Ridge', 'Internal parameter estimation'],
    ['Lasso', '16 regularization values; 3-fold time-series CV'],
  ].map((row, index) => ({ type: 'tableRow', content: row.map(text => ({
    type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(index === 0 ? { marks: [{ type: 'bold' }] } : {}) }] }],
  })) })),
}
const doc = { type: 'doc', content: [paragraph('Model forecast'), { type: 'blockMath', attrs: { latex: formula } }, table,
  { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2+1' } }] },
] }
const backend = await startGoBackendForTests()
let server, browser
try {
  for (const style of ['default', 'grid', 'academic']) {
    const example = structuredClone(table)
    if (style !== 'default') example.attrs.tableStyle = style
    const { latex } = toLatex({ type: 'doc', content: [example] }, '')
    const pdf = await backend.compileLatex(latex, [], { fresh: true })
    await writeFile(`${output}/${style}.pdf`, pdf)
    const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true })
    try {
      const document = await loading.promise
      const page = await document.getPage(1)
      const ops = await page.getOperatorList()
      const boxes = ops.fnArray.flatMap((op, index) => op === OPS.constructPath ? [Array.from(ops.argsArray[index][2])] : [])
      const horizontal = boxes.filter(([x1, y1, x2, y2]) => Math.abs(x2 - x1) > 250 && Math.abs(y2 - y1) < 1)
      assert.ok(horizontal.length >= (style === 'grid' ? 4 : 3), `${style}: actual PDF rules must span the table, including the header separator`)
      const vertical = boxes.filter(([x1, y1, x2, y2]) => Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) > 8)
      if (style === 'grid') assert.ok(vertical.length >= 3, 'an explicitly chosen grid retains vertical rules')
      else assert.equal(vertical.length, 0, 'academic tables have open sides rather than a box around every cell')
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = createCanvas(viewport.width, viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      await writeFile(`${output}/${style}.png`, canvas.toBuffer('image/png'))
      console.log(`PASS ${style}: ${horizontal.length} full-width PDF rules`)
    } finally { await loading.destroy() }
  }
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const project = createProject('Table and equation regression', createTask('Rendering regression', doc))
  await page.addInitScript(project => {
    localStorage.setItem('latex-theme-default-migrated', '1')
    localStorage.setItem('latex-theme', 'light')
    localStorage.setItem('latex-workspace-v1', JSON.stringify({ version: 1, projects: [project], activeProjectId: project.id, mode: 'write', theme: 'light' }))
    localStorage.setItem('latex-pdf-batch-mode', 'manual')
  }, project)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const block = page.locator('.tiptap [data-type="block-math"]')
  await block.waitFor()
  await block.locator('.katex-display .katex-tag').waitFor()
  assert.equal(await block.locator('.katex-error').count(), 0)
  assert.equal(await block.getAttribute('data-latex'), formula, 'rendering preserves the original editable formula')
  assert.match(await block.locator('.katex-tag').innerText(), /1/)
  assert.equal(await page.locator('.tiptap [data-type="inline-math"] .katex-display').count(), 0)
  const cell = page.locator('.tiptap table td').first()
  assert.equal(await page.locator('.tiptap table').getAttribute('data-table-style'), 'academic')
  assert.equal(await page.locator('.tiptap table').evaluate(element => getComputedStyle(element).borderTopWidth), '2px')
  assert.equal(await page.locator('.tiptap table').evaluate(element => getComputedStyle(element).borderBottomWidth), '2px')
  assert.equal(await cell.evaluate(element => getComputedStyle(element).borderLeftColor), 'rgba(0, 0, 0, 0)')
  assert.notEqual(await cell.evaluate(element => getComputedStyle(element).borderBottomColor), 'rgba(0, 0, 0, 0)', 'bold imported headers have a visible separator in the draft')
  await page.screenshot({ path: `${output}/editor.png`, fullPage: true })
  await page.locator('.styled-table').screenshot({ path: `${output}/table-preview.png` })
  await block.click()
  await page.locator('math-field').waitFor()
  assert.equal(await page.locator('math-field').evaluate(element => element.value), formula)
  console.log('PASS editor: tagged equation, editable source and academic rules with inferred Word header')
} finally {
  await browser?.close()
  await server?.close()
  await backend.close()
}
