import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

export function richSpellcheckSegments(doc, { title = '', abstract = '', abstractEnabled = false } = {}) {
  const segments = []
  const field = (id, text, target, label) => { if (text) segments.push({ id, text, target, label }) }
  field('title', title, { kind: 'title' }, 'Tiêu đề tài liệu')
  if (abstractEnabled) field('abstract', abstract, { kind: 'abstract' }, 'Abstract')
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (node.type.name === 'footnote') field(`attr:${pos}:text`, node.attrs.text, { kind: 'attribute', pos, attribute: 'text', nodeType: node.type.name }, 'Chú thích')
    if (['imageBlock', 'table'].includes(node.type.name)) field(`attr:${pos}:caption`, node.attrs.caption, { kind: 'attribute', pos, attribute: 'caption', nodeType: node.type.name }, 'Caption')
    if (node.type.name === 'table') field(`attr:${pos}:note`, node.attrs.note, { kind: 'attribute', pos, attribute: 'note', nodeType: node.type.name }, 'Ghi chú bảng')
    if (!node.isTextblock) return true
    let text = '', from = 0
    const flush = () => {
      if (text) segments.push({ id: `rich:${from}`, text, target: { kind: 'rich', from }, label: node.type.name === 'heading' ? 'Tiêu đề' : 'Bản thảo' })
      text = ''
    }
    node.forEach((child, offset) => {
      if (child.isText && !child.marks.some(mark => mark.type.name === 'code')) {
        if (!text) from = pos + 1 + offset
        text += child.text
      } else flush()
    })
    flush()
    // Inline footnotes still need attribute scanning.
    return true
  })
  return segments
}

export function locateSpellcheckErrors(errors, segments) {
  const byId = new Map(segments.map(segment => [segment.id, segment]))
  return errors.flatMap(error => {
    const segment = byId.get(error.segmentId)
    if (!segment || segment.text.slice(error.from, error.to) !== error.original) return []
    const target = segment.target
    return [{ ...error, target, label: segment.label || 'LaTeX', context: segment.text.slice(Math.max(0, error.from - 35), error.to + 45), position: ['rich', 'source'].includes(target.kind) ? target.from + error.from : null }]
  })
}

export function replaceSpellingField(value, error, replacement, maxLength) {
  if (typeof value !== 'string' || typeof replacement !== 'string' || !Number.isSafeInteger(error.from) || !Number.isSafeInteger(error.to) || error.from < 0 || error.to > value.length || error.to <= error.from || value.slice(error.from, error.to) !== error.original) return null
  const result = value.slice(0, error.from) + replacement + value.slice(error.to)
  return result.length <= maxLength ? result : null
}

export function replaceRichSpelling(editor, error, replacement) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const { state } = editor
  const tr = closeHistory(state.tr)
  if (error.target.kind === 'attribute') {
    const { pos, attribute, nodeType } = error.target
    const node = state.doc.nodeAt(pos)
    const current = node?.attrs[attribute]
    if (node?.type.name !== nodeType || typeof current !== 'string' || current.slice(error.from, error.to) !== error.original) return false
    const corrected = replaceSpellingField(current, error, replacement, nodeType === 'footnote' ? 5000 : 500)
    if (corrected === null) return false
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attribute]: corrected })
  } else {
    const from = error.position, to = from + error.original.length
    if (from == null || state.doc.textBetween(from, to, '', '\0') !== error.original) return false
    const runs = []
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText) runs.push({ length: Math.min(to, pos + node.nodeSize) - Math.max(from, pos), marks: node.marks })
    })
    if (!runs.length) return false
    let consumed = 0
    const nodes = []
    for (let index = 0; index < runs.length && consumed < replacement.length; index++) {
      const end = index === runs.length - 1 ? replacement.length : Math.min(replacement.length, consumed + runs[index].length)
      if (end > consumed) nodes.push(state.schema.text(replacement.slice(consumed, end), runs[index].marks))
      consumed = end
    }
    tr.replaceWith(from, to, Fragment.fromArray(nodes))
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + replacement.length)))
  }
  editor.view.dispatch(tr)
  // Close the group on both sides so typing immediately after a correction has its own undo.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
  editor.commands.focus()
  return true
}
