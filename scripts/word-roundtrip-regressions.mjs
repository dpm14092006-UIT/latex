import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { unzipSync, strFromU8 } from 'fflate'
import { importWordAst, toWordAst } from '../src/services/WordDocument.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const pandocAttrs = ['', [], []]
const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'text*', group: 'block' },
  heading: { content: 'text*', group: 'block', attrs: { level: { default: 1 }, label: { default: '' } } },
  codeBlock: { content: 'text*', group: 'block' },
  bulletList: { content: 'listItem*', group: 'block' },
  orderedList: { content: 'listItem*', group: 'block', attrs: { start: { default: 1 } } },
  listItem: { content: 'paragraph block*' },
  text: { group: 'inline' },
} })
const descendants = node => [node, ...(node.content || []).flatMap(descendants)]
const textOf = document => descendants(document).map(node => node.text || '').join(' ').replace(/\s+/gu, ' ')
const goBackend = await startGoBackendForTests()
async function roundtrip(document, title) {
  const exported = await goBackend.convertWord('export', toWordAst(document, title))
  const xml = strFromU8(unzipSync(exported.bytes)['word/document.xml'])
  const { ast } = await goBackend.convertWord('import', exported.bytes)
  const imported = await importWordAst(ast)
  return { ...imported, ast, xml }
}

try {
  for (const marks of [
    [{ type: 'bold' }, { type: 'code' }, { type: 'link', attrs: { href: 'https://example.com/code' } }],
    [{ type: 'code' }, { type: 'link', attrs: { href: 'https://example.com/code' } }, { type: 'bold' }],
  ]) {
    const source = { type: 'doc', content: [{
      type: 'paragraph', content: [{ type: 'text', text: 'nativeCodeToken', marks }],
    }] }
    const astRoundtrip = await importWordAst(toWordAst(source, 'Code wrappers'))
    assert.deepEqual(astRoundtrip.document.content[0].content[0].marks.map(mark => mark.type).sort(), ['bold', 'code', 'link'])
    const { document, warnings, xml, ast } = await roundtrip(source, 'Code wrappers')
    const token = descendants(document).find(node => node.type === 'text' && node.text.includes('nativeCodeToken'))
    assert.ok(token, 'native Word conversion lost the code text')
    const nativeMarks = token.marks.map(mark => mark.type).sort()
    assert.ok(nativeMarks.includes('code'), 'native Word conversion lost the code mark')
    assert.ok(nativeMarks.includes('link'), 'native Word conversion lost the hyperlink')
    assert.equal(token.marks.find(mark => mark.type === 'link').attrs.href, 'https://example.com/code')
    const run = /<w:r>(?:(?!<\/w:r>)[\s\S])*nativeCodeToken(?:(?!<\/w:r>)[\s\S])*<\/w:r>/u.exec(xml)?.[0] || ''
    assert.match(run, /<w:b\s*\/?\s*>/u, 'exported DOCX must retain bold formatting on the code run')
    assert.match(run, /<w:rStyle w:val="VerbatimChar"/u, 'exported DOCX must retain its code character style')
    assert.deepEqual(warnings, [])
    console.log('CODE_BOLD_OBSERVATION', JSON.stringify({
      inputMarkOrder: marks.map(mark => mark.type),
      exportedDocxHasBoldCodeRun: true,
      importedEditorMarks: nativeMarks,
      importedPandocBlocks: ast.blocks,
    }))
  }
  console.log('PASS AST wrappers and DOCX bold/code export; native code/link/text round trip (Pandoc may drop code bold on import)')

  const listSource = await importWordAst({ blocks: [{ t: 'BulletList', c: [[
    { t: 'Header', c: [1, pandocAttrs, [{ t: 'Str', c: 'Heading list item' }]] },
  ], [{ t: 'CodeBlock', c: [pandocAttrs, 'Code list item'] }]] }] })
  schema.nodeFromJSON(listSource.document).check()
  const listResult = await roundtrip(listSource.document, 'List leading paragraphs')
  schema.nodeFromJSON(listResult.document).check()
  assert.match(textOf(listResult.document), /Heading list item/)
  assert.match(textOf(listResult.document), /Code list item/)
  assert.ok(descendants(listResult.document).some(node => node.type === 'bulletList'), 'native Word conversion lost the list')
  console.log('PASS native DOCX list content survives with a valid editor structure')

  const pageResult = await roundtrip({ type: 'doc', content: [
    paragraph('BeforePageBreakToken'), { type: 'pageBreak' }, paragraph('AfterPageBreakToken'),
  ] }, 'Page break inspection')
  const xmlPageBreaks = [...pageResult.xml.matchAll(/<w:br\b[^>]*\bw:type="page"[^>]*\/?\s*>/gu)].length
  assert.equal(xmlPageBreaks, 1, 'the exported DOCX must contain the requested page break')
  assert.match(textOf(pageResult.document), /BeforePageBreakToken/)
  assert.match(textOf(pageResult.document), /AfterPageBreakToken/)
  console.log('PAGE_BREAK_OBSERVATION', JSON.stringify({
    exportedDocxPageBreaks: xmlPageBreaks,
    importedPandocBlocks: pageResult.ast.blocks.map(block => block.t),
    importedPandocRawBlocks: pageResult.ast.blocks.filter(block => block.t === 'RawBlock'),
    importedEditorPageBreaks: descendants(pageResult.document).filter(node => node.type === 'pageBreak').length,
    warnings: pageResult.warnings,
  }))
} finally {
  await goBackend.close()
}
