import assert from 'node:assert/strict'
import test from 'node:test'
import { documentMap } from '../src/services/DocumentFrameData.js'

test('document map keeps real block indexes across empty paragraphs and nested content', () => {
  const map = documentMap({ content: [
    { type: 'paragraph' },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Phương pháp' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mục đầu' }] }] }] },
    { type: 'imageBlock', attrs: { src: 'private-image-data', caption: 'Kết quả' } },
    { type: 'blockMath', attrs: { latex: 'x^2' } },
    { type: 'table', attrs: { caption: 'Số liệu' } },
  ] })
  assert.deepEqual(map.rows.map(row => row.blockIndex), [1, 2, 3, 4, 5])
  assert.deepEqual(map.rows.map(row => row.label), ['Phương pháp', 'Mục đầu', 'Kết quả', 'x^2', 'Số liệu'])
  assert.equal(map.rows[1].level, 2)
  assert.ok(!JSON.stringify(map).includes('private-image-data'))
})

test('large documents bound rendered rows and report hidden blocks without losing source indexes', () => {
  const doc = { content: Array.from({ length: 400 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `Đoạn ${index}` }] })) }
  const map = documentMap(doc)
  assert.equal(map.rows.length, 160)
  assert.equal(map.remaining, 240)
  assert.equal(map.rows.at(-1).blockIndex, 159)
  assert.equal(documentMap({ content: [{ type: 'paragraph' }] }).total, 0)
})

test('structure search reaches later blocks, accents and text beyond the short label', () => {
  const content = Array.from({ length: 180 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `Đoạn ${index}` }] }))
  content.push({ type: 'paragraph', content: [{ type: 'text', text: `${'Nội dung '.repeat(20)}Đường dẫn cuối cùng` }] })
  const map = documentMap({ content }, 160, 'duong dan cuoi')
  assert.equal(map.total, 181)
  assert.equal(map.matched, 1)
  assert.equal(map.remaining, 0)
  assert.equal(map.rows[0].blockIndex, 180)
  assert.equal(documentMap({ content }, 160, 'không tồn tại').matched, 0)
  assert.equal(documentMap({ content }, 320).rows.length, 181)
})

test('structure labels preserve adjacent formatted heading text, line breaks and page breaks', () => {
  const map = documentMap({ content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Viet' }, { type: 'text', text: 'LaTeX', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Dòng một' }, { type: 'hardBreak' }, { type: 'text', text: 'dòng hai' }] },
    { type: 'pageBreak' },
  ] })
  assert.deepEqual(map.rows.map(row => row.label), ['VietLaTeX', 'Dòng một dòng hai', 'Ngắt trang'])
  assert.equal(map.rows[2].kind, 'pageBreak')
})
