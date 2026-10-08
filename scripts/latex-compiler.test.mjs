import assert from 'node:assert/strict'
import test from 'node:test'
import { LatexCompiler } from '../src/services/LatexCompiler.js'

test('desktop compiler preserves overload status and diagnostic details', async () => {
  const compiler = new LatexCompiler({
    desktopAPI: { compileLatex: async () => ({ ok: false, status: 503, error: 'busy', log: 'diagnostic', line: 7 }) },
    fetchImpl: () => assert.fail('desktop compiler must use IPC'),
  })
  await assert.rejects(compiler.compile('source', []), error => error.status === 503 && error.message === 'busy' && error.log === 'diagnostic' && error.line === 7)
})

test('web compiler preserves the HTTP status even for a non-JSON overload response', async () => {
  const compiler = new LatexCompiler({ desktopAPI: null, fetchImpl: async () => new Response('temporarily unavailable', { status: 503 }) })
  await assert.rejects(compiler.compile('source', []), error => error.status === 503)
})

test('cancelled compiler requests do not reach IPC or HTTP', async () => {
  const controller = new AbortController()
  controller.abort()
  const compiler = new LatexCompiler({ desktopAPI: null, fetchImpl: () => assert.fail('cancelled request reached HTTP') })
  await assert.rejects(compiler.compile('source', [], controller.signal), { name: 'AbortError' })
})
