import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { updateMathNode } from '../src/services/MathNodeTransforms.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', attrs: { textAlign: { default: null } } },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
    text: { group: 'inline' },
    inlineMath: { group: 'inline', inline: true, atom: true, attrs: { latex: { default: '' } } },
    blockMath: { group: 'block', atom: true, attrs: { latex: { default: '' }, label: { default: '' } } },
  },
  marks: { strong: {} },
})

const paragraph = (content, attrs = null) => schema.node('paragraph', attrs, content)
const math = (name, latex, extra = {}) => schema.node(name, { latex, ...extra })

test('editing a display formula as inline joins adjacent matching paragraphs', () => {
  const before = paragraph([schema.text('and', [schema.mark('strong')])])
  const display = math('blockMath', 'E_t^{(k)}', { label: 'eq:predictor' })
  const after = paragraph([schema.text('denotes the predictor set.')])
  const doc = schema.node('doc', null, [before, display, after])
  const state = EditorState.create({ doc })
  const transaction = updateMathNode(state, before.nodeSize, 'E_t^{(k)}', 'inline')

  assert.ok(transaction)
  assert.equal(transaction.doc.childCount, 1)
  const merged = transaction.doc.firstChild
  assert.equal(merged.type.name, 'paragraph')
  assert.deepEqual(merged.content.content.map(node => node.type.name), ['text', 'inlineMath', 'text'])
  assert.equal(merged.child(0).text, 'and ')
  assert.equal(merged.child(1).attrs.latex, 'E_t^{(k)}')
  assert.equal(merged.child(2).text, ' denotes the predictor set.')
  assert.equal(merged.child(0).marks[0].type.name, 'strong')
})

test('editing an inline formula as display splits its paragraph', () => {
  const inline = math('inlineMath', 'x_t')
  const doc = schema.node('doc', null, [paragraph([schema.text('before '), inline, schema.text(' after')])])
  const position = 1 + 'before '.length
  const state = EditorState.create({ doc })
  const transaction = updateMathNode(state, position, 'x_t', 'block')

  assert.ok(transaction)
  assert.deepEqual(transaction.doc.content.content.map(node => node.type.name), ['paragraph', 'blockMath', 'paragraph'])
  assert.equal(transaction.doc.child(0).textContent, 'before ')
  assert.equal(transaction.doc.child(1).attrs.latex, 'x_t')
  assert.equal(transaction.doc.child(2).textContent, ' after')
})

test('editing formula content without changing its type retains block labels', () => {
  const doc = schema.node('doc', null, [math('blockMath', 'x', { label: 'eq:x' })])
  const transaction = updateMathNode(EditorState.create({ doc }), 0, 'y', 'block')
  assert.equal(transaction.doc.firstChild.attrs.latex, 'y')
  assert.equal(transaction.doc.firstChild.attrs.label, 'eq:x')
})
