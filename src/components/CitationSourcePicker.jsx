import { useMemo, useState } from 'react'
import { describeEntry, entrySearchText } from '../services/Bibliography.js'
import { normalizeCitationSearch } from '../services/CitationLinker.js'

export default function CitationSourcePicker({ id, label, entries, candidates, suggestions = [], reviewed = false, value, onChange }) {
  const [query, setQuery] = useState('')
  const indexed = useMemo(() => entries.map(entry => ({ entry, search: normalizeCitationSearch(entrySearchText(entry)) })), [entries])
  const words = normalizeCitationSearch(query).split(' ').filter(Boolean)
  const matches = indexed.filter(item => words.every(word => item.search.includes(word))).map(item => item.entry)
  const suggestedKeys = suggestions.map(item => item.key)
  const suggested = matches.filter(entry => candidates.includes(entry.key) || suggestedKeys.includes(entry.key))
  const options = [...new Map([...suggested, ...matches.slice(0, 100), ...entries.filter(entry => entry.key === value)].map(entry => [entry.key, entry])).values()]
  const selected = entries.find(entry => entry.key === value)
  const selectedSuggestion = suggestions.find(item => item.key === value)
  return <div className="citation-source-picker">
    <label className="label" htmlFor={`${id}-search`}>{label}</label>
    <input id={`${id}-search`} className="field" type="search" aria-label={`Tìm nguồn cho ${label}`} placeholder="Tìm theo tác giả, năm, tiêu đề hoặc khóa REF" value={query} onChange={event => setQuery(event.target.value)} />
    <select id={id} className="field" aria-label={`Chọn nguồn cho ${label}`} value={value} onChange={event => { onChange(event.target.value); setQuery('') }}>
      <option value="">{candidates.length > 1 ? 'Nhiều nguồn khớp — hãy chọn nguồn đúng' : 'Chọn tài liệu tham khảo'}</option>
      {options.map(entry => {
        const info = describeEntry(entry)
        const prefix = candidates.includes(entry.key) ? 'Khớp chính xác · ' : suggestedKeys.includes(entry.key) ? 'Gợi ý cần xác nhận · ' : ''
        return <option key={entry.key} value={entry.key}>{prefix}{info.authors} ({info.year || '?'}) — {info.title || entry.key} · {entry.key}</option>
      })}
    </select>
    {suggestions.length > 0 && <span className="cite-item-meta">{suggestions.map(item => item.reason).join(' ')}</span>}
    {query && <span className="cite-item-meta">{matches.length} nguồn khớp tìm kiếm{matches.length > 100 ? ' — hiển thị 100 nguồn đầu, hãy tìm cụ thể hơn' : ''}.</span>}
    {selected && <span className="cite-item-meta">{selectedSuggestion ? reviewed ? 'Gợi ý đã được duyệt · ' : 'Gợi ý chờ bạn duyệt · ' : ''}<strong>{describeEntry(selected).title}</strong><br />{describeEntry(selected).authors} · {describeEntry(selected).year} · {selected.key}</span>}
  </div>
}
