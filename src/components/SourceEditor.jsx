import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { HighlightStyle, StreamLanguage, syntaxHighlighting, bracketMatching } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { acceptsSourceEdit } from '../services/DocumentLimits.js'

// Two-colour syntax: structure is carried by weight, slant and underline instead of hue.
const monochromeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.macroName, tags.function(tags.variableName), tags.tagName], fontWeight: '700' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], fontStyle: 'italic', opacity: '.55' },
  { tag: [tags.string, tags.special(tags.string), tags.atom], textDecoration: 'underline', textUnderlineOffset: '3px' },
  { tag: [tags.bracket, tags.paren, tags.squareBracket, tags.brace], fontWeight: '700' },
  { tag: [tags.number, tags.bool], fontStyle: 'italic' },
  { tag: tags.invalid, textDecoration: 'line-through' },
])

export default function SourceEditor({ readOnly = false, value, onChange, onLimitError, errorLine, identity }) {
  const host = useRef(null), view = useRef(null), callback = useRef(onChange), external = useRef(false), lastLocalValue = useRef(value)
  const rejected = useRef(onLimitError)
  callback.current = onChange
  rejected.current = onLimitError
  useEffect(() => {
    lastLocalValue.current = value
    const instance = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
      lineNumbers(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), highlightSelectionMatches(),
      EditorState.transactionFilter.of(transaction => {
        if (!transaction.docChanged || external.current || acceptsSourceEdit(transaction.startState.doc.toString(), transaction.newDoc.toString())) return transaction
        rejected.current?.('Source LaTeX vượt giới hạn 800 KB. Thao tác vừa nhập chưa được áp dụng; hãy giảm nội dung trước khi biên dịch.')
        return []
      }),
      syntaxHighlighting(monochromeHighlight), StreamLanguage.define(stex),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ 'aria-label': 'Mã nguồn LaTeX đầy đủ', spellcheck: 'false' }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.75' },
        '.cm-content': { caretColor: 'var(--fg)' },
        '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg)', borderRight: '1px solid var(--fg)' },
        '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', fontSize: '10px' },
        '.cm-activeLine': { backgroundColor: 'transparent', boxShadow: 'inset 3px 0 0 var(--fg)' },
        '.cm-activeLineGutter': { color: 'var(--bg)', backgroundColor: 'var(--fg)' },
        '.cm-cursor': { borderLeftColor: 'var(--fg)', borderLeftWidth: '2px' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--fg) !important', color: 'var(--bg)' },
        '.cm-selectionMatch': { backgroundColor: 'transparent', outline: '1px dashed var(--fg)' },
        '&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid var(--fg)' },
        '.cm-panels': { backgroundColor: 'var(--bg)', color: 'var(--fg)', borderTop: '1px solid var(--fg)' },
        '.cm-searchMatch': { backgroundColor: 'transparent', outline: '1px solid var(--fg)' },
      }),
      EditorView.updateListener.of(update => {
        if (!update.docChanged || external.current) return
        const nextValue = update.state.doc.toString()
        lastLocalValue.current = nextValue
        callback.current(nextValue)
      }),
    ] }) })
    view.current = instance
    return () => { instance.destroy(); view.current = null }
  // The editor instance is recreated when the document identity changes; the following effect applies later value updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, readOnly])
  useEffect(() => {
    const instance = view.current
    if (!instance || value === lastLocalValue.current) return
    if (value !== instance.state.doc.toString()) {
      external.current = true
      instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } })
      external.current = false
    }
    lastLocalValue.current = value
  }, [value])
  useEffect(() => {
    const instance = view.current
    if (!instance || !errorLine) return
    const line = instance.state.doc.line(Math.min(instance.state.doc.lines, Math.max(1, errorLine)))
    instance.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
  }, [errorLine])
  return <div ref={host} className="studio-source-editor min-h-0 flex-1 overflow-hidden" />
}
