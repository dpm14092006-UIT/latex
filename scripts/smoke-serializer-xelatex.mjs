// Compiles serializer output containing historically fragile constructs with real XeLaTeX.
import assert from 'node:assert/strict'
import { builtInDocumentTemplates, toLatex } from '../src/services/DocumentSerializer.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const paragraph = (...content) => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
const tableCell = (type, value) => ({ type, content: [paragraph(typeof value === 'string' ? text(value) : value)] })
const predictorTable = {
  type: 'table',
  attrs: {
    caption: 'Intermediate and maximum predictor budgets under CatBoost Extended Flags in the 2013Q1 window.',
    label: 'tab:budget',
  },
  content: [
    { type: 'tableRow', content: ['(n,k)', 'p', 'RMSE', 'MAE', 'MAPE', { type: 'inlineMath', attrs: { latex: 'R^2_{\\mathrm{OOS}}' } }].map(value => tableCell('tableHeader', value)) },
    { type: 'tableRow', content: ['(3,10)', '13', '0.0322', '0.0212', '31.97', '0.1165'].map(value => tableCell('tableCell', value)) },
    { type: 'tableRow', content: ['(6,15)', '21', '0.0352', '0.0235', '34.07', '-0.0584'].map(value => tableCell('tableCell', value)) },
  ],
}
const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('2 Bước'), { type: 'hardBreak' }, text('tiếp')] },
    paragraph(text('Đối chiếu với nghiên cứu trước '), { type: 'citation', attrs: { key: 'smith2026' } }),
    paragraph({ type: 'hardBreak' }, text('[1] sau ngắt dòng đầu đoạn')),
    paragraph(text('Ký tự đặc biệt: a\\b{c} # $ % & _ ^ ~ < > |')),
    paragraph(text('NO₂ CO₂ H₂O SO₄²⁻ m² xₜ ¹⁴C')),
    paragraph(text('Rỗng: '), { type: 'inlineMath', attrs: { latex: '  ' } }, text(' xong')),
    { type: 'blockMath', attrs: { latex: 'a = b\n\n\n+ c' } },
    { type: 'blockMath', attrs: { latex: '' } },
    { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('Đoạn căn đều.')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('[a] mục bắt đầu bằng ngoặc'))] }] },
    predictorTable,
  ],
}

const bibliography = '@article{smith2026, author={Smith, Jane}, title={Research Methods}, journal={Journal of Studies}, year={2026}}'
const backend = await startGoBackendForTests()
try {
  const cases = [
    { name: 'mẫu mặc định', source: undefined },
    ...builtInDocumentTemplates.map(template => ({ name: template.name, source: template.source })),
  ]
  for (const item of cases) {
    const { latex, images } = toLatex(doc, 'Kiểm tra \\ serializer {}', item.source, { bibliography, abstractEnabled: true, abstractTitle: 'Tóm tắt', abstract: 'Mục tiêu nghiên cứu: dự báo xu hướng. Phương pháp A_B & kết quả 95%.\n\nĐóng góp thứ hai.', tableOfContents: true })
    const assets = [{ filename: 'references.bib', data: Buffer.from(bibliography).toString('base64') }]
    const pdf = await backend.compileLatex(latex, images, { assets, fresh: true })
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', `${item.name} phải tạo PDF hợp lệ`)
    console.log(`XeLaTeX OK: ${item.name} (${pdf.length} bytes)`)
  }
} catch (error) {
  console.error(error.message, error.log?.slice(-2000))
  process.exitCode = 1
} finally {
  await backend.close()
}
