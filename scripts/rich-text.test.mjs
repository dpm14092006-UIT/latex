import assert from 'node:assert/strict'
import test from 'node:test'
import { toLatex } from '../src/services/DocumentSerializer.js'
import { isValidDocument } from '../src/services/DocumentData.js'
import { importWordAst, toWordAst, WORD_PAGE_BREAK } from '../src/services/WordDocument.js'
import { normalizeColor, normalizeFontSize } from '../src/services/RichTextFormats.js'

const doc = content => ({ type: 'doc', content })
const para = (content, attrs) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content })
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })

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
