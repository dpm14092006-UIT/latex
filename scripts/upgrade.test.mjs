import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { createTask, createProject, editWorkspace, mergeWorkspace, sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { toLatex, normalizeDocumentDelimiters } from '../src/services/DocumentSerializer.js'
import { validateAssets, safeAssetPath, bytesToBase64 } from '../src/services/ProjectAssets.js'
import { exportLatexProject, importWorkspace, importLatexProject, readZip } from '../src/services/ArchiveService.js'
import { toWordAst, importWordAst } from '../src/services/WordDocument.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'
import { bibtexForCompile } from '../src/services/Bibliography.js'
import { citationLabel, citationNumbers, parseBibtex } from '../src/services/Bibliography.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unicodeScriptFormulas } from '../src/math-input.js'
const require = createRequire(import.meta.url)
const goBackend = await startGoBackendForTests()
after(() => goBackend.close())
const { createWorkspaceStore } = require('../electron/workspace-store.cjs')
const sample = () => ({ version: 1, projects: [createProject('Dự án thử', createTask('Công thức'))] })
const text = value => ({ type: 'text', text: value })
const paragraph = value => ({ type: 'paragraph', content: [text(value)] })
async function pdfText(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await loading.promise
  try {
    const pages = []
    for (let number = 1; number <= pdf.numPages; number++) pages.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str).join(' '))
    return pages.join(' ').replace(/\s+/g, ' ')
  } finally { await loading.destroy() }
}

test('automatically recognized Unicode chemical formulas compile with scripts in a real PDF', async () => {
  const content = unicodeScriptFormulas('NO₂ CO₂ H₂O SO₄²⁻ m² xₜ').flatMap(formula => [
    { type: 'inlineMath', attrs: { latex: formula.latex } }, text(' '),
  ])
  const { latex } = toLatex({ type: 'doc', content: [{ type: 'paragraph', content }] }, 'Recognized chemistry')
  assert.match(latex, /\$\\mathrm\{NO\}_\{2\}\$/)
  const bytes = await goBackend.compileLatex(latex, [], { fresh: true })
  const printed = (await pdfText(bytes)).replace(/\s+/gu, '')
  assert.ok(printed.includes('NO2CO2H2O'), printed)
  // Math-mode extraction may emit the raised charge before the lower index.
  assert.match(printed, /SO(?:42[-−]|2[-−]4)/u)
  assert.ok(printed.includes('m2xt'), printed)
  assert.doesNotMatch(printed, /[\ufffd\uffff]/u)
})

test('typed Unicode scripts retain their glyphs and baseline positions in a real PDF', async () => {
  const document = { type: 'doc', content: [paragraph('NO₂ CO₂ H₂O SO₄²⁻ m² xₜ ¹⁴C')] }
  const { latex } = toLatex(document, 'Unicode scripts')
  const bytes = await goBackend.compileLatex(latex, [], { fresh: true })
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  try {
    const pdf = await loading.promise
    const items = (await (await pdf.getPage(1)).getTextContent()).items
    const combined = items.map(item => item.str).join('').replace(/\s+/gu, '')
    assert.ok(combined.includes('NO2CO2H2OSO42-m2xt14C'), combined)
    assert.doesNotMatch(combined, /[\ufffd\uffff]/u)
    const no = items.findIndex(item => item.str === 'NO')
    assert.equal(items[no + 1]?.str, '2')
    assert.ok(items[no + 1].transform[5] < items[no].transform[5], 'NO₂ must place 2 below the baseline')
    assert.ok(items[no + 1].height < items[no].height, 'NO₂ must reduce the script size')
    const meters = items.findIndex(item => item.str === 'm')
    assert.equal(items[meters + 1]?.str, '2')
    assert.ok(items[meters + 1].transform[5] > items[meters].transform[5], 'm² must place 2 above the baseline')
  } finally { await loading.destroy() }
})

test('workspace CRUD, merge and restored settings retain independent documents', () => {
  const source = sample(); source.activeProjectId = source.projects[0].id
  source.projects[0].tasks[0].sourceDraft = '\\documentclass{article}'
  source.projects[0].tasks[0].sourceDraftBackup = true
  source.projects[0].tasks[0].settings.author = 'Nguyễn Văn A'
  assert.equal(sanitizeWorkspace(source).projects[0].tasks[0].sourceDraftBackup, true)
  const duplicate = editWorkspace(source, 'duplicate-task', source.activeProjectId, source.projects[0].tasks[0].id)
  assert.equal(duplicate.projects[0].tasks.length, 2)
  duplicate.projects[0].tasks[1].settings.author = 'B'
  assert.equal(source.projects[0].tasks[0].settings.author, 'Nguyễn Văn A')
  const incoming = mergeWorkspace(source, source)
  assert.equal(incoming.projects.length, 2)
  assert.notEqual(incoming.projects[0].id, incoming.projects[1].id)
  assert.equal(incoming.projects[1].tasks[0].sourceTrusted, false)
  const removed = editWorkspace(source, 'delete-project', source.activeProjectId)
  assert.equal(removed.projects.length, 1)
  assert.ok(sanitizeWorkspace(removed))
})

test('atomic workspace snapshots recover corrupted primary without overwriting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-store-test-'))
  try {
    const store = createWorkspaceStore({ getPath: () => directory })
    const first = sample()
    await store.save(first)
    await store.backup()
    const second = structuredClone(first); second.projects[0].name = 'Bản mới'
    await store.save(second)
    assert.equal((await store.load()).projects[0].name, 'Bản mới')
    await writeFile(join(directory, 'workspace-v1.json'), '{broken')
    const recovered = await store.load()
    assert.equal(recovered.projects[0].name, 'Dự án thử')
    assert.match(recovered.recoveryMessage, /khôi phục/)
    await store.save(recovered)
    assert.ok(JSON.parse(await readFile(join(directory, 'workspace-v1.json'), 'utf8')))
    await assert.rejects(store.readBackup('../../bad'), /không hợp lệ/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('project archives reject traversal, resource collisions and excessive inflation', async () => {
  for (const path of ['../secret.tex', '/absolute.tex', 'C:/secret.tex', 'a\\b.tex', 'CON.tex', 'document.tex']) assert.equal(safeAssetPath(path), false, path)
  assert.throws(() => validateAssets([{ filename: 'A.bib', data: '' }, { filename: 'a.bib', data: '' }]), /trùng/)
  const bad = new File([zipSync({ '../escape.tex': strToU8('bad') })], 'bad.zip')
  await assert.rejects(readZip(bad), /không an toàn/)
  await assert.rejects(readZip(new File([zipSync({ 'huge.tex': new Uint8Array(1024 * 1024) })], 'bomb.zip'), 10000), /dung lượng/)
  const good = new File([zipSync({ 'main.tex': strToU8('\\documentclass{article}\\begin{document}Hello\\end{document}'), 'figures/test.txt': strToU8('data') })], 'paper.zip')
  const result = await importLatexProject(good)
  assert.equal(result.assets[0].filename, 'figures/test.txt')
  const raw = { ...sample(), format: 'vietlatex-workspace' }
  const restored = await importWorkspace(new File([zipSync({ 'workspace.json': strToU8(JSON.stringify(raw)) })], 'sample.vls'))
  assert.equal(restored.projects[0].tasks[0].title, 'Công thức')
})

test('project archive import reports supported resources outside the main source folder', async () => {
  const archive = new File([zipSync({
    'src/main.tex': strToU8('\\documentclass{article}\\begin{document}\\includegraphics{../figures/chart.png}\\end{document}'),
    'figures/chart.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  })], 'split-assets.zip')
  await assert.rejects(importLatexProject(archive), /Tài nguyên nằm ngoài thư mục của tệp chính/)
})

test('project archive byte budget includes the source separately from the asset allowance', async () => {
  const source = strToU8('\\documentclass{article}\\begin{document}Hello\\end{document}')
  const assetBytes = [10, 10, 4].map(size => new Uint8Array(size * 1024 * 1024))
  const file = new File([zipSync({ 'main.tex': source, 'large-a.txt': assetBytes[0], 'large-b.txt': assetBytes[1], 'large-c.txt': assetBytes[2] })], 'max-assets.zip')
  const imported = await importLatexProject(file)
  assert.equal(imported.assets.reduce((sum, asset) => sum + Buffer.from(asset.data, 'base64').length, 0), 24 * 1024 * 1024)
})

test('LaTeX project export validates image bytes and rejects name collisions', async () => {
  const png = { filename: 'image-1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }
  await assert.rejects(exportLatexProject('\\documentclass{article}', [{ ...png, data: '/9j/4AAQ' }], [], 'test'), /không khớp/)
  await assert.rejects(exportLatexProject('\\documentclass{article}', [png], [{ filename: 'image-1.png', data: '' }], 'test'), /trùng tài nguyên/)
})

test('LaTeX ZIP export stays within the same combined resource limits as import', async () => {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
  const image = { filename: 'image-1.png', data: pngSignature }
  const assets = [10, 10, 4].map((size, index) => ({
    filename: `asset-${index}.txt`,
    data: Buffer.alloc(size * 1024 * 1024).toString('base64'),
  }))
  await assert.rejects(exportLatexProject('\\documentclass{article}', [image], assets, 'test'), /ảnh và tài nguyên.*24 MB/)

  const manyAssets = Array.from({ length: 93 }, (_, index) => ({ filename: `asset-${index}.txt`, data: '' }))
  await assert.rejects(exportLatexProject('\\documentclass{article}', Array.from({ length: 8 }, (_, index) => ({ filename: `image-${index + 1}.png`, data: pngSignature })), manyAssets, 'test'), /tối đa 100 tệp/)
})

test('inline conversion preserves existing math, links, marks and literal code', () => {
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'inlineMath', attrs: { latex: 'a^2' } }, { type: 'text', text: ' bold $b^2$', marks: [{ type: 'bold' }] }, { type: 'text', text: '$literal$', marks: [{ type: 'code' }] },
  ] }] }
  const result = normalizeDocumentDelimiters(document)
  assert.deepEqual(result.content[0].content[0], document.content[0].content[0])
  assert.equal(result.content[0].content[1].marks[0].type, 'bold')
  assert.equal(result.content[0].content[2].attrs.latex, 'b^2')
  assert.equal(result.content[0].content[3].text, '$literal$')
})

test('real XeLaTeX compiles Vietnamese, links, code, tables, equation references and BibTeX', async () => {
  const document = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, label: 'sec:one' }, content: [text('Tiếng Việt và công thức')] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Nguồn tham khảo', marks: [{ type: 'link', attrs: { href: 'https://example.com?q=1&x=2' } }, { type: 'underline' }] }, text(' '), { type: 'citation', attrs: { key: 'sample' } }] },
    { type: 'blockMath', attrs: { latex: 'x^2+y^2=z^2', label: 'eq:one' } },
    { type: 'paragraph', content: [text('Xem công thức '), { type: 'crossReference', attrs: { target: 'eq:one' } }] },
    { type: 'codeBlock', content: [text('const a_b = 1;\n  line two')] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('Tên')] }, { type: 'tableHeader', content: [paragraph('Giá trị')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('A')] }, { type: 'tableCell', content: [paragraph('B')] }] }] },
  ] }
  const bibliography = '@article{sample, author={Nguyen, A}, title={Example}, journal={Journal}, year={2026}}'
  const { latex } = toLatex(document, 'Bản kiểm tra', undefined, { author: 'Nguyễn Văn A', tableOfContents: true, bibliography })
  assert.doesNotMatch(latex, /Author Name|tikz-cd|\{\{content\}\}/)
  assert.match(latex, /\\label\{eq:one\}/)
  const pdf = await goBackend.compileLatex(latex, [], { assets: [{ filename: 'references.bib', data: bytesToBase64(strToU8(bibliography)) }] })
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})

test('Word roundtrip preserves editable OMML math, links and a table', async () => {
  const document = { type: 'doc', content: [
    paragraph('Tài liệu tiếng Việt'),
    { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '\\frac{a}{b}' } }, text(' kết quả')] },
    { type: 'blockMath', attrs: { latex: '\\int_0^1 x^2\\,dx' } },
    { type: 'table', attrs: { caption: 'Kết quả so sánh mô hình', label: 'tab:models' }, content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('Cột 1')] }, { type: 'tableHeader', content: [paragraph('Cột 2')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('A')] }, { type: 'tableCell', content: [paragraph('B')] }] }] },
  ] }
  const exported = await goBackend.convertWord('export', toWordAst(document, 'Word test', { abstractEnabled: true, abstract: 'Abstract content preserved in Word.' }))
  const xml = strFromU8(unzipSync(exported.bytes)['word/document.xml'])
  assert.match(xml, /m:oMath/)
  assert.match(xml, /w:tbl/)
  assert.match(xml.replace(/<[^>]+>/g, ''), /Kết quả so sánh mô hình/)
  assert.match(xml, /w:tblHeader/)
  const wordText = xml.replace(/<[^>]+>/g, '')
  assert.ok(wordText.indexOf('Abstract content preserved in Word.') < wordText.indexOf('Tài liệu tiếng Việt'))
  const imported = await goBackend.convertWord('import', exported.bytes)
  const value = await importWordAst(imported.ast)
  const serialized = JSON.stringify(value.document)
  assert.match(serialized, /inlineMath/)
  assert.match(serialized, /blockMath/)
  assert.match(serialized, /table/)
  assert.match(serialized, /Kết quả so sánh mô hình/)
})

test('real PDF places a centered Abstract between title metadata and Introduction', async () => {
  const document = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [text('Introduction')] }, paragraph('Main manuscript body.')] }
  const { latex } = toLatex(document, 'Frame title', undefined, { author: 'Group 1 Research Proposal', date: 'October 2026', abstractEnabled: true, abstract: 'Forecasting abstract content. ' + 'This study examines visual styles and forecasting methods across multiple seasons. '.repeat(8) })
  const bytes = await goBackend.compileLatex(latex, [], { fresh: true })
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  const pdf = await loading.promise
  try {
    const page = await pdf.getPage(1)
    const items = (await page.getTextContent()).items
    const find = value => items.find(item => item.str.includes(value))
    const heading = find('Abstract')
    assert.ok(heading)
    assert.ok(Math.abs(heading.transform[4] + heading.width / 2 - page.getViewport({ scale: 1 }).width / 2) < 1, 'Abstract heading is physically centered on the page')
    const title = find('Frame title'), date = find('October 2026'), abstract = find('Forecasting abstract content'), intro = find('Introduction')
    assert.ok(title.transform[5] > date.transform[5] && date.transform[5] > heading.transform[5] && heading.transform[5] > abstract.transform[5] && abstract.transform[5] > intro.transform[5], 'title, metadata, Abstract and Introduction retain their order')
  } finally { await loading.destroy() }
})

test('APA same-year labels and BibTeX string expansion agree across editor, PDF and Word', async () => {
  const bibliography = '@string{house="Example " # "Press"}\n@book{beta,author={Smith, John},title={Beta forecasting},publisher=house,year={2025}}\n@book{alpha,author={Smith, John},title={Alpha forecasting},publisher=house,year={2025}}'
  const entries = parseBibtex(bibliography)
  const numbers = citationNumbers([['beta', 'alpha']], entries, 'apa')
  const byKey = new Map(entries.map(entry => [entry.key, entry]))
  assert.equal(citationLabel(['alpha'], numbers, byKey, 'apa'), '(Smith, 2025a)')
  assert.equal(citationLabel(['beta'], numbers, byKey, 'apa'), '(Smith, 2025b)')
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'citation', attrs: { key: 'beta,alpha' } }] }] }
  const { latex } = toLatex(document, 'Year suffix', undefined, { bibliography, citationStyle: 'apa' })
  const pdf = await goBackend.compileLatex(latex, [], { assets: [{ filename: 'references.bib', data: bytesToBase64(strToU8(bibtexForCompile(bibliography, 'apa'))) }], fresh: true })
  const printed = await pdfText(pdf)
  assert.match(printed, /2025a/)
  assert.match(printed, /2025b/)
  assert.match(printed, /Example Press/)
  const word = await goBackend.convertWord('export', toWordAst(document, 'Year suffix', { bibliography, citationStyle: 'apa' }))
  const content = strFromU8(unzipSync(word.bytes)['word/document.xml']).replace(/<[^>]+>/g, '')
  assert.match(content, /2025a/)
  assert.match(content, /2025b/)
  assert.match(content, /Example Press/)
})

test('real XeLaTeX paginates long tables and repeats headers in single-column and IEEE documents', async () => {
  const { builtInDocumentTemplates } = await import('../src/services/DocumentSerializer.js')
  const cell = (type, value) => ({ type, content: [paragraph(value)] })
  const document = { type: 'doc', content: [{ type: 'table', attrs: { caption: 'Long table regression', label: 'tab:long' }, content: [
    { type: 'tableRow', content: [cell('tableHeader', 'Record'), cell('tableHeader', 'Description')] },
    ...Array.from({ length: 120 }, (_, index) => ({ type: 'tableRow', content: [cell('tableCell', `R${String(index + 1).padStart(3, '0')}`), cell('tableCell', 'Data retained across page boundaries')] })),
  ] }] }
  for (const source of [undefined, builtInDocumentTemplates.find(item => item.id === 'ieee-conference').source]) {
    const { latex } = toLatex(document, 'Pagination', source)
    const bytes = await goBackend.compileLatex(latex, [], { fresh: true })
    const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
    const pdf = await loading.promise
    try {
      const pages = []
      for (let number = 1; number <= pdf.numPages; number++) pages.push((await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str).join(' '))
      assert.ok(pages.filter(page => page.includes('Record') && page.includes('Description')).length >= 2, 'table headers repeat across pages')
      const printed = pages.join(' ')
      for (let number = 1; number <= 120; number++) assert.ok(printed.includes(`R${String(number).padStart(3, '0')}`), `row ${number} is retained`)
      assert.ok(printed.includes('Long table regression'))
    } finally { await loading.destroy() }
  }
})

test('Word export accepts valid embedded images and rejects MIME mismatches', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
  const document = { type: 'doc', content: [{ type: 'imageBlock', attrs: { src: `data:image/png;base64,${png}`, alt: 'Pixel', caption: 'Đồ thị A_B & 50%' } }] }
  const exported = await goBackend.convertWord('export', toWordAst(document, 'Image test'))
  assert.equal(Object.keys(unzipSync(exported.bytes)).filter(name => name.startsWith('word/media/')).length, 1)
  const imported = await goBackend.convertWord('import', exported.bytes)
  assert.equal(imported.ast.blocks[0].t, 'Figure')
  const caption = imported.ast.blocks[0].c[1][1].flatMap(block => block.c).filter(item => item.t === 'Str').map(item => item.c).join(' ')
  assert.equal(caption, 'Đồ thị A_B & 50%')
  const { latex, images } = toLatex(document, 'Image caption')
  const pdf = await goBackend.compileLatex(latex, images)
  assert.match(await pdfText(pdf), /Đồ thị A_B & 50%/u)

  const invalid = structuredClone(document)
  invalid.content[0].attrs.src = 'data:image/png;base64,/9j/4AAQ'
  await assert.rejects(goBackend.convertWord('export', toWordAst(invalid, 'Image test')), /không khớp/)
})

test('real XeLaTeX and Pandoc export narrative citations with authors in the sentence', async () => {
  const bibliography = '@article{sousa, author={Sousa, P and Other, A and Third, B}, title={Demand}, journal={Journal}, year={2025}}\n@article{giri,author={Giri, A and Chen, B},title={Forecasting},journal={Journal},year={2022}}'
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [text('Theo '), { type: 'citation', attrs: { key: 'sousa', mode: 'narrative' } }, text(', demand improves. '), { type: 'citation', attrs: { key: 'giri', mode: 'narrative' } }, text(' compared methods.')] }] }
  for (const citationStyle of ['apa', 'authoryear', 'unsrt']) {
    const { latex } = toLatex(document, 'Narrative', undefined, { bibliography, citationStyle })
    const pdf = await goBackend.compileLatex(latex, [], { assets: [{ filename: 'references.bib', data: bytesToBase64(strToU8(bibliography)) }] })
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    const printed = await pdfText(pdf)
    assert.match(printed, /Sousa/)
    assert.doesNotMatch(printed, /\[\?\]|\(\?\)/)
    const exported = await goBackend.convertWord('export', toWordAst(document, 'Narrative', { bibliography, citationStyle }))
    const xml = strFromU8(unzipSync(exported.bytes)['word/document.xml'])
    const content = xml.replace(/<[^>]+>/g, '')
    assert.match(content, /Theo Sousa/)
    assert.match(content, /Giri/)
    assert.doesNotMatch(content, /Theo \(Sousa/)
    if (citationStyle === 'apa' || citationStyle === 'authoryear') assert.match(content, /2025/)
  }
})

test('compiled numeric PDF resolves underscore keys and prints the same 6, 7, 8 labels as the editor', async () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({ key: `ref_${index + 1}`, author: index === 5 ? 'Ma' : index === 6 ? 'Ding' : index === 7 ? 'Chen' : `Author${index + 1}` }))
  const bibliography = entries.map(entry => `@article{${entry.key},author={${entry.author}, A and Other, B and Third, C},title={Study},journal={Journal},year={2025}}`).join('\n')
  const document = { type: 'doc', content: [{ type: 'paragraph', content: entries.slice(0, 5).flatMap(entry => [{ type: 'citation', attrs: { key: entry.key } }, text(' ')]) }, { type: 'paragraph', content: entries.slice(5).flatMap(entry => [text(`${entry.author} et al. `), { type: 'citation', attrs: { key: entry.key } }, text(', ')]) }] }
  const { latex } = toLatex(document, 'Numeric regression', undefined, { bibliography, citationStyle: 'unsrt' })
  const pdf = await goBackend.compileLatex(latex, [], { assets: [{ filename: 'references.bib', data: bytesToBase64(strToU8(bibtexForCompile(bibliography, 'unsrt'))) }] })
  const printed = await pdfText(pdf)
  assert.match(printed, /Ma et al\.\s*\[6\]/)
  assert.match(printed, /Ding et al\.\s*\[7\]/)
  assert.match(printed, /Chen et al\.\s*\[8\]/)
  assert.doesNotMatch(printed, /\[\?\]/)
  await mkdir('artifacts/citation-scan', { recursive: true })
  await writeFile('artifacts/citation-scan/numeric-regression.pdf', pdf)
})

test('the supplied grouped APA citation prints both works in PDF and Word without numeric labels', async () => {
  const bibliography = '@article{swami_2024,author={Swaminathan, S and Venkitasubramony, R},year={2024},title={One},journal={Journal}}\n@article{anitha_2025,author={Anitha, A and Neelakandan, S},year={2025},title={Two},journal={Journal}}'
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [text('Evidence '), { type: 'citation', attrs: { key: 'swami_2024,anitha_2025' } }, text('.')] }] }
  const settings = { bibliography, citationStyle: 'apa' }
  const { latex } = toLatex(document, 'APA grouped regression', undefined, settings)
  const pdf = await goBackend.compileLatex(latex, [], { assets: [{ filename: 'references.bib', data: bytesToBase64(strToU8(bibtexForCompile(bibliography, 'apa'))) }] })
  const printed = await pdfText(pdf)
  assert.match(printed, /Evidence \(Anitha & Neelakandan, 2025; Swaminathan & Venkitasubramony, 2024\)/)
  assert.doesNotMatch(printed, /\[\?\]|\[1\]/)
  const exported = await goBackend.convertWord('export', toWordAst(document, 'APA grouped regression', settings))
  const xml = strFromU8(unzipSync(exported.bytes)['word/document.xml'])
  const wordText = xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
  assert.match(wordText, /Evidence \(Anitha & Neelakandan, 2025; Swaminathan & Venkitasubramony, 2024\)/)
  await mkdir('artifacts/citation-scan', { recursive: true })
  await writeFile('artifacts/citation-scan/apa-grouped-regression.pdf', pdf)
  await writeFile('artifacts/citation-scan/apa-grouped-regression.docx', exported.bytes)
})

test('the compiler rejects unresolved citation warnings instead of returning a PDF containing [?]', async () => {
  const bibliography = '@article{known,author={Author, A},title={Known},journal={Journal},year={2025}}'
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'citation', attrs: { key: 'known,missing' } }] }] }
  for (const citationStyle of ['unsrt', 'apa']) {
    const { latex } = toLatex(document, 'Unresolved', undefined, { bibliography, citationStyle })
    await assert.rejects(goBackend.compileLatex(latex, [], { assets: [{ filename: 'references.bib', data: bytesToBase64(strToU8(bibliography)) }] }), /Trích dẫn chưa được giải quyết/)
  }
})
