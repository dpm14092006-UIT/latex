import { bibliographyStyleName, citationKeys, citationLabel, citationNumbers, citationOccurrences, isAuthorYearStyle, parseBibtex, resolveCitationStyle, shortAuthors, stripLatex } from './Bibliography.js'
import { bareInlineFormula, normalizeFormulaInput, repairStrippedLatex, standaloneLatexPaste } from '../math-input.js'
import { sanitizeSettings } from './DocumentSettings.js'
import { base64ByteLength } from './ProjectAssets.js'

export const starter = { type: 'doc', content: [{ type: 'paragraph' }] }
export const builtInTemplates = [
  { id: 'example', name: 'Tập hợp có chỉ số', latex: 'X_t^{selected} = S_t^{(n)} \\cup E_t^{(k)}', type: 'block' },
  { id: 'fraction', name: 'Phân số', latex: '\\frac{a}{b}', type: 'inline' },
  { id: 'square-root', name: 'Căn bậc hai', latex: '\\sqrt{x}', type: 'inline' },
  { id: 'integral', name: 'Tích phân', latex: '\\int_0^1 f(x)\\,dx', type: 'block' },
]
export const defaultDocumentTemplate = String.raw`\documentclass[{{fontSize}}pt,{{paper}}]{article}
\usepackage[margin={{margin}}mm]{geometry}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}

% Core packages
\usepackage{amsmath,amssymb}
\linespread{{{lineSpacing}}}

% Paragraphs
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.5\baselineskip}

\title{{{title}}}
\author{{{author}}}
\date{{{date}}}

\begin{document}
\maketitle
{{abstract}}
{{toc}}

{{content}}

\end{document}`

const ieeeDocumentTemplate = String.raw`\documentclass[conference]{IEEEtran}
\usepackage{amsmath,amssymb}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}
\usepackage{graphicx}

\title{{{title}}}
\author{\IEEEauthorblockN{{{author}}}}

\begin{document}
\maketitle

{{abstract}}

\begin{IEEEkeywords}
% Add three to five keywords here.
\end{IEEEkeywords}

{{toc}}
{{content}}
\end{document}`

const researchReportTemplate = String.raw`\documentclass[12pt,a4paper]{report}
\usepackage[margin=25mm]{geometry}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}
\usepackage{amsmath,amssymb,graphicx,booktabs}
\usepackage{setspace}
\setstretch{1.25}
\usepackage[hidelinks]{hyperref}

\title{{{title}}}
\author{{{author}}}
\date{{{date}}}

\begin{document}
\maketitle
\pagenumbering{roman}
{{abstract}}
{{toc}}
\clearpage
\pagenumbering{arabic}
% Trình bày bối cảnh, câu hỏi nghiên cứu và đóng góp chính.
\chapter{Giới thiệu}

{{content}}
\end{document}`

const researchArticleTemplate = String.raw`\documentclass[12pt,a4paper]{article}
\usepackage[margin=25mm]{geometry}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}
\usepackage{amsmath,amssymb,graphicx,booktabs}
\usepackage{setspace}
\setstretch{1.15}
\usepackage[hidelinks]{hyperref}

\title{{{title}}}
\author{{{author}}}
\date{{{date}}}

\begin{document}
\maketitle
{{abstract}}
\noindent\textbf{Keywords:} % Thêm 3--6 từ khóa.

{{toc}}
% Nêu vấn đề, khoảng trống nghiên cứu và mục tiêu.
\section{Introduction}

{{content}}
\end{document}`

const ieeeJournalTemplate = String.raw`\documentclass[journal]{IEEEtran}
\usepackage{amsmath,amssymb,graphicx}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}

\title{{{title}}}
\author{{{author}}}

\begin{document}
\maketitle
{{abstract}}
\begin{IEEEkeywords}
% Thêm các từ khóa của bài báo.
\end{IEEEkeywords}

{{toc}}
{{content}}
\end{document}`

function starterDocument(headings) {
  return {
    type: 'doc',
    content: headings.flatMap(([level, title]) => [
      { type: 'heading', attrs: { level }, content: [{ type: 'text', text: title }] },
      { type: 'paragraph' },
    ]),
  }
}

export const builtInDocumentTemplates = [
  {
    id: 'ieee-conference', name: 'IEEE Conference', description: 'IEEEtran · hội nghị hai cột · dàn bài sẵn', builtIn: true, source: ieeeDocumentTemplate,
    starterDocument: starterDocument([
      [1, 'Introduction'], [1, 'Related Work'], [1, 'Methodology'],
      [2, 'Research Design'], [2, 'Data and Measures'], [1, 'Results'],
      [1, 'Discussion'], [1, 'Conclusion'],
    ]),
  },
  {
    id: 'research-report', name: 'Báo cáo nghiên cứu khoa học', description: 'Report · 6 chương, tóm tắt và mục lục', builtIn: true, source: researchReportTemplate,
    starterDocument: starterDocument([
      [1, 'Giới thiệu'], [2, 'Bối cảnh và vấn đề nghiên cứu'], [2, 'Mục tiêu và câu hỏi nghiên cứu'],
      [2, 'Phạm vi và đóng góp'], [1, 'Cơ sở lý thuyết và nghiên cứu liên quan'],
      [2, 'Khung lý thuyết'], [2, 'Các nghiên cứu trước'], [1, 'Phương pháp nghiên cứu'],
      [2, 'Thiết kế nghiên cứu'], [2, 'Dữ liệu và mẫu nghiên cứu'], [2, 'Biến số và phương pháp phân tích'],
      [1, 'Kết quả nghiên cứu'], [2, 'Thống kê mô tả'], [2, 'Kết quả chính'], [2, 'Kiểm định độ bền'],
      [1, 'Thảo luận'], [2, 'Đối chiếu với nghiên cứu trước'], [2, 'Hàm ý của kết quả'],
      [1, 'Kết luận và kiến nghị'], [2, 'Hạn chế và hướng nghiên cứu tiếp theo'],
    ]),
  },
  {
    id: 'research-article', name: 'Bài báo nghiên cứu quốc tế', description: 'Article · abstract, keywords và dàn bài tạp chí', builtIn: true, source: researchArticleTemplate,
    starterDocument: starterDocument([
      [1, 'Introduction'], [2, 'Research Background'], [2, 'Research Questions and Hypotheses'],
      [1, 'Literature Review'], [2, 'Theoretical Framework'], [2, 'Hypothesis Development'],
      [1, 'Methodology'], [2, 'Research Design'], [2, 'Data and Sample'], [2, 'Measures and Analysis'],
      [1, 'Results'], [2, 'Descriptive Statistics'], [2, 'Main Findings'],
      [1, 'Discussion'], [2, 'Theoretical and Practical Implications'],
      [1, 'Conclusion'], [2, 'Limitations and Future Research'],
    ]),
  },
  {
    id: 'ieee-journal', name: 'IEEE Journal', description: 'IEEEtran · bài tạp chí hai cột · dàn bài sẵn', builtIn: true, source: ieeeJournalTemplate,
    starterDocument: starterDocument([
      [1, 'Introduction'], [1, 'Related Work'], [1, 'Methodology'],
      [2, 'Problem Formulation'], [2, 'Proposed Approach'], [1, 'Experimental Setup'],
      [1, 'Results and Discussion'], [2, 'Comparison with Baselines'],
      [1, 'Conclusion and Future Work'],
    ]),
  },
]


export function textIn(node) {
  if (typeof node?.textContent === 'string') return node.textContent
  const content = Array.isArray(node?.content) ? node.content : []
  return content.map(child => child.type === 'text' ? child.text || '' : textIn(child)).join('')
}

function numberedHeading(text) {
  let match = /^(\d{1,3}(?:\.\d{1,3}){0,3}[.)]?)\s+(.+)$/u.exec(text)
  if (match) {
    const components = match[1].replace(/[.)]$/u, '').split('.')
    return {
      kind: 'numbered',
      automaticNumbering: !match[1].endsWith(')'),
      level: Math.min(3, components.length),
      depth: components.length,
      numbers: components.map(Number),
      title: match[2],
    }
  }

  match = /^(?:chapter|ch\.?|chương)\s+(\d{1,3})[.:)]?\s+(.+)$/iu.exec(text)
  if (match) return { kind: 'numbered', automaticNumbering: false, level: 1, depth: 1, title: match[2] }

  match = /^([IVXLCDM]{1,8}\.)\s+(.+)$/u.exec(text)
  if (match) return { kind: 'numbered', automaticNumbering: false, level: 1, depth: 1, title: match[2] }

  match = /^([A-Z]\.)\s+(.+)$/u.exec(text)
  if (match) return { kind: 'numbered', automaticNumbering: false, level: 2, depth: 2, title: match[2] }

  match = /^([a-z]\))\s+(.+)$/u.exec(text)
  if (match) return { kind: 'numbered', automaticNumbering: false, level: 3, depth: 3, title: match[2] }

  match = /^(\(\d{1,3}\))\s+(.+)$/u.exec(text)
  if (match) return { kind: 'numbered', automaticNumbering: false, level: 3, depth: 3, title: match[2] }
  return null
}

function inferredHeading(node) {
  if (!['paragraph', 'heading'].includes(node?.type)) return null
  const isExistingHeading = node.type === 'heading'
  const content = Array.isArray(node.content) ? node.content : []
  if (content.some(child => child.type !== 'text')) return null

  const rawText = content.map(child => child.text || '').join('')
  const text = rawText.trim()
  if (!text || !/\p{L}/u.test(text)) return null

  let inferred
  if (!isExistingHeading) {
    const markdown = /^(#{1,3})\s+(.+)$/u.exec(text)
    if (markdown) inferred = { kind: 'markdown', level: markdown[1].length, title: markdown[2] }
  }
  if (!inferred) inferred = numberedHeading(text)
  if (!inferred) return null

  const title = inferred.title.trim()
  // Plain paragraphs need an explicit, short heading label; existing heading nodes
  // already carry structural intent, so keep their casing and length unrestricted.
  if (!isExistingHeading) {
    if (text.length > 120 || /[.!?]$/u.test(text) || title.length > 110 || title.split(/\s+/u).length > 16) return null
    const firstLetter = title.match(/\p{L}/u)?.[0] || ''
    if (firstLetter !== firstLetter.toLocaleUpperCase()) return null
  }
  if (!title) return null

  const titleStartInRaw = rawText.indexOf(text) + text.indexOf(title)
  return {
    kind: inferred.kind,
    automaticNumbering: inferred.automaticNumbering,
    level: Math.min(3, Math.max(1, inferred.level)),
    depth: inferred.depth,
    numbers: inferred.numbers,
    prefixLength: titleStartInRaw,
  }
}

function withoutPrefix(content, prefixLength) {
  let remaining = prefixLength
  return (content || []).flatMap(child => {
    const text = child.text || ''
    if (!remaining || !text) return [child]
    if (remaining >= text.length) {
      remaining -= text.length
      return []
    }
    const result = { ...child, text: text.slice(remaining) }
    remaining = 0
    return result.text ? [result] : []
  })
}

export function normalizeHeadingNode(node) {
  const inferred = inferredHeading(node)
  if (!inferred) return node
  // Keep explicit numeric labels visible in the editor and outline. The LaTeX
  // serializer uses their values as LaTeX counters and removes the duplicated title prefix.
  const content = inferred.kind === 'markdown' ? withoutPrefix(node.content, inferred.prefixLength) : node.content
  const attrs = { ...(node.attrs || {}), level: inferred.level }
  if (node.type === 'heading') {
    return node.attrs?.level === inferred.level && content === node.content ? node : { ...node, attrs, content }
  }
  return { type: 'heading', attrs, content }
}

export function normalizeHeadingBlocks(node) {
  if (node?.type !== 'paragraph' || !Array.isArray(node.content)) return [normalizeHeadingNode(node)]
  const blocks = []
  let start = 0
  // Word and Shift+Enter can put a heading and its body in one paragraph.
  // Split only leading, explicitly labelled heading lines; retain the body,
  // inline nodes, marks and subsequent line breaks without interpreting prose.
  for (let index = 0; index < node.content.length; index += 1) {
    if (node.content[index].type !== 'hardBreak') continue
    const heading = normalizeHeadingNode({ ...node, content: node.content.slice(start, index) })
    if (heading.type !== 'heading') break
    blocks.push(heading)
    start = index + 1
  }
  if (!blocks.length) return [normalizeHeadingNode(node)]
  if (start < node.content.length) blocks.push(normalizeHeadingNode({ ...node, content: node.content.slice(start) }))
  return blocks
}

export function normalizeDocumentHeadings(doc, { skipIndex = -1 } = {}) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return doc
  let changed = false
  const content = doc.content.flatMap((node, index) => {
    if (index === skipIndex) return [node]
    const normalized = normalizeHeadingBlocks(node)
    if (normalized.length !== 1 || normalized[0] !== node) changed = true
    return normalized
  })
  return changed ? { ...doc, content } : doc
}

export function imageStats(doc) {
  let count = 0
  let storedBytes = 0

  const visit = node => {
    if (node?.type === 'imageBlock') {
      count += 1
      const src = String(node.attrs?.src || '')
      const separator = src.indexOf(',')
      if (separator >= 0) storedBytes += base64ByteLength(src.slice(separator + 1))
    }
    for (const child of node?.content || []) visit(child)
  }

  visit(doc)
  return { count, storedBytes }
}

export function looksLikeFormula(value = '') {
  return /\\[A-Za-z]+|[_^=+*/]|[∪∩≤≥≠→←⇒∈∉∞∫∑√]/.test(value)
}

export function normalizeInlineMath(content = []) {
  let changed = false
  const result = content.flatMap(child => {
    if (child.type !== 'text' || child.marks?.some(mark => mark.type === 'code')) return [child]
    const text = child.text || '', children = []
    const pattern = /\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$]+?)\$|(?<!\\)\(((?:[^()\n]|\([^()\n]*\))+)\)/g
    let cursor = 0, match
    while ((match = pattern.exec(text))) {
      const bare = match[3] !== undefined ? bareInlineFormula(match[3]) : null
      if (match[3] !== undefined && !bare) { pattern.lastIndex = match.index + 1; continue }
      if (match.index > cursor) children.push({ ...child, text: text.slice(cursor, match.index) })
      children.push({ type: 'inlineMath', attrs: { latex: normalizeFormulaInput(bare ? repairStrippedLatex(bare) : match[1] ?? match[2]) } })
      cursor = pattern.lastIndex; changed = true
    }
    if (!children.length) return [child]
    if (cursor < text.length) children.push({ ...child, text: text.slice(cursor) })
    return children
  })
  return changed ? result : content
}

// Chữ của đoạn, ngắt dòng mềm (Shift+Enter, <br> khi dán HTML) thành \n; null nếu đoạn có node khác hoặc code.
function paragraphText(node) {
  if (node?.type !== 'paragraph') return null
  let text = ''
  for (const child of node.content || []) {
    if (child.type === 'hardBreak') text += '\n'
    else if (child.type === 'text' && !child.marks?.some(mark => mark.type === 'code')) text += child.text || ''
    else return null
  }
  return text
}

// Dấu đóng của "[": ngoặc vuông cân bằng để \left[ … \right] và \sqrt[3] không kết thúc sớm.
function closingIndex(formula, marker) {
  if (marker[0] !== '[') return formula.indexOf(marker[1])
  let depth = 1
  for (let index = 0; index < formula.length; index++) {
    if (formula[index] === '[') depth++
    else if (formula[index] === ']' && --depth === 0) return index
  }
  return -1
}

function blockMathAt(blocks, start, bareFormulas) {
  const text = paragraphText(blocks[start])
  if (text === null) return null
  const trim = text.trim()
  const marker = trim.startsWith('\\[') ? ['\\[', '\\]'] : trim.startsWith('$$') ? ['$$', '$$'] : trim.startsWith('[') ? ['[', ']'] : null
  if (marker) {
    let formula = trim.slice(marker[0].length)
    let end = start
    let closeAt = closingIndex(formula, marker)
    while (closeAt < 0 && end + 1 < blocks.length) {
      const line = paragraphText(blocks[end + 1])
      if (line === null) break
      end++
      formula += `\n${line}`
      closeAt = closingIndex(formula, marker)
    }
    if (closeAt >= 0) {
      const trailing = formula.slice(closeAt + marker[1].length).trim()
      formula = formula.slice(0, closeAt)
      if (formula.trim() && (marker[0] !== '[' || looksLikeFormula(formula))) {
        const nodes = [{ type: 'blockMath', attrs: { latex: normalizeFormulaInput(marker[0] === '[' ? repairStrippedLatex(formula) : formula) } }]
        if (trailing) nodes.push({ type: 'paragraph', content: [{ type: 'text', text: trailing }] })
        return { start, end, nodes }
      }
    }
  }
  if (!bareFormulas) return null
  // A paragraph containing an explicit inline wrapper belongs in prose flow.
  // Without this guard, the bare-formula heuristic can mistake words around
  // `$x^2$` / `\(x^2\)` for a display formula and swallow the whole paragraph.
  if (/\\[()[\]]|\$/u.test(trim)) return null
  // Đoạn chỉ gồm LaTeX (thường là công thức dán mất dấu \[ \]), bỏ "[" / "]" lẻ ở đầu hoặc cuối.
  const bare = repairStrippedLatex(trim.replace(/^\[\s*\n/, '').replace(/\n\s*\]$/, ''))
  const parsed = standaloneLatexPaste(bare, normalizeFormulaInput)
  return parsed ? { start, end: start, nodes: [{ type: 'blockMath', attrs: { latex: parsed.latex } }] } : null
}

// Các đoạn cần thay bằng công thức: { start, end } là chỉ số khối con của doc, nodes là JSON thay thế.
// bareFormulas còn nhận đoạn chỉ có LaTeX không dấu bao — chỉ dùng khi dán hoặc mở tài liệu, không dùng khi đang gõ.
export function delimitedMathReplacements(blocks, { bareFormulas = false } = {}) {
  const replacements = []
  const bibliographyIndexes = bibliographyBlockIndexes(blocks)
  for (let index = 0; index < blocks.length; index++) {
    const node = blocks[index]
    if (bibliographyIndexes.has(index)) continue
    if (node?.type !== 'paragraph' || isReferenceLikeParagraph(node)) continue
    const block = blockMathAt(blocks, index, bareFormulas)
    if (block) {
      replacements.push(block)
      index = block.end
      continue
    }
    const original = node.content || []
    const content = normalizeInlineMath(original)
    if (content !== original) replacements.push({ start: index, end: index, nodes: [{ ...node, content }] })
  }
  return replacements
}

function bibliographyBlockIndexes(blocks) {
  const indexes = new Set()
  let referenceLevel = null
  for (let index = 0; index < blocks.length; index++) {
    const node = blocks[index]
    if (node?.type === 'heading') {
      if (isBibliographyHeadingNode(node)) referenceLevel = Number(node.attrs?.level) || 1
      else if (referenceLevel !== null && (Number(node.attrs?.level) || 1) <= referenceLevel) referenceLevel = null
    }
    if (referenceLevel !== null) indexes.add(index)
  }
  return indexes
}

function plainBibliographyText(latex) {
  return stripLatex(String(latex || '')
    .replace(/\\\\/gu, ' ')
    .replace(/\\(?:textit|textbf|textsc|textrm|emph|mathrm|url|nolinkurl)\s*\{([^{}]*)\}/gu, '$1')
    .replace(/\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}/gu, '$1'))
    .replace(/\s+/gu, ' ')
    .trim()
}

function plainNodeText(node) {
  if (node?.type === 'text') return node.text || ''
  if (node?.type === 'hardBreak') return ' '
  if (node?.type === 'inlineMath') return String(node.attrs?.latex || '')
  return (node?.content || []).map(plainNodeText).join('')
}

function isReferenceLikeParagraph(node) {
  if (node?.type !== 'paragraph') return false
  const plain = plainBibliographyText(plainNodeText(node))
  if (plain.length < 40 || plain.length > 4000) return false
  const year = /\((?:18|19|20)\d{2}[a-z]?\)\./iu.exec(plain)
  if (!year) return false
  const author = plain.slice(0, year.index).trim()
  const remaining = plain.slice(year.index + year[0].length).trim()
  const hasSourceDetails = /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi\s*:\s*10\.|\b\d{1,3}\s*\(\d{1,3}\)\s*,?\s*\d{1,4}\s*[–-])/iu.test(remaining)
  return author.length >= 3 && author.length <= 300 && /[,;]/u.test(author) && remaining.length >= 20 && hasSourceDetails
}

function isReferenceLikeMath(node) {
  const latex = String(node?.attrs?.latex || '')
  if (!latex || /\\(?:frac|sqrt|sum|int|prod|lim|begin|end|left|right|alpha|beta|gamma|Delta|mathbf|boldsymbol|infty|times|cdot|overline|underline)\b/u.test(latex)) return false
  const plain = plainBibliographyText(latex)
  if (plain.length < 24 || plain.length > 4000) return false
  const year = /\((?:18|19|20)\d{2}[a-z]?\)/iu.exec(plain)
  if (!year) return false
  const author = plain.slice(0, year.index).trim()
  const remaining = plain.slice(year.index + year[0].length).trim()
  return author.length >= 3 && author.length <= 300 && /[,;]/u.test(author) && remaining.length >= 12
}

function referenceParagraphFromMath(node, neighbor) {
  const text = plainBibliographyText(node.attrs.latex)
  const textStyle = neighbor?.content?.flatMap(child => child.marks || []).find(mark => mark.type === 'textStyle')
  const marks = textStyle ? [textStyle] : []
  const doi = /https?:\/\/(?:dx\.)?doi\.org\/\S+/iu.exec(text)
  const content = []
  const addText = value => { if (value) content.push({ type: 'text', text: value, ...(marks.length ? { marks } : {}) }) }
  if (!doi) addText(text)
  else {
    addText(text.slice(0, doi.index))
    content.push({ type: 'text', text: doi[0], marks: [...marks, { type: 'link', attrs: { href: doi[0], target: '_blank', rel: 'noopener noreferrer nofollow' } }, { type: 'underline' }] })
    addText(text.slice(doi.index + doi[0].length))
  }
  return { type: 'paragraph', attrs: { textAlign: null }, content }
}

function normalizeBibliographyMathNodes(doc) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return doc
  const bibliographyIndexes = bibliographyBlockIndexes(doc.content)
  let content = doc.content
  for (const index of bibliographyIndexes) {
    const node = content[index]
    if (node?.type !== 'blockMath' || !isReferenceLikeMath(node)) continue
    if (content === doc.content) content = [...doc.content]
    content[index] = referenceParagraphFromMath(node, doc.content[index - 1]?.type === 'paragraph' ? doc.content[index - 1] : doc.content[index + 1])
  }
  for (let index = 1; index < doc.content.length - 1; index++) {
    const node = doc.content[index]
    if (bibliographyIndexes.has(index) || node?.type !== 'blockMath' || !isReferenceLikeMath(node)) continue
    if (!isReferenceLikeParagraph(doc.content[index - 1]) || !isReferenceLikeParagraph(doc.content[index + 1])) continue
    if (content === doc.content) content = [...doc.content]
    content[index] = referenceParagraphFromMath(node, doc.content[index - 1])
  }
  return content === doc.content ? doc : { ...doc, content }
}

export function normalizeDocumentDelimiters(doc) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return starter
  const replacements = delimitedMathReplacements(doc.content, { bareFormulas: true })
  if (!replacements.length) return normalizeBibliographyMathNodes(doc)
  const content = [...doc.content]
  for (const { start, end, nodes } of replacements.reverse()) content.splice(start, end - start + 1, ...nodes)
  // Repair references last so the bare-formula recognizer cannot turn the
  // recovered prose back into a math node during this same load.
  return normalizeBibliographyMathNodes({ ...doc, content })
}

const latexEscapes = { '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&', _: '\\_', '{': '\\{', '}': '\\}' }
function latexEscape(value = '') {
  return String(value ?? '').replace(/[\\^~#$%&_{}]/g, character => latexEscapes[character])
}
const highlightDefinition = String.raw`\providecommand{\vietlatexhl}[2]{{\setlength{\fboxsep}{0.5pt}\colorbox[HTML]{#1}{\strut #2}}}`
function latexHexColor(value) { return /^#[0-9a-f]{6}$/i.test(value || '') ? value.slice(1).toUpperCase() : '' }
function latexFontSize(value) {
  const size = /^(\d{1,2})pt$/.exec(value || '')?.[1]
  return size && Number(size) >= 6 && Number(size) <= 72 ? Number(size) : 0
}
function safeLabel(value) { return String(value || '').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 100) }
function underlinedBreakableUrl(value) {
  const segments = String(value || '').split(/(?<=[/._:-])/u).filter(Boolean)
  return segments.map((segment, index) => `\\underline{\\nolinkurl{${segment}}}${index < segments.length - 1 ? '\\allowbreak' : ''}`).join('')
}
const strikethroughDefinition = String.raw`\providecommand{\vietlatexstrike}[1]{%
  \begingroup
  \settowidth{\dimen0}{#1}%
  \rlap{\raisebox{.45ex}{\rule{\dimen0}{.4pt}}}#1%
  \endgroup
}`

function tableCellText(node) {
  if (node?.type === 'text') return node.text || ''
  if (node?.type === 'inlineMath' || node?.type === 'blockMath') return String(node.attrs?.latex || '')
  return (node?.content || []).map(tableCellText).join(' ')
}

function renderLatexTable(node, context) {
  const sourceRows = Array.isArray(node.content) ? node.content : []
  const occupiedUntil = []
  let columns = 0
  const rows = sourceRows.map((row, rowIndex) => {
    let column = 0
    const cells = []
    for (const cell of row.content || []) {
      const colspan = Math.max(1, Math.min(20, Number(cell.attrs?.colspan) || 1))
      const rowspan = Math.max(1, Math.min(100, Number(cell.attrs?.rowspan) || 1))
      while (true) {
        while ((occupiedUntil[column] || 0) > rowIndex) column += 1
        const overlaps = Array.from({ length: colspan }, (_, offset) => (occupiedUntil[column + offset] || 0) > rowIndex).some(Boolean)
        if (!overlaps) break
        column += 1
      }
      cells.push({ cell, column, colspan, rowspan })
      for (let offset = 0; offset < colspan; offset += 1) {
        occupiedUntil[column + offset] = Math.max(occupiedUntil[column + offset] || 0, rowIndex + rowspan)
      }
      column += colspan
      columns = Math.max(columns, column)
    }
    return cells
  })
  columns = Math.max(1, columns)

  let headerRows = 0
  for (const row of rows) {
    if (!row.some(({ cell }) => cell.type === 'tableHeader')) break
    headerRows += 1
  }

  const lengths = Array(columns).fill(4)
  const headerLabels = Array(columns).fill('')
  for (const row of rows.slice(0, headerRows)) {
    for (const { cell, column } of row) if (!headerLabels[column]) headerLabels[column] = tableCellText(cell).replace(/\s+/gu, ' ').trim()
  }
  for (const row of rows) {
    for (const { cell, column, colspan } of row) {
      const length = Math.max(4, Math.min(48, tableCellText(cell).replace(/\s+/gu, ' ').trim().length)) / colspan
      for (let offset = 0; offset < colspan; offset += 1) lengths[column + offset] = Math.max(lengths[column + offset], length)
    }
  }
  const weights = lengths.map(length => Math.sqrt(length))
  // Reserve the inter-column padding explicitly so the real table width stays
  // inside the text block instead of growing past the page margins.
  const tableWidth = Math.max(0.68, 0.98 - 0.025 * (columns - 1))
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const widths = weights.map(weight => tableWidth * weight / weightTotal)

  const valuesByColumn = Array.from({ length: columns }, () => [])
  for (const row of rows.slice(headerRows)) {
    for (const { cell, column, colspan } of row) {
      if (colspan !== 1) continue
      const value = tableCellText(cell).trim()
      if (value) valuesByColumn[column].push(value)
    }
  }
  const alignments = valuesByColumn.map((values, column) => {
    if (/^\(?\s*n\s*,\s*k\s*\)?$/iu.test(headerLabels[column])) return 'left'
    if (values.length && values.every(value => /^[+−-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+−-]?\d+)?\s*%?$/u.test(value))) return 'right'
    return 'left'
  })
  const columnSpec = widths.map((width, index) => lengths[index] <= 28
    ? alignments[index] === 'right' ? 'r' : alignments[index] === 'center' ? 'c' : 'l'
    : `>{${alignments[index] === 'right' ? '\\raggedleft' : '\\raggedright'}\\arraybackslash}p{${width.toFixed(4)}\\linewidth}`
  ).join('')
  const specification = `@{}${columnSpec}@{}`
  let spanEnd = 0
  const spanContinues = rows.map((row, index) => {
    for (const item of row) spanEnd = Math.max(spanEnd, index + item.rowspan)
    return spanEnd > index + 1
  })
  // Repeated headers must include an entire merged group.
  while (headerRows > 0 && headerRows < rows.length && spanContinues[headerRows - 1]) headerRows++
  const renderRow = (row, rowIndex) => {
    const cellsByColumn = new Map(row.map(item => [item.column, item]))
    const values = []
    for (let column = 0; column < columns;) {
      const item = cellsByColumn.get(column)
      if (!item) {
        values.push('')
        column += 1
        continue
      }
      let value = nodeLatex(item.cell, { ...context, inTable: true }).trim().replace(/\\par\s*$/u, '')
      if (item.rowspan > 1) value = `\\multirow{${item.rowspan}}{*}{${value}}`
      if (item.colspan > 1) {
        const width = widths.slice(column, column + item.colspan).reduce((sum, part) => sum + part, 0)
        const alignment = alignments[column] === 'right' ? '\\raggedleft' : alignments[column] === 'center' ? '\\centering' : '\\raggedright'
        value = `\\multicolumn{${item.colspan}}{>{${alignment}\\arraybackslash}p{${width.toFixed(4)}\\linewidth}}{${value}}`
      }
      values.push(value)
      column += item.colspan
    }
    // A page break inside a multirow would detach the continuation cells.
    return `${values.join(' & ')} \\\\${spanContinues[rowIndex] ? '*' : ''}\n`
  }
  const header = rows.slice(0, headerRows).map(renderRow).join('')
  const body = rows.slice(headerRows).map((row, index) => renderRow(row, index + headerRows)).join('')
  const tableStyle = String.raw`\begingroup
\small
\setlength{\tabcolsep}{4pt}
\renewcommand{\arraystretch}{1.2}
\setlength{\extrarowheight}{1pt}
\setlength{\parskip}{0pt}
\setlength{\parindent}{0pt}
`

  const tableNumber = context.inTable ? 0 : (context.tableIndex = (context.tableIndex || 0) + 1)
  const tabular = `${tableStyle}\\begin{tabular}{${specification}}\n\\toprule\n${header}${headerRows ? '\\midrule\n' : ''}${body}\\bottomrule\n\\end{tabular}\n\\endgroup`
  if (context.inTable) return `${tabular}\n`

  const caption = String(node.attrs?.caption || '').trim() || `Bảng ${tableNumber}`
  const requestedLabel = safeLabel(node.attrs?.label) || `tab:table-${tableNumber}`
  context.tableLabels ||= new Set()
  let label = requestedLabel
  let duplicate = 2
  while (context.tableLabels.has(label)) label = `${requestedLabel.slice(0, 94)}-${duplicate++}`
  context.tableLabels.add(label)
  const estimatedLines = rows.reduce((total, row) => total + Math.max(1, ...row.map(({ cell, column, colspan }) => Math.ceil(tableCellText(cell).length / Math.max(8, widths.slice(column, column + colspan).reduce((sum, width) => sum + width, 0) * 80)))), 0)
  const fullWidth = context.twoColumn && (rows.length > 24 || estimatedLines > 40)
  if (!context.twoColumn || fullWidth) {
    const heading = `\\toprule\n${header}${headerRows ? '\\midrule\n' : ''}`
    return `${fullWidth ? '\\onecolumn\n' : ''}${tableStyle}\\begin{longtable}{${specification}}\n\\caption{${latexEscape(caption)}}\\label{${label}} \\\\\n${heading}\\endfirsthead\n${heading}\\endhead\n\\bottomrule\n\\endfoot\n\\bottomrule\n\\endlastfoot\n${body}\\end{longtable}\n\\endgroup\n${fullWidth ? '\\twocolumn\n' : ''}\n`
  }
  return `\\begin{table}[htbp]\n\\centering\n\\caption{${latexEscape(caption)}}\n\\label{${label}}\n${tabular}\n\\end{table}\n\n`
}

function nodeLatex(node, context = { images: [] }) {
  if (!node) return ''

  if (node.type === 'text') {
    const marks = node.marks || []
    const bareUrlMark = marks.find(mark => mark.type === 'link' && /^https?:/i.test(mark.attrs?.href || '') && String(node.text || '').trim() === mark.attrs.href)
    const underlinedBareUrl = bareUrlMark && marks.some(mark => mark.type === 'underline')
    const rawBareUrl = bareUrlMark ? String(bareUrlMark.attrs.href).replace(/[\\{}\r\n]/g, '') : ''
    let text = bareUrlMark
      ? `${latexEscape(node.text.match(/^\s*/u)[0])}${underlinedBareUrl ? underlinedBreakableUrl(rawBareUrl) : `\\nolinkurl{${rawBareUrl}}`}${latexEscape(node.text.match(/\s*$/u)[0])}`
      : latexEscape(node.text)
    // Highlight wraps each word so the colored boxes can still break lines.
    const highlight = marks.find(mark => mark.type === 'highlight')
    if (highlight) {
      const color = latexHexColor(highlight.attrs?.color) || 'FFF59D'
      text = text.split(/( +)/).map(part => part.trim() ? String.raw`\vietlatexhl{${color}}{${part}}` : part).join('')
    }
    for (const mark of marks) {
      if (mark.type === 'underline' && bareUrlMark) continue
      if (mark.type === 'bold') text = String.raw`\textbf{${text}}`
      else if (mark.type === 'italic') text = String.raw`\textit{${text}}`
      else if (mark.type === 'strike') text = String.raw`\vietlatexstrike{${text}}`
      else if (mark.type === 'code') text = String.raw`\texttt{${text}}`
      else if (mark.type === 'underline') text = String.raw`\underline{${text}}`
      else if (mark.type === 'superscript') text = String.raw`\textsuperscript{${text}}`
      else if (mark.type === 'subscript') text = String.raw`\textsubscript{${text}}`
      else if (mark.type === 'textStyle') {
        const color = latexHexColor(mark.attrs?.color)
        if (color) text = String.raw`\textcolor[HTML]{${color}}{${text}}`
        const size = latexFontSize(mark.attrs?.fontSize)
        if (size) text = String.raw`{\fontsize{${size}pt}{${(size * 1.2).toFixed(1)}pt}\selectfont ${text}}`
      }
      else if (mark.type === 'link' && /^(https?:|mailto:)/i.test(mark.attrs?.href || '')) {
        const rawHref = String(mark.attrs.href).replace(/[\\{}\r\n]/g, '')
        const href = rawHref.replace(/[%#&_$]/g, character => `\\${character}`)
        text = `\\href{${href}}{${text}}`
      }
    }
    return text
  }

  if (node.type === 'inlineMath') return String(node.attrs?.latex || '').trim() ? `$${node.attrs.latex}$` : ''
  if (node.type === 'blockMath') {
    const latex = String(node.attrs?.latex || '').replace(/\r?\n(?:[\t ]*\r?\n)+/g, '\n').trim()
    if (!latex) return ''
    const label = safeLabel(node.attrs?.label)
    if (context.settings?.numberedEquations || label) return `\\begin{equation}${label ? `\\label{${label}}` : ''}\n${latex}\n\\end{equation}\n`
    return `\\[\n${latex}\n\\]`
  }
  if (node.type === 'citation') {
    const keys = citationKeys(node.attrs?.key)
    if (keys.length && keys.every(key => context.manualCitationKeys?.has(key))) {
      const label = citationLabel(keys, context.citationNumbers, context.bibliographyByKey, context.citationStyle, node.attrs?.mode)
      const target = keys.length === 1 ? context.manualReferenceTargetsByKey?.get(keys[0]) : ''
      return target ? `\\hyperlink{${target}}{${latexEscape(label)}}` : latexEscape(label)
    }
    if (!keys.length) return ''
    if (node.attrs?.mode === 'narrative') {
      if (isAuthorYearStyle(context.citationStyle)) return `\\citet{${keys.join(',')}}`
      return keys.map(key => `${latexEscape(shortAuthors(context.bibliographyByKey?.get(key), 'and') || key)} \\cite{${key}}`).join('; ')
    }
    return `${isAuthorYearStyle(context.citationStyle) ? '\\citep' : '\\cite'}{${keys.join(',')}}`
  }
  if (node.type === 'crossReference') return `\\ref{${safeLabel(node.attrs?.target)}}`
  if (node.type === 'footnote') return `\\footnote{${latexEscape(node.attrs?.text || '')}}`
  if (node.type === 'codeBlock') return `\\begin{quote}\\ttfamily\\raggedright\n${textIn(node).split('\n').map(line => `\\mbox{${latexEscape(line).replace(/ /g, '\\ ').replace(/\t/g, '\\ \\ \\ \\ ')}}\\par`).join('\n')}\n\\end{quote}\n`

  if (node.type === 'imageBlock') {
    const match = String(node.attrs?.src || '').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return ''

    const extension = match[1] === 'png' ? 'png' : 'jpg'
    const filename = `image-${context.images.length + 1}.${extension}`
    context.images.push({ filename, data: match[2] })
    const graphic = String.raw`\includegraphics[width=0.9\linewidth,keepaspectratio]{${filename}}`
    return context.inTable ? graphic : String.raw`\begin{center}
${graphic}
\end{center}

`
  }

  const children = Array.isArray(node.content) ? node.content : []
  const inner = ['bulletList', 'orderedList', 'table', 'heading'].includes(node.type)
    ? ''
    : children.map(child => nodeLatex(child, context)).join('')

  switch (node.type) {
    case 'paragraph':
    {
      const alignment = { left: '\\raggedright', center: '\\centering', right: '\\raggedleft' }[node.attrs?.textAlign]
      return context.inTable ? `${inner}\\par ` : alignment ? `{${alignment}\n${inner}\\par}\n` : `${inner}\n\n`
    }
    case 'heading': {
      const commands = context.chaptered
        ? { 1: 'chapter', 2: 'section', 3: 'subsection' }
        : { 1: 'section', 2: 'subsection', 3: 'subsubsection' }
      const inferred = inferredHeading(node)
      const isBibliographyHeading = isBibliographyHeadingNode(node)
      const keepLiteralNumber = inferred?.kind === 'numbered'
        && (!inferred.automaticNumbering || inferred.depth > 3 || isBibliographyHeading)
      const baseCommand = commands[node.attrs?.level] || 'paragraph'
      const command = isBibliographyHeading || keepLiteralNumber
        ? `${isBibliographyHeading ? (context.chaptered ? 'chapter' : 'section') : baseCommand}*`
        : baseCommand
      const headingContent = inferred?.kind === 'numbered' && !keepLiteralNumber
        ? withoutPrefix(children, inferred.prefixLength)
        : children
      const headingText = headingContent.map(child => nodeLatex(child, { ...context, inHeading: true })).join('')
      // An isolated tab may start at 3.1.1 without containing its parent headings.
      // Seed every explicit counter, then let the heading command advance its own.
      const counters = inferred?.numbers && !keepLiteralNumber && !isBibliographyHeading
        ? inferred.numbers.map((number, index) => `\\setcounter{${commands[index + 1]}}{${number - (index === inferred.numbers.length - 1 ? 1 : 0)}}\n`).join('')
        : ''
      const tocEntry = keepLiteralNumber ? `\\addcontentsline{toc}{${baseCommand}}{${headingText}}` : ''
      return counters + '\\' + command + `{${headingText}}${tocEntry}${safeLabel(node.attrs?.label) ? `\\label{${safeLabel(node.attrs.label)}}` : ''}\n\n`
    }
    case 'bulletList':
      return String.raw`\begin{itemize}
${children.map(child => nodeLatex(child, context)).join('')}\end{itemize}
`
    case 'orderedList':
      return String.raw`\begin{enumerate}
${node.attrs?.start > 1 ? `\\setcounter{enumi}{${Math.min(9999, Math.floor(node.attrs.start) - 1)}}\n` : ''}${children.map(child => nodeLatex(child, context)).join('')}\end{enumerate}
`
    case 'listItem':
      return String.raw`\item\relax ` + inner
    case 'blockquote':
      return String.raw`\begin{quote}
${inner}\end{quote}
`
    case 'table': {
      return renderLatexTable(node, context)
    }
    case 'tableHeader':
      return String.raw`\textbf{${inner.trim().replace(/\\par\s*$/, '')}}`
    case 'tableCell':
      return inner
    case 'hardBreak':
      return context.inHeading ? ' ' : String.raw`\leavevmode\newline ` + '\n'
    case 'pageBreak':
      return context.inTable ? '' : String.raw`\newpage` + '\n\n'
    case 'horizontalRule':
      return String.raw`\hrule` + '\n'
    default:
      return inner
  }
}

function isBibliographyHeadingNode(node) {
  const normalized = textIn(node)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/^(?:chapter|section)\s+\d+(?:\.\d+)*\.?\s+/u, '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(?:references?|reference list|list of references|bibliography|bibliographies|works cited|literature cited|tai lieu tham khao|danh muc tai lieu tham khao|thu muc tai lieu tham khao)$/u.test(normalized)
}

function normalizeReferenceMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/https?:\/\/(?:dx\.)?doi\.org\//g, '')
    .replace(/^doi\s*:\s*/u, '')
    .replace(/[^a-z0-9]/g, '')
}

function manualBibliographyParagraphs(doc) {
  const matches = []
  let inBibliography = false
  for (const [index, node] of (doc?.content || []).entries()) {
    if (node.type === 'heading') {
      inBibliography = isBibliographyHeadingNode(node)
      continue
    }
    if (inBibliography && node.type === 'paragraph') {
      const text = textIn(node).trim()
      if (text) matches.push({ index, text })
    }
  }
  return matches
}

function bibliographyEntryMatchesManualText(entry, text) {
  const fields = entry?.fields || {}
  const manualText = normalizeReferenceMatch(text)
  const doi = normalizeReferenceMatch(fields.doi || fields.url || '')
  if (doi && manualText.includes(doi)) return true

  const title = normalizeReferenceMatch(stripLatex(fields.title || fields.booktitle || ''))
  const year = normalizeReferenceMatch(fields.year || fields.date || '').slice(0, 4)
  return title.length >= 12 && manualText.includes(title) && (!year || manualText.includes(year))
}
function ensureLatexPackage(latex, packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const packagePattern = new RegExp(`\\\\(?:usepackage|RequirePackage)(?:\\[[^\\]]*\\])?\\{[^}]*\\b${escapedName}\\b[^}]*\\}`, 'i')
  if (packagePattern.test(latex)) return latex

  const directive = `\\usepackage{${packageName}}\n`
  const documentStart = /\\begin\{document\}/i
  if (documentStart.test(latex)) return latex.replace(documentStart, `${directive}\\begin{document}`)

  const documentClass = /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/i.exec(latex)
  if (!documentClass) return `${directive}${latex}`
  const insertAt = documentClass.index + documentClass[0].length
  return `${latex.slice(0, insertAt)}\n${directive.trimEnd()}${latex.slice(insertAt)}`
}

// Numeric styles get sorted, compressed ranges ([1–3]); author–year styles need their own citation package.
// Templates that already load a citation system are left alone to avoid package clashes.
function ensureCitationPackages(latex, style) {
  if (/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:natbib|biblatex|apacite|cite)\b[^}]*\}/.test(latex)) return ensureLatexPackage(latex, 'hyperref')
  const directive = style === 'apa' ? '\\usepackage{csquotes}\n\\usepackage[backend=biber,style=apa,natbib=true]{biblatex}\n\\addbibresource{references.bib}' : style === 'authoryear' ? '\\usepackage[round]{natbib}' : '\\usepackage{cite}'
  // hyperref must load after cite/natbib/apacite.
  const hyperref = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bhyperref\b/.exec(latex)
  if (hyperref) return `${latex.slice(0, hyperref.index)}${directive}\n${latex.slice(hyperref.index)}`
  return ensureLatexPackage(latex.replace(/\\begin\{document\}/i, () => `${directive}\n\\begin{document}`), 'hyperref')
}

function ensureLatexDefinition(latex, command, definition) {
  const commandPattern = new RegExp(`\\\\(?:providecommand|newcommand)\\*?\\{\\\\${command}\\}`)
  if (commandPattern.test(latex)) return latex

  const documentStart = /\\begin\{document\}/i
  const match = documentStart.exec(latex)
  if (match) return `${latex.slice(0, match.index)}${definition}\n${latex.slice(match.index)}`

  const documentClass = /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/i.exec(latex)
  if (!documentClass) return `${definition}\n${latex}`
  const insertAt = documentClass.index + documentClass[0].length
  return `${latex.slice(0, insertAt)}\n${definition}${latex.slice(insertAt)}`
}

const editorImageStart = '%<vietlatex:editor-image:start>'
const editorImageEnd = '%<vietlatex:editor-image:end>'
const legacyEditorImagesStart = '%<vietlatex:editor-images:start>'
const legacyEditorImagesEnd = '%<vietlatex:editor-images:end>'
const validImageData = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/u
const blockNodeTypes = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'tableCell', 'tableHeader'])

function collectImageTextSegments(node, segments) {
  if (!node) return
  if (node.type === 'imageBlock') {
    if (validImageData.test(String(node.attrs?.src || ''))) segments.push({ type: 'image' })
    return
  }
  if (node.type === 'text') {
    segments.push({ type: 'text', value: node.text || '' })
    return
  }

  const isBlock = blockNodeTypes.has(node.type)
  if (isBlock) segments.push({ type: 'text', value: ' ' })
  for (const child of node.content || []) collectImageTextSegments(child, segments)
  if (isBlock) segments.push({ type: 'text', value: ' ' })
}

function editorImageAnchors(doc) {
  const segments = []
  collectImageTextSegments(doc, segments)
  return segments.flatMap((segment, index) => {
    if (segment.type !== 'image') return []
    const textAround = (parts, limit, reverse = false) => {
      const value = parts.map(part => part.type === 'text' ? part.value : ' ').join('')
      return reverse ? value.slice(-limit) : value.slice(0, limit)
    }
    return [{
      beforeText: textAround(segments.slice(0, index), 500, true),
      afterText: textAround(segments.slice(index + 1), 500),
    }]
  })
}

function skipLatexGroup(source, index, opening = '{', closing = '}') {
  while (/\s/u.test(source[index] || '')) index++
  if (source[index] !== opening) return index
  let depth = 0
  for (; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue }
    if (source[index] === opening) depth++
    else if (source[index] === closing && --depth === 0) return index + 1
  }
  return index
}

const latexCommandsWithoutVisibleArguments = new Set([
  'begin', 'end', 'usepackage', 'RequirePackage', 'documentclass', 'title', 'author', 'date',
  'includegraphics', 'graphicspath', 'label', 'ref', 'pageref', 'cite', 'citep', 'citet',
  'bibliography', 'bibliographystyle', 'addbibresource', 'printbibliography', 'input', 'include', 'setlength', 'addtolength',
  'vspace', 'vspace*', 'hspace', 'hspace*', 'raisebox', 'rule', 'color', 'textcolor',
  'url', 'geometry', 'fontsize', 'selectlanguage',
])

function latexVisibleTokens(source) {
  const chars = []
  const offsets = []
  const append = (value, offset) => {
    for (let index = 0; index < value.length; index++) {
      chars.push(value[index])
      offsets.push(offset + index)
    }
  }

  for (let index = 0; index < source.length;) {
    const char = source[index]
    if (char === '%') {
      while (index < source.length && source[index] !== '\n') index++
      append(' ', index)
      continue
    }
    if (char === '\\') {
      const next = source[index + 1] || ''
      if (next === '\\') {
        append(' ', index)
        index += 2
        continue
      }
      if (/[A-Za-z@]/u.test(next)) {
        const commandMatch = /^[A-Za-z@]+/u.exec(source.slice(index + 1))
        const command = commandMatch?.[0] || ''
        index += command.length + 1
        if (['par', 'newline', 'linebreak', 'item'].includes(command)) append(' ', index)
        if (command === 'href') {
          index = skipLatexGroup(source, index)
          append(' ', index)
          continue
        }
        if (latexCommandsWithoutVisibleArguments.has(command)) {
          index = skipLatexGroup(source, index, '[', ']')
          index = skipLatexGroup(source, index)
          append(' ', index)
        }
        continue
      }
      if ('#$%&_{}'.includes(next)) append(next, index + 1)
      else append(' ', index)
      index += 2
      continue
    }
    if (char === '{' || char === '}') { index++; continue }
    if (char === '$') { append(' ', index); index++; continue }
    if (char === '~') { append(' ', index); index++; continue }
    append(char, index)
    index++
  }

  const text = chars.join('')
  const tokens = []
  for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
    const start = match.index
    const end = start + match[0].length
    tokens.push({
      value: normalizeAnchorWord(match[0]),
      start: offsets[start],
      end: offsets[end - 1] + 1,
    })
  }
  return tokens
}

function normalizeAnchorWord(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/gu, 'd').toLocaleLowerCase('vi')
}

function anchorWords(value) {
  return [...String(value || '').matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
    .map(match => normalizeAnchorWord(match[0]))
}

function findAnchorToken(tokens, words, side, afterToken = -1) {
  if (!words.length) return null
  const minimum = words.length >= 4 ? 4 : words.length
  for (let length = Math.min(10, words.length); length >= minimum; length--) {
    const sequence = side === 'before' ? words.slice(-length) : words.slice(0, length)
    const matches = []
    for (let start = 0; start <= tokens.length - sequence.length; start++) {
      if (start <= afterToken) continue
      if (sequence.every((word, offset) => tokens[start + offset].value === word)) {
        matches.push({ start, end: start + sequence.length - 1 })
      }
    }
    if (matches.length) return side === 'before' ? matches.at(-1) : matches[0]
  }
  return null
}

function findParagraphBoundary(source, start, end) {
  const gap = source.slice(start, end)
  const candidates = [
    { pattern: /\\end\s*\{\s*(?:quote|itemize|enumerate|center|table|figure|abstract)\s*\}/giu, place: 'after' },
    { pattern: /\r?\n[\t ]*\r?\n|\\par\b/giu, place: 'before' },
    { pattern: /\\begin\s*\{\s*(?:quote|itemize|enumerate|center|table|figure|abstract)\s*\}|\\(?:chapter|section|subsection|subsubsection|paragraph)\*?(?=\s*\{)/giu, place: 'before' },
  ]
  const matches = candidates.flatMap(candidate => {
    const match = candidate.pattern.exec(gap)
    return match ? [{ index: match.index + (candidate.place === 'after' ? match[0].length : 0) }] : []
  }).sort((left, right) => left.index - right.index)
  return matches.length ? start + matches[0].index : null
}

function findImageInsertionPoint(source, anchor) {
  const beforeWords = anchorWords(anchor?.beforeText)
  const afterWords = anchorWords(anchor?.afterText)
  if (!beforeWords.length && !afterWords.length) {
    const title = [...source.matchAll(/\\maketitle\b/giu)].at(-1)
    if (title) return title.index + title[0].length
    const begin = /\\begin\s*\{\s*document\s*\}/iu.exec(source)
    return begin ? begin.index + begin[0].length : null
  }

  const tokens = latexVisibleTokens(source)
  const before = findAnchorToken(tokens, beforeWords, 'before')
  const after = findAnchorToken(tokens, afterWords, 'after', before?.end ?? -1)
  const beforeEnd = before ? tokens[before.end].end : null
  const afterStart = after ? tokens[after.start].start : null

  if (beforeEnd !== null && afterStart !== null && beforeEnd < afterStart) {
    return findParagraphBoundary(source, beforeEnd, afterStart)
  }
  if (beforeEnd !== null) {
    const documentEnd = /\\end\s*\{\s*document\s*\}/giu.exec(source.slice(beforeEnd))
    const end = documentEnd ? beforeEnd + documentEnd.index : source.length
    return findParagraphBoundary(source, beforeEnd, end) ?? end
  }
  if (afterStart !== null) {
    const prefix = source.slice(0, afterStart)
    const separators = [...prefix.matchAll(/\r?\n[\t ]*\r?\n|\\par\b|\\(?:chapter|section|subsection|subsubsection|paragraph)\*?(?=\s*\{)/giu)]
    if (separators.length) {
      const last = separators.at(-1)
      return last.index + last[0].length
    }
    const title = [...prefix.matchAll(/\\maketitle\b/giu)].at(-1)
    if (title) return title.index + title[0].length
    const begin = /\\begin\s*\{\s*document\s*\}/iu.exec(prefix)
    return begin ? begin.index + begin[0].length : null
  }
  return null
}

function insertManagedImages(source, additions) {
  const groups = new Map()
  for (const addition of additions) {
    const blocks = groups.get(addition.index) || []
    blocks.push(addition.block)
    groups.set(addition.index, blocks)
  }
  let nextSource = source
  for (const [index, blocks] of [...groups.entries()].sort(([left], [right]) => right - left)) {
    const before = nextSource.slice(0, index).replace(/[\t ]+$/u, '')
    const after = nextSource.slice(index).replace(/^[\t ]+/u, '')
    nextSource = `${before}${before ? '\n\n' : ''}${blocks.join('\n\n')}${after ? '\n\n' : ''}${after}`
  }
  return nextSource
}

export function reconcileEditorImagesIntoLatexSource(source, images = [], anchors = []) {
  const rawSource = String(source || '')
  const legacyManagedBlock = new RegExp(`${legacyEditorImagesStart}[\\s\\S]*?${legacyEditorImagesEnd}\\s*`, 'g')
  const perImageManagedBlock = new RegExp(`${editorImageStart}[\\s\\S]*?${editorImageEnd}\\s*`, 'g')
  const cleanSource = rawSource.replace(legacyManagedBlock, '').replace(perImageManagedBlock, '')
  const referencedNames = new Set(
    [...cleanSource.matchAll(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/giu)]
      .map(([, path]) => path.trim().replace(/\\/g, '/').split('/').pop()),
  )
  const validImages = Array.isArray(images)
    ? images.filter(image => /^image-\d+\.(?:png|jpg)$/u.test(image?.filename || ''))
    : []
  const additions = []
  const unplacedImages = []

  validImages.forEach((image, index) => {
    if (referencedNames.has(image.filename)) return
    const insertionIndex = findImageInsertionPoint(cleanSource, anchors[index])
    if (insertionIndex === null) {
      unplacedImages.push(image.filename)
      return
    }
    const block = `${editorImageStart}\n\\begin{center}\n\\includegraphics[width=0.9\\linewidth,keepaspectratio]{${image.filename}}\n\\end{center}\n${editorImageEnd}`
    additions.push({ index: insertionIndex, block })
  })

  const nextSource = insertManagedImages(cleanSource, additions)
  return {
    source: validImages.length ? ensureLatexPackage(nextSource, 'graphicx') : nextSource,
    unplacedImages,
  }
}

export function syncEditorImagesIntoLatexSource(source, images = [], anchors = []) {
  return reconcileEditorImagesIntoLatexSource(source, images, anchors).source
}

function removeRepeatedTemplateHeading(templateSource, doc) {
  const placeholderAt = templateSource.indexOf('{{content}}')
  if (placeholderAt < 0) return templateSource
  const firstContent = (doc?.content || []).find(node => node.type !== 'paragraph' || textIn(node).trim())
  if (firstContent?.type !== 'heading') return templateSource

  const chaptered = /\\documentclass(?:\[[^\]]*\])?\s*\{\s*(?:report|book)\s*\}/iu.test(templateSource)
  const headingCommands = chaptered
    ? { 1: 'chapter', 2: 'section', 3: 'subsection' }
    : { 1: 'section', 2: 'subsection', 3: 'subsubsection' }
  const command = headingCommands[firstContent.attrs?.level]
  if (!command) return templateSource
  const headingText = textIn(firstContent).trim()
  const signature = value => value
    .replace(/\\([#$%&_{}])/g, '$1')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()

  const beforePlaceholder = templateSource.slice(0, placeholderAt)
  const sectionLine = /(?:^|\r?\n)[ \t]*(\\(chapter|section|subsection|subsubsection)\*?\s*\{([^{}]+)\})[ \t]*(?:\r?\n[ \t]*)*$/.exec(beforePlaceholder)
  if (!sectionLine || sectionLine[2] !== command || signature(sectionLine[3]) !== signature(headingText)) return templateSource

  const commandAt = beforePlaceholder.lastIndexOf(sectionLine[1])
  return `${beforePlaceholder.slice(0, commandAt)}${templateSource.slice(placeholderAt)}`
}

function prepareManualCitationReuse(doc, bibliography, citationStyle) {
  const bibliographyEntries = parseBibtex(bibliography)
  const bibliographyByKey = new Map(bibliographyEntries.map(entry => [entry.key, entry]))
  const occurrences = citationOccurrences(doc)
  const citedKeys = [...new Set(occurrences.flat())]
  const emptyReuse = {
    bibliographyEntries,
    bibliographyByKey,
    citationNumbers: citationNumbers(occurrences, bibliographyEntries, citationStyle),
    manualCitationKeys: new Set(),
    manualReferenceTargetsByKey: new Map(),
    manualReferenceTargetsByIndex: new Map(),
    reusesManualBibliography: false,
  }
  if (!isAuthorYearStyle(citationStyle) || !citedKeys.length) return emptyReuse

  const paragraphs = manualBibliographyParagraphs(doc)
  if (!paragraphs.length) return emptyReuse
  const matches = citedKeys.map(key => {
    const entry = bibliographyByKey.get(key)
    if (!entry) return null
    const paragraph = paragraphs.find(item => bibliographyEntryMatchesManualText(entry, item.text))
    return paragraph ? { key, paragraph } : null
  })
  if (matches.some(match => !match)) return emptyReuse

  const manualReferenceTargetsByKey = new Map()
  const manualReferenceTargetsByIndex = new Map()
  for (const { key, paragraph } of matches) {
    const target = `manual-ref-${safeLabel(key)}`
    manualReferenceTargetsByKey.set(key, target)
    const targets = manualReferenceTargetsByIndex.get(paragraph.index) || []
    targets.push(target)
    manualReferenceTargetsByIndex.set(paragraph.index, targets)
  }
  return {
    ...emptyReuse,
    manualCitationKeys: new Set(citedKeys),
    manualReferenceTargetsByKey,
    manualReferenceTargetsByIndex,
    reusesManualBibliography: true,
  }
}

export function toLatex(doc, title, templateSource = defaultDocumentTemplate, documentSettings = {}) {
  const settings = sanitizeSettings(documentSettings)
  const source = String(templateSource || defaultDocumentTemplate)
  const chaptered = /\\documentclass(?:\[[^\]]*\])?\s*\{\s*(?:report|book)\s*\}/iu.test(source)
  const citationStyle = resolveCitationStyle(settings.citationStyle, source)
  const normalized = normalizeDocumentHeadings(normalizeBibliographyMathNodes(doc))
  const hasCitations = citationOccurrences(normalized).some(keys => keys.length > 0)
  const manualCitationReuse = prepareManualCitationReuse(normalized, settings.bibliography, citationStyle)
  const context = { images: [], settings, citationStyle, twoColumn: /IEEEtran|twocolumn/.test(source), chaptered, tableIndex: 0, tableLabels: new Set(), ...manualCitationReuse }
  const needsAutomaticBibliography = Boolean(settings.bibliography.trim() && hasCitations && !context.reusesManualBibliography)
  let inManualBibliography = false
  const body = (normalized?.content || []).map((node, index) => {
    if (node.type === 'heading') {
      inManualBibliography = isBibliographyHeadingNode(node)
      if (needsAutomaticBibliography && inManualBibliography) return ''
    }
    if (needsAutomaticBibliography && inManualBibliography) return ''
    const anchors = (context.manualReferenceTargetsByIndex.get(index) || [])
      .map(target => `\\hypertarget{${target}}{}`)
      .join('')
    const rendered = anchors + nodeLatex(node, context)
    if (inManualBibliography && node.type === 'paragraph' && textIn(node).trim()) {
      return `\\begin{samepage}\n${rendered.trim()}\n\\par\n\\end{samepage}\n`
    }
    return rendered
  }).join('')
    .replace(/(?:[\t ]*\r?\n){3,}/g, '\n\n')
    .trim()
  let template = removeRepeatedTemplateHeading(source, normalized)
  if (settings.abstractEnabled && !template.includes('{{abstract}}')) {
    if (/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/.test(template)) template = template.replace(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/, '{{abstract}}')
    else if (/\\maketitle\b/.test(template)) template = template.replace(/\\maketitle\b/, '\\maketitle\n{{abstract}}')
    else template = template.replace('{{content}}', '{{abstract}}\n{{content}}')
  }
  const abstractText = settings.abstract.split(/\n\s*\n/u).map(paragraph => latexEscape(paragraph.replace(/\s+/gu, ' ').trim())).join('\n\n')
  const values = {
    ...settings,
    title: latexEscape(title),
    content: body,
    author: latexEscape(settings.author),
    date: latexEscape(settings.date),
    abstract: settings.abstractEnabled ? `\\begin{abstract}\n${abstractText}\n\\end{abstract}` : '',
    toc: settings.tableOfContents ? '\\tableofcontents\\newpage' : '',
  }
  let latex = template.replace(/\{\{([^{}]+)\}\}/g, (placeholder, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder,
  )
  if (settings.abstractEnabled) {
    const definition = String.raw`% Fixed abstract heading and justified body, independent of the surrounding alignment.
\makeatletter
\@ifundefined{abstract}{\newenvironment{abstract}{}{}}{}
\makeatother
\renewenvironment{abstract}{\par\begin{center}\normalfont\bfseries ${latexEscape(settings.abstractTitle)}\end{center}\begin{quotation}\normalfont\leftskip=0pt\rightskip=0pt\parfillskip=0pt plus 1fil\parindent=1.5em\ignorespaces}{\par\end{quotation}\ignorespacesafterend}`
    latex = latex.replace(/\\begin\{document\}/, () => `${definition}\n\\begin{document}`)
  }
  if (/\\includegraphics\b/.test(latex)) latex = ensureLatexPackage(latex, 'graphicx')
  if (/\\(?:href|hyperlink|hypertarget|url|nolinkurl|ref|label|cite\w*)\b/.test(latex)) {
    latex = ensureLatexPackage(latex, 'hyperref')
    if (!/\\hypersetup\s*\{[^}]*\b(?:pdfborder|colorlinks)\s*=/is.test(latex)) {
      latex = latex.replace(/\\begin\{document\}/i, '\\hypersetup{pdfborder={0 0 0}}\n\\begin{document}')
    }
  }
  if (/\\nolinkurl\s*\{/.test(latex)) {
    latex = ensureLatexPackage(latex, 'url')
    if (!/\\urlstyle\s*\{/i.test(latex)) latex = latex.replace(/\\begin\{document\}/i, '\\urlstyle{rm}\n\\begin{document}')
  }
  if (/\\(?:toprule|midrule|bottomrule)\b/.test(latex)) {
    latex = ensureLatexPackage(latex, 'booktabs')
    latex = ensureLatexPackage(latex, 'array')
  }
  if (/\\begin\{longtable\}/.test(latex)) latex = ensureLatexPackage(latex, 'longtable')
  if (/\\multirow\b/.test(latex)) latex = ensureLatexPackage(latex, 'multirow')
  if (needsAutomaticBibliography) {
    latex = latex.replace(/\\end\{document\}/, () => citationStyle === 'apa' ? '\\printbibliography\n\\end{document}' : `\\bibliographystyle{${bibliographyStyleName(citationStyle)}}\n\\bibliography{references}\n\\end{document}`)
    latex = ensureCitationPackages(latex, citationStyle)
  }
  if (/\\vietlatexstrike\s*\{/.test(latex)) latex = ensureLatexDefinition(latex, 'vietlatexstrike', strikethroughDefinition)
  if (/\\(?:textcolor|vietlatexhl)\b/.test(latex)) latex = ensureLatexPackage(latex, 'xcolor')
  if (/\\vietlatexhl\s*\{/.test(latex)) latex = ensureLatexDefinition(latex, 'vietlatexhl', highlightDefinition)
  return { latex, images: context.images, imageAnchors: editorImageAnchors(normalized) }
}
