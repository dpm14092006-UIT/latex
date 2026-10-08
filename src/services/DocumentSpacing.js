// Some pasted prose uses NBSP for every word separator. Repair that pattern
// while preserving isolated nonbreaking spaces between quantities and units, and code/math.
export function normalizeDocumentSpacing(node) {
  if (!node || typeof node !== 'object' || node.type === 'codeBlock') return node
  const content = node.content
  if (!Array.isArray(content)) return node
  const prose = node.type === 'paragraph' || node.type === 'heading'
  const text = prose ? content.filter(child => child.type === 'text' && !child.marks?.some(mark => mark.type === 'code')).map(child => child.text || '').join('') : ''
  const nonbreaking = (text.match(/\u00a0/g) || []).length
  const repair = nonbreaking >= 3 && nonbreaking > (text.match(/ /g) || []).length
  const next = content.map(child => repair && child.type === 'text' && !child.marks?.some(mark => mark.type === 'code') && child.text.includes('\u00a0')
    ? { ...child, text: child.text.replace(/\u00a0/g, ' ') }
    : normalizeDocumentSpacing(child))
  return next.some((child, index) => child !== content[index]) ? { ...node, content: next } : node
}
