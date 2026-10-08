// Word-style character formatting. Every value here must survive both the
// LaTeX serializer and the document validator, so the UI only offers values
// from these lists and the validator rejects anything else.

export const TEXT_COLORS = [
  ['#000000', 'Đen'], ['#595959', 'Xám đậm'], ['#c62828', 'Đỏ'], ['#ef6c00', 'Cam'],
  ['#f9a825', 'Vàng đậm'], ['#2e7d32', 'Xanh lá'], ['#00838f', 'Xanh ngọc'], ['#1565c0', 'Xanh dương'],
  ['#283593', 'Chàm'], ['#6a1b9a', 'Tím'], ['#ad1457', 'Hồng'], ['#4e342e', 'Nâu'],
]
export const HIGHLIGHT_COLORS = [
  ['#fff59d', 'Vàng'], ['#c5e1a5', 'Xanh lá'], ['#81d4fa', 'Xanh dương'], ['#f8bbd0', 'Hồng'],
  ['#ffcc80', 'Cam'], ['#e1bee7', 'Tím'], ['#e0e0e0', 'Xám'],
]
export const FONT_SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '36pt', '48pt', '72pt']

const hexColor = /^#[0-9a-f]{6}$/i
export const isAllowedColor = value => value == null || hexColor.test(value)
export const isAllowedFontSize = value => value == null || FONT_SIZES.includes(value)

// Text symbols verified to exist in Latin Modern Roman (the default PDF font).
export const TEXT_SYMBOLS = ['©', '®', '™', '°', '±', '×', '÷', '→', '←', '↑', '↓', '…', '–', '—', '§', '¶', '•', '€', '£', '¥', '«', '»', '‰', '½', '¼', '¾', '²', '³', 'µ', '†', '‡', '∞', '√']
// Symbols missing from the text font are inserted as inline math instead.
export const MATH_SYMBOLS = [['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'], ['↔', '\\leftrightarrow'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow'], ['∈', '\\in'], ['∉', '\\notin'], ['⊂', '\\subset'], ['∪', '\\cup'], ['∩', '\\cap'], ['∀', '\\forall'], ['∃', '\\exists'], ['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['Δ', '\\Delta'], ['π', '\\pi'], ['Ω', '\\Omega'], ['∑', '\\sum'], ['∫', '\\int'], ['✓', '\\checkmark']]

// Pasted HTML (Word, web pages) carries arbitrary CSS; map it onto values the
// serializer accepts, or drop it, rather than letting it invalidate a document.
export function normalizeColor(value) {
  const text = String(value || '').trim().toLowerCase()
  let match = /^#([0-9a-f]{6})$/.exec(text)
  if (match) return `#${match[1]}`
  match = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (match) return `#${match[1]}${match[1]}${match[2]}${match[2]}${match[3]}${match[3]}`
  match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text)
  if (!match) return null
  if (match[4] !== undefined && parseFloat(match[4]) === 0) return null
  const channels = match.slice(1, 4).map(Number)
  if (channels.some(channel => channel > 255)) return null
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

export function normalizeFontSize(value) {
  const match = /^([\d.]+)\s*(pt|px)$/i.exec(String(value || '').trim())
  if (!match) return null
  const points = parseFloat(match[1]) * (match[2].toLowerCase() === 'px' ? 0.75 : 1)
  if (!Number.isFinite(points) || points <= 0) return null
  return FONT_SIZES.reduce((best, size) => Math.abs(parseFloat(size) - points) < Math.abs(parseFloat(best) - points) ? size : best)
}
