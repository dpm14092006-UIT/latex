import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { safeExternalUrl } = require('../electron/external-links.cjs')

test('desktop external links allow web and mail handlers while rejecting executable schemes', () => {
  assert.equal(safeExternalUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1')
  assert.equal(safeExternalUrl('mailto:help@example.com'), 'mailto:help@example.com')
  assert.equal(safeExternalUrl('javascript:alert(1)'), null)
  assert.equal(safeExternalUrl('file:///C:/Windows/win.ini'), null)
  assert.equal(safeExternalUrl('https://'), null)
  assert.equal(safeExternalUrl('not a URL'), null)
})
