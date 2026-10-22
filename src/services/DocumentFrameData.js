const textOf = node => node?.type === 'text' ? node.text || ''
  : node?.type === 'hardBreak' ? ' '
  : ['inlineMath', 'blockMath'].includes(node?.type) ? node.attrs?.latex || ''
    : node?.type === 'citation' ? node.attrs?.sourceText || node.attrs?.key || 'Trích dẫn'
      : node?.type === 'crossReference' ? node.attrs?.target || 'Tham chiếu'
        : node?.type === 'footnote' ? node.attrs?.text || 'Chú thích'
    : (node?.content || []).map(textOf).join(['paragraph', 'heading', 'codeBlock'].includes(node?.type) ? '' : ' ')
const compact = value => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 120)
const searchText = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/gu, 'd').toLocaleLowerCase('vi')

// Keep top-level indexes, including skipped empty paragraphs, for exact navigation.
export function documentMap(document, limit = 160, query = '') {
  const rows = []
  const needle = searchText(query.trim())
  let total = 0, matched = 0, level = 0
  for (const [blockIndex, node] of (document?.content || []).entries()) {
    const fullText = textOf(node)
    const text = compact(fullText)
    let kind = node.type, label = text, badge = '¶'
    if (kind === 'paragraph' && !text) continue
    if (kind === 'heading') { level = Math.max(1, Math.min(3, node.attrs?.level || 1)); badge = `H${level}`; label ||= 'Tiêu đề chưa đặt tên' }
    else if (kind === 'table') {
      badge = 'Bảng'
      label = compact(node.attrs?.caption) || 'Bảng dữ liệu'
    } else if (kind === 'imageBlock') { badge = 'Ảnh'; label = compact(node.attrs?.caption || node.attrs?.alt || node.attrs?.filename) || 'Hình ảnh' }
    else if (kind === 'blockMath') { badge = 'fx'; label ||= 'Công thức' }
    else if (['bulletList', 'orderedList'].includes(kind)) { badge = '≡'; label ||= 'Danh sách' }
    else if (kind === 'blockquote') { badge = '“'; label ||= 'Trích đoạn' }
    else if (kind === 'codeBlock') { badge = '</>'; label ||= 'Khối mã' }
    else if (kind === 'horizontalRule') { badge = '—'; label = 'Đường phân cách' }
    else if (kind === 'pageBreak') { badge = '↵'; label = 'Ngắt trang' }
    else { kind = 'paragraph'; label ||= 'Nội dung' }
    total += 1
    if (needle && !searchText(`${fullText} ${label} ${badge}`).includes(needle)) continue
    matched += 1
    if (rows.length < limit) rows.push({ blockIndex, kind, label, badge, level })
  }
  return { rows, total, matched, remaining: matched - rows.length }
}

export const PAPER_SIZES = Object.freeze({
  a4paper: { label: 'A4', width: 210, height: 297 },
  a5paper: { label: 'A5', width: 148, height: 210 },
  letterpaper: { label: 'Letter', width: 215.9, height: 279.4 },
})
