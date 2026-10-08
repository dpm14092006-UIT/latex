import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { closeHistory, history, undo } from '@tiptap/pm/history'
import { bibtexForCompile, normalizeIncomingBibtex, parseBibtex } from '../src/services/Bibliography.js'
import { importReferences } from '../src/services/ReferenceImport.js'
import { citationEditTransaction } from '../src/services/CitationEditing.js'

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' },
  citation: { inline: true, atom: true, group: 'inline', attrs: { key: {}, mode: { default: 'parenthetical' } } },
} })
const document = content => schema.node('doc', null, schema.node('paragraph', null, content))

test('BibTeX parentheses, escaped quotes, macros and concatenation retain complete metadata', () => {
  const input = String.raw`% @book{fake, title={Ignore}}
@string{venue = "Journal of " # "Forecasting"}
@article(real, author={{World Bank}}, title="Methods (new) and \"quotes\"", journal=venue, year=2025)
@book{next, title={Next}, year=2026}`
  const entries = parseBibtex(input)
  assert.deepEqual(entries.map(entry => entry.key), ['real', 'next'])
  assert.equal(entries[0].fields.journal, 'Journal of Forecasting')
  assert.equal(entries[0].fields.title, String.raw`Methods (new) and \"quotes\"`)
  const normalized = normalizeIncomingBibtex(input)
  assert.equal(parseBibtex(normalized.text)[0].fields.author, '{World Bank}')
  assert.equal(parseBibtex(bibtexForCompile(input, 'apa'))[0].fields.journal, 'Journal of Forecasting')
  assert.doesNotMatch(normalized.text, /journal\s*=\s*venue/)
})

test('DOI refresh retains stable citation keys and updates complete metadata', async () => {
  const existing = '@article{smith2024,author={Smith, John},title={Old title},year={2024},doi={https://doi.org/10.1000/TEST}}'
  const result = await importReferences('10.1000/test', existing, null, async () => '@article{smith2025,author={Smith, John},title={New title},journal={Journal},year={2025},doi={10.1000/test}}')
  const entries = parseBibtex(result.text)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'smith2024')
  assert.equal(entries[0].fields.year, '2025')
  assert.equal(entries[0].fields.title, 'New title')
  assert.deepEqual(result.keyRenames, {})
  assert.deepEqual(result.addedKeys, ['smith2024'])
})

test('repeated DOI records share a reference and retain both original number mappings, including offline', async () => {
  const input = '[1] Smith, J. (2025). Study. Journal. https://doi.org/10.1000/test\n[2] Smith, J. (2025). Study. Journal. https://doi.org/10.1000/test'
  for (const lookup of [async () => '@article{smith,author={Smith, John},title={Study},year={2025},doi={10.1000/test}}', async () => { throw Error('Offline') }]) {
    const result = await importReferences(input, '', null, lookup)
    assert.equal(parseBibtex(result.text).length, 1)
    assert.equal(result.added, 1)
    assert.deepEqual(result.sourceNumbers[1], result.sourceNumbers[2])
  }
})

test('malformed BibTeX reports an error and preserves the current bibliography', async () => {
  const existing = '@book{saved,title={Keep}}'
  const result = await importReferences('@article{broken,title={Unclosed}', existing)
  assert.equal(result.text, existing)
  assert.equal(result.added, 0)
  assert.equal(result.errors.length, 1)
})

test('inserting after selected prose preserves it and has independent undo', () => {
  let state = EditorState.create({ schema, doc: document(schema.text('Keep this sentence.')), plugins: [history()] })
  const dispatch = transaction => { state = state.apply(transaction) }
  dispatch(state.tr.insertText('Typed ', 1))
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
  const before = state.doc
  const selection = { doc: state.doc, from: state.selection.from, to: state.selection.to }
  dispatch(citationEditTransaction(state, { keys: ['smith'], insertionSelection: selection, mode: 'narrative' }))
  dispatch(closeHistory(state.tr))
  assert.equal(state.doc.textContent, 'Typed Keep this sentence. ')
  assert.equal(state.doc.firstChild.lastChild.attrs.mode, 'narrative')
  assert.equal(undo(state, dispatch), true)
  assert.ok(state.doc.eq(before))
  assert.throws(() => citationEditTransaction(state.apply(state.tr.insertText('Other ', 1)), { keys: ['smith'], insertionSelection: selection }), /đã thay đổi/)
})

test('citation edits merge equal modes, keep different modes separate and reject stale nodes', () => {
  let state = EditorState.create({ schema, doc: document([schema.text('A '), schema.node('citation', { key: 'smith', mode: 'narrative' })]) })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)))
  state = state.apply(citationEditTransaction(state, { keys: ['lee'], mode: 'narrative' }))
  assert.equal(state.doc.firstChild.lastChild.attrs.key, 'smith,lee')
  state = state.apply(citationEditTransaction(state, { keys: ['nguyen'], mode: 'parenthetical' }))
  assert.equal(state.doc.firstChild.childCount, 4)
  const pos = state.doc.content.size - 2
  const editing = { pos, node: state.doc.nodeAt(pos) }
  state = state.apply(citationEditTransaction(state, { keys: ['smith'], mode: 'narrative', editing }))
  assert.equal(state.doc.nodeAt(pos).attrs.mode, 'narrative')
  assert.throws(() => citationEditTransaction(state, { keys: [], editing }), /đã thay đổi/)
})

test('citation insertion and merging enforce the document validation limit before mutation', () => {
  const keys = Array.from({ length: 50 }, (_, index) => `ref${index}`)
  let state = EditorState.create({ schema, doc: document(schema.node('citation', { key: keys.join(',') })) })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)))
  assert.throws(() => citationEditTransaction(state, { keys: [...keys, 'extra'] }), /tối đa 50/)
  assert.throws(() => citationEditTransaction(state, { keys: ['extra'] }), /giới hạn 50/)
  assert.equal(state.doc.firstChild.firstChild.attrs.key, keys.join(','))
})
