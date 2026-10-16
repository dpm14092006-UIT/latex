import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { richSpellcheckSegments, locateSpellcheckErrors, replaceRichSpelling, replaceSpellingField } from '../src/services/SpellcheckSegments.js'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { toWordAst } from '../src/services/WordDocument.js'
import { createSpellcheckPlugin, spellcheckPluginKey } from '../src/services/SpellcheckExtension.js'
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' },
  codeBlock: { content: 'text*', group: 'block' },
  inlineMath: { inline: true, group: 'inline', atom: true, attrs: { latex: { default: '' } } },
  citation: { inline: true, group: 'inline', atom: true, attrs: { key: { default: '' } } },
  footnote: { inline: true, group: 'inline', atom: true, attrs: { text: { default: '' } } },
  imageBlock: { group: 'block', atom: true, attrs: { caption: { default: '' } } },
}, marks: { bold: {}, italic: {}, code: {} } })
const t = (text, mark) => schema.text(text, mark ? [schema.marks[mark].create()] : [])
const p = content => schema.nodes.paragraph.create(null, content)
test('segments join mark runs but stop at opaque nodes/code; attrs/fields have separate targets', () => {
  const doc = schema.nodes.doc.create(null, [p([t('😀 re', 'bold'), t('cieve', 'italic'), schema.nodes.inlineMath.create({ latex: 'recieve' }), t(' teh '), t('recieve', 'code'), schema.nodes.citation.create({ key: 'recieve' }), schema.nodes.footnote.create({ text: 'seperate' })]), schema.nodes.codeBlock.create(null, t('recieve')), schema.nodes.imageBlock.create({ caption: 'occured' })])
  const segments = richSpellcheckSegments(doc, { title: 'recieve', abstractEnabled: true, abstract: 'teh' })
  assert.deepEqual(segments.map(segment => segment.text), ['recieve', 'teh', '😀 recieve', ' teh ', 'seperate', 'occured'])
  const segment = segments.find(item => item.text === '😀 recieve')
  const [error] = locateSpellcheckErrors([{ segmentId: segment.id, from: 3, to: 10, original: 'recieve' }], segments)
  assert.equal(doc.textBetween(error.position, error.position + 7), 'recieve')
})
test('correcting a split-mark word preserves marks, opaque nodes and single-step undo', () => {
  const original = schema.nodes.doc.create(null, [p([t('re', 'bold'), t('cieve', 'italic'), schema.nodes.inlineMath.create({ latex: 'recieve' }), t(' end')])])
  let state = EditorState.create({ schema, doc: original, plugins: [history(), createSpellcheckPlugin()] })
  const editor = { get state() { return state }, isEditable: true, view: { dispatch(tr) { state = state.apply(tr) } }, commands: { focus() {} } }
  const segment = richSpellcheckSegments(original)[0]
  const [error] = locateSpellcheckErrors([{ segmentId: segment.id, from: 0, to: 7, original: 'recieve' }], [segment])
  assert.equal(replaceRichSpelling(editor, error, 'receive'), true)
  assert.equal(state.doc.child(0).child(0).text, 're')
  assert.equal(state.doc.child(0).child(0).marks[0].type.name, 'bold')
  assert.equal(state.doc.child(0).child(1).text, 'ceive')
  assert.equal(state.doc.child(0).child(1).marks[0].type.name, 'italic')
  assert.equal(state.doc.child(0).child(2).attrs.latex, 'recieve')
  assert.equal(undo(state, tr => { state = state.apply(tr) }), true)
  assert.deepEqual(state.doc.toJSON(), original.toJSON())
  const decorated = state.apply(state.tr.setMeta(spellcheckPluginKey, [{ ...error, id: 'test' }]).setMeta('addToHistory', false))
  assert.deepEqual(decorated.doc.toJSON(), original.toJSON())
  assert.equal(toLatex(decorated.doc.toJSON(), 'Title').latex, toLatex(original.toJSON(), 'Title').latex)
  assert.deepEqual(toWordAst(decorated.doc.toJSON(), 'Title'), toWordAst(original.toJSON(), 'Title'))
  const moved = decorated.apply(decorated.tr.insertText('Hello ', 1))
  assert.equal(spellcheckPluginKey.getState(moved).find()[0].from, error.position + 6)
})
test('field corrections respect limits without truncation and reject changed originals', () => {
  const value = 'teh' + ' '.repeat(157), error = { from: 0, to: 3, original: 'teh' }
  assert.equal(replaceSpellingField(value, error, 'the', 160).length, 160)
  assert.equal(replaceSpellingField(value, error, 'their', 160), null)
  assert.equal(replaceSpellingField('the', error, 'their', 160), null)
})
test('typing after a correction is undone separately from the correction itself', () => {
  const original = schema.nodes.doc.create(null, [p([t('recieve')])])
  let state = EditorState.create({ schema, doc: original, plugins: [history()] })
  const editor = { get state() { return state }, isEditable: true, view: { dispatch(tr) { state = state.apply(tr) } }, commands: { focus() {} } }
  const segment = richSpellcheckSegments(original)[0]
  const [error] = locateSpellcheckErrors([{ segmentId: segment.id, from: 0, to: 7, original: 'recieve' }], [segment])
  assert.equal(replaceRichSpelling(editor, error, 'receive'), true)
  state = state.apply(state.tr.insertText('!', 8))
  undo(state, tr => { state = state.apply(tr) })
  assert.equal(state.doc.textContent, 'receive')
  undo(state, tr => { state = state.apply(tr) })
  assert.equal(state.doc.textContent, 'recieve')
})
test('attribute replacement rejects stale values and preserves other node attrs', () => {
  let state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [p([schema.nodes.footnote.create({ text: 'recieve' })])]) })
  const editor = { get state() { return state }, isEditable: true, view: { dispatch(tr) { state = state.apply(tr) } }, commands: { focus() {} } }
  const segment = richSpellcheckSegments(state.doc)[0]
  const [error] = locateSpellcheckErrors([{ segmentId: segment.id, from: 0, to: 7, original: 'recieve' }], [segment])
  assert.equal(replaceRichSpelling(editor, error, 'receive'), true)
  assert.equal(state.doc.nodeAt(1).attrs.text, 'receive')
  assert.equal(replaceRichSpelling(editor, error, 'wrong'), false)
})
