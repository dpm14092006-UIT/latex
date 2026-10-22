import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidDocument } from '../src/services/DocumentData.js'

const documentWith = node => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [node] }],
})

const referenceFields = [
  ['citation.key', key => ({ type: 'citation', attrs: { key } })],
  ['citation.sourceParts.key', key => ({
    type: 'citation',
    attrs: {
      key: 'ref-a',
      sourceParts: [{ key, suffixText: '', separatorBefore: '' }],
    },
  })],
  ['crossReference.target', target => ({ type: 'crossReference', attrs: { target } })],
]

for (const [field, nodeWith] of referenceFields) {
  test(`${field} rejects non-string JSON values without throwing`, () => {
    // Numbers, true and non-empty arrays used to pass via RegExp.test coercion.
    const invalid = [123, 0, true, false, ['ref-a'], ['ref-a', 'ref-b'], [], {}, { toString: 'ref-a' }, null, undefined]
    for (const value of invalid) {
      assert.equal(isValidDocument(documentWith(nodeWith(value))), false,
        `${field}: ${JSON.stringify(value)}`)
    }
  })

  test(`${field} keeps valid strings and existing key limits`, () => {
    for (const value of ['ref-a', '123', 'true', 'eq:energy_1.v2', 'a'.repeat(100)]) {
      const document = documentWith(nodeWith(value))
      const before = structuredClone(document)
      assert.equal(isValidDocument(document), true, `${field}: ${value}`)
      assert.deepEqual(document, before, 'validation must not rewrite the input')
    }
    for (const value of ['', 'a'.repeat(101), 'ref a', 'ref/a', ',ref-a', 'ref-a,']) {
      assert.equal(isValidDocument(documentWith(nodeWith(value))), false,
        `${field}: ${value}`)
    }
  })
}

for (const [field, nodeWith] of referenceFields.slice(0, 2)) {
  test(`${field} still accepts up to 50 comma-separated keys`, () => {
    const keys = Array.from({ length: 50 }, (_, index) => `ref-${index}`).join(',')
    assert.equal(isValidDocument(documentWith(nodeWith(keys))), true)
    assert.equal(isValidDocument(documentWith(nodeWith(`${keys},ref-50`))), false)
  })
}

test('crossReference still requires exactly one target', () => {
  assert.equal(isValidDocument(documentWith({
    type: 'crossReference', attrs: { target: 'eq:one,eq:two' },
  })), false)
})
