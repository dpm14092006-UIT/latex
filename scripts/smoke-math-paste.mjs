import assert from 'node:assert/strict'
import katex from 'katex'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { normalizeFormulaInput, standaloneLatexPaste } from '../src/math-input.js'

const sample = String.raw`\mathrm{RMSE}_{\mathcal V_t(\theta)} =
\sqrt{
  \frac{1}{\mathcal V_t}
  \sum_{i\in\mathcal V_t}
  \left(
    y_i-\widehat y_i(\theta)
  \right)^2
}`
const parsed = standaloneLatexPaste(sample, normalizeFormulaInput)
assert.equal(parsed?.type, 'block', 'bare multiline LaTeX should become a display formula')
assert.match(parsed?.latex || '', /\\sqrt\{.*\\frac\{1\}/, 'newlines should normalize without losing the equation')
assert.doesNotThrow(() => katex.renderToString(parsed.latex, { throwOnError: true, displayMode: true }), 'the pasted formula should render cleanly')
assert.equal(standaloneLatexPaste(String.raw`\(\frac{a}{b}\)`, normalizeFormulaInput)?.type, 'inline')
assert.equal(standaloneLatexPaste(String.raw`E_t^{(k)}`, normalizeFormulaInput)?.type, 'inline', 'bare one-line formulas should stay inline')
assert.equal(standaloneLatexPaste(String.raw`\[E_t^{(k)}\]`, normalizeFormulaInput)?.type, 'block', 'explicit display delimiters should remain block formulas')
assert.equal(standaloneLatexPaste('This prose includes the word formula.', normalizeFormulaInput), null)
assert.equal(standaloneLatexPaste(String.raw`\documentclass{article}\begin{document}Text\end{document}`, normalizeFormulaInput), null)

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block' },
  blockMath: { group: 'block', atom: true, attrs: { latex: { default: '' } }, toDOM: () => ['div', 0] },
  inlineMath: { group: 'inline', inline: true, atom: true, attrs: { latex: { default: '' } }, toDOM: () => ['span', 0] },
  text: { group: 'inline' },
} })
const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('before after'))])
const state = EditorState.create({ doc, selection: TextSelection.create(doc, 8) })
const inlineFormula = standaloneLatexPaste(String.raw`E_t^{(k)}`, normalizeFormulaInput)
const inserted = state.tr.replaceSelectionWith(schema.nodes.inlineMath.create({ latex: inlineFormula.latex })).doc
assert.equal(inserted.childCount, 1)
assert.equal(inserted.child(0).type.name, 'paragraph')
assert.equal(inserted.child(0).child(1).type.name, 'inlineMath')
assert.equal(inserted.child(0).child(0).text, 'before ')
assert.equal(inserted.child(0).child(2).text, 'after')

const displayInserted = state.tr.replaceSelectionWith(schema.nodes.blockMath.create({ latex: parsed.latex })).doc
assert.deepEqual(displayInserted.content.content.map(node => node.type.name), ['paragraph', 'blockMath', 'paragraph'])
assert.equal(displayInserted.child(0).textContent, 'before ')
assert.equal(displayInserted.child(1).attrs.latex, parsed.latex)
assert.equal(displayInserted.child(2).textContent, 'after')
console.log('Raw LaTeX paste detection and inline/display insertion smoke tests passed.')
