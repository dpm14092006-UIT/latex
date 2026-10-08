import assert from 'node:assert/strict'
import test from 'node:test'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { isValidDocument } from '../src/services/DocumentData.js'
import { importWordAst, readLatexSource, toWordAst, WORD_PAGE_BREAK } from '../src/services/WordDocument.js'
import { bytesToBase64 } from '../src/services/ProjectAssets.js'
import { normalizeColor, normalizeFontSize } from '../src/services/RichTextFormats.js'

const doc = content => ({ type: 'doc', content })
const para = (content, attrs) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content })
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })

test('Word export attaches captions to their image figures', () => {
  const image = { type: 'imageBlock', attrs: { src: 'data:image/png;base64,iVBORw==', alt: 'File name', caption: 'Đồ thị vận tốc' } }
  const ast = toWordAst(doc([image]), 'Image caption')
  assert.equal(ast.blocks[0].t, 'Figure')
  assert.deepEqual(ast.blocks[0].c[1][1][0].c, [{ t: 'Str', c: 'Đồ' }, { t: 'Space' }, { t: 'Str', c: 'thị' }, { t: 'Space' }, { t: 'Str', c: 'vận' }, { t: 'Space' }, { t: 'Str', c: 'tốc' }])
  assert.equal(ast.blocks[0].c[2][0].c[0].t, 'Image')
})

test('serializer emits Word-style character formatting', () => {
  const { latex } = toLatex(doc([para([
    text('H'), text('2', [{ type: 'subscript' }]), text('O x'), text('2', [{ type: 'superscript' }]), text(' '),
    text('đỏ', [{ type: 'textStyle', attrs: { color: '#c62828', fontSize: null } }]), text(' '),
    text('lớn', [{ type: 'textStyle', attrs: { color: null, fontSize: '18pt' } }]), text(' '),
    text('tô sáng & rõ', [{ type: 'highlight', attrs: { color: '#c5e1a5' } }]),
  ])]), 'T')
  assert.match(latex, /H\\textsubscript\{2\}O x\\textsuperscript\{2\}/)
  assert.match(latex, /\\textcolor\[HTML\]\{C62828\}\{đỏ\}/)
  assert.match(latex, /\{\\fontsize\{18pt\}\{21\.6pt\}\\selectfont lớn\}/)
  // Each word is boxed separately so highlighted text can wrap.
  assert.match(latex, /\\vietlatexhl\{C5E1A5\}\{tô\} \\vietlatexhl\{C5E1A5\}\{sáng\} \\vietlatexhl\{C5E1A5\}\{\\&\} \\vietlatexhl\{C5E1A5\}\{rõ\}/)
  assert.match(latex, /\\usepackage\{xcolor\}/)
  assert.match(latex, /\\providecommand\{\\vietlatexhl\}/)
  assert.ok(latex.indexOf('\\usepackage{xcolor}') < latex.indexOf('\\providecommand{\\vietlatexhl}'))
})

test('serializer handles page breaks and explicit alignment', () => {
  const { latex } = toLatex(doc([
    para([text('trái')], { textAlign: 'left' }),
    { type: 'pageBreak' },
    para([text('đều')], { textAlign: 'justify' }),
  ]), 'T')
  assert.match(latex, /\{\\raggedright\ntrái\\par\}/)
  assert.match(latex, /\\newpage/)
  assert.match(latex, /\nđều\n/)
})

test('plain documents do not pull in color packages', () => {
  const { latex } = toLatex(doc([para([text('bình thường')])]), 'T')
  assert.doesNotMatch(latex, /xcolor|vietlatexhl/)
})

test('validator accepts palette formatting and rejects arbitrary values', () => {
  assert.ok(isValidDocument(doc([para([text('a', [{ type: 'textStyle', attrs: { color: '#1565c0', fontSize: '14pt' } }, { type: 'highlight', attrs: { color: null } }, { type: 'superscript' }])], { textAlign: 'justify' }), { type: 'pageBreak' }])))
  for (const mark of [
    { type: 'textStyle', attrs: { color: 'red}\\input{x' } },
    { type: 'textStyle', attrs: { fontSize: '13px' } },
    { type: 'highlight', attrs: { color: 'rgb(1,2,3)' } },
  ]) assert.equal(isValidDocument(doc([para([text('a', [mark])])])), false, JSON.stringify(mark))
  assert.equal(isValidDocument(doc([para([text('a')], { textAlign: 'diagonal' })])), false)
})

test('pasted CSS is normalized to serializable values', () => {
  assert.equal(normalizeColor('rgb(198, 40, 40)'), '#c62828')
  assert.equal(normalizeColor('#ABC'), '#aabbcc')
  assert.equal(normalizeColor('rgba(0, 0, 0, 0)'), null)
  assert.equal(normalizeColor('var(--x)'), null)
  assert.equal(normalizeFontSize('16px'), '12pt')
  assert.equal(normalizeFontSize('100pt'), '72pt')
  assert.equal(normalizeFontSize('1.2em'), null)
})

test('Word export and import keep sub/superscript, highlight and page breaks', async () => {
  const ast = toWordAst(doc([
    para([text('x'), text('2', [{ type: 'superscript' }]), text('i', [{ type: 'subscript' }]), text('sáng', [{ type: 'highlight', attrs: { color: '#fff59d' } }])]),
    { type: 'pageBreak' },
  ]), 'T')
  const inlines = ast.blocks[0].c
  assert.deepEqual(inlines.map(item => item.t), ['Str', 'Superscript', 'Subscript', 'Span'])
  assert.deepEqual(inlines[3].c[0], ['', ['mark'], []])
  assert.deepEqual(ast.blocks[1], { t: 'RawBlock', c: ['openxml', WORD_PAGE_BREAK] })

  const { document } = await importWordAst({ blocks: [{ t: 'Para', c: inlines }] })
  const marks = document.content[0].content.map(node => node.marks?.map(mark => mark.type).join(',') || '')
  assert.deepEqual(marks, ['', 'superscript', 'subscript', 'highlight'])
})

test('Word/LaTeX import keeps figure captions, drops empty text and shortens long footnotes', async () => {
  const attr = ['', [], []]
  const { document, warnings } = await importWordAst({ blocks: [
    { t: 'Figure', c: [attr, [null, [{ t: 'Plain', c: [{ t: 'Str', c: 'Hình' }, { t: 'Space' }, { t: 'Str', c: '1.' }] }]], [{ t: 'Para', c: [{ t: 'Str', c: 'Nội' }] }]] },
    { t: 'Para', c: [{ t: 'Str', c: 'a' }, { t: 'Code', c: [attr, ''] }, { t: 'Str', c: '' }, { t: 'Note', c: [{ t: 'Para', c: [{ t: 'Str', c: 'x'.repeat(6000) }] }] }] },
  ] })
  assert.deepEqual(document.content.slice(0, 2).map(node => node.content[0].text), ['Nội', 'Hình'])
  assert.equal(document.content[1].content.map(node => node.text).join(''), 'Hình 1.')
  assert.deepEqual(document.content[2].content.map(node => node.type), ['text', 'footnote'])
  assert.ok(document.content[2].content.every(node => node.type !== 'text' || node.text))
  assert.equal(document.content[2].content[1].attrs.text.length, 5000)
  assert.ok(warnings.some(warning => warning.includes('5000')))
  assert.equal(isValidDocument(document), true)
})

test('LaTeX source import finds images referenced without a file extension', async () => {
  const png = bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]))
  const ast = { meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Image', c: [['', [], []], [{ t: 'Str', c: 'Plot' }], ['figures/plot', '']] }] }] }
  const saved = Object.fromEntries(['window', 'document', 'createImageBitmap', 'FileReader'].map(name => [name, globalThis[name]]))
  Object.assign(globalThis, {
    window: { desktopAPI: { parseLatexSource: async () => ({ ast: structuredClone(ast) }) } },
    createImageBitmap: async () => ({ width: 4, height: 4, close() {} }),
    document: { createElement: () => ({ getContext: () => ({ clearRect() {}, fillRect() {}, drawImage() {} }), toBlob: (done, type) => done(new Blob([Buffer.from(png, 'base64')], { type })) }) },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload() }) } },
  })
  try {
    const result = await readLatexSource('\\documentclass{article}', [], [{ filename: 'figures/plot.png', data: png }])
    assert.equal(result.document.content[0].type, 'imageBlock')
    assert.equal(result.document.content[0].attrs.src, `data:image/png;base64,${png}`)
    const figure = toWordAst(doc([{ ...result.document.content[0], attrs: { ...result.document.content[0].attrs, caption: 'Chú thích nhập lại' } }]), 'Figure')
    const imported = await importWordAst(figure)
    assert.equal(imported.document.content.length, 1)
    assert.equal(imported.document.content[0].attrs.caption, 'Chú thích nhập lại')
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
})
