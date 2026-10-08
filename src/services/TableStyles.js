// Thư viện kiểu bảng: các thuộc tính được lưu trên node `table` và được
// serializer chuyển thành LaTeX. Mọi giá trị đều đi qua whitelist để dữ liệu
// cũ, dữ liệu nhập từ ZIP/LAN hay giá trị lạ không thể chèn LaTeX tùy ý.

export const TABLE_STYLES = [
  { id: 'academic', label: 'Học thuật', description: 'Ba đường kẻ booktabs: trên, dưới tiêu đề và cuối bảng.' },
  { id: 'grid', label: 'Lưới', description: 'Kẻ đủ đường dọc và ngang cho mọi ô.' },
  { id: 'striped', label: 'Sọc xen kẽ', description: 'Ba đường kẻ, các hàng nội dung tô nền xen kẽ.' },
  { id: 'shaded', label: 'Tiêu đề tô nền', description: 'Hàng tiêu đề tô nền, kẻ trên và cuối bảng.' },
  { id: 'minimal', label: 'Tối giản', description: 'Chỉ một đường dưới hàng tiêu đề.' },
  { id: 'plain', label: 'Không kẻ', description: 'Không có đường kẻ nào.' },
]

export const TABLE_FONT_SIZES = [
  { id: 'scriptsize', label: 'Rất nhỏ' },
  { id: 'footnotesize', label: 'Nhỏ hơn' },
  { id: 'small', label: 'Nhỏ' },
  { id: 'normalsize', label: 'Bằng văn bản' },
]

export const TABLE_ROW_SPACINGS = [
  { id: '1', label: 'Sát' },
  { id: '1.2', label: 'Vừa' },
  { id: '1.5', label: 'Thoáng' },
  { id: '1.8', label: 'Rất thoáng' },
]

export const TABLE_WIDTHS = [
  { id: 'auto', label: 'Tự động', description: 'Cột ngắn giữ độ rộng tự nhiên, cột dài tự xuống dòng.' },
  { id: 'full', label: 'Toàn trang', description: 'Mọi cột tự xuống dòng, bảng rộng bằng vùng chữ.' },
  { id: 'natural', label: 'Theo nội dung', description: 'Không xuống dòng trong ô; bảng rộng theo nội dung.' },
]

export const TABLE_CAPTION_POSITIONS = [
  { id: 'top', label: 'Trên bảng' },
  { id: 'bottom', label: 'Dưới bảng' },
]

export const TABLE_ALIGNMENTS = ['left', 'center', 'right']

export const TABLE_STYLE_DEFAULTS = Object.freeze({
  tableStyle: 'academic',
  fontSize: 'small',
  rowSpacing: '1.2',
  tableWidth: 'auto',
  captionPosition: 'top',
  headerBold: true,
})

const allowed = {
  tableStyle: new Set(TABLE_STYLES.map(item => item.id)),
  fontSize: new Set(TABLE_FONT_SIZES.map(item => item.id)),
  rowSpacing: new Set(TABLE_ROW_SPACINGS.map(item => item.id)),
  tableWidth: new Set(TABLE_WIDTHS.map(item => item.id)),
  captionPosition: new Set(TABLE_CAPTION_POSITIONS.map(item => item.id)),
}

export function isValidTableStyleAttribute(name, value) {
  if (value === undefined || value === null) return true
  if (name === 'headerBold') return typeof value === 'boolean'
  return allowed[name] ? allowed[name].has(value) : true
}

export function normalizeTableStyle(attrs = {}) {
  const result = {}
  for (const name of Object.keys(TABLE_STYLE_DEFAULTS)) {
    const value = attrs?.[name]
    result[name] = value !== undefined && value !== null && isValidTableStyleAttribute(name, value) ? value : TABLE_STYLE_DEFAULTS[name]
  }
  return result
}

export function normalizeCellAlign(value) {
  return TABLE_ALIGNMENTS.includes(value) ? value : null
}

// Các mẫu dựng sẵn trong thư viện: kiểu bảng + kích thước + nội dung gợi ý.
export const TABLE_PRESETS = [
  { id: 'academic-results', label: 'Bảng kết quả', style: { tableStyle: 'academic' }, header: ['Phương pháp', 'Độ chính xác (%)', 'Thời gian (s)'], rows: 3, align: [null, 'right', 'right'] },
  { id: 'grid-compare', label: 'Bảng so sánh', style: { tableStyle: 'grid', rowSpacing: '1.5' }, header: ['Tiêu chí', 'Phương án A', 'Phương án B'], rows: 3, align: [null, 'center', 'center'] },
  { id: 'striped-data', label: 'Bảng số liệu', style: { tableStyle: 'striped', fontSize: 'footnotesize' }, header: ['STT', 'Chỉ tiêu', 'Năm 2025', 'Năm 2026'], rows: 4, align: ['center', null, 'right', 'right'] },
  { id: 'shaded-list', label: 'Danh mục', style: { tableStyle: 'shaded', tableWidth: 'full' }, header: ['STT', 'Nội dung', 'Ghi chú'], rows: 3, align: ['center', null, null] },
  { id: 'minimal-terms', label: 'Thuật ngữ', style: { tableStyle: 'minimal', tableWidth: 'full' }, header: ['Thuật ngữ', 'Giải thích'], rows: 3, align: [null, null] },
  { id: 'plain-layout', label: 'Bố cục không kẻ', style: { tableStyle: 'plain', headerBold: false }, header: ['', ''], rows: 2, align: [null, null], noHeader: true },
]

function cellNode(type, text, align) {
  const paragraph = text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }
  return { type, attrs: { colspan: 1, rowspan: 1, colwidth: null, align: align || null }, content: [paragraph] }
}

export function createPresetTable(preset, { rows, cols } = {}) {
  const columnCount = Math.max(1, Math.min(20, cols || preset.header.length))
  const bodyRows = Math.max(1, Math.min(100, rows || preset.rows))
  const alignFor = index => normalizeCellAlign(preset.align?.[index])
  const header = Array.from({ length: columnCount }, (_, index) => preset.header[index] ?? `Cột ${index + 1}`)
  const content = []
  if (!preset.noHeader) content.push({ type: 'tableRow', content: header.map((text, index) => cellNode('tableHeader', text, alignFor(index))) })
  for (let row = 0; row < bodyRows; row += 1) {
    content.push({ type: 'tableRow', content: header.map((_, index) => cellNode('tableCell', '', alignFor(index))) })
  }
  return { type: 'table', attrs: { ...TABLE_STYLE_DEFAULTS, ...preset.style }, content }
}
