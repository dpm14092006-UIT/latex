import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { aiResultToContent, selectionForAi } from '../src/services/AiSelection.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
    inlineMath: { group: 'inline', inline: true, atom: true, attrs: { latex: { default: '' } } },
    citation: { group: 'inline', inline: true, atom: true, attrs: { key: { default: '' }, mode: { default: 'parenthetical' } } },
    crossReference: { group: 'inline', inline: true, atom: true, attrs: { target: { default: '' } } },
    blockMath: { group: 'block', atom: true, attrs: { latex: { default: '' } } },
  },
  marks: { strong: {} },
})
const p = (...content) => schema.node('paragraph', null, content)
const doc = schema.node('doc', null, [
  p(schema.text('Ta có '), schema.node('inlineMath', { latex: 'x^2' }), schema.text(' theo '), schema.node('citation', { key: 'knuth' }), schema.text('.')),
  schema.node('blockMath', { latex: 'E=mc^2' }),
  p(schema.text('Xem '), schema.node('crossReference', { target: 'eq:1' }), schema.text(' nhé.')),
])
const at = (from, to = from) => EditorState.create({ doc, selection: TextSelection.create(doc, from, to) })

test('an empty selection uses the paragraph around the caret and keeps math and citations as LaTeX', () => {
  const selection = selectionForAi(at(3))
  assert.equal(selection.text, 'Ta có $x^2$ theo \\cite{knuth}.')
  assert.equal(selection.inline, true)
  assert.deepEqual([selection.from, selection.to], [1, doc.child(0).nodeSize - 1])
})

test('a partial selection inside one paragraph is sliced exactly', () => {
  const selection = selectionForAi(at(4, 8))
  assert.equal(selection.text, doc.textBetween(4, 8, '', node => node.type.name === 'inlineMath' ? `$${node.attrs.latex}$` : ''))
  assert.equal(selection.inline, true)
})

test('a selection across blocks joins paragraphs and display formulas with blank lines', () => {
  const selection = selectionForAi(at(1, doc.content.size - 1))
  assert.equal(selection.inline, false)
  assert.equal(selection.text, 'Ta có $x^2$ theo \\cite{knuth}.\n\n\\[E=mc^2\\]\n\nXem \\ref{eq:1} nhé.')
})

test('answers become real formula, citation and reference nodes', () => {
  assert.deepEqual(aiResultToContent('We have $x^2$ by \\cite{knuth}, see \\ref{eq:1}.', { inline: true }), [
    { type: 'text', text: 'We have ' }, { type: 'inlineMath', attrs: { latex: 'x^2' } }, { type: 'text', text: ' by ' },
    { type: 'citation', attrs: { key: 'knuth' } }, { type: 'text', text: ', see ' }, { type: 'crossReference', attrs: { target: 'eq:1' } }, { type: 'text', text: '.' },
  ])
  const blocks = aiResultToContent('First \\(a+b\\) line\ncontinues.\n\n\\[E=mc^2\\]\n\nCosts \\$5 and $$y$$ stays.')
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'blockMath', 'paragraph'])
  assert.deepEqual(blocks[0].content[1], { type: 'inlineMath', attrs: { latex: 'a+b' } })
  assert.equal(blocks[0].content[2].text, ' line continues.')
  assert.equal(blocks[1].attrs.latex, 'E=mc^2')
  assert.ok(blocks[2].content[0].text.startsWith('Costs \\$5'), 'escaped dollars stay text')
  assert.deepEqual(blocks[2].content[1], { type: 'inlineMath', attrs: { latex: 'y' } }, 'inline $$...$$ is one formula')
  assert.deepEqual(aiResultToContent('One\n\nTwo', { inline: true }).map(block => block.type), ['paragraph', 'paragraph'], 'multi-paragraph answers are blocks')
})
