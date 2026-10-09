import { unicodeSubscripts as subscriptMap, unicodeSuperscripts as superscriptMap } from './unicode-scripts.js'
import { unicodeScriptFormulas } from './math-input.js'

const greek = new Map(Object.entries({
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta', epsilon: '\\epsilon',
  theta: '\\theta', lambda: '\\lambda', mu: '\\mu', pi: '\\pi', rho: '\\rho', sigma: '\\sigma',
  tau: '\\tau', phi: '\\phi', chi: '\\chi', psi: '\\psi', omega: '\\omega',
  Gamma: '\\Gamma', Delta: '\\Delta', Theta: '\\Theta', Lambda: '\\Lambda', Pi: '\\Pi',
  Sigma: '\\Sigma', Phi: '\\Phi', Psi: '\\Psi', Omega: '\\Omega',
}))

const functions = new Map(Object.entries({
  sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', log: '\\log', ln: '\\ln',
  exp: '\\exp', min: '\\min', max: '\\max', lim: '\\lim', det: '\\det',
}))

const operators = new Map([
  ['>=', '\\geq'], ['≥', '\\geq'], ['≤', '\\leq'], ['<=', '\\leq'], ['!=', '\\neq'], ['≠', '\\neq'],
  ['==', '='], ['≈', '\\approx'], ['∈', '\\in'], ['∉', '\\notin'], ['∞', '\\infty'],
  ['→', '\\to'], ['⇒', '\\Rightarrow'], ['↔', '\\leftrightarrow'], ['±', '\\pm'],
  ['×', '\\times'], ['÷', '\\div'], ['=', '='], ['>', '>'], ['<', '<'],
])

const tokenPattern = /\s+|>=|<=|!=|==|⇒|↔|[A-Za-z]+\d*|\d+(?:\.\d+)?|[≤≥≠≈∈∉∞→±×÷]|[()+\-*/^_=,{}|<>]/gy

function convertScriptRun(input, pattern, mapping, type) {
  return input.replace(pattern, (_match, base, run) => `${base}${type}{${[...run].map(character => mapping.get(character) || character).join('')}}`)
}

function normalizeUnicodeScripts(input) {
  const base = '([A-Za-z0-9}])'
  const subscripts = new RegExp(`${base}([\\u2080-\\u208E\\u2090-\\u209C\\u1D62\\u2C7C\\u1D63-\\u1D65]+)`, 'g')
  const superscripts = new RegExp(`${base}([\\u00B9\\u00B2\\u00B3\\u2070\\u2074-\\u207F]+)`, 'g')
  let result = convertScriptRun(input, subscripts, subscriptMap, '_')
  result = convertScriptRun(result, superscripts, superscriptMap, '^')
  return convertScriptRun(result, subscripts, subscriptMap, '_')
}

function failure(error = 'Không nhận diện được cú pháp công thức này.') {
  return { latex: '', error }
}

function success(latex) {
  return { latex, error: '' }
}

function renderRoman(value) {
  return `\\mathrm{${value}}`
}

function renderText(value) {
  return `\\text{${value}}`
}

function macroAverage(input) {
  if (!/^\s*Macro-/i.test(input)) return null
  const match = input.trim().match(/^Macro-([A-Za-z]+\d*)\s*=\s*(.+)$/)
  if (!match) return failure('Macro-F1 cần có dạng Macro-F1=F1Emerging+F1Stable+F1Declining3.')

  const [, metric, rawRight] = match
  const explicitDenominator = rawRight.match(/\/\s*(\d+)\s*$/)
  const compactRight = explicitDenominator ? rawRight.slice(0, explicitDenominator.index).trim() : rawRight.trim()
  const terms = compactRight.split('+').map(term => term.trim())
  if (terms.length < 2 || terms.some(term => !term)) return failure('Macro-F1 cần ít nhất hai lớp được cộng lại.')

  const classes = []
  let compactDenominator = ''
  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i].replace(/\s+/g, '')
    if (!term.startsWith(metric)) return failure(`Mỗi hạng tử cần bắt đầu bằng ${metric}.`)
    let label = term.slice(metric.length)
    if (i === terms.length - 1 && !explicitDenominator) {
      const suffix = label.match(/^([A-Z][A-Za-z]*?)(\d+)$/)
      if (!suffix) return failure('Hãy ghi số lớp ở cuối tổng, ví dụ F1Declining3, hoặc thêm /3.')
      label = suffix[1]
      compactDenominator = suffix[2]
    }
    if (!/^[A-Z][A-Za-z]*$/.test(label)) return failure(`Không đọc được tên lớp trong hạng tử ${term}.`)
    classes.push(label)
  }

  const denominator = explicitDenominator?.[1] || compactDenominator
  if (Number(denominator) !== classes.length) {
    return failure(`Mẫu số phải bằng số lớp (${classes.length}).`)
  }
  const sum = classes.map(label => `${renderRoman(metric)}_{${renderText(label)}}`).join(' + ')
  return success(`${renderText(`Macro-${metric}`)} = \\frac{${sum}}{${classes.length}}`)
}

function categoricalLabel(input) {
  const normalized = input.trim()
  const match = normalized.match(/^([A-Za-z])\s*([A-Za-z])\s*,\s*([A-Za-z])\s*\(\s*([A-Za-z0-9]+)\s*\)\s*\{\s*([^{}]+)\s*\}$/)
  if (!match) {
    return /^[A-Za-z]\s*[A-Za-z]\s*,\s*[A-Za-z].*\(/.test(normalized)
      ? failure('Mẫu nhãn cần có dạng Yc,t(4){Emerging,Stable,Declining}.')
      : null
  }
  const [, variable, firstIndex, secondIndex, version, rawLabels] = match
  const labels = rawLabels.split(',').map(label => label.trim())
  if (labels.length < 2 || labels.some(label => !/^[A-Za-z][A-Za-z0-9 -]*$/.test(label))) {
    return failure('Danh sách nhãn phải chứa ít nhất hai tên chữ cái, ngăn cách bằng dấu phẩy.')
  }
  const set = labels.map(renderText).join(', ')
  return success(`${variable}_{${firstIndex},${secondIndex}}^{(${version})} \\in \\{${set}\\}`)
}

function perRatio(input) {
  const equal = input.indexOf('=')
  if (equal < 0) return null
  const left = input.slice(0, equal).trim()
  const right = input.slice(equal + 1).trim()
  const match = left.match(/^([A-Za-z][A-Za-z0-9]*)Per([A-Za-z][A-Za-z0-9]*?)([A-Za-z])\s*,\s*([A-Za-z])$/)
  if (!match) {
    return /Per/.test(left) ? failure('Mẫu “Per” cần có chỉ số hai thành phần, ví dụ SalesPerActiveProductc,t.') : null
  }
  const [, numerator, denominator, firstIndex, secondIndex] = match
  const expectedRight = `${numerator}${firstIndex},${secondIndex}${denominator}s${firstIndex},${secondIndex}`
  if (right.replace(/\s+/g, '').toLowerCase() !== expectedRight.toLowerCase()) {
    return failure('Hai vế của công thức “Per” không khớp tên biến hoặc chỉ số.')
  }
  const name = left.slice(0, left.search(/[A-Za-z]\s*,/)).replace(/\s+/g, '')
  return success(`${renderRoman(name)}_{${firstIndex},${secondIndex}} = \\frac{${renderRoman(numerator)}_{${firstIndex},${secondIndex}}}{${renderRoman(`${denominator}s`)}_{${firstIndex},${secondIndex}}}`)
}

function tokenize(input) {
  const tokens = []
  let position = 0
  while (position < input.length) {
    tokenPattern.lastIndex = position
    const match = tokenPattern.exec(input)
    if (!match) return { error: `Ký tự “${input[position]}” chưa được hỗ trợ.` }
    tokens.push(match[0])
    position = tokenPattern.lastIndex
  }
  return { tokens }
}

// Drops the outer \left( … \right) only when it wraps the whole operand: `(a)(b)` must keep both groups.
function unwrapParentheses(value) {
  if (!value.startsWith('\\left(') || !value.endsWith('\\right)')) return value
  let depth = 0
  for (const match of value.matchAll(/\\left|\\right/g)) {
    depth += match[0] === '\\left' ? 1 : -1
    if (depth === 0) return match.index === value.length - '\\right)'.length ? value.slice('\\left('.length, -'\\right)'.length) : value
  }
  return value
}

function parseTokens(tokens) {
  let position = 0
  let depth = 0
  let absoluteDepth = 0
  const current = () => tokens[position]
  const skipSpace = () => {
    let hadSpace = false
    while (current() && /^\s+$/.test(current())) {
      position += 1
      hadSpace = true
    }
    return hadSpace
  }
  // Inside |…| the next bar closes the absolute value instead of opening an implicit product.
  const isAtomStart = token => token && (token === '(' || token === '{' || (token === '|' && !absoluteDepth) || /^[A-Za-z]/.test(token) || /^\d/.test(token))

  function grouped(open, close, left, right) {
    if (current() !== open) throw new Error('Thiếu dấu mở nhóm.')
    position += 1
    depth += 1
    if (depth > 80) throw new Error('Công thức lồng quá nhiều tầng.')
    const outerAbsoluteDepth = absoluteDepth
    absoluteDepth = 0
    skipSpace()
    const contents = parseSum()
    skipSpace()
    absoluteDepth = outerAbsoluteDepth
    if (current() !== close) throw new Error('Thiếu dấu đóng nhóm.')
    position += 1
    depth -= 1
    return `${left}${contents}${right}`
  }

  function annotation() {
    skipSpace()
    if (!current()) throw new Error('Thiếu phần số mũ hoặc chỉ số.')
    if (current() === '(') return grouped('(', ')', '', '')
    if (current() === '{') return grouped('{', '}', '', '')
    const atom = parseAtom()
    return atom
  }

  function parseAtom() {
    skipSpace()
    const token = current()
    if (!token) throw new Error('Công thức chưa hoàn chỉnh.')
    if (token === '(') return grouped('(', ')', '\\left(', '\\right)')
    if (token === '{') return grouped('{', '}', '\\{', '\\}')
    if (token === '|') {
      position += 1
      depth += 1
      if (depth > 80) throw new Error('Công thức lồng quá nhiều tầng.')
      const outerAbsoluteDepth = absoluteDepth
      absoluteDepth = 1
      const contents = parseSum()
      absoluteDepth = outerAbsoluteDepth
      skipSpace()
      if (current() !== '|') throw new Error('Thiếu dấu | đóng trị tuyệt đối.')
      position += 1
      depth -= 1
      return `\\left|${contents}\\right|`
    }
    if (/^\d/.test(token)) {
      position += 1
      return token
    }
    if (token === '+' || token === '-') {
      position += 1
      return `${token}${parseAtom()}`
    }
    if (/^[A-Za-z]/.test(token)) {
      position += 1
      if ((token === 'sqrt' || token === 'abs') && current() === '(') {
        const inner = grouped('(', ')', '', '')
        return token === 'sqrt' ? `\\sqrt{${inner}}` : `\\left|${inner}\\right|`
      }
      if (greek.has(token)) return greek.get(token)
      // sin(x) is function application, not \sin multiplied by (x).
      if (functions.has(token)) return current() === '(' ? `${functions.get(token)}${grouped('(', ')', '\\left(', '\\right)')}` : functions.get(token)
      if (token.length === 1) return token
      return renderRoman(token)
    }
    throw new Error(`Không có toán hạng trước “${token}”.`)
  }

  function parsePower() {
    let base = parseAtom()
    const suffixes = []
    while (true) {
      const beforeSpace = position
      skipSpace()
      if (current() === '^') {
        position += 1
        const exponent = annotation()
        const previousSuperscript = [...suffixes].reverse().find(suffix => suffix.type === '^')
        if (previousSuperscript) previousSuperscript.value += `^{${exponent}}`
        else suffixes.push({ type: '^', value: exponent })
      } else if (current() === '_') {
        position += 1
        if (suffixes.some(suffix => suffix.type === '_')) throw new Error('Chỉ số bị lặp; hãy nhóm nhiều phần bằng ngoặc nhọn.')
        suffixes.push({ type: '_', value: annotation() })
      } else {
        position = beforeSpace
        break
      }
    }
    return base + suffixes.map(suffix => `${suffix.type}{${suffix.value}}`).join('')
  }

  function parseProduct() {
    let value = parsePower()
    while (true) {
      const hadSpace = skipSpace()
      const token = current()
      if (token === '/' || token === '*' || token === '×' || token === '÷') {
        position += 1
        const right = parsePower()
        if (token === '/') {
          value = `\\frac{${unwrapParentheses(value)}}{${unwrapParentheses(right)}}`
        }
        else value += token === '÷' ? ` \\div ${right}` : ` \\cdot ${right}`
        continue
      }
      if (isAtomStart(token)) {
        const right = parsePower()
        value += `${hadSpace ? ' ' : ' \\cdot '}${right}`
        continue
      }
      return value
    }
  }

  function parseSum() {
    let value = parseProduct()
    while (true) {
      skipSpace()
      const token = current()
      if (token === '+' || token === '-') {
        position += 1
        const right = parseProduct()
        value += ` ${token} ${right}`
      } else if (token === ',') {
        position += 1
        value += ', ' + parseProduct()
      } else if (operators.has(token)) {
        position += 1
        const right = parseProduct()
        value += ` ${operators.get(token)} ${right}`
      } else return value
    }
  }

  try {
    skipSpace()
    const latex = parseSum()
    skipSpace()
    if (position !== tokens.length) throw new Error(`Không thể đặt “${current()}” tại vị trí này.`)
    if (!latex) throw new Error('Hãy nhập biểu thức cần nhận diện.')
    return success(latex)
  } catch (error) {
    return failure(error.message)
  }
}

export function recognizeFormula(value) {
  const input = String(value ?? '')
  if (!input.trim()) return failure('Hãy nhập công thức cần nhận diện.')
  if (input.length > 4000) return failure('Công thức quá dài (tối đa 4000 ký tự).')
  if (input.includes('\\')) return failure('Ô này nhận công thức gõ thường; hãy chuyển sang chế độ LaTeX để nhập mã LaTeX.')
  if (/[\r\n]/.test(input)) return failure('Chỉ nhập một công thức trên mỗi lần nhận diện.')

  const special = macroAverage(input) || categoricalLabel(input) || perRatio(input)
  if (special) return special
  const unicode = unicodeScriptFormulas(input.trim())
  if (unicode.length === 1 && unicode[0].source === input.trim() && unicode[0].latex.startsWith('\\mathrm')) return success(unicode[0].latex)
  const tokenized = tokenize(normalizeUnicodeScripts(input))
  if (tokenized.error) return failure(tokenized.error)
  return parseTokens(tokenized.tokens)
}
