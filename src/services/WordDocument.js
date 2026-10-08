import { ImageEncoder } from './ImageEncoder.js'
import { citationKeys, isAuthorYearStyle, isCitationKey, parseBibtex, resolveCitationStyle, shortAuthors } from './Bibliography.js'
import { isValidDocument, MAX_TABLE_COLUMNS } from './DocumentData.js'
import { downloadBlob } from './ArchiveService.js'
import { MAX_DOCUMENT_IMAGES, MAX_LATEX_SOURCE_BYTES, MAX_WORD_DOCUMENT_BYTES } from './DocumentLimits.js'
import { isValidBase64, matchesImageSignature } from './ProjectAssets.js'

const attr = ['', [], []]
const wordMarks = { Strong: 'bold', Emph: 'italic', Strikeout: 'strike', Underline: 'underline', Superscript: 'superscript', Subscript: 'subscript' }
const markWords = Object.fromEntries(Object.entries(wordMarks).map(([word, mark]) => [mark, word]))
// The backend accepts exactly this raw block; Pandoc has no page-break node.
export const WORD_PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
const paragraph = content => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
function plain(inlines = []) { return inlines.map(item => item.t === 'Str' ? item.c : ['Space', 'SoftBreak', 'LineBreak'].includes(item.t) ? ' ' : Array.isArray(item.c) ? plain(item.c) : '').join('') }
export function dataUrlToBlob(url) {
  const match = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(String(url || ''))
  if (!match) throw new Error('Ảnh trong tài liệu Word không hợp lệ.')
  const text = match[3] ? atob(match[4].replace(/\s/g, '')) : decodeURIComponent(match[4])
  const bytes = match[3] ? Uint8Array.from(text, character => character.charCodeAt(0)) : new TextEncoder().encode(text)
  return new Blob([bytes], { type: match[1] || 'application/octet-stream' })
}

export async function importWordAst(ast) {
  const warnings = new Set()
  const encoder = new ImageEncoder()
  let imageCount = 0
  async function inline(items, marks = []) {
    const result = []
    for (const item of items || []) {
      const text = value => result.push({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
      if (item.t === 'Str') text(item.c)
      else if (['Space', 'SoftBreak'].includes(item.t)) text(' ')
      else if (item.t === 'LineBreak') result.push({ type: 'hardBreak' })
      else if (wordMarks[item.t]) result.push(...await inline(item.c, [...marks, { type: wordMarks[item.t] }]))
      else if (item.t === 'Code') result.push({ type: 'text', text: item.c[1], marks: [...marks, { type: 'code' }] })
      else if (item.t === 'Math') result.push({ type: item.c[0].t === 'DisplayMath' ? 'blockMath' : 'inlineMath', attrs: { latex: item.c[1] } })
      else if (item.t === 'Link') result.push(...await inline(item.c[1], [...marks, { type: 'link', attrs: { href: item.c[2][0] } }]))
      else if (item.t === 'Image') {
        if (!item.c[2][0]) { warnings.add('Một ảnh có định dạng chưa hỗ trợ đã được thay bằng mô tả.'); text(`[Ảnh: ${plain(item.c[1])}]`); continue }
        if (++imageCount > MAX_DOCUMENT_IMAGES) throw new Error(`Tài liệu Word có hơn ${MAX_DOCUMENT_IMAGES} ảnh. Hãy tách tài liệu trước khi nhập.`)
        const blob = dataUrlToBlob(item.c[2][0])
        const src = await encoder.encode(blob)
        result.push({ type: 'imageBlock', attrs: { src, alt: plain(item.c[1]), filename: '' } })
      } else if (item.t === 'Note') result.push({ type: 'footnote', attrs: { text: item.c.map(block => plain(block.c)).join(' ') } })
      else if (item.t === 'Span') result.push(...await inline(item.c[1], item.c[0][1]?.includes('mark') ? [...marks, { type: 'highlight', attrs: { color: null } }] : marks))
      else if (item.t === 'Quoted') { text('“'); result.push(...await inline(item.c[1], marks)); text('”') }
      else if (item.t === 'Cite') {
        const keys = (item.c[0] || []).map(citation => citation?.citationId)
        if (keys.length && keys.every(isCitationKey)) result.push({ type: 'citation', attrs: { key: keys.join(','), ...(item.c[0]?.[0]?.citationMode?.t === 'AuthorInText' ? { mode: 'narrative' } : {}) } })
        else result.push(...await inline(item.c[1], marks))
      }
      else { warnings.add(`Đã giản lược thành phần Word: ${item.t}`); const value = typeof item.c === 'string' ? item.c : plain(item.c); if (value) text(value) }
    }
    return result
  }
  async function blocks(items) {
    const result = []
    for (const item of items || []) {
      if (['Para', 'Plain', 'Header'].includes(item.t)) {
        const children = await inline(item.t === 'Header' ? item.c[2] : item.c)
        let current = []
        const flush = () => { if (current.length) { result.push(item.t === 'Header' ? { type: 'heading', attrs: { level: Math.min(3, item.c[0]), label: item.c[1][0] }, content: current } : paragraph(current)); current = [] } }
        for (const child of children) { if (['imageBlock', 'blockMath'].includes(child.type)) { flush(); result.push(child) } else current.push(child) }
        flush()
        if (!children.length) result.push(paragraph([]))
      } else if (item.t === 'BulletList' || item.t === 'OrderedList') {
        const content = await Promise.all((item.t === 'BulletList' ? item.c : item.c[1]).map(async row => ({ type: 'listItem', content: await blocks(row) })))
        result.push({ type: item.t === 'BulletList' ? 'bulletList' : 'orderedList', attrs: item.t === 'OrderedList' ? { start: item.c[0][0] } : {}, content })
      } else if (item.t === 'BlockQuote') result.push({ type: 'blockquote', content: await blocks(item.c) })
      else if (item.t === 'CodeBlock') result.push({ type: 'codeBlock', ...(item.c[1] ? { content: [{ type: 'text', text: item.c[1] }] } : {}) })
      else if (item.t === 'HorizontalRule') result.push({ type: 'horizontalRule' })
      else if (item.t === 'Div') result.push(...await blocks(item.c[1]))
      else if (item.t === 'Table') {
        const rows = [...item.c[3][1].map(row => [row, true]), ...item.c[4].flatMap(body => [...body[2], ...body[3]].map(row => [row, false])), ...item.c[5][1].map(row => [row, false])]
        const content = await Promise.all(rows.map(async ([row, header]) => ({ type: 'tableRow', content: await Promise.all(row[1].map(async cell => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { rowspan: cell[2], colspan: cell[3] }, content: await blocks(cell[4]) }))) })))
        const caption = item.c[1][1].map(block => plain(block.c)).join(' ').trim()
        const requestedLabel = item.c[0][0] || ''
        const label = /^[A-Za-z0-9:._-]{1,100}$/.test(requestedLabel) ? requestedLabel : ''
        if (caption.length > 500) warnings.add('Chú thích bảng dài hơn 500 ký tự đã được rút gọn.')
        result.push({ type: 'table', attrs: { caption: caption.slice(0, 500), label }, content })
      } else if (item.t === 'Figure') { warnings.add('Chú thích hình được chuyển thành đoạn văn.'); result.push(...await blocks(item.c[2])) }
      else warnings.add(`Thành phần Word chưa chuyển được: ${item.t}`)
    }
    return result.length ? result : [paragraph([])]
  }
  const document = { type: 'doc', content: await blocks(ast.blocks) }
  if (!isValidDocument(document)) throw new Error('Cấu trúc Word vượt giới hạn tài liệu; bản gốc vẫn được giữ nguyên.')
  return { document, warnings: [...warnings] }
}

export function toWordAst(doc, title, settings = {}, templateSource = '') {
  const style = resolveCitationStyle(settings.citationStyle, templateSource)
  const byKey = new Map(parseBibtex(settings.bibliography || '').map(entry => [entry.key, entry]))
  function inline(node) {
    if (node.type === 'text') {
      let output = node.text.split(/(\s+)/).filter(Boolean).map(part => /^\s+$/.test(part) ? { t: 'Space' } : { t: 'Str', c: part })
      for (const mark of node.marks || []) {
        if (mark.type === 'code') output = [{ t: 'Code', c: [attr, node.text] }]
        else if (mark.type === 'link') output = [{ t: 'Link', c: [attr, output, [mark.attrs.href, '']] }]
        else if (markWords[mark.type]) output = [{ t: markWords[mark.type], c: output }]
        else if (mark.type === 'highlight') output = [{ t: 'Span', c: [['', ['mark'], []], output] }]
      }
      return output
    }
    if (node.type === 'inlineMath' || node.type === 'blockMath') return [{ t: 'Math', c: [{ t: node.type === 'blockMath' ? 'DisplayMath' : 'InlineMath' }, node.attrs.latex] }]
    if (node.type === 'hardBreak') return [{ t: 'LineBreak' }]
    if (node.type === 'imageBlock') return [{ t: 'Image', c: [attr, [{ t: 'Str', c: node.attrs.alt || 'Ảnh' }], [node.attrs.src, '']] }]
    if (node.type === 'footnote') return [{ t: 'Note', c: [{ t: 'Para', c: [{ t: 'Str', c: node.attrs.text }] }] }]
    if (node.type === 'citation') {
      const keys = citationKeys(node.attrs.key)
      if (!keys.length) return []
      const cite = (group, narrative = false) => ({ t: 'Cite', c: [group.map((key, index) => ({ citationId: key, citationPrefix: [], citationSuffix: [], citationMode: { t: narrative && index === 0 ? 'AuthorInText' : 'NormalCitation' }, citationNoteNum: 0, citationHash: 0 })), [{ t: 'Str', c: `[@${group.join('; @')}]` }]] })
      if (node.attrs?.mode === 'narrative' && !isAuthorYearStyle(style)) return keys.flatMap((key, index) => [...(index ? [{ t: 'Str', c: ';' }, { t: 'Space' }] : []), { t: 'Str', c: shortAuthors(byKey.get(key), 'and') || key }, { t: 'Space' }, cite([key])])
      return [cite(keys, node.attrs?.mode === 'narrative')]
    }
    if (node.type === 'crossReference') return [{ t: 'Str', c: `[${node.attrs.target}]` }]
    return []
  }
  function block(node) {
    const children = node.content || []
    if (node.type === 'heading') return { t: 'Header', c: [node.attrs.level, [node.attrs.label || '', [], []], children.flatMap(inline)] }
    if (node.type === 'bulletList') return { t: 'BulletList', c: children.map(child => (child.content || []).map(block)) }
    if (node.type === 'orderedList') return { t: 'OrderedList', c: [[node.attrs?.start || 1, { t: 'DefaultStyle' }, { t: 'DefaultDelim' }], children.map(child => (child.content || []).map(block))] }
    if (node.type === 'blockquote') return { t: 'BlockQuote', c: children.map(block) }
    if (node.type === 'codeBlock') return { t: 'CodeBlock', c: [attr, children.map(child => child.text || '').join('')] }
    if (node.type === 'horizontalRule') return { t: 'HorizontalRule' }
    if (node.type === 'pageBreak') return { t: 'RawBlock', c: ['openxml', WORD_PAGE_BREAK] }
    if (node.type === 'table') {
      const span = (cell, key) => {
        const value = cell.attrs?.[key] ?? 1
        if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TABLE_COLUMNS) {
          throw new Error(`Bảng Word vượt giới hạn ${MAX_TABLE_COLUMNS} cột hoặc hàng gộp.`)
        }
        return value
      }
      let cols = 1
      for (const row of children) {
        let rowColumns = 0
        for (const cell of row.content || []) {
          rowColumns += span(cell, 'colspan')
          span(cell, 'rowspan')
          if (rowColumns > MAX_TABLE_COLUMNS) throw new Error(`Bảng Word vượt giới hạn ${MAX_TABLE_COLUMNS} cột.`)
        }
        cols = Math.max(cols, rowColumns)
      }
      const rows = children.map(row => [attr, (row.content || []).map(cell => [attr, { t: 'AlignDefault' }, span(cell, 'rowspan'), span(cell, 'colspan'), (cell.content || []).map(block)])])
      let headCount = 0
      for (const row of children) {
        if (!(row.content || []).some(cell => cell.type === 'tableHeader')) break
        headCount++
      }
      const caption = String(node.attrs?.caption || '').trim()
      return { t: 'Table', c: [[node.attrs?.label || '', [], []], [null, caption ? [{ t: 'Plain', c: inline({ type: 'text', text: caption }) }] : []], Array.from({ length: cols }, () => [{ t: 'AlignDefault' }, { t: 'ColWidthDefault' }]), [attr, rows.slice(0, headCount)], [[attr, 0, [], rows.slice(headCount)]], [attr, []]] }
    }
    return { t: 'Para', c: node.type === 'paragraph' ? children.flatMap(inline) : inline(node) }
  }
  const frontmatter = settings.abstractEnabled ? [{ t: 'Div', c: [['', [], [['custom-style', 'Abstract']]], [
    { t: 'Para', c: [{ t: 'Strong', c: inline({ type: 'text', text: settings.abstractTitle || 'Abstract' }) }] },
    ...String(settings.abstract || '').split(/\n\s*\n/).filter(paragraph => paragraph.trim()).map(paragraph => ({ t: 'Para', c: inline({ type: 'text', text: paragraph.trim() }) })),
  ]] }] : []
  return { 'pandoc-api-version': [1, 23, 1], meta: { title: { t: 'MetaString', c: title }, author: { t: 'MetaString', c: settings.author || '' }, date: { t: 'MetaString', c: settings.date || '' } }, blocks: [...frontmatter, ...(doc.content || []).map(block)], _bibliography: settings.bibliography || '', _citationStyle: resolveCitationStyle(settings.citationStyle, templateSource) }
}
export async function readWord(file) {
  if (!window.desktopAPI?.convertWord) throw new Error('Nhập Word hiện dùng trong ứng dụng desktop.')
  if (!file || file.size > MAX_WORD_DOCUMENT_BYTES) throw new Error('Tệp Word vượt 25 MB hoặc không hợp lệ.')
  const { ast } = await window.desktopAPI.convertWord('import', new Uint8Array(await file.arrayBuffer()))
  return importWordAst(ast)
}

function sourceImageKey(value) {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\?.*$/u, '').toLowerCase()
}

function latexMetadataText(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.c === 'string') return value.c.trim()
  if (!Array.isArray(value.c)) return ''
  if (value.t === 'MetaList') return value.c.map(latexMetadataText).filter(Boolean).join('; ')
  if (value.t === 'MetaBlocks') return value.c.map(block => plain(block.c || [])).filter(Boolean).join('\n\n').trim()
  return plain(value.c).trim()
}

function hydrateLatexImages(value, knownImages) {
  if (Array.isArray(value)) {
    value.forEach(item => hydrateLatexImages(item, knownImages))
    return
  }
  if (!value || typeof value !== 'object') return
  if (value.t === 'Image' && Array.isArray(value.c) && Array.isArray(value.c[2])) {
    const target = value.c[2][0]
    if (typeof target === 'string' && target && !/^data:image\//i.test(target)) {
      const normalized = sourceImageKey(target)
      const image = knownImages.get(normalized) || knownImages.get(normalized.split('/').pop())
      value.c[2][0] = image || ''
    }
  }
  Object.values(value).forEach(item => hydrateLatexImages(item, knownImages))
}

export async function readLatexSource(source, editorImages = [], assets = []) {
  if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > MAX_LATEX_SOURCE_BYTES) {
    throw new Error('Source LaTeX vượt 800 KB hoặc không hợp lệ.')
  }
  let ast
  if (window.desktopAPI?.parseLatexSource) {
    ({ ast } = await window.desktopAPI.parseLatexSource(source))
  } else {
    const response = await fetch('/api/latex/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: source,
    })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.error || `Không đọc được source LaTeX (HTTP ${response.status}).`)
    }
    ast = await response.json()
  }
  const knownImages = new Map()
  for (const file of [...editorImages, ...assets]) {
    const filename = String(file?.filename || '')
    const mime = /\.png$/i.test(filename) ? 'png' : /\.jpe?g$/i.test(filename) ? 'jpeg' : ''
    const data = file?.data
    if (!mime || !isValidBase64(data) || !matchesImageSignature(mime, data)) continue
    const image = `data:image/${mime};base64,${data}`
    const path = sourceImageKey(filename)
    knownImages.set(path, image)
    knownImages.set(path.split('/').pop(), image)
  }
  hydrateLatexImages(ast, knownImages)
  const result = await importWordAst(ast)
  const meta = ast?.meta || {}
  const abstractTitle = /\\bfseries\s+(Tóm tắt|Abstract)\s*\\end\{center\}/u.exec(source)?.[1] || null
  return {
    ...result,
    title: latexMetadataText(meta.title) || '',
    metadata: {
      author: latexMetadataText(meta.author) ?? '',
      date: latexMetadataText(meta.date) ?? '',
      abstract: latexMetadataText(meta.abstract) ?? '',
      abstractEnabled: Object.hasOwn(meta, 'abstract'),
      abstractTitle,
    },
  }
}

export async function writeWord(doc, title, settings, templateSource) {
  if (!window.desktopAPI?.convertWord) throw new Error('Xuất Word hiện dùng trong ứng dụng desktop.')
  const { bytes } = await window.desktopAPI.convertWord('export', toWordAst(doc, title, settings, templateSource))
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') || 'tai-lieu'}.docx`)
}
