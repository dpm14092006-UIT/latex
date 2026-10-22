// Table numbering belongs to the author. A null/missing field identifies an
// older caption that may still contain its own Table/Bảng designation.
export function tableCaptionParts(attrs = {}) {
  const caption = String(attrs?.caption || '').replace(/\s+/gu, ' ').trim()
  if (attrs?.tableNumber != null) return { tableNumber: String(attrs.tableNumber).trim(), caption }
  const legacy = /^(?:Table|Bảng)\s+([A-Za-z]?\.?\d+(?:\.\d+)*[A-Za-z]?|[IVXLCDM]+|\?+)(?:[.:](?:\s+|$)|\s+|$)(.*)$/iu.exec(caption)
  return legacy && legacy[1].length <= 50 ? { tableNumber: legacy[1], caption: legacy[2].trim() } : { tableNumber: '', caption }
}

export function tableCaptionText(attrs = {}) {
  const { tableNumber, caption } = tableCaptionParts(attrs)
  return tableNumber ? `Table ${tableNumber}${caption ? `. ${caption}` : ''}` : caption
}

export function normalizeTableCaptions(node) {
  if (!node || typeof node !== 'object') return node
  let attrs = node.attrs
  if (node.type === 'table' && attrs?.tableNumber == null) {
    const parts = tableCaptionParts(attrs)
    if (parts.tableNumber) attrs = { ...attrs, ...parts }
    else if (attrs && Object.hasOwn(attrs, 'tableNumber')) {
      attrs = { ...attrs }
      delete attrs.tableNumber
    }
  }
  const content = node.content?.map(normalizeTableCaptions)
  return attrs !== node.attrs || content?.some((child, index) => child !== node.content[index])
    ? { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
    : node
}
