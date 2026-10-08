import assert from 'node:assert/strict'
import test from 'node:test'
import { scanMathDocument, scanMathText } from '../src/services/MathSuggestionScanner.js'

function textNode(text, markName = '') {
  return { isText: true, text, nodeSize: text.length, marks: markName ? [{ type: { name: markName } }] : [] }
}

function inlineNode(nodeSize = 1) {
  return { isText: false, isInline: true, nodeSize }
}

function textBlock(children, typeName = 'paragraph') {
  const contentSize = children.reduce((sum, child) => sum + child.nodeSize, 0)
  return {
    isTextblock: true,
    type: { name: typeName },
    nodeSize: contentSize + 2,
    textContent: children.map(child => child.text || '').join(''),
    forEach(callback) {
      let offset = 0
      for (const child of children) {
        callback(child, offset)
        offset += child.nodeSize
      }
    },
  }
}

function documentOf(blocks) {
  return {
    descendants(callback) {
      let position = 0
      for (const block of blocks) {
        if (callback(block, position) === false) {
          position += block.nodeSize
          continue
        }
        position += block.nodeSize
      }
    },
  }
}

test('finds the supplied compact math patterns inside prose with review reasons', () => {
  const samples = [
    ['Macro-F1=F1Emerging+F1Stable+F1Declining3', 'macro-average'],
    ['Yc,t(4){Emerging,Stable,Declining}', 'categorical-label'],
    ['SalesPerActiveProductc,t=Salesc,tActiveProductsc,t', 'per-ratio'],
  ]
  const text = `The measures are ${samples.map(([source]) => source).join('; ')}.`
  const result = scanMathText(text, 20)
  assert.deepEqual(result.suggestions.map(item => item.source), samples.map(([source]) => source))
  assert.deepEqual(result.suggestions.map(item => item.kind), samples.map(([, kind]) => kind))
  assert.ok(result.suggestions.every(item => item.confidence >= 0.9 && item.reason))
  assert.equal(result.suggestions[0].from, 20 + text.indexOf(samples[0][0]))
  const explicitAverage = scanMathText('Macro-F1 = F1Emerging + F1Stable + F1Declining /3.')
  assert.equal(explicitAverage.suggestions[0].latex, result.suggestions[0].latex)
})

test('finds equations embedded in prose and ignores unrelated sentences', () => {
  const result = scanMathText('The score is x^2 + y^2 = z^2 for all cases. The model is accurate.')
  assert.equal(result.suggestions.length, 1)
  assert.equal(result.suggestions[0].source, 'x^2 + y^2 = z^2')
  assert.equal(result.suggestions[0].latex, String.raw`x^{2} + y^{2} = z^{2}`)
  assert.equal(result.suggestions[0].level, 'high')
  assert.equal(scanMathText('The model is accurate. Reference [12] is useful.').suggestions.length, 0)
  const unicode = scanMathText('The identity x² + y² = z² holds.')
  assert.equal(unicode.suggestions.length, 1)
  assert.equal(unicode.suggestions[0].source, 'x² + y² = z²')
  assert.equal(unicode.suggestions[0].latex, String.raw`x^{2} + y^{2} = z^{2}`)
})

test('scans editor paragraphs, maps document positions and skips code, links, and existing math', () => {
  const expression = 'x^2 + y^2 = z^2'
  const prose = 'The score is '
  const paragraph = textBlock([textNode(prose), textNode(expression), textNode('.')])
  const linked = textBlock([textNode('a/b', 'link')])
  const code = textBlock([textNode('x=1')], 'codeBlock')
  const withMath = textBlock([textNode('already '), inlineNode(), textNode('ordinary prose')])
  const result = scanMathDocument(documentOf([paragraph, linked, code, withMath]))
  assert.equal(result.scannedBlocks, 3)
  assert.equal(result.suggestions.length, 1)
  assert.equal(result.suggestions[0].source, expression)
  assert.equal(result.suggestions[0].from, 1 + prose.length)
  assert.equal(result.suggestions[0].to, 1 + prose.length + expression.length)
  assert.equal(result.suggestions[0].blockEligible, false)
})

test('slash dates are not fractions and relations do not absorb neighbouring plain words', () => {
  assert.deepEqual(scanMathText('Ngày 12/05/2024 và tháng 05/2024 chúng tôi họp.').suggestions, [])
  assert.deepEqual(scanMathText('Tỷ lệ 50% (n=120) tham gia khảo sát.').suggestions.map(item => item.source), ['(n=120)'])
  assert.deepEqual(scanMathText('Mẫu gia (n=120) được chọn.').suggestions.map(item => item.source), ['(n=120)'])
  assert.deepEqual(scanMathText('Một nửa là 1/2 phần.').suggestions.map(item => item.source), ['1/2'])
  assert.deepEqual(scanMathText('Năng lượng E = mc^2 rất lớn.').suggestions.map(item => item.source), ['E = mc^2'])
})

test('marks a standalone equation as eligible for display math', () => {
  const paragraph = textBlock([textNode('x^2 + y^2 = z^2')])
  const [suggestion] = scanMathDocument(documentOf([paragraph])).suggestions
  assert.equal(suggestion.blockEligible, true)
  assert.equal(suggestion.defaultType, 'block')
})
