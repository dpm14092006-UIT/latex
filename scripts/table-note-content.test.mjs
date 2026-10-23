import assert from 'node:assert/strict'
import test from 'node:test'
import { tableNoteContent, tableNoteText } from '../src/services/TableNoteContent.js'
import { toWordAst } from '../src/services/WordDocument.js'
import { toLatex } from '../src/services/DocumentSerializer.js'

const table = note => ({ type: 'table', attrs: { note }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] }] }] })
const math = text => tableNoteContent(text).filter(node => node.type === 'inlineMath').map(node => node.attrs.latex)

test('notes share inline dollar, bracket and Unicode math without changing prose', () => {
  const note = String.raw`The $\mathrm{NO}_2$ scale; \(p = n+k\); SO₄²⁻; $5 and $10.`
  assert.deepEqual(math(note), [String.raw`\mathrm{NO}_2`, 'p = n+k', String.raw`\mathrm{SO}_{4}^{2-}`])
  const normalized = tableNoteText({ content: [{ type: 'paragraph', content: tableNoteContent(note) }] })
  assert.ok(normalized.endsWith('; $5 and $10.'))
  assert.deepEqual(tableNoteContent(normalized), tableNoteContent(note))
  assert.equal(tableNoteContent('Typing SO₄', { unicode: false }).some(node => node.type === 'inlineMath'), false)
})

test('currency, escaped dollars and malformed math stay literal in notes', () => {
  for (const text of [String.raw`Prices $5 and $10`, String.raw`Escaped \$x\$`, '$x}$', '${x$', '$x#1$', '$x%comment$']) {
    assert.deepEqual(math(text), [], text)
    assert.equal(tableNoteText({ content: [{ type: 'paragraph', content: tableNoteContent(text) }] }), text)
  }
  assert.deepEqual(math('$x$$y$'), ['x', 'y'])
})

test('note math becomes actual PDF math and editable Office math in Word AST', () => {
  const note = String.raw`Note: NO₂ uses $p = \frac{n+k}{N}$ and \(x_1\).`
  const doc = { type: 'doc', content: [table(note)] }
  const { latex } = toLatex(doc, '')
  assert.ok(latex.includes(String.raw`$\mathrm{NO}_{2}$ uses $p = \frac{n+k}{N}$ and $x_1$`))
  const ast = toWordAst(doc, '')
  const equations = ast.blocks[1].c[0].c.filter(node => node.t === 'Math')
  assert.deepEqual(equations.map(node => node.c[1]), [String.raw`\mathrm{NO}_{2}`, String.raw`p = \frac{n+k}{N}`, 'x_1'])
  assert.ok(equations.every(node => node.c[0].t === 'InlineMath'))
})
