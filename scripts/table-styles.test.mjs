import assert from 'node:assert/strict'
import test from 'node:test'
import { tableLatexPreview, toLatex } from '../src/services/DocumentSerializer.js'
import { isValidDocument } from '../src/services/DocumentData.js'
import { importWordAst, toWordAst } from '../src/services/WordDocument.js'
import { createPresetTable, normalizeTableStyle, TABLE_PRESETS, TABLE_STYLE_DEFAULTS, TABLE_STYLES } from '../src/services/TableStyles.js'
import { normalizeTableCaptions, tableCaptionParts, tableCaptionText } from '../src/services/TableCaptions.js'

const paragraph = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const cell = (type, text, attrs = {}) => ({ type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [paragraph(text)] })
const table = (attrs, rows) => ({ type: 'table', attrs, content: rows.map(content => ({ type: 'tableRow', content })) })
const simple = attrs => table(attrs, [
  [cell('tableHeader', 'Tên'), cell('tableHeader', 'Giá trị')],
  [cell('tableCell', 'A'), cell('tableCell', '1')],
  [cell('tableCell', 'B'), cell('tableCell', '2')],
  [cell('tableCell', 'C'), cell('tableCell', '3')],
])

test('table style attributes are whitelisted and fall back to defaults', () => {
  assert.deepEqual(normalizeTableStyle({}), TABLE_STYLE_DEFAULTS)
  assert.deepEqual(normalizeTableStyle(null), TABLE_STYLE_DEFAULTS)
  const hostile = normalizeTableStyle({ tableStyle: '}\\input{/etc/passwd}', fontSize: 'Huge}\\def', rowSpacing: '9}', tableWidth: 1, captionPosition: 'left', headerBold: 'no' })
  assert.deepEqual(hostile, TABLE_STYLE_DEFAULTS)
  const { latex } = toLatex({ type: 'doc', content: [simple({ tableStyle: '}\\input{x}', fontSize: '\\input{x}' })] }, 'T')
  assert.doesNotMatch(latex, /\\input\{x\}/)
  assert.match(latex, /\\toprule/)
})

test('tables saved before the table library keep the academic layout', () => {
  const latex = tableLatexPreview(simple({ caption: '', label: '' }))
  assert.match(latex, /^\\begingroup\n\\small\n/)
  assert.match(latex, /\\renewcommand\{\\arraystretch\}\{1\.2\}/)
  assert.match(latex, /\\begin\{longtable\}\{@\{\}lr@\{\}\}/)
  assert.doesNotMatch(latex, /\\caption|\\tablename|\\thetable/)
  assert.match(latex, /\\textbf\{Tên\}/)
  assert.doesNotMatch(latex, /\\rowcolor|\\hline/)
})

test('each table style emits its own rules', () => {
  const rules = style => {
    const latex = tableLatexPreview(simple({ tableStyle: style }))
    return { latex, toprule: /\\toprule/.test(latex), midrule: /\\midrule/.test(latex), bottomrule: /\\bottomrule/.test(latex), hline: /\\hline/.test(latex), rowcolor: (latex.match(/\\rowcolor/g) || []).length }
  }
  assert.deepEqual(TABLE_STYLES.map(item => item.id), ['academic', 'grid', 'striped', 'shaded', 'minimal', 'plain'])
  assert.deepEqual(Object.values(rules('academic')).slice(1), [true, true, true, false, 0])
  const grid = rules('grid')
  assert.deepEqual(Object.values(grid).slice(1), [false, false, false, true, 0])
  assert.match(grid.latex, /\\begin\{longtable\}\{\|l\|r\|\}/)
  const striped = rules('striped')
  assert.equal(striped.toprule && striped.bottomrule, true)
  // Second body row only (header and the first body row stay white); repeated
  // longtable headers are not striped.
  assert.match(striped.latex, /\\rowcolor\[HTML\]\{F2F2F2\}B & 2/)
  assert.doesNotMatch(striped.latex, /\\rowcolor\[HTML\]\{F2F2F2\}(?:A|C) &/)
  assert.match(striped.latex, /\\setlength\{\\aboverulesep\}\{0pt\}/)
  assert.match(striped.latex, /\\begin\{longtable\}\{lr\}/, 'coloured tables keep outer padding so colour does not overhang the rules')
  const shaded = rules('shaded')
  assert.match(shaded.latex, /\\rowcolor\[HTML\]\{E6E6E6\}\\textbf\{Tên\}/)
  assert.deepEqual(Object.values(rules('minimal')).slice(1), [false, true, false, false, 0])
  assert.deepEqual(Object.values(rules('plain')).slice(1), [false, false, false, false, 0])
})

test('coloured tables load xcolor and colortbl; grid tables load array only', () => {
  const coloured = toLatex({ type: 'doc', content: [simple({ tableStyle: 'striped' })] }, 'T').latex
  assert.match(coloured, /\\usepackage\{xcolor\}[\s\S]*\\usepackage\{colortbl\}/)
  const grid = toLatex({ type: 'doc', content: [simple({ tableStyle: 'grid', tableWidth: 'full' })] }, 'T').latex
  assert.match(grid, /\\usepackage\{array\}/)
  assert.doesNotMatch(grid, /\\usepackage\{(?:booktabs|colortbl)\}/)
  const plain = toLatex({ type: 'doc', content: [simple({ tableStyle: 'plain' })] }, 'T').latex
  assert.match(plain, /\\usepackage\{array\}/, '\\extrarowheight comes from the array package')
})

test('font size, row spacing, width, caption position and header weight are applied', () => {
  const latex = tableLatexPreview(simple({ fontSize: 'footnotesize', rowSpacing: '1.5', tableWidth: 'full', captionPosition: 'bottom', headerBold: false, caption: 'Kết quả' }))
  assert.match(latex, /^\\begingroup\n\\footnotesize\n/)
  assert.match(latex, /\\arraystretch\}\{1\.5\}/)
  assert.match(latex, /\\begin\{longtable\}\{@\{\}>\{\\raggedright\\arraybackslash\}p\{[\d.]+\\linewidth\}>\{\\raggedleft\\arraybackslash\}p\{[\d.]+\\linewidth\}@\{\}\}/)
  assert.match(latex, /\\bottomrule\n\\caption\*\{Kết quả\} \\\\\n\\endlastfoot/)
  assert.doesNotMatch(latex, /\\endfirsthead[\s\S]*\\caption[\s\S]*\\endhead/)
  assert.doesNotMatch(latex, /\\textbf/)
  const natural = tableLatexPreview(table({ tableWidth: 'natural' }, [[cell('tableCell', 'x'.repeat(60)), cell('tableCell', 'y')]]))
  assert.match(natural, /\\begin\{longtable\}\{@\{\}ll@\{\}\}/)
})

test('cell alignment sets the column type and overrides single cells', () => {
  const latex = tableLatexPreview(table({}, [
    [cell('tableHeader', 'Tên', { align: 'center' }), cell('tableHeader', 'Ghi chú')],
    [cell('tableCell', 'A', { align: 'center' }), cell('tableCell', 'trái')],
    [cell('tableCell', 'B', { align: 'center' }), cell('tableCell', 'phải', { align: 'right' })],
    [cell('tableCell', 'C', { align: 'right' }), cell('tableCell', 'trái')],
  ]))
  assert.match(latex, /\\begin\{longtable\}\{@\{\}cl@\{\}\}/)
  assert.match(latex, /\\multicolumn\{1\}\{@\{\}r\}\{C\}/)
  assert.match(latex, /\\multicolumn\{1\}\{r@\{\}\}\{phải\}/)
  assert.doesNotMatch(latex, /\\multicolumn\{1\}\{[^}]*\}\{A\}/)
})

test('merged cells stay inside their columns and grid rules skip continuing rows', () => {
  const rows = [
    [cell('tableHeader', 'Nhóm', { rowspan: 2 }), cell('tableHeader', 'Kết quả', { colspan: 2 }), cell('tableHeader', 'Ghi chú rất dài cần xuống dòng trong cột để kiểm tra độ rộng', { rowspan: 2 })],
    [cell('tableHeader', '2025'), cell('tableHeader', '2026')],
    [cell('tableCell', 'A', { rowspan: 2 }), cell('tableCell', '1'), cell('tableCell', '2'), cell('tableCell', 'x')],
    [cell('tableCell', '3'), cell('tableCell', '4'), cell('tableCell', 'y')],
  ]
  const academic = tableLatexPreview(table({}, rows))
  assert.match(academic, /\\multirow\{2\}\{=\}\{\\textbf\{Ghi chú/, 'paragraph columns wrap merged text')
  assert.match(academic, /\\multirow\{2\}\{\*\}\{A\}/)
  assert.match(academic, /\\multicolumn\{2\}\{c\}\{\\textbf\{Kết quả\}\}|\\multicolumn\{2\}\{l\}\{\\textbf\{Kết quả\}\}/)
  const grid = tableLatexPreview(table({ tableStyle: 'grid' }, rows))
  assert.match(grid, /\\\\\*\n\\cline\{2-3\}\n/, 'the header rule skips both vertically merged columns')
  assert.match(grid, /A\} & 1 & 2 & x \\\\\*\n\\cline\{2-4\}\n/)
  assert.match(grid, / & 3 & 4 & y \\\\\n\\hline\n/)
  const shaded = tableLatexPreview(table({ tableStyle: 'shaded' }, rows))
  // Typeset from the last merged row so the next \rowcolor cannot paint over it.
  assert.match(shaded, /\\rowcolor\[HTML\]\{E6E6E6\} & \\multicolumn/)
  assert.match(shaded, /\\rowcolor\[HTML\]\{E6E6E6\}\\multirow\{-2\}\{[*=]\}\{\\textbf\{Nhóm\}\}/)
})

test('a rowspan past the last row still closes a grid table', () => {
  const latex = tableLatexPreview(table({ tableStyle: 'grid' }, [
    [cell('tableCell', 'A', { rowspan: 9 }), cell('tableCell', '1')],
    [cell('tableCell', '2')],
  ]))
  assert.match(latex, /\\multirow\{2\}/)
  assert.match(latex, / & 2 \\\\\n\\hline\n\\end\{longtable\}/)
})

test('LaTeX export preserves merged spans supported by the document model', () => {
  const wide = table({}, [[cell('tableCell', 'Wide merged cell', { colspan: 21 })]])
  assert.equal(isValidDocument({ type: 'doc', content: [wide] }), true)
  assert.match(tableLatexPreview(wide), /\\multicolumn\{21\}/)
  const tall = table({}, [
    [cell('tableCell', 'Tall merged cell', { rowspan: 101 }), cell('tableCell', 'First')],
    ...Array.from({ length: 100 }, () => [cell('tableCell', 'Next')]),
  ])
  assert.equal(isValidDocument({ type: 'doc', content: [tall] }), true)
  assert.match(tableLatexPreview(tall), /\\multirow\{101\}/)
})

test('Word column specifications include columns occupied by continuing merged cells', () => {
  const node = table({}, [
    [cell('tableCell', 'Continuing', { rowspan: 2 }), cell('tableCell', 'First')],
    [cell('tableCell', 'Second'), cell('tableCell', 'Third')],
  ])
  assert.equal(isValidDocument({ type: 'doc', content: [node] }), true)
  const ast = toWordAst({ type: 'doc', content: [node] }, 'Merged grid')
  assert.equal(ast.blocks[0].c[2].length, 3)
})

test('oversized legacy merged grids remain recoverable and report a clear Word export limit', () => {
  const node = table({}, [
    [cell('tableCell', 'Continuing', { rowspan: 2, colspan: 256 })],
    [cell('tableCell', 'One column too many')],
  ])
  assert.equal(isValidDocument({ type: 'doc', content: [node] }), true)
  assert.throws(() => toWordAst({ type: 'doc', content: [node] }, 'Overflow'), /vượt giới hạn 256/)
})

test('library presets create valid documents in every style', () => {
  for (const preset of TABLE_PRESETS) {
    const node = createPresetTable(preset)
    assert.ok(isValidDocument({ type: 'doc', content: [node] }), preset.id)
    assert.equal(node.content.length, preset.rows + (preset.noHeader ? 0 : 1))
    const resized = createPresetTable(preset, { rows: 2, cols: 6 })
    assert.equal(resized.content.at(-1).content.length, 6)
    assert.ok(tableLatexPreview(resized).includes('\\begin{longtable}'))
  }
})

test('cell alignment survives Word export and import', async () => {
  const doc = { type: 'doc', content: [table({ caption: 'Căn lề' }, [
    [cell('tableHeader', 'Tên'), cell('tableHeader', 'Số', { align: 'right' })],
    [cell('tableCell', 'A', { align: 'center' }), cell('tableCell', '1', { align: 'right' })],
    [cell('tableCell', 'B', { align: 'center' }), cell('tableCell', '2', { align: 'right' })],
  ])] }
  const ast = toWordAst(doc, 'T')
  const pandocTable = ast.blocks.find(block => block.t === 'Table')
  assert.deepEqual(pandocTable.c[2].map(spec => spec[0].t), ['AlignCenter', 'AlignRight'])
  assert.equal(pandocTable.c[4][0][3][0][1][0][1].t, 'AlignCenter')
  const { document: imported } = await importWordAst(ast)
  const importedTable = imported.content.find(node => node.type === 'table')
  assert.deepEqual(importedTable.content.map(row => row.content.map(item => item.attrs.align ?? null)), [['center', 'right'], ['center', 'right'], ['center', 'right']], 'header cells without their own alignment take the column alignment')
})

test('legacy captions split into manual numbers and English Table captions in every layout', () => {
  const captions = ['', 'Table 5.2.2. Forecast comparison', 'Table ???', 'table S1: Robustness', 'Bảng 7. Bản nháp', 'Results without a number']
  for (const twoColumn of [false, true]) {
    const template = `\\documentclass${twoColumn ? '[twocolumn]' : ''}{article}\n\\begin{document}\n{{content}}\n\\end{document}`
    for (const captionPosition of ['top', 'bottom']) {
      const { latex } = toLatex({ type: 'doc', content: captions.map(caption => simple({ caption, captionPosition })) }, 'T', template)
      assert.doesNotMatch(latex, /\\caption\{|\\tablename|\\thetable|\\refstepcounter\{table\}/)
      for (const caption of captions.filter(Boolean)) assert.equal(latex.split(tableCaptionText({ caption })).length - 1, 1, caption)
      for (const [index, number] of ['??', '5.2.2', '???', 'S1', '7', '??'].entries()) {
        assert.ok(latex.includes(`\\vietlatextablelabel{${number}}{tab:table-${index + 1}}`), number)
      }
    }
  }
  const blank = tableLatexPreview(simple({ caption: '' }))
  assert.doesNotMatch(blank, /\\caption|\\tablename|\\thetable/)
})

test('Table No. is independent of the title and survives Word roundtrip', async () => {
  for (const tableNumber of ['5.2.2', '???', 'S1', '']) {
    const attrs = { tableNumber, caption: 'Forecast comparison', label: 'tab:manual' }
    const expected = tableNumber ? `Table ${tableNumber}. Forecast comparison` : 'Forecast comparison'
    assert.equal(tableCaptionText(attrs), expected)
    const source = tableLatexPreview(simple(attrs))
    assert.ok(source.includes(`\\caption*{${expected}}`))
    assert.ok(source.includes(`\\vietlatextablelabel{${tableNumber || '??'}}{tab:manual}`))
    const ast = toWordAst({ type: 'doc', content: [simple(attrs)] }, 'T')
    const imported = await importWordAst(ast)
    assert.deepEqual(tableCaptionParts(imported.document.content[0].attrs), { tableNumber, caption: attrs.caption })
  }
  assert.equal(tableCaptionText({ tableNumber: '???', caption: '' }), 'Table ???')
  const legacy = { type: 'doc', content: [simple({ caption: 'Bảng 5.2.2. Đối chiếu dự báo' })] }
  const normalized = normalizeTableCaptions(legacy)
  assert.equal(normalized.content[0].attrs.tableNumber, '5.2.2')
  assert.equal(normalized.content[0].attrs.caption, 'Đối chiếu dự báo')
  assert.equal(normalizeTableCaptions(normalized), normalized)
  assert.equal(legacy.content[0].attrs.caption, 'Bảng 5.2.2. Đối chiếu dự báo')
  for (const tableNumber of [123, 'x'.repeat(51)]) assert.equal(isValidDocument({ type: 'doc', content: [simple({ tableNumber })] }), false)
  const safe = tableLatexPreview(simple({ tableNumber: '5}\\input{x}', caption: 'A & B' }))
  assert.doesNotMatch(safe, /\\input\{x\}/)
})

test('table notes are typeset under the table, with inline math', () => {
  const note = 'Ghi chú: RMSE tính theo điểm % với $p = n+k$; giá $5 và $10.'
  const latex = tableLatexPreview(simple({ caption: 'Kết quả', note }))
  assert.ok(latex.includes('\\end{longtable}\n\\nopagebreak\n\\par\\vspace{3pt}\n{\\footnotesize\\setlength{\\parindent}{0pt}\\textit{Ghi chú:} RMSE tính theo điểm \\% với $p = n+k$; giá \\$5 và \\$10.\\par}\n\\vspace{\\LTpost}\n\\endgroup'), latex)
  assert.ok(latex.includes('\\setlength{\\LTpost}{0pt}\n\\begin{longtable}'))
  assert.ok(tableLatexPreview(simple({ note: 'Số liệu năm 2025' })).includes('\\textit{Note:} Số liệu năm 2025'))
  assert.ok(tableLatexPreview(simple({ note: 'Nguồn: Tổng cục Thống kê' })).includes('\\textit{Nguồn:} Tổng cục Thống kê'))
  assert.ok(tableLatexPreview(simple({ note: 'Lỗi $x}$' })).includes('Lỗi \\$x\\}\\$'))
  const floating = toLatex({ type: 'doc', content: [simple({ caption: 'A', note: 'Đơn vị: %' })] }, 'T', '\\documentclass[twocolumn]{article}\n\\begin{document}\n{{content}}\n\\end{document}').latex
  assert.ok(floating.includes('{\\small A\\par}\n\\vspace{\\belowcaptionskip}\n\\begingroup\n'), floating)
  assert.ok(floating.includes('\\setlength{\\parindent}{0pt}\n\\setbox0=\\hbox{\\begin{tabular}'), 'no line end of the style settings is typeset as a space in the box')
  assert.ok(floating.includes('\\end{tabular}}%\n\\ifdim\\wd0>\\linewidth\\setbox0=\\hbox{\\resizebox{\\linewidth}{!}{\\box0}}\\fi\n\\xdef\\vietlatextablewidth{\\the\\wd0}%\n\\leavevmode\\box0\\par\n\\endgroup\n\\noindent\\parbox{\\vietlatextablewidth}{\\vspace{3pt}\n\\footnotesize\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{0pt}\\textit{Đơn vị:} \\%\\par}\n\\end{table}'), floating)
  const below = toLatex({ type: 'doc', content: [simple({ caption: 'A', note: 'B', captionPosition: 'bottom' })] }, 'T', '\\documentclass[twocolumn]{article}\n\\begin{document}\n{{content}}\n\\end{document}').latex
  assert.ok(below.includes('\\leavevmode\\box0\\par\n\\endgroup\n\\par\\vspace{\\abovecaptionskip}\n{\\small A\\par}\n\\vspace{\\belowcaptionskip}\n\\noindent\\parbox{\\vietlatextablewidth}'), 'a caption below the table comes before the note')
  assert.ok(isValidDocument({ type: 'doc', content: [simple({ note })] }))
  assert.equal(isValidDocument({ type: 'doc', content: [simple({ note: 'x'.repeat(2001) })] }), false)
  const word = toWordAst({ type: 'doc', content: [simple({ note: 'Đơn vị: %' })] }, 'T')
  const index = word.blocks.findIndex(block => block.t === 'Table')
  assert.equal(word.blocks[index + 1].t, 'Para')
})

test('short tables stay on one page and long ones keep two rows on each end', () => {
  const rows = count => tableLatexPreview(table({}, [
    [cell('tableHeader', 'A'), cell('tableHeader', 'B')],
    ...Array.from({ length: count }, (_, index) => [cell('tableCell', `r${index}`), cell('tableCell', String(index))]),
  ]))
  const short = rows(5)
  for (const index of [0, 1, 2, 3]) assert.ok(short.includes(`r${index} & ${index} \\\\*\n`), `row ${index}`)
  assert.ok(short.includes('r4 & 4 \\\\\n'))
  const long = rows(14)
  assert.ok(long.includes('r0 & 0 \\\\*\n'))
  assert.ok(long.includes('r1 & 1 \\\\\n'))
  assert.ok(long.includes('r12 & 12 \\\\*\n'))
  assert.ok(long.includes('r13 & 13 \\\\\n'))
})

test('two-column tables too wide for one column span both and never overflow', () => {
  const template = String.raw`\documentclass[conference]{IEEEtran}
\begin{document}
{{content}}
\end{document}`
  const headers = ['Window', 'Model', 'Configuration (n, k)', 'Total p', 'RMSE (pp)', 'MAE (pp)', 'R2 OOS']
  const wide = table({ caption: 'Rộng' }, [headers.map(text => cell('tableHeader', text)), headers.map(() => cell('tableCell', '2013Q1'))])
  const latex = toLatex({ type: 'doc', content: [wide, simple({ caption: 'Hẹp' })] }, 'T', template).latex
  assert.match(latex, /\\begin\{table\*\}\[tp\][\s\S]*?\{\\small Rộng\\par\}/)
  assert.match(latex, /\\begin\{table\}\[htbp\][\s\S]*?\{\\small Hẹp\\par\}/)
  assert.equal((latex.match(/\\resizebox\{\\linewidth\}\{!\}\{\\box0\}/g) || []).length, 2)
  assert.match(latex, /\\usepackage\{graphicx\}/)
})

test('dollar-delimited math in table cells becomes inline math', async () => {
  const { delimitedMathReplacements } = await import('../src/services/DocumentSerializer.js')
  const [replacement] = delimitedMathReplacements([simple({}), table({}, [[cell('tableHeader', 'Total $p$')], [cell('tableCell', '$(4, 0)$')]])])
  assert.equal(replacement.start, 1)
  const cells = replacement.nodes[0].content.map(row => row.content[0].content[0].content)
  assert.deepEqual(cells[0].map(node => node.type), ['text', 'inlineMath'])
  assert.equal(cells[1][0].attrs.latex, '(4, 0)')
  assert.equal(delimitedMathReplacements([simple({})]).length, 0)
})
