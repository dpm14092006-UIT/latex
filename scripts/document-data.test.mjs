import assert from 'node:assert/strict'
import test from 'node:test'
import { clampHeadingLevels, isValidDocument, sanitizeDocumentTemplates, sanitizeFormulaTemplates } from '../src/services/DocumentData.js'
import { imageStats } from '../src/services/DocumentSerializer.js'
import { assetBudgetError, matchesImageSignature, validateAssetFileBatch } from '../src/services/ProjectAssets.js'
import { createProject, createTask, sanitizeWorkspace } from '../src/services/WorkspaceData.js'

test('image captions are optional and limited to 500 characters', () => {
  const image = { type: 'imageBlock', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }
  const document = { type: 'doc', content: [image] }
  assert.equal(isValidDocument(document), true)
  image.attrs.caption = 'a'.repeat(500)
  assert.equal(isValidDocument(document), true)
  image.attrs.caption += 'a'
  assert.equal(isValidDocument(document), false)
  image.attrs.caption = 123
  assert.equal(isValidDocument(document), false)
})

test('workspaces saved with pasted h4-h6 headings still open, clamped to level 3', () => {
  const heading = level => ({ type: 'heading', attrs: { textAlign: null, label: '', level }, content: [{ type: 'text', text: `H${level}` }] })
  const document = { type: 'doc', content: [heading(2), { type: 'blockquote', content: [heading(4)] }, heading(6)] }
  assert.equal(isValidDocument(document), false)
  const clamped = clampHeadingLevels(document)
  assert.equal(isValidDocument(clamped), true)
  assert.deepEqual([clamped.content[0].attrs.level, clamped.content[1].content[0].attrs.level, clamped.content[2].attrs.level], [2, 3, 3])
  assert.equal(clampHeadingLevels(clamped), clamped)
  assert.equal(isValidDocument(clampHeadingLevels({ type: 'doc', content: [heading(7)] })), false)

  const project = createProject('P', createTask('T', document))
  const workspace = sanitizeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })
  assert.equal(workspace.projects[0].tasks.length, 1)
  assert.equal(workspace.projects[0].tasks[0].document.content[2].attrs.level, 3)
})

test('document validation accepts supported editor content and rejects malformed structures', () => {
  const document = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Kết quả: ' },
        { type: 'inlineMath', attrs: { latex: 'x^2' } },
      ],
    }],
  }

  assert.equal(isValidDocument(document), true)
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'unsupportedNode' }] }), false)
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'blockMath', attrs: { latex: 42 } }] }), false)
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text' }] }] }), false)
  const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] }
  assert.equal(isValidDocument({ type: 'doc', content: [table] }), true)
  assert.equal(isValidDocument({ type: 'doc', content: [{ ...table, attrs: { caption: 'Table caption', label: 'tab:budget' } }] }), true)
  assert.equal(isValidDocument({ type: 'doc', content: [{ ...table, attrs: { caption: 'x'.repeat(501) } }] }), false)
  assert.equal(isValidDocument({ type: 'doc', content: [{ ...table, attrs: { label: 'tab:bad label' } }] }), false)
  assert.equal(isValidDocument({
    type: 'doc',
    content: Array.from({ length: 9 }, () => ({ type: 'imageBlock', attrs: { src: 'data:image/png;base64,iVBORw==' } })),
  }), false)
})

test('stored custom templates are filtered to usable entries with unique ids', () => {
  const formulaTemplates = sanitizeFormulaTemplates([
    { id: 'custom-1', name: 'Tỉ lệ', latex: '\\frac{a}{b}', type: 'inline', ignored: true },
    { id: 'custom-2', name: 'Mẫu nhập', latex: '\\input{evil}', type: 'block', untrusted: true },
    { id: 'custom-1', name: 'Trùng id', latex: 'x', type: 'block' },
    { id: 'built-in', name: 'Sai loại', latex: 'x', type: 'inline' },
    null,
  ])
  const documentTemplates = sanitizeDocumentTemplates([
    { id: 'layout-1', name: 'Báo cáo', source: '\\begin{document}{{content}}\\end{document}' },
    { id: 'layout-1', name: 'Trùng id', source: '{{content}}' },
    { id: 'layout-2', name: 'Thiếu chỗ chèn', source: '\\documentclass{article}' },
    { id: 'layout-3', name: 'Mẫu nhập', source: '\\input{evil}{{content}}', untrusted: true },
  ])

  assert.deepEqual(formulaTemplates, [
    { id: 'custom-1', name: 'Tỉ lệ', latex: '\\frac{a}{b}', type: 'inline' },
    { id: 'custom-2', name: 'Mẫu nhập', latex: '\\input{evil}', type: 'block', untrusted: true },
  ])
  assert.deepEqual(documentTemplates, [
    { id: 'layout-1', name: 'Báo cáo', source: '\\begin{document}{{content}}\\end{document}' },
    { id: 'layout-3', name: 'Mẫu nhập', source: '\\input{evil}{{content}}', untrusted: true },
  ])
  assert.deepEqual(sanitizeFormulaTemplates({ name: 'not an array' }), [])
  assert.deepEqual(sanitizeDocumentTemplates(null), [])
})

test('image document limits use decoded bytes consistently with compiler and exports', () => {
  const pngBase64 = size => {
    const bytes = Buffer.alloc(size)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return bytes.toString('base64')
  }
  const imageBytes = 400 * 1024
  const src = `data:image/png;base64,${pngBase64(imageBytes)}`
  const document = { type: 'doc', content: Array.from({ length: 7 }, () => ({ type: 'imageBlock', attrs: { src } })) }
  assert.equal(isValidDocument(document), true)
  assert.deepEqual(imageStats(document), { count: 7, storedBytes: 7 * imageBytes })
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'imageBlock', attrs: { src: 'data:image/png;base64,abc' } }] }), false)
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'imageBlock', attrs: { src: 'data:image/png;base64,/9j/4AAQ' } }] }), false)

  const perImageLimit = `data:image/png;base64,${pngBase64(450 * 1024 + 1)}`
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'imageBlock', attrs: { src: perImageLimit } }] }), false)
  const totalLimit = `data:image/png;base64,${pngBase64(450 * 1024)}`
  assert.equal(isValidDocument({ type: 'doc', content: Array.from({ length: 8 }, () => ({ type: 'imageBlock', attrs: { src: totalLimit } })) }), false)

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00])
  const jpegSrc = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`
  assert.equal(isValidDocument({ type: 'doc', content: [{ type: 'imageBlock', attrs: { src: jpegSrc } }] }), true)
  assert.equal(matchesImageSignature('png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), false)
  assert.equal(matchesImageSignature('png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true)
  assert.equal(matchesImageSignature('jpeg', jpegBytes), true)
})

test('asset file batches reject size and name conflicts before files are read', () => {
  assert.equal(validateAssetFileBatch([{ name: 'refs.bib', size: 100 }, { name: 'chart.png', size: 200 }]), true)
  assert.throws(() => validateAssetFileBatch([{ name: 'huge.txt', size: 10 * 1024 * 1024 + 1 }]), /vượt 10 MB/)
  assert.throws(() => validateAssetFileBatch(Array.from({ length: 3 }, (_, index) => ({ name: `asset-${index}.txt`, size: 9 * 1024 * 1024 }))), /24 MB/)
  assert.throws(() => validateAssetFileBatch([{ name: 'refs.bib', size: 0 }, { name: 'REFS.BIB', size: 0 }]), /trùng/)
})

test('effective asset budgets include generated bibliography files', () => {
  assert.equal(assetBudgetError([{ filename: 'references.bib', data: Buffer.alloc(10).toString('base64') }]), '')
  assert.match(assetBudgetError(Array.from({ length: 101 }, () => ({ data: '' }))), /Tối đa 100/)
  assert.match(assetBudgetError([{ data: Buffer.alloc(24 * 1024 * 1024 + 1).toString('base64') }]), /24 MB/)
})
import { acceptsSourceEdit, MAX_LATEX_SOURCE_BYTES } from '../src/services/DocumentLimits.js'

test('source edit limits count UTF-8 bytes and allow reducing an oversized legacy source', () => {
  assert.equal(acceptsSourceEdit('', 'a'.repeat(MAX_LATEX_SOURCE_BYTES)), true)
  assert.equal(acceptsSourceEdit('', 'a'.repeat(MAX_LATEX_SOURCE_BYTES + 1)), false)
  assert.equal(acceptsSourceEdit('', 'ế'.repeat(Math.floor(MAX_LATEX_SOURCE_BYTES / 3))), true)
  assert.equal(acceptsSourceEdit('', 'ế'.repeat(Math.floor(MAX_LATEX_SOURCE_BYTES / 3) + 1)), false)
  const oversized = 'a'.repeat(MAX_LATEX_SOURCE_BYTES + 100)
  assert.equal(acceptsSourceEdit(oversized, oversized.slice(1)), true)
  assert.equal(acceptsSourceEdit(oversized, oversized + 'a'), false)
})
