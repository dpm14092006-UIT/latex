import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { createProject, createTask, sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { isValidDocument } from '../src/services/DocumentData.js'
import { importWordAst, toWordAst } from '../src/services/WordDocument.js'

const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const workspaceFor = document => ({ projects: [createProject('Recovery', createTask('Prose', document))] })
const pandocAttrs = ['', [], []]

test('workspace recovery preserves prose and valid marks when saved formatting is damaged', () => {
  const document = { type: 'doc', content: [paragraph('before'), {
    type: 'paragraph', attrs: { textAlign: 'damaged' }, content: [{
      type: 'text', text: 'valuable manuscript', marks: [
        { type: 'bold' }, { type: 'textStyle', attrs: { color: 'invalid' } }, { type: 'unknownMark' }, null,
      ],
    }],
  }, paragraph('after')] }
  // Put the damaged JSON directly into storage; createTask normalizes valid JSON.
  const workspace = workspaceFor({ type: 'doc', content: [paragraph('placeholder')] })
  workspace.projects[0].tasks[0].document = document
  const original = structuredClone(workspace)
  const recovered = sanitizeWorkspace(workspace).projects[0].tasks[0].document
  assert.deepEqual(recovered.content.map(node => node.content[0].text), ['before', 'valuable manuscript', 'after'])
  assert.deepEqual(recovered.content[1].content[0].marks, [{ type: 'bold' }])
  assert.equal(recovered.content[1].attrs?.textAlign, undefined)
  assert.deepEqual(workspace, original)
})

test('workspace recovery removes empty text before the editor can reject its JSON', () => {
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '' }, { type: 'text', text: 'preserved' },
  ] }] }
  assert.equal(isValidDocument(document), false)
  const workspace = workspaceFor({ type: 'doc', content: [paragraph('placeholder')] })
  workspace.projects[0].tasks[0].document = document
  const recovered = sanitizeWorkspace(workspace).projects[0].tasks[0].document
  assert.deepEqual(recovered.content[0].content, [{ type: 'text', text: 'preserved' }])
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
  assert.doesNotThrow(() => schema.nodeFromJSON(recovered).check())
})

test('Word AST round trip preserves exact exported page breaks', async () => {
  const document = { type: 'doc', content: [paragraph('first'), { type: 'pageBreak' }, paragraph('second')] }
  const result = await importWordAst(toWordAst(document, 'Pages'))
  assert.deepEqual(result.document.content.map(node => node.type), ['paragraph', 'pageBreak', 'paragraph'])
  assert.deepEqual(result.warnings, [])
  const unsupported = await importWordAst({ blocks: [{ t: 'RawBlock', c: ['openxml', '<w:untrusted/>'] }] })
  assert.equal(unsupported.document.content[0].type, 'paragraph')
  assert.ok(unsupported.warnings.length)
})

test('Word export retains link and strong wrappers around code independent of saved mark order', async () => {
  for (const marks of [
    [{ type: 'bold' }, { type: 'code' }, { type: 'link', attrs: { href: 'https://example.com' } }],
    [{ type: 'code' }, { type: 'link', attrs: { href: 'https://example.com' } }, { type: 'bold' }],
  ]) {
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a  b', marks }] }] }
    const imported = await importWordAst(toWordAst(document, 'Formatting'))
    const text = imported.document.content[0].content[0]
    assert.equal(text.text, 'a  b')
    assert.deepEqual(text.marks.map(mark => mark.type).sort(), ['bold', 'code', 'link'])
  }
})

test('Word list imports provide the leading paragraph required by the editor schema', async () => {
  const { document } = await importWordAst({ blocks: [{ t: 'BulletList', c: [[
    { t: 'Header', c: [1, pandocAttrs, [{ t: 'Str', c: 'Heading item' }]] },
  ], [{ t: 'CodeBlock', c: [pandocAttrs, 'code item'] }]] }] })
  const schema = new Schema({ nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    heading: { content: 'text*', group: 'block', attrs: { level: { default: 1 }, label: { default: '' } } },
    codeBlock: { content: 'text*', group: 'block' },
    bulletList: { content: 'listItem*', group: 'block' },
    listItem: { content: 'paragraph block*' },
    text: { group: 'inline' },
  } })
  assert.doesNotThrow(() => schema.nodeFromJSON(document).check())
  assert.equal(document.content[0].content[0].content[1].content[0].text, 'Heading item')
  assert.equal(document.content[0].content[1].content[1].content[0].text, 'code item')
})
