import { unicodeScriptFormulas } from '../math-input.js'

export const MAX_TABLE_NOTE_LENGTH = 2000

// Notes keep their existing string format on disk. Share its interpretation
// between the inline editor, PDF and Word so equations never become plain text.
export function tableNoteContent(value = '', { unicode = true } = {}) {
  const text = String(value ?? '')
  const content = []
  const addText = text => {
    let cursor = 0
    for (const formula of unicode ? unicodeScriptFormulas(text) : []) {
      if (formula.start > cursor) content.push({ type: 'text', text: text.slice(cursor, formula.start) })
      content.push({ type: 'inlineMath', attrs: { latex: formula.latex } })
      cursor = formula.end
    }
    if (cursor < text.length) content.push({ type: 'text', text: text.slice(cursor) })
  }
  // A space after the opening dollar or a digit after the closing dollar
  // identifies prose such as "$5 and $10", rather than an equation.
  const pattern = /(?<!\\)(?:\$(?![\s$])([^$\n]*?[^\s\\$])\$(?!\d)|\$([^\s$\\])\$(?!\d)|\\\(([^\n]+?)\\\))/gu
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const latex = match[1] ?? match[2] ?? match[3]
    let depth = 0
    for (const brace of latex.replace(/\\[{}]/gu, '').replace(/[^{}]/gu, '')) {
      depth += brace === '{' ? 1 : -1
      if (depth < 0) break
    }
    if (depth !== 0 || /[#%]/u.test(latex)) continue
    if (match.index > cursor) addText(text.slice(cursor, match.index))
    content.push({ type: 'inlineMath', attrs: { latex } })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) addText(text.slice(cursor))
  return content
}

export function tableNoteText(doc) {
  const inline = node => node.type === 'inlineMath' ? `$${node.attrs.latex}$`
    : node.type === 'hardBreak' ? '\n' : node.text || (node.content || []).map(inline).join('')
  return (doc.content || []).map(inline).join('\n')
}
