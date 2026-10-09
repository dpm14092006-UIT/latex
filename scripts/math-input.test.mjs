import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFormulaInput, standaloneLatexPaste, unicodeScriptFormulas } from '../src/math-input.js'

test('Unicode formulas stay complete and bare chemical pastes become inline LaTeX', () => {
  const formulas = unicodeScriptFormulas('Nồng độ NO₂, CO₂, H₂O và SO₄²⁻; xₜ và m².')
  assert.deepEqual(formulas.map(item => item.source), ['NO₂', 'CO₂', 'H₂O', 'SO₄²⁻', 'xₜ', 'm²'])
  assert.deepEqual(formulas.map(item => item.latex), [String.raw`\mathrm{NO}_{2}`, String.raw`\mathrm{CO}_{2}`, String.raw`\mathrm{H}_{2}\mathrm{O}`, String.raw`\mathrm{SO}_{4}^{2-}`, 'x_{t}', 'm^{2}'])
  assert.deepEqual(standaloneLatexPaste('NO₂', normalizeFormulaInput), { latex: String.raw`\mathrm{NO}_{2}`, type: 'inline' })
  assert.equal(standaloneLatexPaste('Nồng độ NO₂.', normalizeFormulaInput), null)
  assert.deepEqual(unicodeScriptFormulas('đNO₂ \\NO₂ abc_NO₂'), [])
})

test('matrix row separators followed by newlines are preserved', () => {
  assert.equal(normalizeFormulaInput('\\begin{pmatrix} a & b \\\\\n c & d \\end{pmatrix}'), '\\begin{pmatrix} a & b \\\\\nc & d \\end{pmatrix}')
  assert.equal(normalizeFormulaInput('a \\\\\n b'), 'a \\\\ b')
})

test('a lone backslash line continuation still collapses to a space', () => {
  assert.equal(normalizeFormulaInput('a +\\\n b'), 'a + b')
})

test('Markdown script escapes are undone only outside text-mode arguments', () => {
  assert.equal(normalizeFormulaInput(String.raw`\text{max\_depth} = d\_{max} + x\^2`), String.raw`\text{max\_depth} = d_{max} + x^2`)
  assert.equal(normalizeFormulaInput(String.raw`\textbf{a {b\_c}} y\_i`), String.raw`\textbf{a {b\_c}} y_i`)
  assert.equal(normalizeFormulaInput(String.raw`a \quad\ b`), String.raw`a \quad\ b`)
  assert.equal(normalizeFormulaInput(String.raw`max\ depth`), String.raw`\text{max depth}`)
})

test('bare one-line formulas paste inline while display formulas stay block', () => {
  const parseType = input => standaloneLatexPaste(input, normalizeFormulaInput)?.type
  assert.equal(parseType(String.raw`E_t^{(k)}`), 'inline')
  assert.equal(parseType(String.raw`\(E_t^{(k)}\)`), 'inline')
  assert.equal(parseType(String.raw`\[E_t^{(k)}\]`), 'block')
  assert.equal(parseType(String.raw`x = a + b
y = c + d`), 'block')
})
