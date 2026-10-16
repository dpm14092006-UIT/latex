import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

export const setSourceSpelling = StateEffect.define()
// A scan can finish against an older source; drop ranges that no longer hold the word.
const matchesSource = (doc, error) => Number.isSafeInteger(error.position) && error.position >= 0 && error.position + error.original.length <= doc.length && doc.sliceString(error.position, error.position + error.original.length) === error.original
export const sourceSpellingField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes)
    for (const effect of transaction.effects) if (effect.is(setSourceSpelling)) {
      value = Decoration.set(effect.value.filter(error => error.target.kind === 'source' && matchesSource(transaction.state.doc, error)).map(error => Decoration.mark({ class: 'spellcheck-error', attributes: { 'data-spellcheck-id': error.id, title: `Chính tả tiếng Anh: ${error.original}` } }).range(error.position, error.position + error.original.length)), true)
    }
    return value
  },
  provide: field => EditorView.decorations.from(field),
})
