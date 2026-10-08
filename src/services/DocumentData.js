import { base64ByteLength, isValidBase64, matchesImageSignature } from './ProjectAssets.js'
import { isAllowedColor, isAllowedFontSize } from './RichTextFormats.js'
import { MAX_DOCUMENT_IMAGE_BYTES, MAX_DOCUMENT_IMAGES, MAX_TOTAL_DOCUMENT_IMAGE_BYTES, MAX_LATEX_SOURCE_BYTES } from './DocumentLimits.js'

const MAX_IMAGE_DATA_URI_CHARS = Math.ceil(MAX_DOCUMENT_IMAGE_BYTES / 3) * 4 + 32
const BLOCK_NODES = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote',
  'codeBlock', 'horizontalRule', 'blockMath', 'imageBlock', 'table', 'tableRow',
  'tableCell', 'tableHeader', 'pageBreak',
])
const INLINE_NODES = new Set(['text', 'inlineMath', 'hardBreak', 'citation', 'crossReference', 'footnote'])
const SUPPORTED_NODES = new Set(['doc', ...BLOCK_NODES, ...INLINE_NODES])
const SUPPORTED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline', 'superscript', 'subscript', 'textStyle', 'highlight'])
const TEXT_ALIGNMENTS = new Set([null, 'left', 'center', 'right', 'justify'])
const BLOCK_CHILDREN = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote',
  'codeBlock', 'horizontalRule', 'blockMath', 'imageBlock', 'table', 'pageBreak',
])
const ALLOWED_CHILDREN = {
  doc: BLOCK_CHILDREN,
  paragraph: INLINE_NODES,
  heading: INLINE_NODES,
  bulletList: new Set(['listItem']),
  orderedList: new Set(['listItem']),
  listItem: BLOCK_CHILDREN,
  blockquote: BLOCK_CHILDREN,
  codeBlock: new Set(['text']),
  table: new Set(['tableRow']),
  tableRow: new Set(['tableCell', 'tableHeader']),
  tableCell: BLOCK_CHILDREN,
  tableHeader: BLOCK_CHILDREN,
}
const REQUIRED_CHILDREN = new Set(['doc', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader'])
export const MAX_TABLE_COLUMNS = 256

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function allowedChildren(parentType, children) {
  const allowedTypes = ALLOWED_CHILDREN[parentType]
  if (!allowedTypes) return children.length === 0
  if (REQUIRED_CHILDREN.has(parentType) && children.length === 0) return false
  return children.every(child => isRecord(child) && allowedTypes.has(child.type))
}

function isValidMark(mark) {
  if (!isRecord(mark) || !SUPPORTED_MARKS.has(mark.type) || (mark.attrs !== undefined && !isRecord(mark.attrs))) return false
  // Colors and sizes are serialized into LaTeX, so only palette values pass.
  if (mark.type === 'textStyle') return isAllowedColor(mark.attrs?.color) && isAllowedFontSize(mark.attrs?.fontSize)
  if (mark.type === 'highlight') return isAllowedColor(mark.attrs?.color)
  return true
}

// Bản cũ của editor lưu được tiêu đề h4–h6 khi dán HTML; hạ về cấp 3 thay vì từ chối cả workspace.
export function clampHeadingLevels(node) {
  if (!isRecord(node)) return node
  let changed = false
  let content = node.content
  if (Array.isArray(content)) {
    const next = content.map(clampHeadingLevels)
    if (next.some((child, index) => child !== content[index])) { content = next; changed = true }
  }
  let attrs = node.attrs
  if (node.type === 'heading' && Number.isSafeInteger(attrs?.level) && attrs.level > 3 && attrs.level <= 6) {
    attrs = { ...attrs, level: 3 }
    changed = true
  }
  return changed ? { ...node, attrs, content } : node
}

export function isValidDocument(value) {
  if (!isRecord(value) || value.type !== 'doc' || !Array.isArray(value.content) || value.content.length === 0) return false

  let visited = 0
  let imageCount = 0
  let imageBytes = 0
  const visit = (node, depth) => {
    if (!isRecord(node) || !SUPPORTED_NODES.has(node.type) || depth > 128 || ++visited > 100_000) return false
    if (node.attrs !== undefined && !isRecord(node.attrs)) return false
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some(mark => !isValidMark(mark)))) return false
    if (node.attrs?.textAlign !== undefined && !TEXT_ALIGNMENTS.has(node.attrs.textAlign)) return false
    if (node.type === 'text' && typeof node.text !== 'string') return false
    if (['inlineMath', 'blockMath'].includes(node.type) && typeof node.attrs?.latex !== 'string') return false
    if (node.type === 'citation' && !/^[A-Za-z0-9:._-]{1,100}(?:,[A-Za-z0-9:._-]{1,100}){0,49}$/.test(node.attrs?.key || '')) return false
    if (node.type === 'citation' && node.attrs?.mode !== undefined && !['parenthetical', 'narrative'].includes(node.attrs.mode)) return false
    if (node.type === 'crossReference' && !/^[A-Za-z0-9:._-]{1,100}$/.test(node.attrs?.target || '')) return false
    if (node.type === 'footnote' && (typeof node.attrs?.text !== 'string' || node.attrs.text.length > 5000)) return false
    if (node.type === 'heading' && ![1, 2, 3].includes(node.attrs?.level)) return false
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      for (const key of ['colspan', 'rowspan']) {
        const span = node.attrs?.[key]
        if (span !== undefined && (!Number.isSafeInteger(span) || span < 1 || span > MAX_TABLE_COLUMNS)) return false
      }
    }
    if (node.type === 'table') {
      if (node.attrs?.caption !== undefined && (typeof node.attrs.caption !== 'string' || node.attrs.caption.length > 500)) return false
      if (node.attrs?.label !== undefined && (typeof node.attrs.label !== 'string' || (node.attrs.label && !/^[A-Za-z0-9:._-]{1,100}$/.test(node.attrs.label)))) return false
    }
    if (node.type === 'imageBlock') {
      if (node.attrs?.caption !== undefined && (typeof node.attrs.caption !== 'string' || node.attrs.caption.length > 500)) return false
      imageCount += 1
      if (imageCount > MAX_DOCUMENT_IMAGES) return false
      const src = node.attrs?.src
      let encodedImage = ''
      if (src !== null) {
        if (typeof src !== 'string' || src.length > MAX_IMAGE_DATA_URI_CHARS) return false
        const prefix = /^data:image\/(png|jpeg);base64,/.exec(src)
        if (!prefix) return false
        encodedImage = src.slice(prefix[0].length)
        if (!isValidBase64(encodedImage) || !encodedImage || !matchesImageSignature(prefix[1], encodedImage)) return false
      }
      const currentImageBytes = base64ByteLength(encodedImage)
      if (currentImageBytes > MAX_DOCUMENT_IMAGE_BYTES) return false
      imageBytes += currentImageBytes
      if (imageBytes > MAX_TOTAL_DOCUMENT_IMAGE_BYTES) return false
      if (node.attrs?.alt !== undefined && typeof node.attrs.alt !== 'string') return false
      if (node.attrs?.filename !== undefined && typeof node.attrs.filename !== 'string') return false
    }
    if (node.content !== undefined && !Array.isArray(node.content)) return false
    const children = node.content || []
    if (!allowedChildren(node.type, children)) return false
    if (node.type === 'table') {
      for (const row of children) {
        if (!Array.isArray(row.content)) return false
        let columns = 0
        for (const cell of row.content) {
          if (!isRecord(cell)) return false
          columns += cell.attrs?.colspan ?? 1
          if (columns > MAX_TABLE_COLUMNS) return false
        }
      }
    }
    return children.every(child => visit(child, depth + 1))
  }

  return value.content.every(node => visit(node, 1))
}

export function sanitizeFormulaTemplates(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.filter(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.startsWith('custom-') || seen.has(item.id)) return false
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) return false
    if (typeof item.latex !== 'string' || !item.latex.trim() || item.latex.length > 12_000) return false
    if (item.type !== 'inline' && item.type !== 'block') return false
    seen.add(item.id)
    return true
  }).map(({ id, name, latex, type, untrusted }) => ({ id, name, latex, type, ...(untrusted === true ? { untrusted: true } : {}) }))
}

export function sanitizeDocumentTemplates(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.filter(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.startsWith('layout-') || seen.has(item.id)) return false
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) return false
    if (typeof item.source !== 'string' || new TextEncoder().encode(item.source).length > MAX_LATEX_SOURCE_BYTES || !item.source.includes('{{content}}')) return false
    seen.add(item.id)
    return true
  }).map(({ id, name, source, untrusted }) => ({ id, name, source, ...(untrusted === true ? { untrusted: true } : {}) }))
}
