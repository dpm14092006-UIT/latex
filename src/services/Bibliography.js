// BibTeX parsing, citation numbering and reference-list helpers shared by the editor, serializer and Word export.

export const CITATION_STYLES = Object.freeze([
  { id: 'auto', label: 'Theo mẫu tài liệu (IEEE nếu mẫu IEEEtran, còn lại APA 7th)' },
  { id: 'unsrt', label: 'Số theo thứ tự xuất hiện — [1], [2]…' },
  { id: 'ieee', label: 'IEEE — số theo thứ tự xuất hiện' },
  { id: 'plain', label: 'Số theo tên tác giả (A→Z)' },
  { id: 'apa', label: 'APA 7th — (Nguyen & Tran, 2024)' },
  { id: 'authoryear', label: 'Tác giả–năm (Harvard) — (Nguyen, 2024)' },
])
export const CITATION_STYLE_IDS = CITATION_STYLES.map(style => style.id)

const KEY_PATTERN = /^[A-Za-z0-9:._-]{1,100}$/
export const isCitationKey = value => KEY_PATTERN.test(String(value || ''))

// Citation nodes keep one or more keys in a comma-separated `key` attribute (older documents hold one key).
export function citationKeys(value) {
  const seen = new Set()
  return String(value || '').split(',').map(key => key.trim()).filter(key => isCitationKey(key) && !seen.has(key) && seen.add(key))
}

export function resolveCitationStyle(style, templateSource = '') {
  if (style && style !== 'auto' && CITATION_STYLE_IDS.includes(style)) return style
  return /\\documentclass(?:\[[^\]]*\])?\s*\{\s*IEEEtran\s*\}/iu.test(String(templateSource)) ? 'ieee' : 'apa'
}

export const bibliographyStyleName = style => ({ unsrt: 'unsrt', ieee: 'IEEEtran', plain: 'plain', apa: 'apacite', authoryear: 'plainnat' })[style] || 'unsrt'
export const isAuthorYearStyle = style => style === 'apa' || style === 'authoryear'

// ---------- BibTeX parsing ----------

function readBalanced(text, start, open, close) {
  let depth = 0
  let braces = 0
  let quoted = false
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (character === '\\') { index++; continue }
    if (open === '(') {
      if (character === '{') braces++
      else if (character === '}') braces--
      if (character === '"' && braces === 0) quoted = !quoted
      if (braces || quoted) continue
    }
    if (character === open) depth++
    else if (character === close && --depth === 0) return index
  }
  return -1
}

function parseFields(body, macros = new Map()) {
  const fields = {}
  let index = 0
  while (index < body.length) {
    const match = /\s*,?\s*(?:%[^\r\n]*(?:\r?\n|$)\s*)*([A-Za-z][\w:-]*)\s*=\s*/y
    match.lastIndex = index
    const found = match.exec(body)
    if (!found) break
    const name = found[1].toLowerCase()
    index = match.lastIndex
    let value
    const parts = []
    while (index < body.length) {
      const character = body[index]
      if (character === '{') {
        const end = readBalanced(body, index, '{', '}')
        if (end < 0) { index = body.length; break }
        parts.push(body.slice(index + 1, end))
        index = end + 1
      } else if (character === '"') {
        let end = index + 1
        let depth = 0
        while (end < body.length && !(body[end] === '"' && depth === 0)) { if (body[end] === '\\') { end += 2; continue } if (body[end] === '{') depth++; else if (body[end] === '}') depth--; end++ }
        parts.push(body.slice(index + 1, end))
        index = end + 1
      } else {
        const bare = /[^\s,#]+/y
        bare.lastIndex = index
        const word = bare.exec(body)
        if (!word) break
        parts.push(macros.get(word[0].toLowerCase()) ?? word[0])
        index = bare.lastIndex
      }
      const joiner = /\s*#\s*/y
      joiner.lastIndex = index
      if (!joiner.exec(body)) break
      index = joiner.lastIndex
    }
    value = parts.join('')
    fields[name] = value.replace(/\s+/g, ' ').trim()
    const comma = body.indexOf(',', index)
    if (comma < 0) break
    index = comma + 1
  }
  return fields
}

// Returns entries in file order with their source span so single entries can be removed without touching the rest.
export function parseBibtex(text) {
  const source = String(text || '')
  const entries = []
  const macros = new Map(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(value => [value.slice(0, 3).toLowerCase(), value]))
  const entryStart = /@\s*([A-Za-z]+)\s*([{(])/g
  let match
  while ((match = entryStart.exec(source))) {
    const type = match[1].toLowerCase()
    const lineStart = source.lastIndexOf('\n', match.index) + 1
    if (/(?<!\\)%/.test(source.slice(lineStart, match.index))) continue
    const open = match[2]
    const end = readBalanced(source, match.index + match[0].length - 1, open, open === '{' ? '}' : ')')
    if (end < 0) break
    entryStart.lastIndex = end + 1
    const body = source.slice(match.index + match[0].length, end)
    if (type === 'string') { for (const [name, value] of Object.entries(parseFields(body, macros))) macros.set(name, value); continue }
    if (['comment', 'preamble'].includes(type)) continue
    const comma = body.indexOf(',')
    const key = (comma < 0 ? body : body.slice(0, comma)).trim()
    entries.push({ key, type, fields: {}, start: match.index, end: end + 1, body: comma < 0 ? '' : body.slice(comma + 1) })
  }
  return entries.map(({ body, ...entry }) => ({ ...entry, fields: parseFields(body, macros) }))
}

// ---------- Display ----------

export function stripLatex(value) {
  return String(value || '')
    .replace(/\\(?:textbf|textit|emph|textrm|textsc|mathrm|url|href)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\['`^"~=.uvHck]\s*\{?([A-Za-z])\}?/g, (_, letter) => letter)
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/--/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
}

export function splitAuthors(value) {
  const source = String(value || '').replace(/,?\s+(?:et\s+al\.?|và\s+cộng\s+sự)\s*$/iu, ' and others')
  const authors = []
  let start = 0
  let depth = 0
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '{') { depth++; continue }
    if (source[index] === '}') { depth = Math.max(0, depth - 1); continue }
    if (depth !== 0) continue
    const separator = /^\s+and\s+/iu.exec(source.slice(index))
    if (!separator) continue
    authors.push(source.slice(start, index).trim())
    index += separator[0].length - 1
    start = index + 1
  }
  authors.push(source.slice(start).trim())
  return authors.filter(Boolean).map(name => /^\{[^{}]+\}$/u.test(name) ? name : stripLatex(name))
}

const SURNAME_PARTICLES = new Set(['af', 'al', 'ap', 'abu', 'ben', 'bin', 'da', 'de', 'del', 'der', 'di', 'do', 'dos', 'du', 'el', 'ibn', 'la', 'le', 'st', 'ter', 'ten', 'van', 'von', 'zu', 'zum', 'zur'])

export function familyName(name) {
  const text = String(name || '').trim()
  const organization = text.match(/^\{([^{}]+)\}$/u)
  if (organization) return stripLatex(organization[1])
  if (text.includes(',')) return text.split(',')[0].trim()
  const parts = text.split(/\s+/)
  const particleIndex = parts.findIndex((part, index) => index < parts.length - 1 && SURNAME_PARTICLES.has(part.toLowerCase()))
  if (particleIndex >= 0) return parts.slice(particleIndex).join(' ')
  return parts.at(-1) || ''
}

export function shortAuthors(entry, conjunction = '&') {
  const authors = splitAuthors(entry?.fields?.author || entry?.fields?.editor || '')
  if (!authors.length) return ''
  if (authors.at(-1)?.toLowerCase() === 'others') return `${familyName(authors[0])} et al.`
  if (authors.length === 1) return familyName(authors[0])
  if (authors.length === 2) return `${familyName(authors[0])} ${conjunction} ${familyName(authors[1])}`
  return `${familyName(authors[0])} et al.`
}

export function describeEntry(entry) {
  const fields = entry?.fields || {}
  return {
    authors: shortAuthors(entry),
    year: stripLatex(fields.year || fields.date || '').slice(0, 4),
    title: stripLatex(fields.title || fields.booktitle || ''),
    venue: stripLatex(fields.journal || fields.booktitle || fields.publisher || fields.howpublished || ''),
    doi: stripLatex(fields.doi || ''),
    url: stripLatex(fields.url || ''),
  }
}

export function entrySearchText(entry) {
  const info = describeEntry(entry)
  return `${entry.key} ${stripLatex(entry.fields?.author || '')} ${info.year} ${info.title} ${info.venue} ${info.doi}`.toLocaleLowerCase('vi')
}

// ---------- Numbering ----------

export function citationOccurrences(doc) {
  const occurrences = []
  const walk = node => {
    if (!node) return
    if (node.type === 'citation') occurrences.push(citationKeys(node.attrs?.key))
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return occurrences
}

const sortName = entry => `${splitAuthors(entry?.fields?.author || entry?.fields?.editor || '').map(name => `${familyName(name)} ${name}`).join(' ')} ${entry?.fields?.year || ''} ${stripLatex(entry?.fields?.title || '')}`.toLocaleLowerCase('vi')

const yearLabelCache = new WeakMap()
function citationYearLabels(keys, numbers, byKey, style) {
  const cached = yearLabelCache.get(numbers)
  const scope = [...new Set([...numbers.keys(), ...keys])].join('\u0000')
  if (cached?.byKey === byKey && cached.style === style && cached.scope === scope) return cached.labels
  const labels = new Map()
  const groups = new Map()
  for (const key of [...new Set([...numbers.keys(), ...keys])]) {
    const entry = byKey.get(key)
    if (!entry) continue
    const year = stripLatex(entry.fields.year || entry.fields.date || '').match(/^\d{4}[a-z]?/i)?.[0] || 'n.d.'
    labels.set(key, year)
    if (style !== 'apa' || !/^\d{4}$/.test(year)) continue
    const authors = splitAuthors(entry.fields.author || entry.fields.editor || '').join('|').toLocaleLowerCase('vi')
    const identity = `${authors || stripLatex(entry.fields.title || '')}|${year}`
    if (!groups.has(identity)) groups.set(identity, [])
    groups.get(identity).push(key)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const title = key => stripLatex(byKey.get(key).fields.sorttitle || byKey.get(key).fields.title || '').replace(/^(?:a|an|the)\s+/i, '').toLocaleLowerCase('vi')
    group.sort((a, b) => title(a).localeCompare(title(b), 'vi') || a.localeCompare(b))
    group.forEach((key, index) => {
      let suffix = '', number = index
      do { suffix = String.fromCharCode(97 + number % 26) + suffix; number = Math.floor(number / 26) - 1 } while (number >= 0)
      labels.set(key, labels.get(key) + suffix)
    })
  }
  yearLabelCache.set(numbers, { byKey, style, scope, labels })
  return labels
}

// Map of key → number matching what BibTeX prints: first appearance for unsrt/IEEEtran, author order for plain.
export function citationNumbers(occurrences, entries, style) {
  const order = []
  const seen = new Set()
  for (const keys of occurrences) for (const key of keys) if (!seen.has(key)) { seen.add(key); order.push(key) }
  const byKey = new Map(entries.map(entry => [entry.key, entry]))
  const known = order.filter(key => byKey.has(key))
  if (style === 'plain') known.sort((a, b) => sortName(byKey.get(a)).localeCompare(sortName(byKey.get(b)), 'vi'))
  return new Map(known.map((key, index) => [key, index + 1]))
}

export function compressNumbers(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts = []
  for (let index = 0; index < sorted.length; index++) {
    let end = index
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++
    if (end - index >= 2) parts.push(`${sorted[index]}–${sorted[end]}`)
    else for (let item = index; item <= end; item++) parts.push(String(sorted[item]))
    index = end
  }
  return parts.join(', ')
}

// Text shown in the editor for one citation node.
export function citationLabel(keys, numbers, byKey, style, mode = 'parenthetical') {
  if (!keys.length) return '[?]'
  const years = isAuthorYearStyle(style) ? citationYearLabels(keys, numbers, byKey, style) : null
  if (mode === 'narrative') {
    return keys.map(key => {
      const entry = byKey.get(key)
      const authors = shortAuthors(entry, 'and') || `${key}?`
      const label = isAuthorYearStyle(style) ? `(${years.get(key) || 'n.d.'})` : `[${numbers.get(key) || '?'}]`
      return `${authors} ${label}`
    }).join('; ')
  }
  if (isAuthorYearStyle(style)) {
    // APA orders works inside one citation alphabetically; Harvard keeps the written order.
    const ordered = style === 'apa' ? [...keys].sort((a, b) => sortName(byKey.get(a) || { fields: { author: a } }).localeCompare(sortName(byKey.get(b) || { fields: { author: b } }), 'vi')) : keys
    return `(${ordered.map(key => {
      const entry = byKey.get(key)
      if (!entry) return `${key}?`
      const year = years.get(key)
      return `${shortAuthors(entry, style === 'apa' ? '&' : 'and') || key}, ${year || 'n.d.'}`
    }).join('; ')})`
  }
  const known = keys.map(key => numbers.get(key)).filter(Boolean)
  const missing = keys.length - known.length
  return `[${[compressNumbers(known), ...Array(missing).fill('?')].filter(Boolean).join(', ')}]`
}

export function citationDiagnostics(doc, entries) {
  const occurrences = citationOccurrences(doc)
  const cited = new Set(occurrences.flat())
  const keys = new Set()
  const duplicates = new Set()
  for (const entry of entries) { if (keys.has(entry.key)) duplicates.add(entry.key); keys.add(entry.key) }
  return {
    missing: [...cited].filter(key => !keys.has(key)),
    unused: entries.filter(entry => !cited.has(entry.key)).map(entry => entry.key),
    duplicates: [...duplicates],
    invalidKeys: entries.filter(entry => !isCitationKey(entry.key)).map(entry => entry.key),
    citationCount: occurrences.length,
  }
}

// ---------- Editing the BibTeX text ----------

export function removeBibtexEntry(text, key) {
  const entry = parseBibtex(text).find(item => item.key === key)
  if (!entry) return text
  return (text.slice(0, entry.start).replace(/\s*$/, '') + '\n\n' + text.slice(entry.end).replace(/^\s*/, '')).trim() + '\n'
}

const ascii = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')

export function makeCitationKey(fields, existing = new Set()) {
  const author = ascii(familyName(splitAuthors(fields.author || fields.editor || '')[0] || '')).replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  const word = ascii(stripLatex(fields.title || '')).toLowerCase().split(/[^a-z0-9]+/).find(item => item.length > 3 && !['with', 'from', 'that', 'this', 'using', 'toward', 'towards'].includes(item)) || ''
  const base = `${author || 'ref'}${String(fields.year || '').match(/\d{4}/)?.[0] || ''}${word}`.slice(0, 60) || 'ref'
  let key = base
  for (let suffix = 0; existing.has(key); suffix++) key = `${base}${String.fromCharCode(97 + (suffix % 26))}${suffix >= 26 ? Math.floor(suffix / 26) : ''}`
  return key
}

// Preserve protected capitalization and corporate authors; these braces are BibTeX semantics.
const bibValue = value => String(value).replace(/\r?\n/g, ' ').trim()

export function formatBibtexEntry({ type = 'misc', key, fields }) {
  const order = ['author', 'title', 'journal', 'booktitle', 'publisher', 'volume', 'number', 'pages', 'year', 'doi', 'url', 'note']
  const names = [...order.filter(name => fields[name]), ...Object.keys(fields).filter(name => !order.includes(name) && fields[name])]
  return `@${type}{${key},\n${names.map(name => `  ${name} = {${bibValue(fields[name])}}`).join(',\n')}\n}`
}

// Rewrites entry keys that clash with the existing file or are not usable in \cite and returns the new text.
export function normalizeIncomingBibtex(text, existingKeys = new Set()) {
  const taken = new Set(existingKeys)
  const added = []
  const skipped = []
  const chunks = []
  for (const entry of parseBibtex(text)) {
    const doi = String(entry.fields.doi || '').toLowerCase()
    let key = entry.key
    if (!isCitationKey(key) || taken.has(key)) key = makeCitationKey(entry.fields, taken)
    taken.add(key)
    chunks.push(formatBibtexEntry({ ...entry, key }))
    added.push({ key, doi })
  }
  if (!chunks.length && String(text).trim()) skipped.push(String(text).trim())
  return { text: chunks.join('\n\n'), added, skipped }
}

export function appendBibtex(existing, addition) {
  const base = String(existing || '').trim()
  const extra = String(addition || '').trim()
  if (!extra) return existing
  return `${base ? `${base}\n\n` : ''}${extra}\n`
}

// ---------- Importing plain reference lists ----------

const risTypes = {
  JOUR: 'article', JFULL: 'article', EBOOK: 'book', BOOK: 'book', CHAP: 'incollection',
  CONF: 'inproceedings', CPAPER: 'inproceedings', THES: 'phdthesis', RPRT: 'techreport',
  UNPB: 'unpublished', GEN: 'misc', ELEC: 'misc', MAP: 'misc', DATA: 'misc', ADVS: 'misc',
}

// Reads standard RIS records, including repeated author tags and continuation lines.
export function parseRis(text) {
  const records = []
  let current = null
  let previousTag = ''
  const finish = () => {
    if (!current) return
    const value = (...tags) => tags.flatMap(tag => current.tags.get(tag) || []).find(item => item.trim())?.trim() || ''
    const values = (...tags) => [...new Set(tags.flatMap(tag => current.tags.get(tag) || []).map(item => item.trim()).filter(Boolean))]
    const fields = {}
    const authors = values('AU', 'A1')
    const editors = values('ED', 'A2')
    if (authors.length) fields.author = authors.join(' and ')
    if (editors.length) fields.editor = editors.join(' and ')
    const title = value('TI', 'T1')
    if (title) fields.title = title
    const risType = current.type.toUpperCase()
    const venue = value('JO', 'JF', 'JA')
    const booktitle = value('BT', 'T2', 'CT', 'CP')
    if (risType === 'JOUR' || risType === 'JFULL') {
      if (venue || booktitle) fields.journal = venue || booktitle
    } else if (['CONF', 'CPAPER', 'CHAP'].includes(risType)) {
      if (booktitle || venue) fields.booktitle = booktitle || venue
    } else if (venue) fields.journal = venue
    const publisher = value('PB')
    if (publisher) fields.publisher = publisher
    const volume = value('VL')
    if (volume) fields.volume = volume
    const number = value('IS')
    if (number) fields.number = number
    const startPage = value('SP')
    const endPage = value('EP')
    const pages = startPage && endPage ? `${startPage}--${endPage}` : startPage || endPage || value('PG')
    if (pages) fields.pages = pages
    const year = value('PY', 'Y1').match(/\b(?:19|20)\d{2}\b/)?.[0]
    if (year) fields.year = year
    const doi = value('DO').replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    if (doi) fields.doi = doi
    const url = value('UR')
    if (url) fields.url = url
    const note = value('N1')
    if (note) fields.note = note
    const keywords = values('KW')
    if (keywords.length) fields.keywords = keywords.join(', ')
    const abstract = value('AB')
    if (abstract) fields.abstract = abstract
    records.push({ type: risTypes[risType] || 'misc', fields })
    current = null
    previousTag = ''
  }

  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = raw.match(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/i)
    if (!match) {
      if (current && previousTag && raw.trim()) {
        const list = current.tags.get(previousTag)
        list[list.length - 1] = `${list.at(-1)} ${raw.trim()}`
      }
      continue
    }
    const tag = match[1].toUpperCase()
    const content = match[2].trim()
    if (tag === 'TY') {
      finish()
      current = { type: content, tags: new Map() }
      previousTag = ''
    } else if (tag === 'ER') {
      finish()
    } else if (current) {
      if (!current.tags.has(tag)) current.tags.set(tag, [])
      current.tags.get(tag).push(content)
      previousTag = tag
    }
  }
  finish()
  return records
}

export const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"<>{}]+[^\s"<>{}.,;)\]])/i
export function extractDoi(value) { return String(value || '').match(DOI_PATTERN)?.[1] || '' }

function referenceAuthors(value) {
  return value.replace(/,?\s*&\s*/g, ', ').split(/\.,\s*/).map(name => {
    const clean = name.trim().replace(/[,.]+$/, '')
    return /,\s*(?:\p{Lu}\.?\s*)+$/u.test(clean) ? clean + '.' : clean
  }).filter(Boolean).join(' and ')
}

function parseBookReference(rest, fields) {
  const start = rest.trim().match(/^in(?:\s*:\s*|\s+)/i)
  if (!start) return false
  let source = rest.trim().slice(start[0].length)
  const editors = source.match(/^(.+?)\s*\((?:eds?\.?|editors?)\)\s*[,.:]?\s*/i)
  if (editors) {
    fields.editor = referenceAuthors(editors[1])
    source = source.slice(editors[0].length)
  }
  const locator = source.match(/\((?:[^)]*?\bvol\.?\s*(\d+)[,;]?\s*)?(?:pp?\.\s*)?(\d+\s*[-–—]+\s*\d+)\)/i)
  if (locator) {
    if (locator[1]) fields.volume = locator[1]
    fields.pages = locator[2].replace(/\s*[-–—]+\s*/, '--')
    source = source.replace(locator[0], '')
  }
  const titleEnd = source.search(/\.\s+(?=[\p{Lu}\d])/u)
  fields.booktitle = (titleEnd < 0 ? source : source.slice(0, titleEnd)).replace(/[\s,.]+$/, '')
  const metadata = titleEnd < 0 ? '' : source.slice(titleEnd + 1).trim()
  const series = metadata.match(/(Lecture Notes in [^.,]+)(?:[,.]\s*(?:vol\.?|volume)\s*(\d+))?/i)
  if (series) {
    fields.series = series[1].trim()
    if (series[2]) fields.volume = series[2]
  }
  const volume = metadata.match(/\b(?:vol\.?|volume)\s*(\d+)/i)
  if (volume) fields.volume = volume[1]
  const pages = rest.match(/\bpp?\.\s*(\d+\s*[-–—]+\s*\d+|\d+)/i)
  if (pages) fields.pages = pages[1].replace(/\s*[-–—]+\s*/, '--')
  const tail = metadata.replace(/\bpp?\.\s*\d+(?:\s*[-–—]+\s*\d+)?[,.]?/gi, '').trim().replace(/[\s.]+$/, '')
  const publication = tail.split(/\.\s+/).at(-1)?.trim()
  if (publication && !/^(?:\d+|(?:vol\.?|volume|ECCV|CVPR|ICCV|LNCS)\b|Lecture Notes)/i.test(publication)) {
    const parts = publication.split(/,\s*/)
    fields.publisher = parts[0]
    if (parts.length === 2) fields.address = parts[1]
  }
  return Boolean(fields.booktitle)
}

// Best-effort parse of one formatted reference ("A. Nguyen and B. Tran, “Title,” Journal, vol. 3, pp. 1–9, 2024.").
export function parseReferenceLine(line) {
  const text = String(line || '').replace(/\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s>)]+)\s*>?\s*\)/g, '$2')
    .replace(/(?:&#x20;|&#160;|&nbsp;)/gi, ' ').replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const fields = {}
  const doi = extractDoi(text)
  if (doi) fields.doi = doi
  const url = text.match(/https?:\/\/[^\s,;]+[^\s,;.]/)?.[0]
  if (url && !url.includes('doi.org/')) fields.url = url
  const year = [...text.matchAll(/\b(19|20)\d{2}\b/g)].at(-1)?.[0]
  if (year) fields.year = year
  let rest
  const quoted = text.match(/[“"]([^”"]{3,}?)[,.]?[”"]/)
  if (quoted) {
    fields.title = quoted[1].trim()
    const authorPart = text.slice(0, quoted.index).replace(/[,.\s]+$/, '')
    if (authorPart) fields.author = authorPart.replace(/,?\s+(?:and|&|và)\s+/g, ', ').split(/\s*,\s*/).filter(Boolean).join(' and ')
    rest = text.slice(quoted.index + quoted[0].length)
  } else {
    // APA-like: Authors (2024). Title. Venue.
    const apa = text.match(/^(.+?)\s*\((\d{4}[a-z]?)\)\.?\s*(.+?)\.\s+(.*)$/)
    if (apa) {
      fields.author = referenceAuthors(apa[1])
      fields.year = apa[2]
      fields.title = apa[3]
      rest = apa[4]
    } else {
      const sentences = text.split(/\.\s+/)
      if (sentences.length >= 2) { fields.author = sentences[0]; fields.title = sentences[1] } else fields.title = text
      rest = sentences.slice(2).join('. ')
    }
  }
  // DOI/URL wrappers are links, not publication metadata. Keep the publication
  // year parsed above; years inside conference names must not overwrite it.
  rest = rest.replace(/(?:doi\s*:\s*)?https?:\/\/\S+/gi, '').replace(/\b(?:doi\s*:\s*)?10\.\d{4,9}\/\S+/gi, '')
    .replace(/\(\s*\)|\[\s*\]|<\s*>/g, '').replace(/[<>[\]\s]+$/g, '').trim()
  if (parseBookReference(rest, fields)) {
    const conference = /\b(?:proc\.?|proceedings|conference|symposium|workshops?|ECCV|CVPR|ICCV|ACM|IEEE)\b|hội nghị/i.test(fields.booktitle)
    return { type: conference ? 'inproceedings' : 'incollection', fields }
  }
  // APA-style locator: "Venue, 4(2), 10-20."
  const apaLocator = rest.match(/,\s*(\d+)\s*(?:\((\d+)\))?\s*,\s*(\d+\s*[-–]+\s*\d+|\d+)/)
  if (apaLocator) {
    fields.volume = apaLocator[1]
    if (apaLocator[2]) fields.number = apaLocator[2]
    fields.pages = apaLocator[3].replace(/\s*[-–]+\s*/, '--')
  }
  const venue = rest.replace(/^[\s,.]+/, '').split(/,\s*(?:vol\.|no\.|pp\.|tập|số|tr\.|\d+\s*(?:\(\d+\))?\s*,)/i)[0].replace(/,?\s*\b(?:19|20)\d{2}\s*\.?$/, '').replace(/[\s,.]+$/, '')
  if (venue && venue.length < 200 && !/^https?:/.test(venue)) fields[/proc\.|conference|hội nghị|symposium|workshop/i.test(venue) ? 'booktitle' : 'journal'] = venue.replace(/^in\s+/i, '')
  const volume = rest.match(/\bvol\.\s*(\d+)/i)?.[1]
  if (volume) fields.volume = volume
  const number = rest.match(/\bno\.\s*(\d+)/i)?.[1]
  if (number) fields.number = number
  const pages = rest.match(/\bpp?\.\s*([\d]+\s*[-–]+\s*[\d]+|\d+)/i)?.[1]
  if (pages) fields.pages = pages.replace(/\s*[-–]+\s*/, '--')
  const type = fields.booktitle ? 'inproceedings' : fields.journal ? 'article' : 'misc'
  return { type, fields }
}

// Splits pasted text into BibTeX blocks, bare DOIs and formatted reference lines.
export function classifyReferenceInput(text) {
  const source = String(text || '')
  if (/@\s*[A-Za-z]+\s*[{(]/.test(source)) return { bibtex: source, dois: [], lines: [], ris: [] }
  const ris = parseRis(source)
  if (ris.length) return { bibtex: '', dois: [], lines: [], ris }
  const lines = []
  let current = ''
  const numbered = /^\s*(?:\[\d+\]|\d+[.)])\s/m.test(source)
  const isDoiLine = line => /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/\S+$/i.test(line)
  // Numbered lists may wrap an entry over several lines; otherwise every line is one reference.
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) { if (current) { lines.push(current); current = '' } continue }
    const starts = !numbered || isDoiLine(line) || /^(?:\[\d+\]|\d+[.)])\s/.test(line)
    if (starts && current) { lines.push(current); current = line } else current = current ? `${current} ${line}` : line
  }
  if (current) lines.push(current)
  const dois = []
  const rest = []
  for (const line of lines) {
    const bare = line.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    if (/^10\.\d{4,9}\/\S+$/.test(bare)) dois.push(bare)
    else rest.push(line)
  }
  return { bibtex: '', dois, lines: rest, ris: [] }
}

// ---------- Compile helpers ----------

// Styles that ignore doi/url fields still get a clickable link through `note`.
function protectBibtexText(text) {
  let source = String(text || '')
  for (const entry of parseBibtex(source).reverse()) {
    const fields = Object.fromEntries(Object.entries(entry.fields).map(([name, value]) => {
      if (['doi', 'url'].includes(name)) return [name, value]
      const urls = []
      let protectedValue = value.replace(/https?:\/\/[^\s{}]+/gi, url => { urls.push(url); return '\u0000URL' + (urls.length - 1) + '\u0000' })
        .replace(/(?<!\\)[#$%&_]/g, character => '\\' + character)
      urls.forEach((url, index) => { protectedValue = protectedValue.replaceAll('\u0000URL' + index + '\u0000', url) })
      return [name, protectedValue]
    }))
    if (JSON.stringify(fields) === JSON.stringify(entry.fields) && !/@\s*string\s*[{(]/i.test(source) && !source.slice(entry.start, entry.end).includes('#')) continue
    source = source.slice(0, entry.start) + formatBibtexEntry({ ...entry, fields }) + source.slice(entry.end)
  }
  return source
}

export function bibtexForCompile(text, style) {
  const safeText = protectBibtexText(text)
  if (isAuthorYearStyle(style)) return safeText
  const entries = parseBibtex(safeText)
  if (!entries.length) return safeText
  let output = ''
  let last = 0
  for (const entry of entries) {
    const link = entry.fields.doi ? `https://doi.org/${stripLatex(entry.fields.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}` : stripLatex(entry.fields.url || '')
    output += safeText.slice(last, entry.end)
    last = entry.end
    if (!link || !/^https?:\/\/[^\s{}\\%#]+$/.test(link)) continue
    // IEEEtran prints `url` but ignores `doi`; unsrt/plain print neither, only `note`.
    const field = style === 'ieee' ? (entry.fields.url ? '' : `url = {${link}}`) : (entry.fields.note ? '' : `note = {\\url{${link}}}`)
    if (!field) continue
    const closing = output.lastIndexOf(safeText[entry.end - 1])
    const before = output.slice(0, closing).replace(/,?\s*$/, '')
    output = `${before},\n  ${field}\n${output.slice(closing)}`
  }
  return output + safeText.slice(last)
}
