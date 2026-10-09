import assert from 'node:assert/strict'
import test from 'node:test'
import katex from 'katex'
import { recognizeFormula } from '../src/formula-recognition.js'

test('recognizes typed relations, fractions, roots and named subscripts', () => {
  const samples = [
    ['p >= N_train', String.raw`p \geq N_{\mathrm{train}}`],
    ['sqrt(x)', String.raw`\sqrt{x}`],
    ['(a+b)/c', String.raw`\frac{a + b}{c}`],
    ['x^(n+1)', 'x^{n + 1}'],
    ['x^2_i', 'x^{2}_{i}'],
    ['x^2^3', 'x^{2^{3}}'],
    ['x^2 + y^2 = z^2', String.raw`x^{2} + y^{2} = z^{2}`],
    ['x² + y² = z²', String.raw`x^{2} + y^{2} = z^{2}`],
    ['Xₜ²', String.raw`X_{t}^{2}`],
    ['NO₂', String.raw`\mathrm{NO}_{2}`],
    ['CO₂', String.raw`\mathrm{CO}_{2}`],
    ['H₂O', String.raw`\mathrm{H}_{2}\mathrm{O}`],
    ['SO₄²⁻', String.raw`\mathrm{SO}_{4}^{2-}`],
    ['x⁻¹', String.raw`x^{-1}`],
    ['x⁽ⁿ⁺¹⁾', String.raw`x^{\left(n + 1\right)}`],
    ['N_train^2', String.raw`N_{\mathrm{train}}^{2}`],
    ['a+b*c', String.raw`a + b \cdot c`],
    ['alpha ≤ pi', String.raw`\alpha \leq \pi`],
    ['x y z', 'x y z'],
    ['abs(x)', String.raw`\left|x\right|`],
  ]
  for (const [input, expected] of samples) {
    const result = recognizeFormula(input)
    assert.equal(result.error, '', input)
    assert.equal(result.latex, expected, input)
    assert.doesNotThrow(() => katex.renderToString(result.latex, { throwOnError: true }), input)
  }
})

test('recognizes compact macro averages, categorical labels and per ratios', () => {
  const samples = [
    ['Macro-F1=F1Emerging+F1Stable+F1Declining3', String.raw`\text{Macro-F1} = \frac{\mathrm{F1}_{\text{Emerging}} + \mathrm{F1}_{\text{Stable}} + \mathrm{F1}_{\text{Declining}}}{3}`],
    ['Yc,t(4){Emerging,Stable,Declining}', String.raw`Y_{c,t}^{(4)} \in \{\text{Emerging}, \text{Stable}, \text{Declining}\}`],
    ['SalesPerActiveProductc,t=Salesc,tActiveProductsc,t', String.raw`\mathrm{SalesPerActiveProduct}_{c,t} = \frac{\mathrm{Sales}_{c,t}}{\mathrm{ActiveProducts}_{c,t}}`],
  ]
  for (const [input, expected] of samples) {
    const result = recognizeFormula(input)
    assert.equal(result.error, '', input)
    assert.equal(result.latex, expected, input)
    assert.doesNotThrow(() => katex.renderToString(result.latex, { throwOnError: true }), input)
  }
})

test('rejects incomplete, unsupported and excessive input without partial results', () => {
  for (const input of ['', 'a/', 'sqrt(', '(a+b', 'x)', 'x__i', 'x@2', 'x=1\ny=2', String.raw`\frac{a}{b}`, 'x'.repeat(4001), '('.repeat(100) + 'x' + ')'.repeat(100)]) {
    const result = recognizeFormula(input)
    assert.equal(result.latex, '', input.slice(0, 40))
    assert.ok(result.error)
  }
})

test('fractions keep juxtaposed groups balanced; bars and function calls parse as written', () => {
  const samples = [
    ['(a)(b)/c', String.raw`\frac{\left(a\right) \cdot \left(b\right)}{c}`],
    ['(a+b)(a-b)/2', String.raw`\frac{\left(a + b\right) \cdot \left(a - b\right)}{2}`],
    ['(a+b)/(c+d)', String.raw`\frac{a + b}{c + d}`],
    ['|x|', String.raw`\left|x\right|`],
    ['|x - y| <= |x| + |y|', String.raw`\left|x - y\right| \leq \left|x\right| + \left|y\right|`],
    ['|f(|x|)|', String.raw`\left|f \cdot \left(\left|x\right|\right)\right|`],
    ['sin(x)^2 + cos(x)^2 = 1', String.raw`\sin\left(x\right)^{2} + \cos\left(x\right)^{2} = 1`],
    ['log(n)/2', String.raw`\frac{\log\left(n\right)}{2}`],
  ]
  for (const [input, expected] of samples) {
    const result = recognizeFormula(input)
    assert.equal(result.error, '', input)
    assert.equal(result.latex, expected, input)
    assert.doesNotThrow(() => katex.renderToString(result.latex, { throwOnError: true }), input)
  }
  assert.ok(recognizeFormula('|'.repeat(5000)).error)
})

test('rejects compact notation when its meaning is inconsistent', () => {
  for (const input of [
    'Macro-F1=F1Emerging+F1Stable+F1Declining2',
    'SalesPerActiveProductc,t=Salesc,kActiveProductsc,t',
    'Yc,t(4){Emerging,Stable,Declining',
  ]) {
    const result = recognizeFormula(input)
    assert.equal(result.latex, '', input)
    assert.ok(result.error, input)
  }
})
