export const UNTRUSTED_LATEX_PASTE_META = 'untrustedLatexPaste'
export const UNTRUSTED_LATEX_TEMPLATE_META = 'untrustedLatexTemplate'
export const UNTRUSTED_LATEX_INSERT_META = 'untrustedLatexInsert'

export function isClipboardPasteTransaction(transaction) {
  return Boolean(transaction?.getMeta('paste')) || transaction?.getMeta('uiEvent') === 'paste'
}

export function containsUntrustedLatex(transaction, appendedTransactions = []) {
  return [transaction, ...appendedTransactions].some(item =>
    item?.getMeta(UNTRUSTED_LATEX_PASTE_META) === true
    || item?.getMeta(UNTRUSTED_LATEX_TEMPLATE_META) === true
    || item?.getMeta(UNTRUSTED_LATEX_INSERT_META) === true,
  )
}
