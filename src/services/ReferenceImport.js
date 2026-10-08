import { appendBibtex, classifyReferenceInput, extractDoi, formatBibtexEntry, makeCitationKey, normalizeIncomingBibtex, parseBibtex, parseReferenceLine } from './Bibliography.js'

const MAX_BIBTEX = 500_000

const normalizedDoi = value => (extractDoi(String(value || '')) || String(value || '').trim()).toLowerCase()

function updateExistingBibtexEntry(bibliography, key, incomingEntry, refresh) {
  const existingEntry = parseBibtex(bibliography).find(entry => entry.key === key)
  if (!existingEntry || !incomingEntry) return bibliography
  const fields = { ...existingEntry.fields }
  for (const [name, value] of Object.entries(incomingEntry.fields)) {
    if (value && (refresh || !fields[name] || name === 'year')) fields[name] = value
  }
  if (JSON.stringify(fields) === JSON.stringify(existingEntry.fields)) return bibliography
  const raw = formatBibtexEntry({ type: refresh ? incomingEntry.type : existingEntry.type, key, fields })
  return bibliography.slice(0, existingEntry.start) + raw + bibliography.slice(existingEntry.end)
}

async function lookupDoi(doi) {
  if (window.desktopAPI?.lookupDoi) return (await window.desktopAPI.lookupDoi(doi)).bibtex
  const response = await fetch('/api/doi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doi }) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Không tra được DOI ${doi}.`)
  return body.bibtex
}

// Adds pasted BibTeX, DOIs or a formatted reference list to the bibliography. Returns the new text and keys.
export async function importReferences(input, bibliography, onProgress, lookup = lookupDoi) {
  const existing = parseBibtex(bibliography)
  const keys = new Set(existing.map(entry => entry.key))
  const knownDois = new Map(existing.filter(entry => entry.fields.doi).map(entry => [normalizedDoi(entry.fields.doi), entry.key]))
  let currentBibliography = bibliography
  const { bibtex, dois, lines, ris } = classifyReferenceInput(input)
  const chunks = []
  const addedKeys = []
  const errors = []
  const sourceNumbers = {}
  const keyRenames = {}
  let updated = 0
  let parsedFromText = 0
  const recordNumber = (line, resolvedKeys) => {
    const number = line?.match(/^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s/)?.slice(1).find(Boolean)
    if (number && Number(number) > 0 && resolvedKeys.length) {
      const label = String(Number(number))
      sourceNumbers[label] = [...new Set([...(sourceNumbers[label] || []), ...resolvedKeys])]
    }
  }
  const addBibtex = (text, refresh = false) => {
    const result = normalizeIncomingBibtex(text, keys)
    if (result.skipped.length) errors.push('Không đọc được BibTeX. Hãy kiểm tra dấu ngoặc và cú pháp của bản ghi; nội dung này chưa được thêm.')
    const incomingEntries = parseBibtex(result.text)
    const resolvedKeys = []
    for (const { key, doi } of result.added) {
      const doiKey = normalizedDoi(doi)
      const incomingEntry = incomingEntries.find(entry => entry.key === key && normalizedDoi(entry.fields.doi) === doiKey)
      const existingKey = doiKey ? knownDois.get(doiKey) : null
      if (existingKey) {
        const next = updateExistingBibtexEntry(currentBibliography, existingKey, incomingEntry, refresh)
        if (next !== currentBibliography) updated++
        currentBibliography = next
        addedKeys.push(existingKey)
        resolvedKeys.push(existingKey)
        continue
      }
      if (!incomingEntry) continue
      keys.add(key)
      if (doiKey) knownDois.set(doiKey, key)
      addedKeys.push(key)
      resolvedKeys.push(key)
      const chunk = result.text.slice(incomingEntry.start, incomingEntry.end)
      chunks.push(chunk)
      currentBibliography = appendBibtex(currentBibliography, chunk)
    }
    return resolvedKeys
  }
  if (bibtex) addBibtex(bibtex)
  if (ris.length) {
    const risKeys = new Set(keys)
    const converted = []
    for (const [index, record] of ris.entries()) {
      onProgress?.(`Đang xử lý ${index + 1}/${ris.length}…`)
      if (!record.fields.title) { errors.push(`Bản ghi RIS ${index + 1} thiếu tiêu đề.`); continue }
      const key = makeCitationKey(record.fields, risKeys)
      risKeys.add(key)
      converted.push(formatBibtexEntry({ type: record.type, key, fields: record.fields }))
    }
    if (converted.length) addBibtex(converted.join('\n\n'))
  }
  const tasks = [...dois.map(doi => ({ doi })), ...lines.map(line => ({ line, doi: extractDoi(line) }))]
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]
    onProgress?.(`Đang xử lý ${index + 1}/${tasks.length}…`)
    if (task.doi) {
      try {
        const resolved = addBibtex(await lookup(task.doi), true)
        if (!resolved.length) throw Error(`Resolver DOI ${task.doi} không trả bản ghi hợp lệ.`)
        recordNumber(task.line, resolved)
        continue
      } catch (error) {
        if (!task.line) { errors.push(error.message); continue }
        const existingKey = knownDois.get(normalizedDoi(task.doi))
        if (existingKey) {
          addedKeys.push(existingKey)
          recordNumber(task.line, [existingKey])
          errors.push(`Không cập nhật được metadata cho DOI ${task.doi}; vẫn giữ bản ghi hiện có.`)
          continue
        }
      }
    }
    const parsed = parseReferenceLine(task.line)
    if (!parsed?.fields.title) { errors.push(`Không nhận ra: ${task.line.slice(0, 80)}`); continue }
    const key = makeCitationKey(parsed.fields, keys)
    recordNumber(task.line, addBibtex(formatBibtexEntry({ type: parsed.type, key, fields: parsed.fields })))
    parsedFromText++
  }
  const text = currentBibliography
  if (new TextEncoder().encode(text).length > MAX_BIBTEX) throw new Error('Danh mục BibTeX vượt quá 500 KB tính theo UTF-8.')
  return { text, addedKeys: [...new Set(addedKeys)], errors, added: chunks.length, updated, parsedFromText, sourceNumbers, keyRenames }
}
