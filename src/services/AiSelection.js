// Converts the editor selection to LaTeX-flavoured plain text for the assistant,
// and the assistant's answer back to editor JSON, so formulas, citations,
// cross-references and footnotes survive a round trip instead of being flattened.

const MAX_SELECTION = 20_000

function inlineText(node) {
  if (node.isText) return node.text
  switch (node.type.name) {
    case 'inlineMath': return `$${node.attrs.latex}$`
    case 'citation': return `\\cite{${node.attrs.key}}`
    case 'crossReference': return `\\ref{${node.attrs.target}}`
    case 'footnote': return `\\footnote{${node.attrs.text}}`
    case 'hardBreak': return '\n'
    default: return ''
  }
}

function blockText(node) {
  if (node.type.name === 'blockMath') return `\\[${node.attrs.latex}\\]`
  if (node.isTextblock) { let text = ''; node.forEach(child => { text += inlineText(child) }); return text }
  return ''
}

// With an empty selection the paragraph around the caret is used. `inline` is
// true when the range sits inside one textblock, so the answer can replace it
// without splitting the paragraph or heading.
export function selectionForAi(state) {
  let { from, to, empty, $from, $to } = state.selection
  if (empty) {
    if (!$from.parent.isTextblock) return null
    from = $from.start(); to = $from.end()
  }
  const inline = $from.sameParent($to) && $from.parent.isTextblock
  const parts = []
  if (inline) {
    $from.parent.nodesBetween(from - $from.start(), to - $from.start(), (node, pos) => {
      if (!node.isInline) return true
      if (node.isText) {
        const start = Math.max(0, from - $from.start() - pos), end = Math.min(node.text.length, to - $from.start() - pos)
        parts.push(node.text.slice(start, end))
      } else parts.push(inlineText(node))
      return false
    })
  } else {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock && node.type.name !== 'blockMath') return true
      if (node.type.name === 'blockMath') { parts.push(blockText(node)); return false }
      const start = Math.max(from, pos + 1), end = Math.min(to, pos + node.nodeSize - 1)
      let text = ''
      node.nodesBetween(start - pos - 1, end - pos - 1, (child, offset) => {
        if (child.isText) text += child.text.slice(Math.max(0, start - pos - 1 - offset), Math.min(child.text.length, end - pos - 1 - offset))
        else text += inlineText(child)
        return false
      })
      parts.push(text)
      return false
    })
  }
  const text = parts.join(inline ? '' : '\n\n').trim()
  if (!text) return null
  return { text, from, to, inline, tooLong: text.length > MAX_SELECTION }
}

const INLINE_TOKEN = /\\\(([\s\S]+?)\\\)|(?<!\\)\$\$?([^$\n]+?)\$\$?|\\cite[pt]?\{([^{}]{1,500})\}|\\ref\{([^{}]{1,200})\}|\\footnote\{([^{}]{1,5000})\}/g

export function aiInlineContent(text) {
  const content = []
  let cursor = 0
  const plain = value => { if (value) content.push({ type: 'text', text: value }) }
  for (const match of text.matchAll(INLINE_TOKEN)) {
    plain(text.slice(cursor, match.index))
    const [, paren, dollar, cite, ref, footnote] = match
    if (paren !== undefined || dollar !== undefined) content.push({ type: 'inlineMath', attrs: { latex: (paren ?? dollar).trim() } })
    else if (cite !== undefined) content.push({ type: 'citation', attrs: { key: cite.trim() } })
    else if (ref !== undefined) content.push({ type: 'crossReference', attrs: { target: ref.trim() } })
    else content.push({ type: 'footnote', attrs: { text: footnote.trim() } })
    cursor = match.index + match[0].length
  }
  plain(text.slice(cursor))
  return content
}

// Paragraphs are separated by blank lines; a paragraph that is only \[...\] or
// $$...$$ becomes a display formula.
export function aiResultToContent(text, { inline = false } = {}) {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (inline && !/\n\s*\n/.test(normalized)) return aiInlineContent(normalized.replace(/\s*\n\s*/g, ' '))
  return normalized.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).map(block => {
    const display = /^(?:\\\[([\s\S]+)\\\]|\$\$([\s\S]+)\$\$)$/.exec(block)
    if (display) return { type: 'blockMath', attrs: { latex: (display[1] ?? display[2]).trim() } }
    const content = aiInlineContent(block.replace(/\s*\n\s*/g, ' '))
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
  })
}
