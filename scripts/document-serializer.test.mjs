import assert from 'node:assert/strict'
import test from 'node:test'
import { builtInDocumentTemplates, normalizeDocumentDelimiters, normalizeDocumentHeadings, reconcileEditorImagesIntoLatexSource, starter, textIn, toLatex } from '../src/services/DocumentSerializer.js'
import { sanitizeSettings } from '../src/services/DocumentSettings.js'

test('image captions are escaped and kept in generated and managed LaTeX', () => {
  const document = { type: 'doc', content: [{ type: 'imageBlock', attrs: { src: 'data:image/png;base64,iVBORw==', caption: 'Đồ thị A_B & 50%' } }] }
  const output = toLatex(document, 'Caption')
  assert.match(output.latex, /\\textit\{Đồ thị A\\_B \\& 50\\%\}/u)
  assert.equal(output.images[0].caption, 'Đồ thị A_B & 50%')
  const source = reconcileEditorImagesIntoLatexSource('\\documentclass{article}\n\\begin{document}\n\\end{document}', output.images, output.imageAnchors).source
  assert.match(source, /\\textit\{Đồ thị A\\_B \\& 50\\%\}/u)
})

test('abstract frame preserves order and safely escapes content across every built-in template', () => {
  for (const template of [undefined, ...builtInDocumentTemplates.map(item => item.source)]) {
    const { latex } = toLatex(starter, 'Frame title', template, { abstractEnabled: true, abstract: 'A_B & 95%.\n\nSecond paragraph.', tableOfContents: true })
    const title = latex.indexOf('\\maketitle')
    const abstract = latex.indexOf('\\begin{abstract}')
    const toc = latex.indexOf('\\tableofcontents')
    assert.ok(title < abstract && abstract < toc)
    assert.equal(latex.match(/\\begin\{abstract\}/g)?.length, 1)
    assert.match(latex, /A\\_B \\& 95\\%\.\n\nSecond paragraph\./)
    assert.match(latex, /\\begin\{center\}\\normalfont\\bfseries Abstract\\end\{center\}/)
    assert.match(latex, /\\leftskip=0pt\\rightskip=0pt/)
    assert.doesNotMatch(latex, /\{\{abstract\}\}/)
  }
})

test('legacy documents keep abstract disabled and custom templates receive one configured abstract', () => {
  assert.equal(sanitizeSettings({}).abstractEnabled, false)
  assert.doesNotMatch(toLatex(starter, 'Old').latex, /\\begin\{abstract\}/)
  const template = String.raw`\documentclass{article}\begin{document}\maketitle\begin{abstract}Old placeholder\end{abstract}{{content}}\end{document}`
  const { latex } = toLatex(starter, 'New', template, { abstractEnabled: true, abstract: 'New summary', abstractTitle: 'Tóm tắt' })
  assert.equal(latex.match(/\\begin\{abstract\}/g)?.length, 1)
  assert.doesNotMatch(latex, /Old placeholder/)
  assert.match(latex, /New summary/)
  assert.match(latex, /\\bfseries Tóm tắt/)
})

test('serializer escapes ordinary text and defines package-free strikethrough formatting', () => {
  const document = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'A_B & C', marks: [{ type: 'strike' }] }],
    }],
  }
  const result = toLatex(document, 'Bản_thảo')

  assert.match(result.latex, /\\title\{Bản\\_thảo\}/)
  assert.match(result.latex, /\\vietlatexstrike\{A\\_B \\& C\}/)
  assert.match(result.latex, /\\providecommand\{\\vietlatexstrike\}/)
  assert.doesNotMatch(result.latex, /\\usepackage\{ulem\}/)
})

test('plain Unicode subscripts and superscripts become LaTeX scripts without changing manuscript text', () => {
  const original = 'NO₂ CO₂ H₂O SO₄²⁻ m² xₜ ¹⁴C A₁₂ & 50%'
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: original, marks: [{ type: 'bold' }] }] }] }
  const { latex } = toLatex(document, 'NO₂', undefined, { author: 'CO₂', abstractEnabled: true, abstract: 'm² xₜ' })
  assert.ok(latex.includes(String.raw`\textbf{NO\textsubscript{2} CO\textsubscript{2} H\textsubscript{2}O SO\textsubscript{4}\textsuperscript{2-} m\textsuperscript{2} x\textsubscript{t} \textsuperscript{14}C A\textsubscript{12} \& 50\%}`))
  assert.ok(latex.includes(String.raw`\title{NO\textsubscript{2}}`))
  assert.ok(latex.includes(String.raw`\author{CO\textsubscript{2}}`))
  assert.ok(latex.includes(String.raw`m\textsuperscript{2} x\textsubscript{t}`))
  assert.doesNotMatch(latex, /[₂₄ₜ₁²⁻¹⁴]/u)
  assert.equal(document.content[0].content[0].text, original)
})

test('serializer inserts replacement tokens literally and does not reprocess body placeholders', () => {
  const apostropheToken = '\\' + '$' + "'"
  const backtickToken = '\\' + '$' + '`'
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Price $' tail and prefix $` + '`' + ' suffix' }] }] }
  const { latex } = toLatex(document, `Title $' tail and prefix $` + '`' + ' suffix')
  assert.ok(latex.includes(`\\title{Title ${apostropheToken} tail and prefix ${backtickToken} suffix}`))
  assert.ok(latex.includes(`Price ${apostropheToken} tail and prefix ${backtickToken} suffix`))
  assert.equal((latex.match(/\\end\{document\}/g) || []).length, 1)

  const rawPlaceholder = String.raw`\text{literal {{author}}}`
  const withRawPlaceholder = toLatex({ type: 'doc', content: [{ type: 'blockMath', attrs: { latex: rawPlaceholder } }] }, 'Placeholder', undefined, { author: 'Nguyễn Văn A' }).latex
  assert.ok(withRawPlaceholder.includes(rawPlaceholder))
})

test('built-in research templates preserve report chapters and journal heading and citation conventions', () => {
  const report = builtInDocumentTemplates.find(template => template.id === 'research-report')
  const article = builtInDocumentTemplates.find(template => template.id === 'research-article')
  const ieeeJournal = builtInDocumentTemplates.find(template => template.id === 'ieee-journal')
  const ieeeConference = builtInDocumentTemplates.find(template => template.id === 'ieee-conference')
  assert.ok(report && article && ieeeJournal && ieeeConference)
  assert.equal(builtInDocumentTemplates.length, 4)
  for (const template of builtInDocumentTemplates) {
    const headings = template.starterDocument.content.filter(node => node.type === 'heading').map(node => textIn(node))
    assert.ok(headings.length >= 6, `${template.name} needs a usable research-paper outline`)
  }

  const document = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Giới thiệu')] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Phương pháp')] },
    { type: 'heading', attrs: { level: 3 }, content: [text('Thiết kế nghiên cứu')] },
    para(text('Nội dung và trích dẫn '), { type: 'citation', attrs: { key: 'smith2026' } }),
  ] }
  const settings = { author: 'Nguyễn Văn A', date: '2026', bibliography: '@article{smith2026, title={Study}, author={Smith}, year={2026}}' }

  const reportLatex = toLatex(document, 'Báo cáo nghiên cứu', report.source, settings).latex
  assert.match(reportLatex, /\\documentclass\[12pt,a4paper\]\{report\}/)
  assert.equal((reportLatex.match(/\\chapter\{Giới thiệu\}/g) || []).length, 1)
  assert.match(reportLatex, /\\section\{Phương pháp\}/)
  assert.match(reportLatex, /\\subsection\{Thiết kế nghiên cứu\}/)
  assert.match(reportLatex, /\\printbibliography/)

  const articleDocument = { ...document, content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Introduction')] },
    ...document.content.slice(1),
  ] }
  const articleLatex = toLatex(articleDocument, 'Bài báo', article.source, settings).latex
  assert.match(articleLatex, /\\documentclass\[12pt,a4paper\]\{article\}/)
  assert.equal((articleLatex.match(/\\section\{Introduction\}/g) || []).length, 1)
  assert.match(articleLatex, /\\subsection\{Phương pháp\}/)

  for (const template of [ieeeJournal, ieeeConference]) {
    const latex = toLatex(document, 'Bài IEEE', template.source, settings).latex
    assert.match(latex, /\\documentclass\[[^\]]+\]\{IEEEtran\}/)
    assert.match(latex, /\\bibliographystyle\{IEEEtran\}/)
    assert.match(latex, /\\cite\{smith2026\}/)
    assert.doesNotMatch(latex, /\{\{(?:content|title|author|date|toc)\}\}/)
  }
})

test('serializer includes local image assets and the graphics package', () => {
  const document = {
    type: 'doc',
    content: [{ type: 'imageBlock', attrs: { src: 'data:image/png;base64,iVBORw==', alt: 'Hình' } }],
  }
  const result = toLatex(document, 'Hình')

  assert.match(result.latex, /\\usepackage\{graphicx\}/)
  assert.match(result.latex, /\\includegraphics\[width=0\.9\\linewidth,keepaspectratio\]\{image-1\.png\}/)
  assert.deepEqual(result.images, [{ filename: 'image-1.png', data: 'iVBORw==' }])
})

test('serializer preserves table cells and uses unboxed booktabs rules', () => {
  const document = {
    type: 'doc',
    content: [{
      type: 'table',
      attrs: { caption: 'Predictor budgets', label: 'tab:budget' },
      content: [{
        type: 'tableRow',
        content: ['(n,k)', 'p', 'RMSE', 'MAE', 'MAPE', 'R2'].map(value => ({ type: 'tableHeader', content: [para(text(value))] })),
      }, ...[
        ['(3,10)', '13', '0.0322', '0.0212', '31.97', '0.1165'],
        ['(6,15)', '21', '0.0352', '0.0235', '34.07', '-0.0584'],
      ].map(values => ({ type: 'tableRow', content: values.map(value => ({ type: 'tableCell', content: [para(text(value))] })) }))],
    }],
  }
  const { latex } = toLatex(document, 'Table')

  assert.match(latex, /\\begin\{longtable\}\{@\{\}lrrrrr@\{\}\}\s*\\caption\{Predictor budgets\}\\label\{tab:budget\}/)
  assert.ok(latex.includes('\\toprule'))
  assert.ok(latex.includes('\\textbf{(n,k)} & \\textbf{p} & \\textbf{RMSE} & \\textbf{MAE} & \\textbf{MAPE} & \\textbf{R2} \\\\\n\\midrule'))
  assert.ok(latex.includes('(3,10) & 13 & 0.0322 & 0.0212 & 31.97 & 0.1165 \\\\'))
  assert.ok(latex.includes('\\bottomrule'))
  assert.match(latex, /\\begingroup\s*\\small\s*\\setlength\{\\tabcolsep\}\{4pt\}/)
  assert.match(latex, /\\renewcommand\{\\arraystretch\}\{1\.2\}/)
  assert.match(latex, /\\setlength\{\\parskip\}\{0pt\}/)
  assert.match(latex, /\\end\{longtable\}\s*\\endgroup/)
  assert.match(latex, /\\endfirsthead/)
  assert.match(latex, /\\endhead/)
  assert.equal((latex.match(/\\caption\{Predictor budgets\}/g) || []).length, 1)
  assert.doesNotMatch(latex, /\\begin\{table\}|\\hline|\\begin\{longtable\}\{[^}]*\|/)
})

test('IEEE keeps compact tables in columns and moves long tables to breakable full-width pages', () => {
  const template = builtInDocumentTemplates.find(item => item.id === 'ieee-conference').source
  const row = value => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [para(text(value))] }] })
  const table = count => ({ type: 'doc', content: [{ type: 'table', content: Array.from({ length: count }, (_, i) => row(`Row ${i}`)) }] })
  const compact = toLatex(table(2), 'Compact', template).latex
  assert.match(compact, /\\begin\{table\}/)
  assert.doesNotMatch(compact, /\\onecolumn|\\begin\{longtable\}/)
  const long = toLatex(table(100), 'Long', template).latex
  assert.match(long, /\\onecolumn\s*\\begingroup/)
  assert.match(long, /\\begin\{longtable\}/)
  assert.match(long, /\\endgroup\s*\\twocolumn/)
})

test('normalizer converts delimited formula text and leaves the empty starter document valid', () => {
  const document = normalizeDocumentDelimiters({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Giá trị $x^2$' }] }],
  })

  assert.equal(document.content[0].content[1].type, 'inlineMath')
  assert.equal(document.content[0].content[1].attrs.latex, 'x^2')
  assert.deepEqual(starter, { type: 'doc', content: [{ type: 'paragraph' }] })
})

test('inline math wrappers stay inside their surrounding text instead of becoming display math', () => {
  for (const formula of ['$x^2$', '\\(x^2\\)']) {
    const document = normalizeDocumentDelimiters({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Giá trị ' + formula + ' trong câu.' }] }],
    })
    assert.equal(document.content[0].type, 'paragraph')
    assert.equal(document.content[0].content[1].type, 'inlineMath')
    assert.equal(document.content[0].content[1].attrs.latex, 'x^2')
    assert.equal(document.content[0].content.at(-1).text, ' trong câu.')
  }
})

test('normalizer recovers formulas pasted from sources that stripped the backslash of \\[ \\] and \\( \\)', () => {
  const hardBreak = { type: 'hardBreak' }
  const document = normalizeDocumentDelimiters({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '[' }, hardBreak, { type: 'text', text: String.raw`y_t=\beta_0+\mathbf{x}_t^{\prime}\boldsymbol{\beta}+\varepsilon_t,` }, hardBreak, { type: 'text', text: ']' }] },
    { type: 'paragraph', content: [{ type: 'text', text: String.raw`trong đó (y_t) là GDP growth và (\mathbf{x}_t) là predictor (Zou & Hastie, 2005), (xem file_name).` }] },
    { type: 'paragraph', content: [{ type: 'text', text: String.raw`\arg\min_{\boldsymbol{\beta}}` }, hardBreak, { type: 'text', text: String.raw`\left[\sum_t y_t^2\right],` }, hardBreak, { type: 'text', text: ']' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[' }, hardBreak, { type: 'text', text: String.raw`max_depth\in{2,3},` }, hardBreak, { type: 'text', text: ']' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[1] Smith, Journal (2020).' }] },
  ] })

  assert.deepEqual(document.content.map(node => node.type), ['blockMath', 'paragraph', 'blockMath', 'blockMath', 'paragraph'])
  assert.equal(document.content[0].attrs.latex, String.raw`y_t=\beta_0+\mathbf{x}_t^{\prime}\boldsymbol{\beta}+\varepsilon_t,`)
  assert.deepEqual(document.content[1].content.filter(node => node.type === 'inlineMath').map(node => node.attrs.latex), ['y_t', String.raw`\mathbf{x}_t`])
  assert.match(document.content[1].content.at(-1).text, /\(Zou & Hastie, 2005\), \(xem file_name\)\.$/)
  assert.equal(document.content[2].attrs.latex, String.raw`\arg\min_{\boldsymbol{\beta}} \left[\sum_t y_t^2\right],`)
  assert.equal(document.content[3].attrs.latex, String.raw`\text{max\textunderscore{}depth}\in\{2,3\},`)
  assert.equal(document.content[4].content[0].text, '[1] Smith, Journal (2020).')
})

test('reference entries stored as math are restored to prose and reference text is never formula-normalized', () => {
  const reference = String.raw`Breiman, L. (2001). Random forests. Machine Learning, 45(1), 5--32. https://doi.org/10.1023/A:1010933404324`
  const source = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('References')] },
    { type: 'blockMath', attrs: { latex: reference } },
    para(text('Reference note $x^2$ stays ordinary text.')),
    { type: 'heading', attrs: { level: 1 }, content: [text('Appendix')] },
    { type: 'blockMath', attrs: { latex: 'x^2+y^2' } },
  ] }
  const normalized = normalizeDocumentDelimiters(source)
  assert.equal(normalized.content[1].type, 'paragraph')
  assert.equal(textIn(normalized.content[1]), reference.replace('5--32', '5–32'))
  assert.equal(normalized.content[2].content.some(node => node.type === 'inlineMath'), false)
  assert.equal(normalized.content[4].type, 'blockMath')

  const latex = toLatex(source, 'References fix').latex
  assert.ok(latex.includes('Breiman, L. (2001). Random forests. Machine Learning'))
  assert.doesNotMatch(latex, /\\\[\s*Breiman, L\./)
})

test('an unheaded Word reference list repairs old math once and keeps DOI links across subsequent loads', () => {
  const doi = 'https://doi.org/10.1023/A:1010933404324'
  const reference = `Breiman, L. (2001). Random forests. Machine Learning, 45, 5–32. ${doi}`
  const source = { type: 'doc', content: [
    para(text('Bergmeir, C., Hyndman, R. J., & Koo, B. (2018). A note on cross-validation. Computational Statistics & Data Analysis, 120, 70–83. https://doi.org/10.1016/j.csda.2017.11.003')),
    { type: 'blockMath', attrs: { latex: reference } },
    para(text('Chaouch, A., & Ben Sassi, S. (2026). GDP nowcasting with machine learning. Economic Analysis and Policy, 92, 1117–1141. https://doi.org/10.1016/j.eap.2026.06.050')),
    { type: 'blockMath', attrs: { latex: String.raw`\sum_t x_t^2` } },
  ] }
  const normalized = normalizeDocumentDelimiters(source)
  assert.deepEqual(normalized.content.map(node => node.type), ['paragraph', 'paragraph', 'paragraph', 'blockMath'])
  assert.equal(textIn(normalized.content[1]), reference)
  assert.equal(normalized.content[1].content.find(node => node.marks?.some(mark => mark.type === 'link'))?.text, doi)
  assert.deepEqual(normalizeDocumentDelimiters(normalized), normalized)
  assert.equal(source.content[1].type, 'blockMath')
})

const body = content => toLatex({ type: 'doc', content }, 'T').latex
const para = (...content) => ({ type: 'paragraph', content })
const text = value => ({ type: 'text', text: value })

test('serializer escapes backslash and braces in a single pass', () => {
  assert.ok(body([para(text(String.raw`a\b{c}`))]).includes(String.raw`a\textbackslash{}b\{c\}`))
})

test('serializer drops empty math instead of emitting $$ or blank display blocks', () => {
  const latex = body([para(text('x'), { type: 'inlineMath', attrs: { latex: '  ' } }, text('y')), { type: 'blockMath', attrs: { latex: '' } }])
  assert.ok(latex.includes('xy'))
  assert.doesNotMatch(latex, /\$\$|\\\[\s*\\\]/)
  assert.ok(body([{ type: 'blockMath', attrs: { latex: 'a\n\n\n b' } }]).includes('\\[\na\n b\n\\]'))
})

test('hard breaks and list items cannot be misparsed by TeX', () => {
  const latex = body([para({ type: 'hardBreak' }, text('[1] x')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('[a] b'))] }] }])
  assert.ok(latex.includes('\\leavevmode\\newline \n[1] x'))
  assert.doesNotMatch(latex, /\\\\\n\[/)
  assert.ok(latex.includes('\\item\\relax [a] b'))
  assert.ok(body([{ type: 'heading', attrs: { level: 1 }, content: [text('A'), { type: 'hardBreak' }, text('B')] }]).includes('\\section{A B}'))
})

test('justified and left paragraphs are emitted as normal paragraphs', () => {
  for (const textAlign of ['justify', 'left']) {
    const latex = body([{ type: 'paragraph', attrs: { textAlign }, content: [text('Nội dung')] }])
    assert.doesNotMatch(latex, /flushleft/)
    assert.ok(latex.includes('Nội dung'))
  }
})

test('centered paragraphs avoid extra list spacing and generated source collapses empty paragraph runs', () => {
  const latex = body([
    para(text('Trước công thức')),
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('X_t = S_t E_t')] },
    para(),
    para(),
    para(text('Sau công thức')),
  ])

  assert.match(latex, /\{\\centering\nX\\_t = S\\_t E\\_t\\par\}/)
  assert.doesNotMatch(latex, /\\begin\{center\}/)
  assert.match(latex, /Trước công thức\n\n\{\\centering/)
  assert.match(latex, /\\par\}\n\nSau công thức/)
  const generatedBody = latex.slice(latex.indexOf('Trước công thức'), latex.indexOf('\\end{document}')).trim()
  assert.doesNotMatch(generatedBody, /\n[\t ]*\n[\t ]*\n/)
  assert.match(latex, /\\setlength\{\\parskip\}\{0\.5\\baselineskip\}/)
})

test('heading normalization keeps explicit labels in the editor but avoids duplicate LaTeX numbering', () => {
  const doc = { type: 'doc', content: [para(text('1. 2 Bước'))] }
  const once = normalizeDocumentHeadings(doc)
  assert.deepEqual(once.content[0], { type: 'heading', attrs: { level: 1 }, content: [text('1. 2 Bước')] })
  assert.deepEqual(normalizeDocumentHeadings(once), once)
  const latex = body(once.content)
  assert.match(latex, /\\section\{2 Bước\}/)
  assert.doesNotMatch(latex, /\\section\{1\. 2 Bước\}/)
})

test('common numbered title prefixes select matching heading depth without printing a second label', () => {
  const examples = [
    ['1. Walk-forward evaluation and the dimensionality of the predictor space', 1, /\\section\{Walk-forward evaluation and the dimensionality of the predictor space\}/],
    ['6.1.4. Lasso Regression', 3, /\\subsubsection\{Lasso Regression\}/],
  ]
  for (const [label, level, expectedLatex] of examples) {
    const normalized = normalizeDocumentHeadings({ type: 'doc', content: [para(text(label))] })
    assert.equal(normalized.content[0].type, 'heading')
    assert.equal(normalized.content[0].attrs.level, level)
    assert.equal(textIn(normalized.content[0]), label)
    const latex = body(normalized.content)
    assert.match(latex, expectedLatex)
    assert.doesNotMatch(latex, /\\(?:section|subsection|subsubsection)\{(?:1\.|6\.1\.4\.)/)
  }
})

test('an isolated 3.1.1 heading preserves its explicit number and a semantic reference label', () => {
  const document = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 3, label: 'sec:night' }, content: [text('3.1.1 Night time light')] },
    { type: 'heading', attrs: { level: 3 }, content: [text('Next measurement')] },
  ] }
  const original = structuredClone(document)
  const latex = toLatex(document, '3. Data').latex
  assert.match(latex, /\\setcounter\{section\}\{3\}\n\\setcounter\{subsection\}\{1\}\n\\setcounter\{subsubsection\}\{0\}\n\\subsubsection\{Night time light\}\\label\{sec:night\}/)
  assert.match(latex, /\\subsubsection\{Next measurement\}/)
  assert.doesNotMatch(latex, /\\subsubsection\*|\\subsubsection\{3\.1\.1/)
  assert.deepEqual(document, original, 'export must not rewrite the saved draft')
})

test('explicit nonsequential headings seed the matching counters in report templates', () => {
  const report = builtInDocumentTemplates.find(item => /\\documentclass\[.*\]\{report\}/.test(item.source))
  assert.ok(report)
  const document = { type: 'doc', content: [para(text('6.1.4. Lasso Regression'))] }
  const latex = toLatex(document, 'Model', report.source).latex
  assert.match(latex, /\\setcounter\{chapter\}\{6\}\n\\setcounter\{section\}\{1\}\n\\setcounter\{subsection\}\{3\}\n\\subsection\{Lasso Regression\}/)
})

test('numeric prefixes split across text marks preserve heading formatting and counter values', () => {
  const latex = body([{ type: 'heading', attrs: { level: 2 }, content: [
    text('3.'), { type: 'text', text: '7. Samples', marks: [{ type: 'bold' }] },
  ] }])
  assert.match(latex, /\\setcounter\{section\}\{3\}\n\\setcounter\{subsection\}\{6\}\n\\subsection\{\\textbf\{Samples\}\}/)
})

test('a numbered heading and body separated by Shift+Enter become distinct blocks without losing formatting', () => {
  const title = { type: 'text', text: '3.1 Dữ liệu vệ tinh', marks: [{ type: 'bold' }] }
  const bodyContent = [text('Nghiên cứu sử dụng 6 vệ tinh '), { type: 'inlineMath', attrs: { latex: 'x^2' } }, { type: 'hardBreak' }, { type: 'text', text: 'Dòng tiếp theo.', marks: [{ type: 'italic' }] }]
  const document = { type: 'doc', content: [
    { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [title, { type: 'hardBreak' }, ...bodyContent] },
    { type: 'heading', attrs: { level: 3 }, content: [text('3.1.1 Night time light')] },
  ] }
  const original = structuredClone(document)
  const normalized = normalizeDocumentHeadings(document)
  assert.deepEqual(normalized.content.map(node => [node.type, node.attrs.level]), [['heading', 2], ['paragraph', undefined], ['heading', 3]])
  assert.deepEqual(normalized.content[0].content, [title])
  assert.deepEqual(normalized.content[1], { type: 'paragraph', attrs: { textAlign: 'justify' }, content: bodyContent })
  assert.equal(normalizeDocumentHeadings(normalized), normalized, 'normalization must be idempotent')
  assert.deepEqual(document, original, 'normalization must not mutate the stored document')
  const latex = toLatex(document, '3. Data').latex
  assert.match(latex, /\\subsection\{\\textbf\{Dữ liệu vệ tinh\}\}/)
  assert.match(latex, /\\subsubsection\{Night time light\}/)
  assert.match(latex, /\\setcounter\{section\}\{3\}/)
})

test('consecutive heading lines normalize once while prose, lists and existing multiline headings stay intact', () => {
  const consecutive = para(text('3. Data'), { type: 'hardBreak' }, text('3.1 Satellites'), { type: 'hardBreak' }, text('3.1.1 Night time light'))
  const document = { type: 'doc', content: [consecutive] }
  const normalized = normalizeDocumentHeadings(document)
  assert.deepEqual(normalized.content.map(node => node.attrs.level), [1, 2, 3])
  assert.equal(normalizeDocumentHeadings(normalized), normalized)
  assert.equal(normalizeDocumentHeadings(document, { skipIndex: 0 }), document)
  for (const node of [
    para(text('3.1 triệu người tham gia.'), { type: 'hardBreak' }, text('Phần mô tả.')),
    para(text('Nội dung mở đầu.'), { type: 'hardBreak' }, text('3.1 Dữ liệu vệ tinh')),
    { type: 'orderedList', content: [{ type: 'listItem', content: [consecutive] }] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Heading'), { type: 'hardBreak' }, text('continued')] },
  ]) assert.equal(normalizeDocumentHeadings({ type: 'doc', content: [node] }).content[0], node)
})

test('bibliography headings are semantic unnumbered top-level headings', () => {
  const articleLatex = body([
    { type: 'heading', attrs: { level: 2 }, content: [text('References')] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Tài liệu tham khảo')] },
    para(text('Entry with a DOI')),
  ])
  assert.match(articleLatex, /\\section\*\{References\}/)
  assert.match(articleLatex, /\\section\*\{Tài liệu tham khảo\}/)
  assert.doesNotMatch(articleLatex, /\\(?:sub)?section\{(?:References|Tài liệu tham khảo)\}/)
  assert.match(articleLatex, /\\begin\{samepage\}[\s\S]*Entry with a DOI[\s\S]*\\end\{samepage\}/)

  const report = builtInDocumentTemplates.find(template => template.id === 'research-report')
  assert.ok(report)
  const reportLatex = toLatex({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [text('References')] }] }, 'T', report.source).latex
  assert.match(reportLatex, /\\chapter\*\{References\}/)
})

test('APA citations reuse a matching manual reference instead of appending a duplicate bibliography', () => {
  const doi = '10.1007/s10182-024-00515-0'
  const key = 'kant2025nowcasting'
  const bibliography = `@article{${key}, author={Kant, David and Pick, Adam and de Winter, Joost}, title={Nowcasting GDP using machine learning methods}, year={2025}, doi={${doi}}}`
  const document = { type: 'doc', content: [
    para(text('Citation '), { type: 'citation', attrs: { key } }),
    { type: 'heading', attrs: { level: 2 }, content: [text('References')] },
    para(text(`Kant, D., Pick, A., & de Winter, J. (2025). Nowcasting GDP using machine learning methods. https://doi.org/${doi}`)),
  ] }
  const latex = toLatex(document, 'T', undefined, { bibliography, citationStyle: 'apa' }).latex

  assert.equal((latex.match(/\\section\*\{/g) || []).length, 1)
  assert.doesNotMatch(latex, /\\bibliography\{references\}/)
  assert.match(latex, /\\hyperlink\{manual-ref-kant2025nowcasting\}\{\(Kant et al\., 2025\)\}/)
  assert.match(latex, /\\hypertarget\{manual-ref-kant2025nowcasting\}\{\}/)

  const unmatched = toLatex({ type: 'doc', content: [
    para(text('Citation '), { type: 'citation', attrs: { key } }),
    { type: 'heading', attrs: { level: 2 }, content: [text('References')] },
    para(text('An unrelated manually typed entry.')),
  ] }, 'T', undefined, { bibliography, citationStyle: 'apa' }).latex
  assert.match(unmatched, /\\citep\{kant2025nowcasting\}/)
  assert.match(unmatched, /\\addbibresource\{references.bib\}/)
  assert.doesNotMatch(unmatched, /\\section\*\{References\}|An unrelated manually typed entry/)
})

test('a configured bibliography does not invoke BibTeX when the document has no citations', () => {
  const bibliography = '@article{uncited2026, author={Writer, A}, title={An unused source}, year={2026}}'
  const document = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('References')] },
    para(text('Manually entered reference.')),
  ] }
  const latex = toLatex(document, 'T', undefined, { bibliography, citationStyle: 'apa' }).latex

  assert.match(latex, /Manually entered reference\./)
  assert.doesNotMatch(latex, /\\bibliography\{references\}/)
  assert.doesNotMatch(latex, /\\bibliographystyle\{/)
})

test('imported Word DOI links with surrounding whitespace remain breakable', () => {
  const doi = 'https://doi.org/10.1111/j.2517-6161.1996.tb02080.x'
  const latex = body([para(text('Tibshirani, R. (1996). Regression shrinkage. '), {
    type: 'text', text: ` ${doi} `,
    marks: [
      { type: 'link', attrs: { href: doi } },
      { type: 'textStyle', attrs: { color: '#1155cc', fontSize: '11pt' } },
      { type: 'underline' },
    ],
  })])
  assert.match(latex, /\\allowbreak/)
  assert.match(latex, /\\underline\{\\nolinkurl\{https:\}\}/)
  assert.doesNotMatch(latex, /\\underline\{ https/)
})

test('bare DOI links use breakable URL text and avoid boxing the full URL with underline', () => {
  const doi = 'https://doi.org/10.1016/j.csda.2017.11.003'
  const latex = body([para({
    type: 'text',
    text: doi,
    marks: [
      { type: 'link', attrs: { href: doi } },
      { type: 'textStyle', attrs: { color: '#1155cc' } },
      { type: 'underline' },
    ],
  })])

  assert.ok(latex.includes(`\\href{${doi}}{`))
  assert.match(latex, /\\underline\{\\nolinkurl\{https:\}\}\\allowbreak/)
  assert.match(latex, /\\underline\{\\nolinkurl\{10\.\}\}\\allowbreak/)
  assert.match(latex, /\\allowbreak/)
  assert.match(latex, /\\usepackage\{url\}/)
  assert.match(latex, /\\urlstyle\{rm\}/)
  assert.match(latex, /\\hypersetup\{pdfborder=\{0 0 0\}\}/)
  assert.doesNotMatch(latex, /\\underline\{[^}]*\\href/)
})

test('bare URLs with percent-encoding or fragments stay inside the href argument', () => {
  const href = 'https://vi.wikipedia.org/wiki/L%E1%BB%8Bch_s%E1%BB%AD#Ngu%E1%BB%93n'
  const link = marks => ({ type: 'paragraph', content: [{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }, ...marks] }] })
  const { latex } = toLatex({ type: 'doc', content: [link([]), link([{ type: 'underline' }])] }, 'T')
  const escaped = String.raw`L\%E1\%BB\%8Bch\_s\%E1\%BB\%AD\#Ngu\%E1\%BB\%93n`
  assert.ok(latex.includes(String.raw`\href{https://vi.wikipedia.org/wiki/` + escaped + String.raw`}{\nolinkurl{https://vi.wikipedia.org/wiki/` + escaped.replace(String.raw`\_`, '_') + '}}'))
  assert.ok(latex.includes(String.raw`\underline{\nolinkurl{L\%E1\%BB\%8Bch_}}`))
})
