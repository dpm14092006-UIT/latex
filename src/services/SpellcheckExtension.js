import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const spellcheckPluginKey = new PluginKey('englishSpellcheck')
// Results are applied only while the document still holds the reported word.
const matchesText = (doc, error) => Number.isSafeInteger(error.position) && error.position >= 0 && error.position + error.original.length <= doc.content.size && doc.textBetween(error.position, error.position + error.original.length, '', '\0') === error.original
export function createSpellcheckPlugin() {
  return new Plugin({
    key: spellcheckPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, decorations) {
        const errors = tr.getMeta(spellcheckPluginKey)
        if (errors) {
          const decorations = []
          const attributePositions = new Set()
          for (const error of errors) {
            if (error.target.kind === 'rich') { if (matchesText(tr.doc, error)) decorations.push(Decoration.inline(error.position, error.position + error.original.length, { class: 'spellcheck-error', 'data-spellcheck-id': error.id, title: `Chính tả tiếng Anh: ${error.original}` })) }
            else if (error.target.kind === 'attribute' && !attributePositions.has(error.target.pos)) {
              const node = tr.doc.nodeAt(error.target.pos)
              if (node) { decorations.push(Decoration.node(error.target.pos, error.target.pos + node.nodeSize, { class: 'spellcheck-attribute-error', ...(node.isAtom ? { 'data-spellcheck-id': error.id } : {}), title: `${error.label}: ${error.original}` })); attributePositions.add(error.target.pos) }
            }
          }
          return DecorationSet.create(tr.doc, decorations)
        }
        return tr.docChanged ? decorations.map(tr.mapping, tr.doc) : decorations
      },
    },
    props: { decorations: state => spellcheckPluginKey.getState(state) },
  })
}
export function showRichSpellcheckErrors(editor, errors) {
  if (!editor || editor.isDestroyed || !spellcheckPluginKey.getState(editor.state)) return
  editor.view.dispatch(editor.state.tr.setMeta(spellcheckPluginKey, errors).setMeta('addToHistory', false))
}
