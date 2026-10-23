import { Editor, Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import { InlineMath } from '@tiptap/extension-mathematics'
import { Plugin } from '@tiptap/pm/state'
import { closeHistory, redo, undo } from '@tiptap/pm/history'
import { MAX_TABLE_NOTE_LENGTH, tableNoteContent, tableNoteText } from './TableNoteContent.js'
import { containsUntrustedLatex, isClipboardPasteTransaction, UNTRUSTED_LATEX_PASTE_META } from './UntrustedLatex.js'
import { convertUnicodeScriptMath } from './UnicodeScriptMath.js'

const activeNotes = new WeakMap()
export const activeTableNote = view => activeNotes.get(view)

export class TableNoteEditor {
  constructor(owner) {
    this.owner = owner
    this.field = document.createElement('div')
    this.field.className = 'table-text-field table-note-field'
    this.field.contentEditable = 'false'
    const label = document.createElement('span')
    label.className = 'table-text-field-tag'
    label.textContent = 'Ghi chú'
    this.host = document.createElement('div')
    this.host.className = 'table-note-editor'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'table-note-formula'
    button.textContent = 'ƒx'
    button.title = 'Chèn công thức vào ghi chú'
    button.setAttribute('aria-label', button.title)
    this.button = button
    this.field.append(label, this.host, button)
    this.editor = new Editor({
      element: this.host,
      extensions: [Document, Paragraph, Text, HardBreak, InlineMath.configure({
        katexOptions: { throwOnError: false, displayMode: false },
        onClick: (node, pos) => this.requestFormula(pos, node),
      }), Extension.create({
        name: 'tableNoteInput',
        addProseMirrorPlugins: () => [new Plugin({
          filterTransaction: transaction => this.loading || !transaction.docChanged || (owner.editable() && tableNoteText(transaction.doc.toJSON()).length <= MAX_TABLE_NOTE_LENGTH),
          appendTransaction: (transactions, _old, state) => {
            const completed = transactions.some(transaction => transaction.getMeta('noteComplete') || isClipboardPasteTransaction(transaction))
            if (!completed && !transactions.some(transaction => transaction.docChanged)) return null
            if (this.editor?.view.composing) return null
            const replacements = []
            state.doc.descendants((node, pos) => {
              if (!node.isText) return
              const content = tableNoteContent(node.text, { unicode: false })
              if (content.some(child => child.type === 'inlineMath')) replacements.push({ pos, size: node.nodeSize, content })
            })
            if (!replacements.length) return convertUnicodeScriptMath(state, { deferAtCursor: !completed })
            const tr = state.tr
            for (const { pos, size, content } of replacements.reverse()) tr.replaceWith(pos, pos + size, content.map(node => state.schema.nodeFromJSON(node)))
            // Unicode tokens and delimited equations may arrive in one paste.
            // Convert both in the same transaction using its updated positions.
            convertUnicodeScriptMath({ doc: tr.doc, schema: state.schema, selection: tr.selection, tr }, { deferAtCursor: !completed })
            return tr
          },
        })],
        addKeyboardShortcuts: () => ({
          'Mod-z': () => this.history(undo),
          'Mod-Shift-z': () => this.history(redo),
          'Mod-y': () => this.history(redo),
        }),
      })],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      editorProps: { attributes: { class: 'table-note-content', 'aria-label': 'Ghi chú bảng', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false', 'data-placeholder': 'Ghi chú dưới bảng…' } },
      onFocus: () => {
        activeNotes.set(owner.view, this)
        if (owner.editable()) owner.view.dispatch(closeHistory(owner.view.state.tr))
      },
      onBlur: () => {
        window.setTimeout(() => {
          if (!this.editor.isDestroyed && !this.editor.view.composing) this.editor.view.dispatch(this.editor.state.tr.setMeta('noteComplete', true))
        }, 0)
      },
      onUpdate: ({ transaction, appendedTransactions }) => {
        const pasted = containsUntrustedLatex(transaction, appendedTransactions) || transaction.getMeta('paste') === true || transaction.getMeta('uiEvent') === 'paste'
        owner.commit('note', tableNoteText(this.editor.getJSON()), pasted ? UNTRUSTED_LATEX_PASTE_META : null)
      },
    })
    // Keep document-wide selectors and pagination attached to the outer editor.
    this.editor.view.dom.classList.remove('tiptap')
    this.onInsert = () => this.requestFormula()
    button.addEventListener('click', this.onInsert)
    this.onOuterFocus = event => {
      if (!this.host.contains(event.target) && activeNotes.get(owner.view) === this) activeNotes.delete(owner.view)
    }
    owner.view.dom.addEventListener('focusin', this.onOuterFocus)
    this.editabilityObserver = new MutationObserver(() => {
      this.editor.setEditable(owner.editable(), false)
      this.button.disabled = !owner.editable()
    })
    this.editabilityObserver.observe(owner.view.dom, { attributes: true, attributeFilter: ['contenteditable'] })
  }

  render(value, editable) {
    if (tableNoteText(this.editor.getJSON()) !== value) {
      this.loading = true
      try { this.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: tableNoteContent(value) }] }, { emitUpdate: false }) }
      finally { this.loading = false }
    }
    if (this.editor.isEditable !== editable) this.editor.setEditable(editable, false)
    this.button.disabled = !editable
  }

  requestFormula(position = null, node = null) {
    if (!this.owner.editable()) return
    activeNotes.set(this.owner.view, this)
    const { from, to } = this.editor.state.selection
    this.owner.view.dom.dispatchEvent(new CustomEvent('table-note-formula', { detail: { note: this, from: position ?? from, to: position === null ? to : position + node.nodeSize, latex: node?.attrs.latex || '', editing: Boolean(node), doc: this.editor.state.doc } }))
  }

  insertionTarget() {
    const { from, to } = this.editor.state.selection
    return { note: this, from, to, doc: this.editor.state.doc }
  }

  history(command) {
    command(this.owner.view.state, this.owner.view.dispatch)
    return true
  }

  insertFormula(target, latex, untrusted) {
    if (this.editor.isDestroyed || !this.owner.editable() || target.doc !== this.editor.state.doc) return false
    const replacement = this.editor.state.tr.replaceWith(target.from, target.to, this.editor.schema.nodes.inlineMath.create({ latex }))
    if (tableNoteText(replacement.doc.toJSON()).length > MAX_TABLE_NOTE_LENGTH) return false
    this.owner.view.dispatch(closeHistory(this.owner.view.state.tr))
    const chain = this.editor.chain().insertContentAt({ from: target.from, to: target.to }, { type: 'inlineMath', attrs: { latex } })
    if (untrusted) chain.setMeta(UNTRUSTED_LATEX_PASTE_META, true)
    const before = this.editor.state.doc
    chain.run()
    const inserted = this.editor.state.doc !== before
    this.owner.view.dispatch(closeHistory(this.owner.view.state.tr))
    this.editor.commands.focus()
    return inserted
  }

  destroy() {
    if (activeNotes.get(this.owner.view) === this) activeNotes.delete(this.owner.view)
    this.owner.view.dom.removeEventListener('focusin', this.onOuterFocus)
    this.button.removeEventListener('click', this.onInsert)
    this.editabilityObserver.disconnect()
    this.editor.destroy()
  }
}
