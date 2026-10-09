import { recognizeFormula } from '../formula-recognition.js'
import { unicodeScriptFormulas } from '../math-input.js'

const BLOCK_SEPARATOR = '\u0000'
const MAX_BLOCK_LENGTH = 12_000
const MAX_BLOCKS = 5_000
const MAX_SUGGESTIONS = 2_000
const relationPattern = /(?:>=|<=|!=|==|=|≤|≥|≈|∈|∉)/g
const potentialMathPattern = /[=<>≤≥≈∈∉+*/^_{}()\u00B9\u00B2\u00B3\u2070-\u207F\u2080-\u208E\u2090-\u209C]/
const proseWords = new Set([
  'a', 'about', 'after', 'also', 'an', 'and', 'are', 'as', 'at', 'because', 'before', 'between', 'by', 'can', 'compared', 'define', 'described', 'during', 'each', 'equation', 'equations', 'expression', 'formula', 'formulas', 'for', 'from', 'given', 'has', 'have', 'identity', 'in', 'is', 'it', 'let', 'may', 'model', 'of', 'on', 'or', 'our', 'result', 'results', 'see', 'set', 'shown', 'that', 'the', 'their', 'this', 'to', 'use', 'using', 'we', 'when', 'where', 'which', 'with', 'was', 'were',
])
const mathWords = new Set(['alpha', 'beta', 'cos', 'det', 'exp', 'gamma', 'log', 'ln', 'max', 'min', 'pi', 'sin', 'sqrt', 'tan'])

const specialPatterns = [
  {
    id: 'macro-average',
    pattern: /Macro-[A-Za-z]+\d*\s*=\s*[A-Za-z]+\d*[A-Z][A-Za-z]*(?:\s*\+\s*[A-Za-z]+\d*[A-Z][A-Za-z]*)+\s*(?:\d+|\/\s*\d+)/g,
    confidence: 0.96,
    reason: 'Có dạng Macro-F1 theo lớp và số hạng/mẫu số nhất quán.',
  },
  {
    id: 'categorical-label',
    pattern: /[A-Za-z][A-Za-z]\s*,\s*[A-Za-z]\s*\(\s*[A-Za-z0-9]+\s*\)\s*\{[^{}\n]+\}/g,
    confidence: 0.94,
    reason: 'Có biến phân loại với chỉ số, phiên bản và tập nhãn rõ ràng.',
  },
  {
    id: 'per-ratio',
    pattern: /[A-Za-z][A-Za-z0-9]*Per[A-Za-z][A-Za-z0-9]*[A-Za-z]\s*,\s*[A-Za-z]\s*=\s*[A-Za-z][A-Za-z0-9]*[A-Za-z]\s*,\s*[A-Za-z][A-Za-z][A-Za-z0-9]*s[A-Za-z]\s*,\s*[A-Za-z]/g,
    confidence: 0.94,
    reason: 'Hai vế của tỉ số “Per” có cùng chỉ số và khớp tên biến.',
  },
]

function trimRange(text, start, end) {
  while (start < end && /\s/.test(text[start])) start += 1
  while (end > start && /\s/.test(text[end - 1])) end -= 1
  return { start, end, source: text.slice(start, end) }
}

function containsProse(source) {
  const words = source.match(/[A-Za-z]+/g) || []
  return words.some(word => proseWords.has(word.toLowerCase()))
}

function isFormulaLike(source) {
  return /[=<>≤≥≈∈∉+*/^_{}()\u00B9\u00B2\u00B3\u2070-\u207F\u2080-\u208E\u2090-\u209C]/.test(source)
}

// Dates (12/05/2024, 05/2024) are written with slashes in Vietnamese prose; they are not fractions.
const datePattern = /^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$|^\d{1,2}\/(?:19|20)\d{2}$/

// A plain word glued to one edge of a relation ("(n=120) tham", "gia (n=120)") is usually the
// surrounding sentence, so an equally scored candidate without it is preferred.
function hasBareWordEdge(source) {
  return [source.match(/^([A-Za-z]{2,})\s/)?.[1], source.match(/\s([A-Za-z]{2,})$/)?.[1]]
    .some(word => word && !mathWords.has(word.toLowerCase()))
}

function betterRelation(candidate, best) {
  if (!best || candidate.score !== best.score) return !best || candidate.score > best.score
  const candidateEdge = hasBareWordEdge(candidate.source)
  if (candidateEdge !== hasBareWordEdge(best.source)) return !candidateEdge
  return candidate.source.length > best.source.length
}

function quality(source, latex, kind, forcedConfidence) {
  if (forcedConfidence) return forcedConfidence
  const operators = (source.match(/[=<>≤≥≈∈∉+*/^_]/g) || []).length
  const scripts = /[_^\u00B9\u00B2\u00B3\u2070-\u207F\u2080-\u208E\u2090-\u209C]/.test(source)
  const identifiers = source.match(/[A-Za-z]+/g) || []
  const longIdentifiers = identifiers.filter(word => word.length > 1 && !mathWords.has(word.toLowerCase()) && !/\d/.test(word))
  if (kind === 'relation' && (scripts || operators >= 3) && longIdentifiers.length === 0) return 0.86
  if (kind === 'relation') return longIdentifiers.length > 1 ? 0.58 : 0.72
  if (scripts || /\\(?:sin|cos|tan|sqrt|log|ln)\b/.test(latex)) return 0.76
  return 0.66
}

function collectFromSegment(text, segmentOffset, output) {
  const add = (start, end, kind, reason, confidence) => {
    const range = trimRange(text, start, end)
    if (!range.source || range.source.length > 180 || range.source.includes(BLOCK_SEPARATOR) || datePattern.test(range.source)) return
    const parsed = recognizeFormula(range.source)
    if (parsed.error || !parsed.latex || !isFormulaLike(range.source)) return
    const score = quality(range.source, parsed.latex, kind, confidence)
    if (score < 0.64) return
    output.push({
      start: segmentOffset + range.start,
      end: segmentOffset + range.end,
      source: range.source,
      latex: parsed.latex,
      kind,
      confidence: score,
      level: score >= 0.82 ? 'high' : 'review',
      reason,
    })
  }

  for (const rule of specialPatterns) {
    for (const match of text.matchAll(rule.pattern)) {
      add(match.index, match.index + match[0].length, rule.id, rule.reason, rule.confidence)
    }
  }

  for (const formula of unicodeScriptFormulas(text)) {
    add(formula.start, formula.end, 'unicode-script', 'Có chỉ số hoặc số mũ Unicode rõ ràng, chuyển được trực tiếp sang LaTeX.', formula.latex.startsWith('\\mathrm') ? 0.94 : 0.76)
  }

  relationPattern.lastIndex = 0
  for (const relation of text.matchAll(relationPattern)) {
    const relationStart = relation.index
    const relationEnd = relationStart + relation[0].length
    let leftStartLimit = Math.max(0, relationStart - 120)
    while (leftStartLimit > 0 && leftStartLimit < relationStart && !/[\s,;:!?]/.test(text[leftStartLimit - 1])) leftStartLimit += 1
    if (leftStartLimit >= relationStart) continue
    let rightEndLimit = Math.min(text.length, relationEnd + 120)
    while (rightEndLimit < text.length && /[A-Za-z0-9]/.test(text[rightEndLimit - 1] || '') && /[A-Za-z0-9]/.test(text[rightEndLimit] || '')) rightEndLimit -= 1
    const starts = [leftStartLimit]
    const ends = []
    for (let index = leftStartLimit; index < relationStart; index += 1) {
      if (/\s/.test(text[index]) || /[,;:!?]/.test(text[index])) starts.push(index + 1)
    }
    for (let index = relationEnd; index <= rightEndLimit; index += 1) {
      const atLimit = (index === rightEndLimit || index === text.length)
        && (!/[A-Za-z0-9]/.test(text[index - 1] || '') || !/[A-Za-z0-9]/.test(text[index] || ''))
      const char = text[index]
      const nextWord = text.slice(index).match(/^\s+([A-Za-z]+)/)?.[1]?.toLowerCase()
      if (atLimit || /\s/.test(char || '') || /[;.!?]/.test(char || '') || (nextWord && proseWords.has(nextWord))) ends.push(index)
    }

    let best = null
    for (const start of starts) {
      const left = text.slice(start, relationStart).trim()
      if (!left || left.length > 80 || containsProse(left)) continue
      for (const end of ends) {
        if (end <= relationEnd) continue
        const source = `${left} ${relation[0]} ${text.slice(relationEnd, end).trim()}`.trim()
        if (!source || source.length > 180 || containsProse(source)) continue
        const parsed = recognizeFormula(source)
        if (parsed.error || !parsed.latex) continue
        const score = quality(source, parsed.latex, 'relation')
        if (score < 0.64) continue
        const candidate = { start, end, source, score }
        if (betterRelation(candidate, best)) best = candidate
      }
    }
    if (best) {
      add(best.start, best.end, 'relation', 'Có dấu quan hệ và toán hạng gọn; hãy xác nhận đây là biểu thức toán.', best.score)
    }
  }

  const mathTerm = String.raw`(?:[A-Za-z][A-Za-z0-9]*(?:[_^](?:\{[^{}]+\}|[A-Za-z0-9]+)|[\u00B9\u00B2\u00B3\u2070-\u207F\u2080-\u208E\u2090-\u209C]+)?|\d+(?:\.\d+)?|\([^()\n]{1,40}\))`
  const standalonePatterns = [
    { pattern: new RegExp(`${mathTerm}(?:\\s*[+*/×÷−]\\s*${mathTerm})+`, 'g'), kind: 'arithmetic', reason: 'Có nhiều toán hạng nối bằng toán tử số học.' },
    { pattern: new RegExp(String.raw`\b(?:sqrt|abs|sin|cos|tan|log|ln)\s*\([^()\n]{1,60}\)`, 'g'), kind: 'function', reason: 'Có tên hàm toán học đi cùng đối số trong ngoặc.' },
    { pattern: /\b[A-Za-z][A-Za-z0-9]*[_^](?:\{[^{}]+\}|[A-Za-z0-9]+)(?:\s*[-+*/]\s*(?:[A-Za-z][A-Za-z0-9]*|\d+(?:\.\d+)?))*/g, kind: 'script', reason: 'Có dấu hiệu chỉ số hoặc số mũ trong biểu thức.' },
    { pattern: /\b[A-Za-z][A-Za-z0-9]*[\u00B9\u00B2\u00B3\u2070-\u207F\u2080-\u208E\u2090-\u209C]+/g, kind: 'script', reason: 'Có dấu hiệu chỉ số hoặc số mũ Unicode trong biểu thức.' },
  ]
  for (const rule of standalonePatterns) {
    for (const match of text.matchAll(rule.pattern)) {
      if (containsProse(match[0])) continue
      add(match.index, match.index + match[0].length, rule.kind, rule.reason)
    }
  }
}

function preferCandidate(candidate, existing) {
  if (candidate.start === existing.start && candidate.end === existing.end) return candidate.confidence > existing.confidence
  if (candidate.end <= existing.start || candidate.start >= existing.end) return null
  if (candidate.kind === 'macro-average' || candidate.kind === 'categorical-label') return true
  if (existing.kind === 'macro-average' || existing.kind === 'categorical-label') return false
  if (candidate.start <= existing.start && candidate.end >= existing.end) return candidate.confidence >= existing.confidence - 0.15
  if (existing.start <= candidate.start && existing.end >= candidate.end) return false
  return candidate.confidence > existing.confidence
}

export function scanMathText(textValue, basePosition = 0) {
  const completeText = String(textValue ?? '')
  const text = completeText.slice(0, MAX_BLOCK_LENGTH)
  if (!text) return { suggestions: [], truncated: false }
  const candidates = []
  let segmentOffset = 0
  for (const segment of text.split(BLOCK_SEPARATOR)) {
    if (segment) collectFromSegment(segment, segmentOffset, candidates)
    segmentOffset += segment.length + 1
  }
  const sorted = candidates
    .map(candidate => ({ ...candidate, from: basePosition + candidate.start, to: basePosition + candidate.end }))
    .sort((a, b) => b.confidence - a.confidence || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const selected = []
  for (const candidate of sorted) {
    let replaceIndex = -1
    let rejected = false
    for (let index = 0; index < selected.length; index += 1) {
      const preference = preferCandidate(candidate, selected[index])
      if (preference === null) continue
      if (!preference) { rejected = true; break }
      replaceIndex = index
      break
    }
    if (rejected) continue
    if (replaceIndex >= 0) selected.splice(replaceIndex, 1)
    selected.push(candidate)
  }
  selected.sort((a, b) => a.start - b.start)
  return {
    suggestions: selected.map((candidate, index) => ({ ...candidate, id: `${candidate.from}:${candidate.to}:${index}` })),
    truncated: completeText.length > MAX_BLOCK_LENGTH,
  }
}

function blockText(node) {
  let text = ''
  node.forEach(child => {
    if (child.isText) {
      const excluded = child.marks?.some(mark => ['code', 'link'].includes(mark.type.name))
      text += excluded ? BLOCK_SEPARATOR.repeat(child.text.length) : child.text
    } else {
      text += BLOCK_SEPARATOR.repeat(Math.max(1, child.nodeSize || 1))
    }
  })
  return text
}

export function scanMathDocument(doc) {
  if (!doc?.descendants) return { suggestions: [], scannedBlocks: 0, truncated: false }
  const suggestions = []
  let scannedBlocks = 0
  let truncated = false
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'codeBlock') return false
    scannedBlocks += 1
    if (scannedBlocks > MAX_BLOCKS) {
      truncated = true
      return false
    }
    const text = blockText(node)
    if (!potentialMathPattern.test(text)) return false
    const basePosition = position + 1
    const result = scanMathText(text, basePosition)
    if (result.truncated) truncated = true
    for (const item of result.suggestions) {
      const wholeBlock = item.start === text.search(/\S|$/) && item.end === text.trimEnd().length && text.trim() === item.source && node.type.name === 'paragraph'
      suggestions.push({
        ...item,
        blockFrom: position,
        blockTo: position + node.nodeSize,
        blockType: node.type.name,
        blockText: text,
        context: text.slice(Math.max(0, item.start - 48), Math.min(text.length, item.end + 48)).replaceAll(BLOCK_SEPARATOR, ' … '),
        blockEligible: wholeBlock && !text.includes(BLOCK_SEPARATOR),
        defaultType: wholeBlock ? 'block' : 'inline',
      })
      if (suggestions.length >= MAX_SUGGESTIONS) {
        truncated = true
        return false
      }
    }
    return false
  })
  return { suggestions, scannedBlocks: Math.min(scannedBlocks, MAX_BLOCKS), truncated }
}
