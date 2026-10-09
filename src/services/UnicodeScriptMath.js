import { unicodeScriptFormulas } from '../math-input.js'

// Replace only the token ranges so text, marks and the cursor surrounding a
// formula survive. Wait until a typed token ends (space, punctuation or blur)
// so H₂ can still become H₂O and multi-digit scripts can be entered.
export function convertUnicodeScriptMath(state, { ranges, deferAtCursor = false } = {}) {
  const nodeType = state.schema.nodes.inlineMath
  if (!nodeType) return null
  const matches = []
  state.doc.descendants((node, position) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    if (ranges && !ranges.some(range => range.from <= position + node.nodeSize && range.to >= position)) return false
    node.forEach((child, offset) => {
      if (!child.isText || child.marks.some(mark => ['code', 'link'].includes(mark.type.name))) return
      for (const formula of unicodeScriptFormulas(child.text)) {
        const from = position + 1 + offset + formula.start
        const to = position + 1 + offset + formula.end
        if (deferAtCursor && state.selection.from >= from && state.selection.to <= to) continue
        matches.push({ from, to, latex: formula.latex, marks: child.marks })
      }
    })
    return false
  })
  if (!matches.length) return null
  const transaction = state.tr
  for (const match of matches.reverse()) transaction.replaceWith(match.from, match.to, nodeType.create({ latex: match.latex }, null, match.marks))
  return transaction
}
