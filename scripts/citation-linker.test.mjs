import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { closeHistory, history, undo, redo } from '@tiptap/pm/history'
import { formatBibtexEntry, parseBibtex, parseReferenceLine } from '../src/services/Bibliography.js'
import { linkCitationTransaction, removeAllCitationTransaction, parseSourceMapping, sanitizeSourceMaps, scanUnlinkedCitations } from '../src/services/CitationLinker.js'
import { sanitizeSettings } from '../src/services/DocumentSettings.js'

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' },
  heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
  codeBlock: { content: 'text*', group: 'block', code: true },
  citation: { inline: true, atom: true, group: 'inline', attrs: { key: {}, mode: { default: 'parenthetical' } } },
  inlineMath: { inline: true, atom: true, group: 'inline' }, text: { group: 'inline' },
  hardBreak: { inline: true, group: 'inline' },
}, marks: { bold: {}, italic: {}, code: {}, link: { attrs: { href: {} } } } })
const text = (value, marks) => schema.text(value, marks)
const paragraph = value => schema.node('paragraph', null, typeof value === 'string' ? text(value) : value)
const document = (...blocks) => schema.node('doc', null, blocks)
const entries = parseBibtex(`@book{smith2021, author={Smith, John}, title={First}, year={2021}}
@book{nguyen2023, author={Nguyễn, Văn A and Trần, B and Lê, C}, title={Second}, year={2023}}
@book{lee2022, author={Lee, Jane}, title={Third}, year={2022}}`)
const sourceMap = { id: 'original', label: 'PDF gốc', numbers: { 12: ['lee2022'], 2: ['smith2021'], 5: ['nguyen2023'], 6: ['lee2022'], 7: ['smith2021'] } }

test('scan crosses a hard line break inside a cite, preserves surrounding prose and restores it on undo', () => {
  let state = EditorState.create({ schema, doc: document(paragraph([text('🙂 Theo (Smith,'), schema.node('hardBreak'), text('2021), kết quả tốt.')])), plugins: [history()] })
  const before = state.doc
  const scan = scanUnlinkedCitations(state.doc, entries)
  assert.equal(scan.rows.length, 1)
  assert.equal(scan.rows[0].text, '(Smith, 2021)')
  assert.deepEqual(scan.rows[0].keys, ['smith2021'])
  state = state.apply(linkCitationTransaction(state, scan, { [scan.rows[0].id]: ['smith2021'] }, entries).transaction)
  state = state.apply(closeHistory(state.tr))
  assert.equal(state.doc.textContent, '🙂 Theo , kết quả tốt.')
  assert.ok(undo(state, tr => { state = state.apply(tr) }))
  assert.ok(state.doc.eq(before))
})

test('et al is not a confident match for a complete two-author reference', () => {
  const refs = parseBibtex('@book{pair,author={Smith, John and Lee, Jane},year={2025},title={Pair}}')
  const scan = scanUnlinkedCitations(document(paragraph('(Smith et al., 2025) (Smith & Lee, 2025)')), refs)
  assert.equal(scan.rows.length, 2)
  assert.equal(scan.rows[0].resolved, false)
  assert.equal(scan.rows[1].resolved, true)
})

test('three explicit authors, no-date citations and corporate narratives match their full identities', () => {
  const refs = parseBibtex('@book{three,author={Smith, John and Jones, Ann and Lee, Jane},year={2025},title={Three}}\n@book{undated,author={{World Health Organization}},title={Guidance}}')
  const scan = scanUnlinkedCitations(document(paragraph('(Smith, Jones, & Lee, 2025). World Health Organization (n.d.). (World Health Organization, n. d.)')), refs)
  assert.equal(scan.rows.length, 3)
  assert.ok(scan.rows.every(row => row.resolved))
  assert.equal(scan.rows[1].text, 'World Health Organization (n.d.)')
  assert.equal(scan.rows[2].keys[0], 'undated')
})

test('unheaded reference entries are skipped while ordinary narrative prose remains scannable', () => {
  const doc = document(paragraph('Smith, J. (2021). Long study title. Journal, 4(2), 10–20. https://doi.org/10.1000/example'), paragraph('Smith (2021). Results are discussed at https://example.com.'))
  const scan = scanUnlinkedCitations(doc, entries)
  assert.equal(scan.rows.length, 1)
  assert.equal(scan.rows[0].text, 'Smith (2021)')
})

test('changing metadata under the same key invalidates a previous scan', () => {
  const state = EditorState.create({ schema, doc: document(paragraph('(Smith, 2021)')) })
  const scan = scanUnlinkedCitations(state.doc, entries)
  const altered = structuredClone(entries)
  altered[0].fields.year = '2024'
  assert.throws(() => linkCitationTransaction(state, scan, { [scan.rows[0].id]: ['smith2021'] }, altered), /Danh mục REF đã thay đổi/)
})

test('numeric ranges enforce source provenance, missing mappings and ambiguity without guessing current numbers', () => {
  const doc = document(paragraph('[2–7] [0] [7–2] [1–100] [12]'))
  const noMap = scanUnlinkedCitations(doc, entries)
  assert.equal(noMap.rows.length, 2)
  assert.ok(noMap.rows.every(row => !row.resolved))
  const mapped = scanUnlinkedCitations(doc, entries, sourceMap)
  assert.equal(mapped.rows[0].groups.length, 6)
  assert.equal(mapped.rows[0].resolved, false)
  assert.equal(mapped.rows[1].resolved, true)
})

test('scan offsets stay correct across Unicode, formatting, multiple blocks and reverse-order replacements', () => {
  const doc = document(...Array.from({ length: 100 }, (_, index) => paragraph([text(`🙂 ${index} tiếng Việt `), text('(Smi', [schema.marks.bold.create()]), text('th, 2021)'), text(' và [@lee2022].')])))
  const scan = scanUnlinkedCitations(doc, entries)
  assert.equal(scan.rows.length, 200)
  for (const row of scan.rows) assert.equal(doc.textBetween(row.from, row.to), row.text)
  const state = EditorState.create({ schema, doc })
  const result = linkCitationTransaction(state, scan, Object.fromEntries(scan.rows.map(row => [row.id, row.keys])), entries)
  const after = state.apply(result.transaction).doc
  let count = 0
  after.descendants(node => { if (node.type.name === 'citation') count++ })
  assert.equal(count, 200)
  assert.equal(scanUnlinkedCitations(after, entries).rows.length, 0)
  assert.ok(after.textContent.includes('🙂 99 tiếng Việt '))
})

test('large scans report truncation and return only bounded, exact positions', () => {
  const doc = document(paragraph('[@smith2021] '.repeat(2005)))
  const scan = scanUnlinkedCitations(doc, entries)
  assert.equal(scan.rows.length, 2000)
  assert.equal(scan.truncated, true)
  assert.equal(doc.textBetween(scan.rows.at(-1).from, scan.rows.at(-1).to), '[@smith2021]')
})

test('each source keeps its page locator in a grouped cite, including several years for one source', () => {
  const doc = document(paragraph('Theo (Smith, 2021, pp. 2–4; Lee, 2022, p. 9), kết quả tốt.'))
  const scan = scanUnlinkedCitations(doc, entries)
  assert.equal(scan.rows.length, 1)
  assert.equal(scan.rows[0].resolved, true)
  const state = EditorState.create({ schema, doc })
  const linked = state.apply(linkCitationTransaction(state, scan, { [scan.rows[0].id]: scan.rows[0].keys }, entries).transaction)
  assert.equal(linked.doc.textContent, 'Theo  (pp. 2–4);  (p. 9), kết quả tốt.')
  assert.deepEqual(linked.doc.firstChild.content.content.filter(node => node.type.name === 'citation').map(node => node.attrs.key), ['smith2021', 'lee2022'])
})

test('mapped numeric narratives preserve author semantics when switching citation style', () => {
  const doc = document(paragraph('Theo Smith [2] và Lee [12]. Unknown [2].'))
  const scan = scanUnlinkedCitations(doc, entries, sourceMap)
  assert.equal(scan.rows.length, 3)
  assert.equal(scan.rows[0].text, 'Smith [2]')
  assert.equal(scan.rows[0].mode, 'narrative')
  assert.equal(scan.rows[1].text, 'Lee [12]')
  assert.equal(scan.rows[2].text, '[2]')
  assert.equal(scan.rows[2].mode, 'parenthetical')
  const state = EditorState.create({ schema, doc })
  const after = state.apply(linkCitationTransaction(state, scan, Object.fromEntries(scan.rows.map(row => [row.id, row.keys])), entries).transaction).doc
  assert.equal(after.textContent, 'Theo  và . Unknown .')
})

test('the screenshot group remains visible with six sources and correctly separates suffix uncertainty from a year mismatch', () => {
  const refs = parseBibtex(`@article{Adel_2026,author={Adel, A and B, B and C, C},year={2026},title={Demand}}
@inbook{Avogaro_2024,author={Avogaro, A and Capogrosso, L and Fummi, F and Cristani, M},year={2024},title={Dif4FF}}
@inbook{Avogaro_2025,author={Avogaro, A and Capogrosso, L and Fummi, F and Cristani, M},year={2025},title={MDiFF}}
@article{Lee_2026,author={Lee, A and B, B and C, C},year={2026},title={Transformer}}
@article{Park_2026,author={Park, A and B, B and C, C},year={2026},title={Sales}}
@article{Rajendran_2025,author={Rajendran, A and Hong, B},year={2025},title={Forecast}}`)
  const value = '(Adel et al., 2026; Avogaro et al., 2025a, 2025b; Lee et al., 2026; Park et al., 2026; Rajendran & Hong, 2025)'
  const doc = document(paragraph(value), paragraph('Avogaro et al. (2025a, 2025b) exploit diffusion models.'))
  const scan = scanUnlinkedCitations(doc, refs)
  assert.equal(scan.rows.length, 2)
  assert.equal(scan.rows[0].text, value)
  assert.equal(scan.rows[0].groups.length, 6)
  assert.equal(scan.rows[0].groups.filter(group => group.candidates.length === 1).length, 4)
  assert.equal(scan.rows[0].groups[1].suggestions[0].key, 'Avogaro_2025')
  assert.match(scan.rows[0].groups[1].suggestions[0].reason, /hậu tố a/)
  assert.match(scan.rows[0].groups[1].suggestions[1].reason, /2024 thay vì 2025a/)
  const state = EditorState.create({ schema, doc })
  const invalid = ['Adel_2026', 'Avogaro_2025', 'Avogaro_2025', 'Lee_2026', 'Park_2026', 'Rajendran_2025']
  assert.throws(() => linkCitationTransaction(state, scan, { [scan.rows[0].id]: invalid }, refs), /Không chọn cùng một REF/)
  const choices = ['Adel_2026', 'Avogaro_2024', 'Avogaro_2025', 'Lee_2026', 'Park_2026', 'Rajendran_2025']
  const after = state.apply(linkCitationTransaction(state, scan, { [scan.rows[0].id]: choices }, refs).transaction).doc
  assert.equal(after.firstChild.firstChild.attrs.key, choices.join(','))
})

test('bulk citation removal has independent undo/redo and preserves prose and previous typing', () => {
  let state = EditorState.create({ schema, doc: document(paragraph([text('A '), schema.node('citation', { key: 'smith2021,lee2022' }), text(' B '), schema.node('citation', { key: 'nguyen2023' })])), plugins: [history()] })
  const dispatch = transaction => { state = state.apply(transaction) }
  dispatch(state.tr.insertText('typed ', 1))
  const before = state.doc
  const result = removeAllCitationTransaction(state)
  assert.equal(result.count, 2)
  dispatch(result.transaction)
  dispatch(closeHistory(state.tr))
  assert.equal(state.doc.textContent, 'typed A  B ')
  assert.equal(removeAllCitationTransaction(state), null)
  assert.equal(undo(state, dispatch), true)
  assert.ok(state.doc.eq(before))
  assert.equal(redo(state, dispatch), true)
  assert.equal(state.doc.textContent, 'typed A  B ')
  dispatch(closeHistory(state.tr))
  dispatch(state.tr.insertText('after ', 1))
  assert.equal(undo(state, dispatch), true)
  assert.equal(state.doc.textContent, 'typed A  B ')
  assert.equal(undo(state, dispatch), true)
  assert.ok(state.doc.eq(before))
})

test('detects grouped author-year, exact keys and original numeric ranges without using current numbering', () => {
  const doc = document(paragraph('A (Smith,2021; Nguyễn và cộng sự, 2023) B [12] C [2, 5–7] D [@lee2022; @smith2021].'))
  const unresolved = scanUnlinkedCitations(doc, entries)
  assert.equal(unresolved.rows[1].resolved, false)
  assert.deepEqual(unresolved.rows[1].keys, [])
  const scan = scanUnlinkedCitations(doc, entries, sourceMap)
  assert.equal(scan.rows.length, 4)
  assert.ok(scan.rows.every(row => row.resolved))
  assert.deepEqual(scan.rows[0].keys, ['smith2021', 'nguyen2023'])
  assert.deepEqual(scan.rows[1].keys, ['lee2022'])
  assert.deepEqual(scan.rows[2].keys, ['smith2021', 'nguyen2023', 'lee2022'])
  for (const row of scan.rows) assert.equal(doc.textBetween(row.from, row.to), row.text)
})

test('joins formatted text but skips linked citations, formulas, code, hyperlinks and reference sections', () => {
  const doc = document(paragraph([text('A (Smi', [schema.mark('bold')]), text('th, 2021)'), schema.node('citation', { key: 'lee2022' }), schema.node('inlineMath'), text(' [12]', [schema.mark('code')]), text(' [12]', [schema.mark('link', { href: 'https://example.com' })])]),
    schema.node('codeBlock', null, text('[@smith2021]')),
    schema.node('heading', { level: 1 }, text('Tài liệu tham khảo')), paragraph('[12] Source (Smith, 2021)'),
    schema.node('heading', { level: 1 }, text('Phụ lục')), paragraph('[@lee2022]'))
  const scan = scanUnlinkedCitations(doc, entries, sourceMap)
  assert.deepEqual(scan.rows.map(row => row.text), ['(Smith, 2021)', '[@lee2022]'])
  const state = EditorState.create({ schema, doc })
  const choices = Object.fromEntries(scan.rows.map(row => [row.id, row.keys]))
  const linked = state.apply(linkCitationTransaction(state, scan, choices, entries).transaction)
  assert.equal(linked.doc.child(0).child(1).type.name, 'citation')
  assert.equal(linked.doc.child(0).child(1).marks[0].type.name, 'bold')
})

test('keeps ambiguity, missing REF and year suffixes unresolved; supports reviewed narrative choices', () => {
  const ambiguous = [...entries, ...parseBibtex('@book{other,author={Smith, Ann},year={2021},title={Other}}')]
  const scan = scanUnlinkedCitations(document(paragraph('(Smith, 2021) (Smith, 2021a) [@missing] Smith (2021)')), ambiguous)
  assert.equal(scan.rows[0].groups[0].candidates.length, 2)
  assert.ok(scan.rows.every(row => !row.resolved))
  assert.equal(scan.rows[3].kind, 'narrative')
  const state = EditorState.create({ schema, doc: scan.doc })
  const linked = state.apply(linkCitationTransaction(state, scan, { [scan.rows[3].id]: ['smith2021'] }, ambiguous).transaction)
  assert.equal(linked.doc.child(0).lastChild.attrs.mode, 'narrative')
  assert.equal(scan.rows[3].text, 'Smith (2021)')
  const missingMap = { ...sourceMap, numbers: { 12: ['lee2022', 'deleted'] } }
  assert.equal(scanUnlinkedCitations(document(paragraph('[12]')), entries, missingMap).rows[0].resolved, false)
  const duplicate = [...entries, entries[0]]
  assert.equal(scanUnlinkedCitations(document(paragraph('(Smith, 2021) [@smith2021]')), duplicate).rows[0].resolved, false)
})

test('links all selected positions in one undo step and rejects stale documents or changed REF', () => {
  let state = EditorState.create({ schema, doc: document(paragraph('(Smith, 2021) + [12]')), plugins: [history()] })
  const before = state.doc
  const scan = scanUnlinkedCitations(state.doc, entries, sourceMap)
  const choices = Object.fromEntries(scan.rows.map(row => [row.id, row.keys]))
  const result = linkCitationTransaction(state, scan, choices, entries)
  assert.equal(result.count, 2)
  state = state.apply(result.transaction)
  assert.equal(scanUnlinkedCitations(state.doc, entries, sourceMap).rows.length, 0)
  assert.ok(undo(state, tr => { state = state.apply(tr) }))
  assert.ok(state.doc.eq(before))
  const changed = state.apply(state.tr.insertText('changed ', 1))
  assert.throws(() => linkCitationTransaction(changed, scan, choices, entries), /đã thay đổi/)
  assert.throws(() => linkCitationTransaction(EditorState.create({ schema, doc: scan.doc }), scan, choices, entries.filter(entry => entry.key !== 'lee2022')), /Danh mục REF đã thay đổi/)
})

test('persists separate original source maps and validates manual mappings and bounds', () => {
  const maps = [sourceMap, { id: 'other-list', label: 'Khác', numbers: { 12: ['smith2021'] } }]
  assert.deepEqual(sanitizeSettings({ citationSourceMaps: maps }).citationSourceMaps, maps)
  assert.deepEqual(parseSourceMapping('[12] lee2022\n[12] smith2021\n2 = nguyen2023', entries), { 12: ['lee2022', 'smith2021'], 2: ['nguyen2023'] })
  assert.throws(() => parseSourceMapping('[12] missing', entries), /không hợp lệ/)
  assert.throws(() => parseSourceMapping('[0] lee2022', entries), /không hợp lệ/)
  assert.deepEqual(sanitizeSourceMaps([{ id: 'bad', numbers: { 0: ['smith2021'], 12: ['bad/key'] } }]), [])
  const scan = scanUnlinkedCitations(document(paragraph('[1–99] [0] (x, 2021) [@bad/key]')), entries)
  assert.equal(scan.rows.length, 0)
})

test('recognizes complete narrative spans across formatting and keeps author identities distinct', () => {
  const refs = parseBibtex(`@article{sousa,author={Sousa, P and Other, A and Third, B},year={2025},title={Demand}}
@article{giri,author={Giri, A and Chen, B},year={2022},title={Forecasting}}
@article{compound,author={de Vries, A},year={2024a},title={Particles}}`)
  const doc = document(paragraph([text('Theo Sousa et '), text('al. (2025)', [schema.mark('italic')]), text(', mô hình tốt. Sousa et al. (2025), chẳng hạn. Giri and Chen (2022) đánh giá. de Vries (2024a) hỗ trợ. Unknown (2025) chưa rõ. Năm (2025). (2025).')]))
  const scan = scanUnlinkedCitations(doc, refs)
  assert.deepEqual(scan.rows.slice(0, 5).map(row => row.text), ['Sousa et al. (2025)', 'Sousa et al. (2025)', 'Giri and Chen (2022)', 'de Vries (2024a)', 'Unknown (2025)'])
  assert.ok(scan.rows.slice(0, 4).every(row => row.resolved))
  assert.equal(scan.rows[0].signature, scan.rows[1].signature)
  assert.notEqual(scan.rows[0].signature, scan.rows[4].signature)
  for (const row of scan.rows) assert.equal(doc.textBetween(row.from, row.to), row.text)
  const state = EditorState.create({ schema, doc })
  const choices = Object.fromEntries(scan.rows.slice(0, 4).map(row => [row.id, row.groups.map(group => group.candidates[0])]))
  const linked = state.apply(linkCitationTransaction(state, scan, choices, refs).transaction)
  assert.ok(linked.doc.textContent.startsWith('Theo , mô hình tốt. '))
  const nodes = []
  linked.doc.descendants(node => { if (node.type.name === 'citation') nodes.push(node) })
  assert.equal(nodes.length, 4)
  assert.ok(nodes.every(node => node.attrs.mode === 'narrative'))
})

test('multi-year narrative requires a source for every year and supports duplicate mapped references', () => {
  const refs = [...entries, ...parseBibtex('@book{smith2022,author={Smith, John},year={2022},title={Later}}')]
  const doc = document(paragraph('Smith (2021, 2022) [2, 7]'))
  const scan = scanUnlinkedCitations(doc, refs, sourceMap)
  assert.deepEqual(scan.rows[0].keys, ['smith2021', 'smith2022'])
  const state = EditorState.create({ schema, doc })
  assert.throws(() => linkCitationTransaction(state, scan, { [scan.rows[0].id]: ['smith2021'] }, refs), /Nguồn được chọn/)
  const choices = Object.fromEntries(scan.rows.map(row => [row.id, row.groups.map(group => group.candidates[0])]))
  assert.equal(linkCitationTransaction(state, scan, choices, refs).count, 2)
})

test('detects the supplied two-paper APA group as one citation with two independently matched sources', () => {
  const refs = parseBibtex('@article{swami_2024,author={Swaminathan, S and Venkitasubramony, R},year={2024},title={One}}\n@article{anitha_2025,author={Anitha, A and Neelakandan, S},year={2025},title={Two}}')
  const doc = document(paragraph('(Swaminathan & Venkitasubramony, 2024; Anitha & Neelakandan, 2025).'))
  const scan = scanUnlinkedCitations(doc, refs)
  assert.equal(scan.rows.length, 1)
  assert.equal(scan.rows[0].groups.length, 2)
  assert.deepEqual(scan.rows[0].keys, ['swami_2024', 'anitha_2025'])
  assert.equal(scan.rows[0].resolved, true)
  const state = EditorState.create({ schema, doc })
  const linked = state.apply(linkCitationTransaction(state, scan, { [scan.rows[0].id]: scan.rows[0].keys }, refs).transaction)
  assert.equal(linked.doc.child(0).firstChild.attrs.key, 'swami_2024,anitha_2025')
  assert.equal(linked.doc.child(0).lastChild.text, '.')
  const imported = ['Swaminathan, S., & Venkitasubramony, R. (2024). One. Journal.', 'Anitha, A., & Neelakandan, S. (2025). Two. Journal.'].map((line, index) => ({ ...parseReferenceLine(line), key: `import_${index}` }))
  const reparsed = parseBibtex(imported.map(formatBibtexEntry).join('\n'))
  assert.equal(scanUnlinkedCitations(doc, reparsed).rows[0].resolved, true)
})

test('surfaces careful REF suggestions for year mismatches and compound surnames without silently linking', () => {
  const refs = parseBibtex(`@article{kant2024,author={Kant, Dennis and Pick, Andreas and de Winter, Jasper},year={2024},title={Nowcasting}}
@article{chaouch2026,author={Chaouch, Anouar and Sassi, Salim Ben},year={2026},title={Forecast accuracy}}
@article{qureshi2026,author={Qureshi, A and Other, B and Third, C},year={2026},title={Forecasting}}
@article{smith2020,author={Smith, John},year={2020},title={Earlier}}
@article{smith2021,author={Smith, John},year={2021},title={Later}}`)
  const doc = document(paragraph('(Kant et al., 2025; Qureshi et al., 2026) (Chaouch & Ben Sassi, 2026) (Yousuf & Feng, 2022) Kant et al. (2025, p. 6) (Smith, 2020, 2021)'))
  const scan = scanUnlinkedCitations(doc, refs)

  assert.equal(scan.rows.length, 5)
  assert.deepEqual(scan.rows[0].groups.map(group => group.candidates), [[], ['qureshi2026']])
  assert.equal(scan.rows[0].groups[0].suggestions[0].key, 'kant2024')
  assert.match(scan.rows[0].groups[0].suggestions[0].reason, /2024 thay vì 2025/)
  assert.deepEqual(scan.rows[0].keys, [])
  assert.equal(scan.rows[1].groups[0].suggestions[0].key, 'chaouch2026')
  assert.match(scan.rows[1].groups[0].suggestions[0].reason, /tên họ|thứ tự tên/)
  assert.deepEqual(scan.rows[2].groups[0].suggestions, [])
  assert.deepEqual(scan.rows[2].keys, [])
  assert.equal(scan.rows[3].kind, 'narrative')
  assert.equal(scan.rows[3].groups[0].suggestions[0].key, 'kant2024')
  assert.equal(scan.rows[3].suffixText, ' (p. 6)')
  assert.deepEqual(scan.rows[4].groups.map(group => group.candidates), [['smith2020'], ['smith2021']])
  assert.equal(scan.rows[4].resolved, true)

  const state = EditorState.create({ schema, doc })
  const transaction = linkCitationTransaction(state, scan, {
    [scan.rows[3].id]: ['kant2024'],
    [scan.rows[4].id]: ['smith2020', 'smith2021'],
  }, refs)
  const linked = state.apply(transaction.transaction)
  const linkedKeys = []
  linked.doc.descendants(node => { if (node.type.name === 'citation') linkedKeys.push(node.attrs.key) })
  assert.deepEqual(linkedKeys, ['kant2024', 'smith2020,smith2021'])
  assert.ok(linked.doc.textContent.endsWith('(p. 6) '))
})

test('preserves a page locator after linking a parenthetical author-year citation', () => {
  const doc = document(paragraph('(Smith, 2021, pp. 14–16) remains relevant.'))
  const scan = scanUnlinkedCitations(doc, entries)
  assert.equal(scan.rows.length, 1)
  assert.equal(scan.rows[0].suffixText, ' (pp. 14–16)')
  const state = EditorState.create({ schema, doc })
  const linked = state.apply(linkCitationTransaction(state, scan, { [scan.rows[0].id]: ['smith2021'] }, entries).transaction)
  assert.equal(linked.doc.child(0).firstChild.attrs.key, 'smith2021')
  assert.ok(linked.doc.child(0).child(1).text.startsWith(' (pp. 14–16) remains relevant.'))
})

test('recognizes protected corporate authors and particle surnames as complete citation identities', () => {
  const refs = parseBibtex('@techreport{worldbank,author={{World Bank} and Doe, Jane},year={2024},title={Outlook}}\n@article{vries,author={de Vries, Jane},year={2023},title={Particles}}')
  const doc = document(paragraph('(World Bank & Doe, 2024) (de Vries, 2023)'))
  const scan = scanUnlinkedCitations(doc, refs)
  assert.deepEqual(scan.rows.map(row => row.keys), [['worldbank'], ['vries']])
  assert.ok(scan.rows.every(row => row.resolved))
})

test('Western-order Vietnamese names match their BibTeX last name and rows never overlap another citation', () => {
  const refs = parseBibtex('@article{nguyen2020, author={Van Thanh Nguyen}, year={2020}, title={A}}\n@article{pair2020, author={Smith, John and Jones, Ann}, year={2020}, title={B}}')
  const scan = scanUnlinkedCitations(document(paragraph('Theo (Nguyen, 2020) và [@Smith] and Jones (2020).')), refs)
  assert.deepEqual(scan.rows.map(row => [row.text, row.keys]), [['(Nguyen, 2020)', ['nguyen2020']], ['[@Smith]', []], ['Jones (2020)', []]])
  const ranges = scan.rows.map(row => [row.from, row.to]).sort((a, b) => a[0] - b[0])
  for (let index = 1; index < ranges.length; index++) assert.ok(ranges[index][0] >= ranges[index - 1][1])
})

test('citation labels survive typing without a rebuild and refresh when citations change', async () => {
  const { Citation, citationPluginKey } = await import('../src/services/AcademicNodes.js')
  const storage = { entries: parseBibtex('@book{a, author={Smith, John}, title={A}, year={2021}}\n@book{b, author={Lee, Jane}, title={B}, year={2022}}'), style: 'unsrt' }
  const [plugin] = Citation.config.addProseMirrorPlugins.call({ storage })
  let state = EditorState.create({ schema, doc: document(paragraph([text('See '), schema.node('citation', { key: 'b' }), text(' and '), schema.node('citation', { key: 'a' })])), plugins: [plugin] })
  const labels = () => citationPluginKey.getState(state).decorations.find().map(item => [item.from, item.type.attrs['data-citation-label']])
  assert.deepEqual(labels(), [[5, '[1]'], [11, '[2]']])
  const before = citationPluginKey.getState(state).decorations.find()
  state = state.apply(state.tr.insertText('Xem ', 1))
  assert.deepEqual(labels(), [[9, '[1]'], [15, '[2]']])
  assert.equal(citationPluginKey.getState(state).decorations.find()[0].type, before[0].type)
  // Moving a citation without changing the order still decorates the node at its new position.
  state = state.apply(state.tr.delete(9, 10).insert(10, schema.node('citation', { key: 'b' })))
  assert.deepEqual(labels(), [[10, '[1]'], [15, '[2]']])
  state = state.apply(state.tr.insert(1, schema.node('citation', { key: 'a' })))
  assert.deepEqual(labels().map(([, label]) => label), ['[1]', '[2]', '[1]'])
})
