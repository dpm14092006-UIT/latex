import assert from 'node:assert/strict'
import test from 'node:test'
import {
  containsUntrustedLatex,
  isClipboardPasteTransaction,
  UNTRUSTED_LATEX_INSERT_META,
  UNTRUSTED_LATEX_PASTE_META,
  UNTRUSTED_LATEX_TEMPLATE_META,
} from '../src/services/UntrustedLatex.js'

const transaction = metadata => ({ getMeta: key => metadata[key] })

test('clipboard paste metadata is recognized for ProseMirror paste transactions only', () => {
  assert.equal(isClipboardPasteTransaction(transaction({ paste: true })), true)
  assert.equal(isClipboardPasteTransaction(transaction({ uiEvent: 'paste' })), true)
  assert.equal(isClipboardPasteTransaction(transaction({ uiEvent: 'drop' })), false)
  assert.equal(isClipboardPasteTransaction(transaction({ uiEvent: 'cut' })), false)
})

test('untrusted LaTeX markers propagate from appended formula and imported-template transactions', () => {
  const original = transaction({ uiEvent: 'paste' })
  const appendedPasteConversion = transaction({ [UNTRUSTED_LATEX_PASTE_META]: true })
  assert.equal(containsUntrustedLatex(original, [appendedPasteConversion]), true)

  const templateInsertion = transaction({ [UNTRUSTED_LATEX_TEMPLATE_META]: true })
  assert.equal(containsUntrustedLatex(templateInsertion), true)
  const dialogPasteInsertion = transaction({ [UNTRUSTED_LATEX_INSERT_META]: true })
  assert.equal(containsUntrustedLatex(dialogPasteInsertion), true)
  assert.equal(containsUntrustedLatex(transaction({})), false)
})
