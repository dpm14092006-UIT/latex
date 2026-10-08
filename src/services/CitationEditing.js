import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { citationKeys } from './Bibliography.js'

// Adding a citation never replaces the prose selected to provide context.
export function citationEditTransaction(state, { keys, mode = 'parenthetical', editing = null, insertionSelection = null }) {
  const unique = citationKeys(keys.join(','))
  if (unique.length > 50) throw Error('Một nhóm cite tối đa 50 REF. Hãy chia thành các nhóm nhỏ hơn.')
  if (!['parenthetical', 'narrative'].includes(mode)) throw Error('Cách cite không hợp lệ.')
  const tr = state.tr
  if (editing) {
    const node = state.doc.nodeAt(editing.pos)
    if (node?.type.name !== 'citation' || (editing.node && node !== editing.node)) throw Error('Trích dẫn đã thay đổi. Hãy mở lại để sửa.')
    if (unique.length) tr.setNodeMarkup(editing.pos, undefined, { ...node.attrs, key: unique.join(','), mode })
    else tr.delete(editing.pos, editing.pos + node.nodeSize)
    return closeHistory(tr)
  }
  if (!unique.length) return null
  if (insertionSelection && insertionSelection.doc !== state.doc) throw Error('Nội dung đã thay đổi. Hãy chọn lại vị trí chèn trích dẫn.')
  const range = insertionSelection || state.selection
  // Select-all ends outside the last paragraph; insert at that paragraph's end.
  const at = range.to === state.doc.content.size && state.doc.lastChild?.isTextblock ? range.to - 1 : range.to
  const resolved = state.doc.resolve(at)
  if (!resolved.parent.isTextblock) throw Error('Đặt con trỏ ở cuối câu hoặc trong đoạn văn để chèn trích dẫn.')
  if (!resolved.parent.contentMatchAt(resolved.index()).matchType(state.schema.nodes.citation)) throw Error('Không chèn citation trong khối mã. Hãy chọn một đoạn văn.')
  const before = resolved.nodeBefore
  if (range.from === range.to && before?.type.name === 'citation' && before.attrs.mode === mode) {
    const merged = [...new Set([...citationKeys(before.attrs.key), ...unique])]
    if (merged.length > 50) throw Error('Nhóm cite liền trước đã đạt giới hạn 50 REF. Hãy chèn nhóm riêng ở vị trí khác.')
    tr.setNodeMarkup(at - before.nodeSize, undefined, { ...before.attrs, key: merged.join(',') })
  } else {
    const previous = before?.isText ? before.text.at(-1) : before ? 'x' : ''
    const marks = resolved.marks().filter(mark => !['code', 'link'].includes(mark.type.name))
    const nodes = []
    if (previous && !/[\s(]/u.test(previous)) nodes.push(state.schema.text(' ', marks))
    nodes.push(state.schema.nodes.citation.create({ key: unique.join(','), mode }, null, marks))
    tr.insert(at, nodes)
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(at, 1)))
  }
  return closeHistory(tr)
}
