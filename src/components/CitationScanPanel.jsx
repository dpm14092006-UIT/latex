import { useMemo, useState } from 'react'
import { closeHistory } from '@tiptap/pm/history'
import { hasConflictingSuffixChoices, linkCitationTransaction, normalizeCitationSearch, parseSourceMapping, scanUnlinkedCitations } from '../services/CitationLinker.js'
import { isCitationKey } from '../services/Bibliography.js'
import CitationSourcePicker from './CitationSourcePicker.jsx'

export default function CitationScanPanel({ editor, entries, settings, onSettings }) {
  const [sourceId, setSourceId] = useState('')
  const [scan, setScan] = useState(null)
  const [values, setValues] = useState({})
  const [checked, setChecked] = useState(new Set())
  const [message, setMessage] = useState('')
  const [mappingOpen, setMappingOpen] = useState(false)
  const [mappingText, setMappingText] = useState('')
  const [mappingLabel, setMappingLabel] = useState('')
  const [undoDoc, setUndoDoc] = useState(null)
  const [filter, setFilter] = useState('all')
  const [rowQuery, setRowQuery] = useState('')
  const maps = settings.citationSourceMaps || []
  const usable = useMemo(() => {
    const counts = new Map()
    for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) || 0) + 1)
    return entries.filter(entry => isCitationKey(entry.key) && counts.get(entry.key) === 1)
  }, [entries])
  const byKey = new Map(usable.map(entry => [entry.key, entry]))
  const valid = row => values[row.id]?.length === row.groups.length && row.groups.length > 0 && values[row.id].every(key => byKey.has(key)) && !hasConflictingSuffixChoices(row, values[row.id])
  const selectedRows = scan?.rows.filter(row => checked.has(row.id) && valid(row)) || []
  const visibleRows = scan?.rows.filter(row => {
    if (filter === 'selected' && (!checked.has(row.id) || !valid(row))) return false
    if (filter === 'unresolved' && row.resolved && valid(row) && row.groups.every((group, index) => values[row.id][index] === group.candidates[0])) return false
    if (filter === 'partial' && (row.resolved || !row.groups.some(group => group.candidates.length === 1))) return false
    if (filter === 'ambiguous' && !row.groups.some(group => group.candidates.length > 1)) return false
    const search = normalizeCitationSearch(`${row.text} ${row.context} ${(values[row.id] || []).join(' ')}`)
    return normalizeCitationSearch(rowQuery).split(' ').filter(Boolean).every(word => search.includes(word))
  }) || []
  const unreviewedExactRows = visibleRows.filter(row => row.resolved && valid(row) && row.groups.every((group, index) => values[row.id][index] === group.candidates[0]) && !checked.has(row.id))

  const scanMessage = result => {
    const rows = result.rows
    const exact = rows.filter(row => row.resolved).length
    const near = rows.filter(row => !row.resolved && row.groups.some(group => group.suggestions?.length)).length
    const ambiguous = rows.filter(row => row.groups.some(group => group.candidates.length > 1)).length
    const authorYearGroups = rows.filter(row => ['author-year', 'narrative'].includes(row.kind)).flatMap(row => row.groups)
    const exactParts = authorYearGroups.filter(group => group.candidates.length === 1 && !group.missing.length).length
    const suggestedParts = authorYearGroups.filter(group => !group.candidates.length && group.suggestions?.length).length
    const ambiguousParts = authorYearGroups.filter(group => group.candidates.length > 1).length
    const missingParts = authorYearGroups.filter(group => !group.candidates.length && !group.suggestions?.length && !group.missing.length).length
    if (authorYearGroups.length && exactParts === 0 && suggestedParts === 0 && ambiguousParts === 0) {
      return `Đã nhận diện ${rows.length} vị trí, gồm ${authorYearGroups.length} phần tác giả–năm; chưa có phần nào khớp REF trong ${entries.length} mục BibTeX. Kiểm tra danh mục hoặc chọn REF thủ công. Không tự ghép khi tên/năm không đủ căn cứ.`
    }
    const noMatch = rows.filter(row => !row.resolved && !row.groups.some(group => group.candidates.length > 1 || group.suggestions?.length)).length
    const limit = result.truncated ? ' Đang hiển thị tối đa 2.000 vị trí; cite xong hãy quét lại phần còn lại.' : ''
    const authorYearStatus = authorYearGroups.length ? ` Phần tác giả–năm: ${exactParts} khớp chính xác, ${suggestedParts} có REF gần khớp cần xác nhận, ${ambiguousParts} mơ hồ, ${missingParts} chưa có gợi ý.` : ''
    return `Đã nhận diện ${rows.length} vị trí: ${exact} khớp chính xác toàn bộ, ${near} có REF gợi ý cần xác nhận, ${ambiguous} mơ hồ, ${noMatch} chưa có REF.${authorYearStatus} Duyệt REF bên dưới rồi bấm Cite để cập nhật tài liệu.${limit}`
  }

  const runScan = (id = sourceId, suppliedMaps = maps, mapping = null, preserve = true) => {
    if (!editor) return
    const result = scanUnlinkedCitations(editor.state.doc, entries, suppliedMaps.find(map => map.id === id))
    const previous = new Map((scan?.rows || []).map(row => [mapping ? String(mapping.map(row.from, -1)) : row.id, row]))
    const nextValues = {}, nextChecked = new Set()
    for (const row of result.rows) {
      const old = previous.get(row.id)
      const keep = preserve && scan?.bibliography === settings.bibliography && old?.text === row.text && old.signature === row.signature && (row.kind !== 'number' || scan.sourceId === id)
      nextValues[row.id] = keep ? [...values[old.id]] : row.groups.map(group => {
        if (group.candidates.length === 1 && !group.missing.length) return group.candidates[0]
        if (!group.candidates.length && group.suggestions?.length === 1) return group.suggestions[0].key
        return ''
      })
      if (keep && checked.has(old.id)) nextChecked.add(row.id)
    }
    setScan({ ...result, bibliography: settings.bibliography, sourceId: id })
    setValues(nextValues)
    setChecked(nextChecked)
    setMessage(scanMessage(result))
  }
  const linkRows = (rows, successMessage) => {
    try {
      if (scan.bibliography !== settings.bibliography) throw Error('BibTeX đã thay đổi. Hãy quét lại trước khi liên kết.')
      const choices = Object.fromEntries(rows.map(row => [row.id, values[row.id]]))
      const result = linkCitationTransaction(editor.state, scan, choices, entries)
      if (!result) return
      editor.view.dispatch(result.transaction)
      editor.view.dispatch(closeHistory(editor.state.tr))
      setUndoDoc(editor.state.doc)
      runScan(sourceId, maps, result.transaction.mapping)
      setMessage(successMessage(result.count))
    } catch (error) { setMessage(error.message) }
  }
  const choose = (row, index, key) => {
    const next = [...(values[row.id] || [])]
    next[index] = key.trim()
    setValues(previous => ({ ...previous, [row.id]: next }))
    setChecked(previous => {
      const result = new Set(previous)
      result.delete(row.id)
      return result
    })
  }
  const applyRepeated = row => {
    const repeats = scan.rows.filter(item => item.signature === row.signature)
    setValues(previous => ({ ...previous, ...Object.fromEntries(repeats.map(item => [item.id, [...values[row.id]]])) }))
    setChecked(previous => new Set([...previous, ...repeats.map(item => item.id)]))
    setMessage(`Đã chọn cùng REF cho ${repeats.length} lần xuất hiện của ${row.text}. Kiểm tra danh sách rồi bấm Cite khi sẵn sàng.`)
  }
  const apply = () => linkRows(selectedRows, count => `Đã cite ${count} vị trí bạn duyệt với REF. Có thể hoàn tác toàn bộ lần cite này.`)
  const selectExactMatches = () => {
    const ids = unreviewedExactRows.map(row => row.id)
    if (!ids.length) return
    setChecked(previous => new Set([...previous, ...ids]))
    setMessage(`Đã chọn ${ids.length} dòng khớp chính xác tác giả và năm để bạn duyệt. Các gợi ý lệch tên/năm vẫn chưa được chọn; mở từng dòng, xác nhận REF rồi tự đánh dấu nếu đúng. Tài liệu chưa bị thay đổi.`)
  }
  const saveMapping = () => {
    try {
      const numbers = parseSourceMapping(mappingText, entries)
      const item = { id: crypto.randomUUID(), label: mappingLabel.trim() || `Danh mục gốc ${maps.length + 1}`, numbers }
      const next = [...maps, item].slice(-50)
      onSettings({ ...settings, citationSourceMaps: next })
      setSourceId(item.id)
      setMappingOpen(false)
      setMappingText('')
      setMappingLabel('')
      runScan(item.id, next)
    } catch (error) { setMessage(error.message) }
  }

  return <div className="cite-dialog">
    <p className="cite-preview">Quét cả Sousa et al. (2025), Giri and Chen (2022), (Tác giả, năm), [12] và [@smith2021]. Trích dẫn tường thuật giữ tác giả trong câu; năm hoặc số hiển thị theo kiểu trích dẫn bạn chọn.</p>
    <label className="label" htmlFor="citation-source-map">Danh mục số gốc dùng để đối chiếu [12]</label>
    <select id="citation-source-map" className="field" value={sourceId} onChange={event => { setSourceId(event.target.value); if (scan) runScan(event.target.value) }}>
      <option value="">Chưa chọn — chọn REF thủ công cho trích dẫn số</option>
      {maps.map(map => <option key={map.id} value={map.id}>{map.label} ({Object.keys(map.numbers).length} số)</option>)}
    </select>
    <div className="studio-manager-actions">
      <button type="button" className="btn btn--solid" onClick={() => runScan()}>{scan ? 'Quét lại tài liệu' : 'Quét tài liệu'}</button>
      <button type="button" className="btn" aria-expanded={mappingOpen} onClick={() => setMappingOpen(value => !value)}>Thêm ánh xạ số gốc</button>
    </div>
    {mappingOpen && <div className="cite-dialog">
      <p className="cite-preview">Danh mục có số được nhập ở tab Danh mục sẽ tự lưu ánh xạ. Với REF đã có, nhập [12] khóa_REF, mỗi dòng một số. Đừng lấy thứ tự BibTeX làm số gốc.</p>
      <input className="field" aria-label="Tên danh mục gốc" placeholder="Tên danh mục gốc" value={mappingLabel} maxLength={160} onChange={event => setMappingLabel(event.target.value)} />
      <textarea className="field" rows={4} aria-label="Ánh xạ số gốc" placeholder={'[12] smith2021\n[13] nguyen2023'} maxLength={500000} value={mappingText} onChange={event => setMappingText(event.target.value)} />
      <button className="btn" type="button" onClick={saveMapping}>Lưu ánh xạ và quét</button>
    </div>}
    {message && <p className="studio-notice" role="status">{message}</p>}
    {scan && <>
      <div className="studio-manager-actions">
        {unreviewedExactRows.length > 0
          ? <button
            type="button"
            className="btn btn--solid"
            title="Chọn riêng các dòng khớp chính xác cả tác giả lẫn năm. Gợi ý khác tên hoặc năm cần bạn duyệt từng dòng; nút này chưa sửa tài liệu."
            onClick={selectExactMatches}
          >Chọn {unreviewedExactRows.length} khớp chính xác để duyệt</button>
          : <span className="cite-preview">{scan.rows.some(row => row.resolved)
            ? 'Không còn khớp chính xác chưa chọn trong kết quả đang hiển thị.'
            : 'Không có khớp chính xác để chọn hàng loạt. Kiểm tra từng REF gợi ý, đánh dấu dòng đúng rồi bấm Cite; tài liệu chưa thay đổi.'}</span>}
        <button
          type="button"
          className="btn"
          disabled={!checked.size}
          title={checked.size ? 'Bỏ chọn mọi vị trí, kể cả các vị trí ngoài bộ lọc hiện tại.' : 'Hiện không có vị trí nào được chọn.'}
          onClick={() => {
            setChecked(new Set())
            setMessage(`Đã bỏ chọn tất cả ${selectedRows.length} vị trí đã chọn.`)
          }}
        >Bỏ chọn tất cả</button>
      </div>
      <div className="citation-scan-filters">
        <input className="field" type="search" aria-label="Tìm trong kết quả quét" placeholder="Tìm tác giả, năm hoặc đoạn trích dẫn…" value={rowQuery} onChange={event => setRowQuery(event.target.value)} />
        <select className="field" aria-label="Lọc kết quả quét" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả</option><option value="unresolved">Cần kiểm tra / chọn nguồn</option><option value="partial">Nhóm khớp một phần</option><option value="ambiguous">Nhiều nguồn khớp</option><option value="selected">Đã chọn</option></select>
      </div>
      <span className="cite-preview">Hiển thị {visibleRows.length}/{scan.rows.length} vị trí · {scan.rows.filter(row => row.resolved).length} khớp chính xác toàn bộ · {scan.rows.filter(row => !row.resolved && row.groups.some(group => group.suggestions?.length)).length} có gợi ý REF · {selectedRows.length} đã duyệt để cite. Gợi ý gần khớp luôn cần bạn xác nhận.</span>
      <div className="citation-scan-list" role="group" aria-label="Trích dẫn chưa liên kết">
        {visibleRows.map(row => <div key={row.id} className="citation-scan-row">
          <label className="citation-scan-selection"><input type="checkbox" aria-label={`Duyệt ${row.text} tại ${row.from}`} disabled={!valid(row)} checked={checked.has(row.id) && valid(row)} onChange={event => setChecked(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next })} /><strong>{row.text}</strong></label>
          <p className="cite-preview">…{row.context}…</p>
          {!row.resolved && row.groups.length > 1 && <p className="cite-preview">Khớp chính xác {row.groups.filter(group => group.candidates.length === 1 && !group.missing.length).length}/{row.groups.length} nguồn. Nhóm này cần chọn đủ nguồn rồi đánh dấu duyệt; nút chọn khớp chính xác hàng loạt sẽ để lại nhóm này.</p>}
          {hasConflictingSuffixChoices(row, values[row.id]) && <p className="studio-notice" role="status">Các hậu tố a/b chỉ các bài khác nhau. Hãy chọn hai REF khác nhau theo tiêu đề/DOI.</p>}
          <p className="cite-preview">{row.resolved ? 'Khớp chính xác; chờ bạn duyệt. ' : row.groups.some(group => group.suggestions?.length) ? 'Có REF gợi ý; kiểm tra trước khi duyệt. ' : row.groups.some(group => group.candidates.length > 1) ? 'Có nhiều nguồn phù hợp. ' : ''}{row.reason}</p>
          {row.groups.map((group, index) => <div className="citation-scan-source" key={index}>
            <CitationSourcePicker id={`cite-scan-${row.id}-${index}`} label={group.label} entries={usable} candidates={group.candidates} suggestions={group.suggestions} reviewed={checked.has(row.id)} value={values[row.id]?.[index] || ''} onChange={key => choose(row, index, key)} />
            {values[row.id]?.[index] && !byKey.has(values[row.id][index]) && <span className="cite-item-meta">Khóa REF không có hoặc bị trùng trong BibTeX.</span>}
            {group.missing.length > 0 && <span className="cite-item-meta">Nguồn gốc thiếu hoặc trùng khóa: {group.missing.join(', ')}. Hãy chọn nguồn rõ ràng.</span>}
          </div>)}
          <button type="button" className="btn" disabled={!valid(row)} onClick={() => applyRepeated(row)}>Dùng cho mọi lần xuất hiện của mẫu này</button>
        </div>)}
        {!visibleRows.length && <div className="cite-empty">{scan.rows.length ? 'Không có vị trí khớp bộ lọc. Các lựa chọn ngoài bộ lọc vẫn được giữ.' : 'Không còn mẫu trích dẫn phù hợp chưa liên kết.'}</div>}
      </div>
      <div className="studio-dialog-foot citation-scan-foot">
        <button type="button" className="btn" disabled={!undoDoc || editor?.state.doc !== undoDoc} onClick={() => { editor.commands.undo(); setUndoDoc(null); runScan(sourceId, maps, null, false); setMessage('Đã hoàn tác lần liên kết.'); }}>Hoàn tác liên kết</button>
        <button type="button" className="btn btn--solid" disabled={!selectedRows.length} onClick={apply}>Cite {selectedRows.length} vị trí đã duyệt</button>
      </div>
    </>}
  </div>
}
