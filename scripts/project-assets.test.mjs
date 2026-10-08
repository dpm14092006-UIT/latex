import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidBase64, safeAssetPath, validateAssets, bytesToBase64, base64ToBytes } from '../src/services/ProjectAssets.js'

test('resource Base64 validation matches the strict backend for padding bits', () => {
  for (const value of ['aGVsbG8=', 'YQ==', 'YWI=', '', 'AAAA']) assert.equal(isValidBase64(value), true, value)
  for (const value of ['aGVsbG9=', 'YR==', 'YWJ=', 'aGVsbG8', 'YQ=\n', 'AA=A', '====']) assert.equal(isValidBase64(value), false, value)
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
  for (let length = 1; length <= bytes.length; length++) {
    const value = bytesToBase64(bytes.subarray(0, length))
    assert.equal(isValidBase64(value), true)
    assert.deepEqual(base64ToBytes(value), bytes.subarray(0, length))
  }
  assert.throws(() => validateAssets([{ filename: 'refs.bib', data: 'YR==' }]), /không hợp lệ/)
})

test('resource path validation reserves compiler filenames in nested directories', () => {
  for (const path of ['document.tex', 'Document.PDF', 'nested/document.tex', 'nested/Document.PDF']) {
    assert.equal(safeAssetPath(path), false, path)
    assert.throws(() => validateAssets([{ filename: path, data: 'YQ==' }]), /không hợp lệ/)
  }
  for (const path of ['refs.bib', 'nested/chapter.tex', 'figures/photo.pdf']) assert.equal(safeAssetPath(path), true, path)
})
