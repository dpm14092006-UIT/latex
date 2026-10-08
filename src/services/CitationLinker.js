import { closeHistory } from '@tiptap/pm/history'
import { familyName, isCitationKey, shortAuthors, splitAuthors, stripLatex } from './Bibliography.js'

export const normalizeCitationSearch = value => stripLatex(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, ' ').replace(/\s+/g, ' ').trim()
const canonicalYear = value => value.toLowerCase().replace(/\s+/g, '').replace(/^n\.?d\.?$/, 'n.d.')
const normalizeName = value => stripLatex(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/va cong su/g, 'et al').replace(/(?:\band\b|\bva\b)/gu, '&')
  .replace(/[^\p{L}\p{N}&]+/gu, ' ').replace(/\s*&\s*/g, ' & ').replace(/\s+/g, ' ').trim()
const referenceHeading = value => /^(?:\d+\s+)*(?:tai lieu tham khao|danh muc tai lieu tham khao|thu muc tai lieu tham khao|references?|reference list|list of references|bibliography|bibliographies|works cited|literature cited)$/i.test(normalizeName(value))

export function hasConflictingSuffixChoices(row, choices = []) {
  const previous = new Map()
  return row.groups.some((group, index) => {
    const match = group.label.match(/^(.+),\s*((?:18|19|20)\d{2})([a-z])$/i)
    if (!match || !choices[index]) return false
    const id = `${normalizeName(match[1])}|${match[2]}|${choices[index]}`
    const suffix = match[3].toLowerCase()
    const conflict = previous.has(id) && previous.get(id) !== suffix
    previous.set(id, suffix)
    return conflict
  })
}

function narrativeAuthor(prefix, years, authorIndex) {
  const before = prefix.trimEnd()
  const tail = before.slice(-220)
  // Try complete REF author labels at word boundaries, so surrounding prose is never consumed.
  const starts = [...tail.matchAll(/(?<![\p{L}\p{M}])(?:\p{Lu}|(?:de|da|dos|van|von|der|den|di|del)\b)/gu)]
  for (const match of starts) {
    const author = tail.slice(match.index)
    // Brackets belong to another citation ("[@Smith] and Jones (2020)"); a row must not swallow them.
    if (/[()[\]]/u.test(author)) continue
    if (years.some(year => authorIndex.has(`${normalizeName(author)}|${year.toLowerCase()}`))) return { author, start: before.length - tail.length + match.index }
  }
  // Unknown authors still need a source picker. Only recognize a bounded surname/author-pair suffix.
  const name = String.raw`(?:(?:de|da|dos|van|von|der|den|di|del)\s+)*[\p{Lu}][\p{L}\p{M}'’−.-]*`
  const found = before.match(new RegExp(String.raw`(${name}(?:\s+(?:and|&|và)\s+${name})?(?:\s+(?:et\s+al\.?|và\s+cộng\s+sự))?)$`, 'u'))
  return found ? { author: found[1], start: found.index } : null
}

export function sanitizeSourceMaps(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.slice(-50).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(item.id) || seen.has(item.id)) return []
    seen.add(item.id)
    const numbers = {}
    for (const [number, keys] of Object.entries(item.numbers || {}).slice(0, 5000)) {
      if (!/^[1-9]\d{0,3}$/.test(number) || !Array.isArray(keys)) continue
      const valid = [...new Set(keys.filter(key => typeof key === 'string' && isCitationKey(key)))].slice(0, 50)
      if (valid.length) numbers[number] = valid
    }
    return Object.keys(numbers).length ? [{ id: item.id, label: String(item.label || 'Danh mục gốc').slice(0, 160), numbers }] : []
  })
}

export function parseSourceMapping(text, entries) {
  const counts = new Map()
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1)
  const known = new Set(entries.filter(entry => counts.get(entry.key) === 1).map(entry => entry.key))
  const numbers = {}
  for (const line of String(text).split(/\r?\n/).filter(line => line.trim())) {
    const match = line.trim().match(/^(?:\[(\d{1,4})\]|(\d{1,4})[.)]?)\s*(?:=|:)?\s+([A-Za-z0-9:._-]+)$/)
    if (!match || Number(match[1] || match[2]) < 1 || !isCitationKey(match[3]) || !known.has(match[3])) throw Error(`Ánh xạ không hợp lệ: ${line.slice(0, 100)}. Dùng [12] khóa_REF có trong BibTeX.`)
    const number = String(Number(match[1] || match[2]))
    numbers[number] = [...new Set([...(numbers[number] || []), match[3]])]
  }
  if (!Object.keys(numbers).length) throw Error('Hãy nhập ít nhất một ánh xạ số → khóa REF.')
  if (Object.keys(numbers).length > 5000) throw Error('Tối đa 5.000 số trong một danh mục gốc.')
  return numbers
}

function numericParts(text) {
  const result = []
  for (const part of text.slice(1, -1).split(/[,;]/)) {
    const range = part.trim().match(/^(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?$/)
    if (!range) return null
    const from = Number(range[1]), to = Number(range[2] || range[1])
    if (from < 1 || to < from || to - from >= 50 || result.length + to - from + 1 > 50) return null
    for (let number = from; number <= to; number++) result.push(String(number))
  }
  return [...new Set(result)]
}

const NAME_PARTICLES = new Set(['af', 'al', 'ap', 'abu', 'ben', 'bin', 'da', 'de', 'del', 'der', 'di', 'do', 'dos', 'du', 'el', 'ibn', 'la', 'le', 'st', 'ter', 'ten', 'van', 'von', 'zu', 'zum', 'zur'])
const PARTICLE_PATTERN = [...NAME_PARTICLES].join('|')
const looksLikeAuthor = value => new RegExp(`^(?:(?:${PARTICLE_PATTERN})\\s+)*\\p{Lu}[\\p{L}\\p{M}'’−.-]*`, 'u').test(value.trim())

function surnameAliases(value) {
  const raw = String(value || '').trim()
  const source = stripLatex(raw).trim()
  const aliases = new Set([familyName(raw)])
  if (/^\{[^{}]+\}$/u.test(raw)) return [...aliases].filter(Boolean)
  const comma = source.indexOf(',')
  if (comma >= 0) {
    const family = source.slice(0, comma).trim()
    const given = source.slice(comma + 1).trim().split(/\s+/u).filter(Boolean)
    const finalGiven = given.at(-1)?.replace(/[.,]+$/u, '').toLowerCase()
    if (NAME_PARTICLES.has(finalGiven)) aliases.add(`${given.at(-1)} ${family}`)
    // Some imported reference lists put initials before the comma: "S., Anitha".
    if (/^(?:\p{Lu}\.?\s*)+$/u.test(family) && given.length && !/^(?:\p{Lu}\.?\s*)+$/u.test(given.join(' '))) aliases.add(given.at(-1))
  } else {
    const words = source.split(/\s+/u).filter(Boolean)
    if (words.length > 1) {
      for (let index = 0; index < words.length - 1; index++) {
        if (NAME_PARTICLES.has(words[index].toLowerCase())) aliases.add(words.slice(index).join(' '))
      }
    }
  }
  return [...aliases].filter(Boolean)
}

function parseAuthorYearParts(value) {
  const groups = []
  const segments = []
  let hasInternalLocator = false
  let suffixText = ''
  const parts = value.split(';').map(part => part.trim())
  for (const [index, original] of parts.entries()) {
    const groupStart = groups.length
    let partSuffix = ''
    let part = original
    const locator = part.match(/,\s*((?:p{1,2}\.|para\.|chap(?:ter)?\.?|sec(?:tion)?\.?)\s*[\p{L}\d.]+(?:\s*[-–—]\s*[\p{L}\d.]+)?)$/iu)
    if (locator) {
      partSuffix = ` (${locator[1]})`
      if (index !== parts.length - 1) hasInternalLocator = true
      else suffixText = partSuffix
      part = part.slice(0, locator.index).trim()
    }

    const multiYear = part.match(/^(.+?),\s*((?:(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?))(?:\s*,\s*(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?))*)$/iu)
    if (multiYear) {
      const author = multiYear[1].trim()
      const years = multiYear[2].match(/(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?)/giu) || []
      if (!looksLikeAuthor(author) || !years.length) return null
      groups.push(...years.map(year => ({ author, year: canonicalYear(year) })))
      segments.push({ indexes: Array.from({ length: years.length }, (_, offset) => groupStart + offset), suffixText: partSuffix })
      continue
    }

    const singleYear = part.match(/^([\p{Lu}][\p{L}\p{M}\s.,&'’−-]{0,180}?)(?:,\s*|\s+)((?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?))$/u)
    if (!singleYear) return null
    groups.push({ author: singleYear[1].trim(), year: canonicalYear(singleYear[2]) })
    segments.push({ indexes: [groupStart], suffixText: partSuffix })
  }
  return groups.length ? { groups, suffixText, segments: hasInternalLocator ? segments : null } : null
}

function parseNarrativeYears(value) {
  const match = value.match(/^\(\s*((?:(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?))(?:\s*,\s*(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?))*)\s*(?:,\s*((?:p{1,2}\.|para\.|chap(?:ter)?\.?|sec(?:tion)?\.?)\s*[\p{L}\d.]+(?:\s*[-–—]\s*[\p{L}\d.]+)?))?\s*\)$/iu)
  if (!match) return null
  return {
    years: (match[1].match(/(?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?)/giu) || []).map(canonicalYear),
    suffixText: match[2] ? ` (${match[2]})` : '',
  }
}

function authorForms(entry, expanded = false) {
  const authors = splitAuthors(entry.fields.author || entry.fields.editor || '')
  if (!authors.length) return []
  const families = authors.map(author => expanded ? surnameAliases(author) : [familyName(author)]).map(values => values.filter(Boolean))
  const forms = new Set([shortAuthors(entry)])
  if (authors.length >= 3) forms.add(`${families[0][0]} et al.`)
  if (authors.at(-1)?.toLowerCase() === 'others') forms.add(`${families[0][0]} et al.`)
  else if (authors.length <= 3) {
    const combinations = families.slice(0, 3).reduce((previous, choices) => previous.flatMap(prefix => choices.map(value => [...prefix, value])), [[]])
    for (const parts of combinations.slice(0, 27)) {
      forms.add(parts.join(' & '))
      if (parts.length >= 3) forms.add(`${parts.slice(0, -1).join(', ')} & ${parts.at(-1)}`)
    }
  }
  return [...forms].map(normalizeName).filter(Boolean)
}

function differsByOneCharacter(left, right) {
  if (!left || !right || Math.abs(left.length - right.length) > 1) return false
  let a = 0, b = 0, edits = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { a++; b++; continue }
    if (++edits > 1) return false
    if (left.length > right.length) a++
    else if (right.length > left.length) b++
    else { a++; b++ }
  }
  return edits + (a < left.length || b < right.length ? 1 : 0) <= 1
}

function textRuns(doc) {
  const runs = []
  let referenceLevel = null
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'heading' && parent === doc) {
      if (referenceHeading(node.textContent)) referenceLevel = node.attrs.level || 1
      else if (referenceLevel !== null && node.attrs.level <= referenceLevel) referenceLevel = null
    }
    if (referenceLevel !== null || node.type.name === 'codeBlock') return false
    if (!node.isTextblock) return true
    // Full reference entries can be pasted without a References heading.
    // Requiring initials + a publication year followed by a title avoids treating
    // ordinary narrative citations such as Smith (2025) as bibliography entries.
    if (/^\s*(?:\[\d+\]\s*|\d+[.)]\s*)?[\p{L}\p{M}'’ -]+,\s*(?:\p{Lu}\.\s*)+(?:[\s\S]{0,220})\((?:(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?)\)\.\s+\S/iu.test(node.textContent) && /https?:\/\/|\b10\.\d{4,9}\/|\d+\s*\(\d+\)\s*,\s*\d+[-–]/iu.test(node.textContent)) return false
    let current = null
    node.forEach((child, offset) => {
      if (child.type.name === 'hardBreak' && current) { current.text += ' '; return }
      if (!child.isText || child.marks.some(mark => ['code', 'link'].includes(mark.type.name))) { current = null; return }
      if (current) current.text += child.text
      else { current = { text: child.text, from: pos + 1 + offset }; runs.push(current) }
    })
    return false
  })
  return runs
}

export function scanUnlinkedCitations(doc, entries, sourceMap = null) {
  const counts = new Map()
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1)
  const usable = entries.filter(entry => isCitationKey(entry.key) && counts.get(entry.key) === 1)
  const byKey = new Map(usable.map(entry => [entry.key, entry]))
  const authorIndex = new Map()
  const authorRecords = []
  for (const entry of usable) {
    const year = stripLatex(entry.fields.year || entry.fields.date || '').match(/^\d{4}[a-z]?/i)?.[0]?.toLowerCase() || (!entry.fields.year && !entry.fields.date ? 'n.d.' : '')
    if (!year) continue
    const exactForms = authorForms(entry)
    const expandedForms = authorForms(entry, true)
    if (!exactForms.length) continue
    authorRecords.push({ key: entry.key, year, exactForms, expandedForms })
    for (const name of exactForms) {
      const id = `${name}|${year}`
      authorIndex.set(id, [...new Set([...(authorIndex.get(id) || []), entry.key])])
    }
  }
  const suggestionsFor = (author, year) => {
    const query = normalizeName(author)
    const suggestions = []
    for (const record of authorRecords) {
      if (!byKey.has(record.key)) continue
      const exactAuthor = record.exactForms.includes(query)
      const baseYear = year.replace(/[a-z]$/i, '')
      const expandedAuthor = record.expandedForms.includes(query)
      const fuzzyAuthor = record.expandedForms.some(form => differsByOneCharacter(query, form))
      let reason, rank
      if (exactAuthor && record.year === baseYear && baseYear !== year) {
        reason = `Tác giả và năm ${baseYear} khớp; hậu tố ${year.slice(-1)} phân biệt các bài trong danh mục gốc, chưa xác định được bài nào. Kiểm tra tiêu đề/DOI và chọn đúng REF.`
        rank = 120
      } else if (exactAuthor && record.year !== year) {
        reason = `Tác giả khớp, nhưng REF ghi năm ${record.year} thay vì ${year}. Hãy xác nhận năm trước khi cite.`
        rank = 100
      } else if (!exactAuthor && expandedAuthor && record.year === year) {
        reason = `Khớp gần tên họ hoặc thứ tự tên; năm ${year} trùng. Hãy xác nhận REF trước khi cite.`
        rank = 90
      } else if (!exactAuthor && expandedAuthor) {
        reason = `Tên tác giả gần khớp, nhưng REF ghi năm ${record.year} thay vì ${year}. Hãy xác nhận cả tên và năm.`
        rank = 70
      } else if (fuzzyAuthor && record.year === year) {
        reason = `Tên tác giả gần giống và năm ${year} trùng. Hãy xác nhận REF trước khi cite.`
        rank = 60
      }
      if (reason) suggestions.push({ key: record.key, reason, rank })
    }
    return [...new Map(suggestions.sort((a, b) => b.rank - a.rank).map(item => [item.key, item])).values()].slice(0, 8)
  }
  const groupFor = (label, keys, suggestions = []) => ({
    label,
    candidates: [...new Set(keys.filter(key => byKey.has(key)))],
    suggestions: suggestions.filter(item => byKey.has(item.key)),
    missing: [...new Set(keys.filter(key => !byKey.has(key)))],
  })
  const authorYearGroup = (label, author, year) => {
    const candidates = authorIndex.get(`${normalizeName(author)}|${year.toLowerCase()}`) || []
    const suggestions = candidates.length ? [] : suggestionsFor(author, year)
    return groupFor(label, candidates, suggestions)
  }
  const rows = []
  let truncated = false
  for (const run of textRuns(doc)) {
    const pattern = /\[@[^\]\n]{1,300}\]|\[\s*\d[\d\s,;–—-]{0,300}\]|\([^()\n]{1,300}\)/gu
    for (const match of run.text.matchAll(pattern)) {
      let text = match[0], start = match.index
        let kind, groups, reason, segments = null, mode = 'parenthetical', suffixText = ''
      if (text.startsWith('[@')) {
        kind = 'key'
        const keys = text.slice(1, -1).split(/[,;]\s*/).map(value => value.trim().replace(/^@/, ''))
        if (!keys.length || keys.length > 50 || keys.some(key => !isCitationKey(key))) continue
        groups = keys.map(key => groupFor(key, [key]))
        reason = 'Đối chiếu khóa REF chính xác.'
      } else if (text.startsWith('[')) {
        kind = 'number'
        const numbers = numericParts(text)
        if (!numbers) continue
        groups = numbers.map(number => groupFor(`[${number}]`, [...new Set(sourceMap?.numbers?.[number] || [])]))
        reason = sourceMap ? `Số gốc từ ${sourceMap.label}.` : 'Chưa chọn danh mục số gốc; không suy diễn từ số hiện tại.'
        if (groups.every(group => group.candidates.length === 1 && !group.missing.length)) {
          const shared = groups.map(group => authorForms(byKey.get(group.candidates[0]))).reduce((left, right) => left.filter(name => right.includes(name)))
          const labels = new Map(shared.map(name => [`${name}|mapped`, true]))
          const author = narrativeAuthor(run.text.slice(0, match.index), ['mapped'], labels)
          if (author && labels.has(`${normalizeName(author.author)}|mapped`)) {
            mode = 'narrative'
            start = author.start
            text = run.text.slice(start, match.index + match[0].length)
          }
        }
      } else {
        const parsed = parseAuthorYearParts(text.slice(1, -1))
        if (parsed && parsed.groups.length <= 50) {
          kind = 'author-year'
          groups = parsed.groups.map(item => authorYearGroup(`${item.author}, ${item.year}`, item.author, item.year))
          suffixText = parsed.suffixText
          segments = parsed.segments
          reason = groups.some(group => group.candidates.length > 1)
            ? 'Có nhiều REF cùng tác giả và năm. Hãy chọn đúng nguồn cho từng phần trước khi duyệt.'
            : groups.some(group => group.suggestions.length)
              ? 'Có REF gợi ý theo tác giả hoặc tên gần khớp. Kiểm tra từng REF và năm trước khi duyệt.'
            : groups.some(group => !group.candidates.length && !group.missing.length)
              ? 'Không tìm thấy đủ tác giả và năm trong BibTeX hiện tại. Kiểm tra danh mục hoặc chọn REF thủ công.'
              : 'Khớp đầy đủ tác giả và năm với REF; kiểm tra đề xuất trước khi duyệt.'
        } else if (parseNarrativeYears(text)) {
          const parsedNarrative = parseNarrativeYears(text)
          const author = narrativeAuthor(run.text.slice(0, match.index), parsedNarrative.years, authorIndex)
          if (!author) continue
          kind = 'narrative'
          mode = 'narrative'
          start = author.start
          text = run.text.slice(start, match.index + match[0].length)
          groups = parsedNarrative.years.map(year => authorYearGroup(`${author.author}, ${year}`, author.author, year))
          suffixText = parsedNarrative.suffixText
          reason = groups.some(group => group.suggestions.length)
            ? 'Trích dẫn tường thuật có REF gợi ý; hãy xác nhận tác giả và năm trước khi cite.'
            : groups.some(group => !group.candidates.length)
              ? 'Trích dẫn tường thuật chưa khớp REF; kiểm tra BibTeX hoặc chọn nguồn thủ công.'
              : 'Trích dẫn tường thuật khớp tác giả và năm; kiểm tra đề xuất trước khi duyệt.'
        } else continue
      }
      const resolved = groups.every(group => group.candidates.length === 1 && !group.missing.length)
      const keys = resolved ? [...new Set(groups.flatMap(group => group.candidates))] : []
      const signature = `${kind}|${groups.map(group => normalizeName(group.label)).join(';')}`
      rows.push({ id: `${run.from + start}`, from: run.from + start, to: run.from + start + text.length,
        text, kind, mode, signature, groups, keys, reason, resolved, suffixText, segments, context: run.text.slice(Math.max(0, start - 65), Math.min(run.text.length, start + text.length + 65)) })
      if (rows.length >= 2000) { truncated = true; break }
    }
    if (truncated) break
  }
  return { doc, rows, truncated, referenceSignature: JSON.stringify(entries.map(({ key, type, fields }) => ({ key, type, fields }))) }
}

export function linkCitationTransaction(state, scan, choices, entries) {
  if (!scan || state.doc !== scan.doc) throw Error('Nội dung tài liệu đã thay đổi. Hãy quét lại trước khi liên kết.')
  if (scan.referenceSignature !== JSON.stringify(entries.map(({ key, type, fields }) => ({ key, type, fields })))) throw Error('Danh mục REF đã thay đổi. Hãy quét lại trước khi liên kết.')
  const counts = new Map()
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1)
  const selected = scan.rows.filter(row => Array.isArray(choices[row.id]) && choices[row.id].length)
  if (!selected.length) return null
  const tr = state.tr
  for (const row of [...selected].sort((a, b) => b.from - a.from)) {
    const keys = [...new Set(choices[row.id])]
    if (hasConflictingSuffixChoices(row, choices[row.id])) throw Error('Các hậu tố a/b chỉ các bài khác nhau. Không chọn cùng một REF cho hai hậu tố; hãy đối chiếu tiêu đề/DOI.')
    if (choices[row.id].length !== row.groups.length || keys.length > 50 || keys.some(key => !isCitationKey(key) || counts.get(key) !== 1)) throw Error('Nguồn được chọn thiếu, trùng khóa hoặc chưa hỗ trợ. Hãy quét và chọn lại.')
    if (state.doc.textBetween(row.from, row.to, '', node => node.type.name === 'hardBreak' ? ' ' : '\uFFFC') !== row.text) throw Error('Vị trí trích dẫn đã thay đổi. Hãy quét lại.')
    const marks = state.doc.resolve(row.from).marks().filter(mark => !['code', 'link'].includes(mark.type.name))
    const mode = row.mode || (row.kind === 'narrative' ? 'narrative' : 'parenthetical')
    const replacement = []
    const segments = row.segments || [{ indexes: choices[row.id].map((_, index) => index), suffixText: row.suffixText }]
    for (const [index, segment] of segments.entries()) {
      if (index) replacement.push(state.schema.text('; ', marks))
      const segmentKeys = [...new Set(segment.indexes.map(groupIndex => choices[row.id][groupIndex]))]
      replacement.push(state.schema.nodes.citation.create({ key: segmentKeys.join(','), mode }, null, marks))
      if (segment.suffixText) replacement.push(state.schema.text(segment.suffixText, marks))
    }
    tr.replaceWith(row.from, row.to, replacement)
  }
  return { transaction: closeHistory(tr), count: selected.length }
}

export function removeAllCitationTransaction(state) {
  const ranges = []
  state.doc.descendants((node, position) => {
    if (node.type.name === 'citation') ranges.push({ from: position, to: position + node.nodeSize })
  })
  if (!ranges.length) return null
  const transaction = state.tr
  for (const range of ranges.reverse()) transaction.delete(range.from, range.to)
  return { transaction: closeHistory(transaction), count: ranges.length }
}
