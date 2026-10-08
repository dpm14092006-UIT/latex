import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bibtexForCompile, citationDiagnostics, citationKeys, citationLabel, citationNumbers, citationOccurrences, classifyReferenceInput,
  compressNumbers, describeEntry, familyName, formatBibtexEntry, normalizeIncomingBibtex, parseBibtex, parseReferenceLine, parseRis, removeBibtexEntry, resolveCitationStyle, shortAuthors, splitAuthors, stripLatex,
} from '../src/services/Bibliography.js'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { toWordAst, importWordAst } from '../src/services/WordDocument.js'
import { isValidDocument } from '../src/services/DocumentData.js'

const bib = `@article{nguyen2024,
  author = {Nguy{\\~e}n, V{\\u{a}}n A and Tran, B. and Le, C.},
  title = {{Deep} learning for {Vietnamese} text},
  journal = "Journal of AI",
  year = 2024,
  doi = {10.1000/xyz123}
}
@inproceedings(adams2020, author={Adams, Zed}, title={Alpha}, booktitle={Proc. Conf}, year={2020}, url={https://example.com/a})
@comment{ignored}
@book{brown2019, author={Brown, Amy}, title={Beta}, publisher={Pub}, year={2019}}`

const citation = key => ({ type: 'citation', attrs: { key } })
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A ' }, citation('brown2019'), { type: 'text', text: ' B ' }, citation('nguyen2024,adams2020'), citation('missing')] }] }

test('parses BibTeX entries with nested braces, quotes and parentheses', () => {
  const entries = parseBibtex(bib)
  assert.deepEqual(entries.map(entry => entry.key), ['nguyen2024', 'adams2020', 'brown2019'])
  assert.equal(entries[0].fields.journal, 'Journal of AI')
  assert.equal(entries[0].fields.year, '2024')
  const info = describeEntry(entries[0])
  assert.equal(info.title, 'Deep learning for Vietnamese text')
  // `Nguy{\~e}n` prints as “Nguyẽn” in the PDF; the editor label shows the same letters.
  assert.equal(info.authors, 'Nguyẽn et al.')
  assert.equal(describeEntry(entries[1]).url, 'https://example.com/a')
})

test('keeps braced organization authors intact and includes surname particles in citation labels', () => {
  const entries = parseBibtex('@techreport{worldbank,author={{World Bank} and de Vries, Jane},year={2024},title={Outlook}}')
  assert.deepEqual(splitAuthors(entries[0].fields.author), ['{World Bank}', 'de Vries, Jane'])
  assert.equal(familyName('{World Bank}'), 'World Bank')
  assert.equal(shortAuthors(entries[0]), 'World Bank & de Vries')
  assert.equal(familyName('Jasper van der Waals'), 'van der Waals')
  assert.equal(familyName('de Vries, Jane'), 'de Vries')
})

test('numbers citations by first appearance, or by author for plain', () => {
  const entries = parseBibtex(bib)
  const occurrences = citationOccurrences(doc)
  assert.deepEqual(occurrences, [['brown2019'], ['nguyen2024', 'adams2020'], ['missing']])
  const numbers = citationNumbers(occurrences, entries, 'unsrt')
  assert.deepEqual([...numbers], [['brown2019', 1], ['nguyen2024', 2], ['adams2020', 3]])
  const plain = citationNumbers(occurrences, entries, 'plain')
  assert.deepEqual([...plain], [['adams2020', 1], ['brown2019', 2], ['nguyen2024', 3]])
  const byKey = new Map(entries.map(entry => [entry.key, entry]))
  assert.equal(citationLabel(['nguyen2024', 'adams2020'], numbers, byKey, 'unsrt'), '[2, 3]')
  assert.equal(citationLabel(['missing'], numbers, byKey, 'ieee'), '[?]')
  assert.equal(citationLabel(['brown2019', 'adams2020'], numbers, byKey, 'apa'), '(Adams, 2020; Brown, 2019)')
  assert.equal(citationLabel(['brown2019', 'adams2020'], numbers, byKey, 'authoryear'), '(Brown, 2019; Adams, 2020)')
})

test('compresses ranges', () => {
  assert.equal(compressNumbers([5, 1, 2, 3, 7, 8]), '1–3, 5, 7, 8')
  assert.equal(compressNumbers([4]), '4')
})

test('citation keys are split, validated and de-duplicated', () => {
  assert.deepEqual(citationKeys('a, b,a,bad key,c'), ['a', 'b', 'c'])
  assert.equal(isValidDocument(doc), true)
})

test('diagnostics report missing, unused and duplicate keys', () => {
  const entries = parseBibtex(`${bib}\n@misc{brown2019, title={Dup}}\n@misc{unused1, title={U}}`)
  const result = citationDiagnostics(doc, entries)
  assert.deepEqual(result.missing, ['missing'])
  assert.deepEqual(result.unused, ['unused1'])
  assert.deepEqual(result.duplicates, ['brown2019'])
})

test('removes one entry and renames clashing incoming keys', () => {
  const removed = removeBibtexEntry(bib, 'adams2020')
  assert.deepEqual(parseBibtex(removed).map(entry => entry.key), ['nguyen2024', 'brown2019'])
  const incoming = normalizeIncomingBibtex('@article{brown2019, author={Brown, Amy}, title={Gamma rays}, year={2021}}', new Set(['brown2019']))
  assert.equal(incoming.added[0].key, 'brown2021gamma')
  assert.match(incoming.text, /^@article\{brown2021gamma,/)
})

test('parses formatted reference lists and DOIs', () => {
  const input = `[1] A. Nguyen and B. Tran, “Deep learning for text,” IEEE Trans. Neural Netw., vol. 3, no. 2, pp. 1–9, 2024.
[2] 10.1109/5.771073
[3] Smith, J., & Doe, A. (2021). A study of things. Journal of Stuff, 4(2), 10-20.`
  const { dois, lines } = classifyReferenceInput(input)
  assert.deepEqual(dois, [])
  assert.equal(lines.length, 3)
  const ieee = parseReferenceLine(lines[0])
  assert.equal(ieee.fields.title, 'Deep learning for text')
  assert.equal(ieee.fields.author, 'A. Nguyen and B. Tran')
  assert.equal(ieee.fields.year, '2024')
  assert.equal(ieee.fields.pages, '1--9')
  assert.equal(ieee.fields.volume, '3')
  assert.equal(ieee.type, 'article')
  const apa = parseReferenceLine(lines[2])
  assert.equal(apa.fields.year, '2021')
  assert.equal(apa.fields.title, 'A study of things')
  assert.equal(apa.fields.journal, 'Journal of Stuff')
  assert.deepEqual([apa.fields.volume, apa.fields.number, apa.fields.pages], ['4', '2', '10--20'])
  assert.deepEqual(classifyReferenceInput('10.1109/5.771073\nhttps://doi.org/10.1000/abc').dois, ['10.1109/5.771073', '10.1000/abc'])
})

test('parses and converts multi-record RIS files', () => {
  const ris = `\uFEFFTY  - JOUR
AU  - Nguyen, An
AU  - Tran, Binh
TI  - A portable reference format
JO  - Journal of Example Studies
VL  - 12
IS  - 3
SP  - 40
EP  - 52
PY  - 2024/06/01
DO  - https://doi.org/10.1000/example
ER  -
TY  - CONF
AU  - Le, Chi
TI  - Importing citations safely
T2  - Proceedings of the Example Conference
PB  - Example Press
Y1  - 2023/09/01
ER  -`
  const classified = classifyReferenceInput(ris)
  assert.equal(classified.ris.length, 2)
  assert.deepEqual(classified.dois, [])
  assert.deepEqual(classified.lines, [])
  const [article, conference] = parseRis(ris)
  assert.equal(article.type, 'article')
  assert.deepEqual(article.fields, {
    author: 'Nguyen, An and Tran, Binh', title: 'A portable reference format', journal: 'Journal of Example Studies',
    volume: '12', number: '3', pages: '40--52', year: '2024', doi: '10.1000/example',
  })
  assert.equal(conference.type, 'inproceedings')
  assert.equal(conference.fields.booktitle, 'Proceedings of the Example Conference')
  assert.equal(conference.fields.publisher, 'Example Press')
  const bibtex = classified.ris.map((entry, index) => formatBibtexEntry({ type: entry.type, key: `ris${index}`, fields: entry.fields })).join('\n')
  assert.deepEqual(parseBibtex(bibtex).map(entry => entry.key), ['ris0', 'ris1'])
  assert.equal(parseBibtex(bibtex)[0].fields.pages, '40--52')
})

test('offline fallback preserves LNCS conference chapter metadata and its publication year', () => {
  const ref = 'Avogaro, A., Capogrosso, L., Fummi, F., Cristani, M. (2025). MDiFF: Exploiting Multimodal Score-Based Diffusion Models for New Fashion Product Performance Forecasting. In: Del Bue, A., Canton, C., Pont-Tuset, J., Tommasi, T. (eds) Computer Vision – ECCV 2024 Workshops. ECCV 2024. Lecture Notes in Computer Science, vol 15623. Springer, Cham. [https://doi.org/10.1007/978-3-031-91569-7_21 ](<https://doi.org/10.1007/978-3-031-91569-7_21 >) &#x20;'
  const parsed = parseReferenceLine(ref)
  assert.equal(parsed.type, 'inproceedings')
  assert.equal(parsed.fields.year, '2025')
  assert.equal(parsed.fields.booktitle, 'Computer Vision – ECCV 2024 Workshops')
  assert.equal(parsed.fields.author, 'Avogaro, A. and Capogrosso, L. and Fummi, F. and Cristani, M.')
  assert.equal(parsed.fields.editor, 'Del Bue, A. and Canton, C. and Pont-Tuset, J. and Tommasi, T.')
  assert.equal(parsed.fields.series, 'Lecture Notes in Computer Science')
  assert.equal(parsed.fields.volume, '15623')
  assert.equal(parsed.fields.publisher, 'Springer')
  assert.equal(parsed.fields.address, 'Cham')
  assert.equal(parsed.fields.doi, '10.1007/978-3-031-91569-7_21')
  assert.equal(parsed.fields.journal, undefined)
})

test('APA book chapters retain editors, page ranges and publisher', () => {
  const parsed = parseReferenceLine('Smith, J. (2025). A chapter. In A. Brown (Ed.), Research methods (pp. 15–30). Example Press.')
  assert.equal(parsed.type, 'incollection')
  assert.equal(parsed.fields.booktitle, 'Research methods')
  assert.equal(parsed.fields.editor, 'A. Brown')
  assert.equal(parsed.fields.pages, '15--30')
  assert.equal(parsed.fields.publisher, 'Example Press')
})

test('Word AST roundtrip retains table caption, label and repeated header rows', async () => {
  const document = { type: 'doc', content: [{ type: 'table', attrs: { caption: 'Kết quả so sánh', label: 'tab:results' }, content: ['tableHeader', 'tableCell'].map(type => ({ type: 'tableRow', content: [{ type, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Giá trị' }] }] }] })) }] }
  const ast = toWordAst(document, 'Tables')
  const restored = await importWordAst(ast)
  assert.equal(restored.document.content[0].attrs.caption, 'Kết quả so sánh')
  assert.equal(restored.document.content[0].attrs.label, 'tab:results')
  assert.equal(restored.document.content[0].content[0].content[0].type, 'tableHeader')
})

test('adds DOI/URL links for styles that ignore those fields', () => {
  const out = bibtexForCompile(bib, 'unsrt')
  assert.match(out, /note = \{\\url\{https:\/\/doi\.org\/10\.1000\/xyz123\}\}/)
  assert.match(out, /note = \{\\url\{https:\/\/example\.com\/a\}\}/)
  assert.deepEqual(parseBibtex(out).map(entry => entry.key), ['nguyen2024', 'adams2020', 'brown2019'])
  const ieee = parseBibtex(bibtexForCompile(bib, 'ieee'))
  assert.equal(ieee[0].fields.url, 'https://doi.org/10.1000/xyz123')
  assert.equal(ieee[1].fields.url, 'https://example.com/a')
  assert.equal(bibtexForCompile(bib, 'apa'), bib)
})

test('BibTeX compilation escapes text metacharacters while preserving URL query strings', () => {
  const source = '@article{symbols, title={Models & Forecasts_5}, journal={Research & Development}, url={https://example.com/?left=1&right=2}, year={2026}}'
  const compiled = bibtexForCompile(source, 'apa')
  assert.match(compiled, /title\s*=\s*\{Models \\& Forecasts\\_5\}/)
  assert.match(compiled, /journal\s*=\s*\{Research \\& Development\}/)
  assert.match(compiled, /url\s*=\s*\{https:\/\/example\.com\/\?left=1&right=2\}/)
  assert.equal(parseBibtex(compiled)[0].fields.url, 'https://example.com/?left=1&right=2')
  const numeric = bibtexForCompile(source.replace('year={2026}', 'year={2026}, doi={10.1000/symbols}'), 'unsrt')
  assert.match(numeric, /note = \{\\url\{https:\/\/doi\.org\/10\.1000\/symbols\}\}/)
  assert.equal(parseBibtex(numeric)[0].fields.journal, 'Research \\& Development')
})

test('serializer emits grouped citations with the chosen style', () => {
  const run = citationStyle => toLatex(doc, 'T', undefined, { bibliography: bib, citationStyle }).latex
  const numeric = run('unsrt')
  assert.match(numeric, /\\cite\{brown2019\}/)
  assert.match(numeric, /\\cite\{nguyen2024,adams2020\}/)
  assert.match(numeric, /\\bibliographystyle\{unsrt\}/)
  assert.match(numeric, /\\usepackage\{cite\}[\s\S]*hyperref/)
  const apa = run('apa')
  assert.match(apa, /\\usepackage\[backend=biber,style=apa,natbib=true\]\{biblatex\}[\s\S]*hyperref/)
  assert.match(apa, /\\hypersetup\{pdfborder=\{0 0 0\}\}/)
  assert.match(apa, /\\citep\{brown2019\}/)
  assert.match(apa, /\\addbibresource\{references.bib\}/)
  assert.match(apa, /\\printbibliography/)
  const harvard = run('authoryear')
  assert.match(harvard, /\\citep\{nguyen2024,adams2020\}/)
  assert.match(harvard, /\\usepackage\[round\]\{natbib\}/)
  assert.equal(resolveCitationStyle('auto', '\\documentclass[conference]{IEEEtran}'), 'ieee')
})

test('Word export groups keys in one Cite and passes the style', () => {
  const ast = toWordAst(doc, 'T', { bibliography: bib, citationStyle: 'apa' })
  const cites = JSON.stringify(ast.blocks).match(/"citationId":"[^"]+"/g)
  assert.deepEqual(cites, ['"citationId":"brown2019"', '"citationId":"nguyen2024"', '"citationId":"adams2020"', '"citationId":"missing"'])
  assert.equal(ast._citationStyle, 'apa')
})

test('narrative citations preserve author-in-text semantics in labels, LaTeX and Word AST', async () => {
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'citation', attrs: { key: 'brown2019', mode: 'narrative' } }] }] }
  const byKey = new Map(parseBibtex(bib).map(entry => [entry.key, entry]))
  const numbers = new Map([['brown2019', 1]])
  assert.equal(citationLabel(['brown2019'], numbers, byKey, 'apa', 'narrative'), 'Brown (2019)')
  assert.equal(citationLabel(['brown2019'], numbers, byKey, 'unsrt', 'narrative'), 'Brown [1]')
  for (const style of ['apa', 'authoryear']) assert.match(toLatex(document, 'T', undefined, { bibliography: bib, citationStyle: style }).latex, /\\citet\{brown2019\}/)
  assert.match(toLatex(document, 'T', undefined, { bibliography: bib, citationStyle: 'unsrt' }).latex, /Brown \\cite\{brown2019\}/)
  const ast = toWordAst(document, 'T', { bibliography: bib, citationStyle: 'apa' })
  assert.equal(ast.blocks[0].c[0].c[0][0].citationMode.t, 'AuthorInText')
  const imported = await importWordAst(ast)
  assert.equal(imported.document.content[0].content[0].attrs.mode, 'narrative')
  assert.equal(isValidDocument(document), true)
})

test('plain reference et al is represented as BibTeX others rather than an author named al', () => {
  const entry = parseReferenceLine('[12] P. Sousa et al., “Demand forecasts,” Journal, 2025.')
  const byKey = new Map([[entry.key || 'sousa', { ...entry, key: entry.key || 'sousa' }]])
  assert.equal(citationLabel([...byKey.keys()], new Map(), byKey, 'apa', 'narrative'), 'Sousa et al. (2025)')
})

test('compiler escaping never changes BibTeX identifiers containing underscores', () => {
  const source = '@article{ma_2024,author={Ma, A},title={Trends_5 & models},year={2024}}'
  for (const style of ['unsrt', 'apa', 'ieee']) {
    const compiled = bibtexForCompile(source, style)
    assert.equal(parseBibtex(compiled)[0].key, 'ma_2024')
    assert.match(compiled, /Trends\\_5 \\& models/)
  }
})

test('LaTeX accents, Vietnamese tone marks and special letters display as the PDF prints them', () => {
  const cases = [
    [String.raw`Nguy{\~{\^e}}n`, 'Nguyễn'],
    [String.raw`Tr{\`\^a}n {\d{a}}i {\h{o}}`, 'Trần ại ỏ'],
    [String.raw`M{\"u}ller and Garc{\'\i}a`, 'Müller and García'],
    [String.raw`S{\o}ren {\ss} {\L}ukasz {\DJ}{\^o}ng`, 'Søren ß Łukasz Đông'],
    [String.raw`\emph{Nguy{\~e}n} \textbf{Analysis}`, 'Nguyẽn Analysis'],
    [String.raw`{\v{C}}apek \c{c}a \u{a}`, 'Čapek ça ă'],
  ]
  for (const [input, expected] of cases) assert.equal(stripLatex(input), expected, input)
  // Letter accents never consume a longer command name.
  assert.equal(stripLatex(String.raw`\Huge Title`), String.raw`\Huge Title`)
  const entry = parseBibtex(String.raw`@article{a, author={Nguy{\~{\^e}}n, V{\u{a}}n An}, year={2024}, title={T}}`)[0]
  assert.equal(shortAuthors(entry), 'Nguyễn')
})

test('capitalized given names are not BibTeX von particles', () => {
  assert.equal(familyName('Van Thanh Nguyen'), 'Nguyen')
  assert.equal(familyName('Hung Van Le'), 'Le')
  assert.equal(familyName('Do Van Nam'), 'Nam')
  assert.equal(familyName('Ludwig van Beethoven'), 'van Beethoven')
  const entry = parseBibtex('@article{vn, author={Van Thanh Nguyen and Hung Van Le}, year={2023}, title={T}}')[0]
  assert.equal(shortAuthors(entry), 'Nguyen & Le')
  assert.equal(citationLabel(['vn'], new Map(), new Map([['vn', entry]]), 'apa'), '(Nguyen & Le, 2023)')
})

test('BibTeX compilation keeps inline math in titles while escaping text metacharacters', () => {
  const source = String.raw`@article{km, author={Lee, A}, title={{$k$}-means & $O(n \log n)$ clustering_v2}, journal={J}, year={2024}}`
  for (const style of ['unsrt', 'apa']) {
    const compiled = bibtexForCompile(source, style)
    assert.ok(compiled.includes(String.raw`{$k$}-means \& $O(n \log n)$ clustering\_v2`), style)
  }
  assert.ok(bibtexForCompile('@misc{p, title={Costs 50$ only}, year={2024}}', 'unsrt').includes(String.raw`Costs 50\$ only`))
})

test('APA reference lines with a full date or n.d. keep author, year and title apart', () => {
  const dated = parseReferenceLine('Nguyen, A. (2024, March 5). Rising sea levels. Daily News.')
  assert.equal(dated.fields.author, 'Nguyen, A.')
  assert.equal(dated.fields.year, '2024')
  assert.equal(dated.fields.title, 'Rising sea levels')
  const undated = parseReferenceLine('World Health Organization. (n.d.). Air quality guidance. Retrieved 2025 from https://who.int/air')
  assert.equal(undated.fields.title, 'Air quality guidance')
  assert.equal(undated.fields.year, undefined)
})

test('formatted entries with a stray brace or trailing backslash cannot swallow later entries', () => {
  const broken = formatBibtexEntry({ type: 'misc', key: 'broken', fields: { title: 'Sets {A, B and C', note: `path C:${String.fromCharCode(92)}` } })
  const parsed = parseBibtex(`${broken}\n\n@misc{next, title={Next}, year={2024}}`)
  assert.deepEqual(parsed.map(entry => entry.key), ['broken', 'next'])
  assert.equal(parsed[0].fields.title, 'Sets A, B and C')
  assert.equal(formatBibtexEntry({ key: 'ok', fields: { title: '{Deep} learning' } }), '@misc{ok,\n  title = {{Deep} learning}\n}')
})
