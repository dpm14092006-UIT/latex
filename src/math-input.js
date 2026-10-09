import { replaceUnicodeScripts, unicodeSubscripts, unicodeSuperscripts } from './unicode-scripts.js'

const unicodeScriptCharacters = [...unicodeSubscripts.keys(), ...unicodeSuperscripts.keys()].join('')
const unicodeFormulaPattern = new RegExp(`(?<![\\p{L}\\p{N}_\\\\])[A-Za-z][A-Za-z0-9${unicodeScriptCharacters}]*(?![\\p{L}\\p{N}_])`, 'gu')
const unicodeScriptPattern = new RegExp(`[${unicodeScriptCharacters}]`, 'u')

// Explicit Unicode scripts are an unambiguous signal even without $…$.
// Keep an entire chemical token together: H₂O and SO₄²⁻ must not be split.
export function unicodeScriptFormulas(input) {
  const text = String(input ?? '')
  return [...text.matchAll(unicodeFormulaPattern)].filter(match => unicodeScriptPattern.test(match[0])).map(match => {
    const source = match[0]
    const chemical = /^[A-Z]/.test(source) && source.replace(/[^A-Za-z]/g, '').length > 1
    const base = chemical ? source.replace(/[A-Za-z]+/g, letters => `\\mathrm{${letters}}`) : source
    return { source, start: match.index, end: match.index + source.length, latex: normalizeFormulaInput(base) }
  })
}

const formulaCommands = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|lim|left|right|begin|end|mathrm|mathcal|mathbb|mathbf|mathit|operatorname|widehat|widetilde|overline|underline|vec|dot|ddot|partial|nabla|cdot|times|div|pm|mp|cup|cap|in|notin|leq|geq|neq|approx|equiv|rightarrow|leftarrow|Rightarrow|infty|log|ln|sin|cos|tan|exp|cases|matrix|aligned)\b/i
const bareMathOperators = /[=+*/^_<>≤≥≠≈∈∉→←⇒∞∫∑√±×÷∪∩∂∇−-]/u
const mathFunctionWords = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'sum', 'prod', 'min', 'max', 'sup', 'inf', 'det', 'rank', 'trace'])

function latexText(value) {
  return value.replace(/([#$%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function textifyPlainWordRuns(value) {
  if (value.includes('\\')) return value
  const operators = /([=+*/^_<>≤≥≠≈∈∉→←⇒∞∫∑√±×÷∪∩∂∇−-])/u
  return value.split(operators).map(part => {
    const phrase = part.trim()
    if (!phrase || !/\s/u.test(phrase) || !/^[\p{L}\p{N}\s.,:;()'’&%#$-]+$/u.test(phrase)) return part
    const words = phrase.match(/[\p{L}][\p{L}\p{N}.-]*/gu) || []
    if (words.length < 2 || words.every(word => word.length < 2)) return part
    if (mathFunctionWords.has(words[0].toLocaleLowerCase('en'))) return part
    return `\\text{${latexText(phrase)}}`
  }).join('')
}

function removeBraceContents(input) {
  let depth = 0
  let output = ''
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '\\') {
      if (depth === 0) output += char
      if (index + 1 < input.length) {
        if (depth === 0) output += input[index + 1]
        index++
      }
      continue
    }
    if (char === '{') { depth++; if (depth === 1) output += ' '; continue }
    if (char === '}') { if (depth > 0) depth--; if (depth === 0) output += ' '; continue }
    if (depth === 0) output += char
  }
  return output
}

function removeDelimitedWrapper(source) {
  const wrappers = [
    { open: '\\[', close: '\\]', type: 'block' },
    { open: '$$', close: '$$', type: 'block' },
    { open: '\\(', close: '\\)', type: 'inline' },
    { open: '$', close: '$', type: 'inline' },
  ]
  for (const wrapper of wrappers) {
    if (source.startsWith(wrapper.open) && source.endsWith(wrapper.close) && source.length >= wrapper.open.length + wrapper.close.length) {
      return { source: source.slice(wrapper.open.length, -wrapper.close.length).trim(), type: wrapper.type, explicit: true }
    }
  }
  const environment = source.match(/^\\begin\{(equation\*?|align\*?|gather\*?|displaymath)\}([\s\S]*)\\end\{\1\}$/)
  if (environment) return { source: environment[2].trim(), type: 'block', explicit: true }
  return { source, type: 'inline', explicit: false }
}

export function standaloneLatexPaste(input, normalize = value => value.trim()) {
  let source = String(input || '').normalize('NFC').trim()
  if (!source || source.length > 12000) return null
  source = source.replace(/^```(?:latex|tex)?\s*/i, '').replace(/\s*```$/, '').trim()
  const wrapped = removeDelimitedWrapper(source)
  source = wrapped.source
  if (!source || /\\(?:documentclass|usepackage|maketitle|tableofcontents)\b/i.test(source) || /\\begin\{document\}|\\end\{document\}/i.test(source)) return null
  const environments = [...source.matchAll(/\\begin\{([^}]+)\}/g)].map(match => match[1])
  if (environments.some(name => !/^(?:equation\*?|align\*?|gather\*?|displaymath|aligned|split|multline\*?|cases|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)$/.test(name))) return null

  const commands = source.match(/\\[A-Za-z]+\*?/g) || []
  const unicode = unicodeScriptFormulas(source)
  if (!wrapped.explicit && unicode.length === 1 && unicode[0].source === source) return { latex: unicode[0].latex, type: 'inline' }
  const hasStructure = formulaCommands.test(source) || bareMathOperators.test(source)
  if (!hasStructure && !wrapped.explicit) return null

  const prose = removeBraceContents(source)
    .replace(/\\[A-Za-z]+\*?/g, ' ')
    .match(/[A-Za-z]{3,}/g) || []
  if (commands.length && prose.some(word => !/^[A-Z]{3,6}$/.test(word))) return null
  if (!commands.length && !wrapped.explicit) {
    const plainWords = source.match(/[\p{L}]{3,}/gu) || []
    const relation = /(?:<=|>=|=|<|>|≤|≥|≠|≈|∈|∉)/u.exec(source)
    const leftSide = relation ? source.slice(0, relation.index).trim() : ''
    const sentenceLike = /[.!?]["')\]]?\s*$/u.test(source)
      || plainWords.length > 8
      || source.length > 360
      || /\b(?:and|but|then|because|while|therefore|we|our|the|this|that|is|are|was|were)\b/iu.test(source)
      || (relation && /\b(?:the|this|that|is|are|was|were|because|while|therefore)\b/iu.test(leftSide))
    if (sentenceLike) return null
  }

  const latex = normalize(source)
  if (!latex) return null
  // Bare one-line formulas belong in text flow; bare multiline formulas stay display math.
  let type = wrapped.type
  if (!wrapped.explicit && /\r?\n/u.test(source)) type = 'block'
  return { latex, type }
}

// Công thức từ nguồn Markdown đã mất escape: \{0,1\} → {0,1}, \text{max\_depth} → max_depth.
export function repairStrippedLatex(input = '') {
  return String(input)
    .replace(/(\\(?:in|notin|subset|subseteq)\b|=)\s*\{([^{}]*,[^{}]*)\}/g, (_match, relation, items) => `${relation}\\{${items}\\}`)
    .replace(/(?<![\\A-Za-z0-9])([A-Za-z][A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)(?![A-Za-z0-9{])/g, name =>
      name.split('_').slice(1).some(part => /[A-Za-z]{2,}/.test(part)) ? `\\text{${name.replace(/_/g, '\\textunderscore{}')}}` : name)
}

// Nội dung của "(y_t)" / "(\mathbf{x}_t)" khi nguồn dán đã mất dấu \ của \( \).
export function bareInlineFormula(input) {
  const source = String(input || '').trim()
  if (!source || source.length > 160 || /[$\n]/.test(source) || !/\\[A-Za-z]+|[_^]/.test(source)) return null
  let depth = 0
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue }
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth < 0) return null
  }
  if (depth) return null
  const outside = removeBraceContents(source).replace(/\\[A-Za-z]+\*?/g, ' ')
  if (/[^\p{ASCII}]/u.test(outside.replace(/[^\p{L}]/gu, ''))) return null
  if ((outside.match(/[A-Za-z]{3,}/g) || []).some(word => !/^[A-Z]{3,6}$/.test(word))) return null
  return source
}

// Markdown escapes `x\_i` / `x\^2` become scripts, but inside text-mode arguments (`\text{max\_depth}`)
// `\_` is the literal underscore and a bare `_` would not compile.
const TEXT_MODE_COMMANDS = new Set(['text', 'textrm', 'textit', 'textbf', 'texttt', 'textsf', 'textup', 'textnormal', 'mbox'])
function unescapeMathScripts(value) {
  let output = ''
  let depth = 0
  let textDepth = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '\\') {
      const command = /^\\([A-Za-z]+)\s*\{/.exec(value.slice(index, index + 40))
      if (command && !textDepth && TEXT_MODE_COMMANDS.has(command[1])) {
        output += command[0]
        textDepth = ++depth
        index += command[0].length - 1
        continue
      }
      const next = value[index + 1] ?? ''
      output += !textDepth && (next === '_' || next === '^') ? next : char + next
      index++
      continue
    }
    if (char === '{') depth++
    else if (char === '}') {
      if (depth === textDepth) textDepth = 0
      depth = Math.max(0, depth - 1)
    }
    output += char
  }
  return output
}

export function normalizeFormulaInput(input = '') {
  let value = String(input).normalize('NFC').trim()
    .replace(/^```(?:latex|tex)?\s*/i, '').replace(/\s*```$/, '')
  const plainBracketed = value.match(/^\[\s*([\s\S]*?)\s*\]$/)
  if (plainBracketed && /\\[A-Za-z]+|[_^=+*/]|[∪∩≤≥≠→←⇒∈∉∞∫∑√]/.test(plainBracketed[1])) value = plainBracketed[1].trim()
  value = value.replace(/(?:^|\r?\n)\s*={3,}\s*(?=\r?\n|$)/g, '\n')
  const wrappers = [['\\(', '\\)'], ['\\[', '\\]'], ['$$', '$$'], ['$', '$']]
  let changed = true
  while (changed) {
    changed = false
    for (const [open, close] of wrappers) {
      if (value.startsWith(open) && value.endsWith(close) && value.length >= open.length + close.length) {
        value = value.slice(open.length, -close.length).trim(); changed = true; break
      }
    }
  }
  const environment = value.match(/^\\begin\{(equation\*?|align\*?|gather\*?)\}/)
  if (environment) {
    const close = `\\end{${environment[1]}}`
    if (value.endsWith(close)) value = value.slice(environment[0].length, -close.length).trim()
  }
  const aligned = /\\begin\{(?:aligned|align\*?|array|cases|matrix|pmatrix|bmatrix)\}/.test(value)
  value = unescapeMathScripts(value)
    .replace(/∪/g, '\\cup ').replace(/∩/g, '\\cap ').replace(/≤/g, '\\leq ').replace(/≥/g, '\\geq ')
    .replace(/≠/g, '\\neq ').replace(/×/g, '\\times ').replace(/÷/g, '\\div ').replace(/±/g, '\\pm ')
    .replace(/→/g, '\\rightarrow ').replace(/←/g, '\\leftarrow ').replace(/⇒/g, '\\Rightarrow ').replace(/∞/g, '\\infty ')
    .replace(/(?<!\\)\\[\t ]*\r?\n\s*/g, ' ')
    .replace(/\\\\[\t ]*\r?\n\s*/g, aligned ? '\\\\\n' : '\\\\ ')
  if (!aligned) value = value.replace(/\s*\r?\n\s*/g, ' ')
  // `max\ depth` is a spaced word run; `\quad\ x` / `\cdot\ n` are commands and stay untouched.
  value = value.replace(/(?<!\\)\b([A-Za-z][A-Za-z0-9.-]*)\\\s+([A-Za-z][A-Za-z0-9.-]*(?:\\\s+[A-Za-z][A-Za-z0-9.-]*)*)/g,
    (_match, first, rest) => `\\text{${first} ${rest.replace(/\\\s+/g, ' ')}}`)
  value = replaceUnicodeScripts(value, (type, content) => `${type === 'subscript' ? '_' : '^'}{${content}}`)
  value = textifyPlainWordRuns(value)
    .replace(/\s{2,}/g, ' ').trim()
  return value
}
