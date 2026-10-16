import { SpellcheckEngine } from '../services/SpellcheckEngine.js'
import { latexSpellcheckSegments } from '../services/LatexSpellcheckScanner.js'

let engine, signature = '', generation = 0
async function load(message) {
  const next = JSON.stringify([message.locale, message.words])
  if (engine && next === signature) return engine
  const locale = message.locale === 'en-GB' ? 'en-GB' : 'en-US'
  const resources = await Promise.all(['aff', 'dic'].map(async extension => {
    const response = await fetch(new URL(`${locale}.${extension}`, message.assetBase))
    if (!response.ok) throw new Error(`Không nạp được từ điển ${locale} (${response.status}).`)
    return response.text()
  }))
  engine = new SpellcheckEngine(...resources, message.words || [])
  signature = next
  return engine
}

self.onmessage = async ({ data: message }) => {
  const current = ++generation
  if (message.type === 'cancel') return
  try {
    const checker = await load(message)
    if (current !== generation) return
    if (message.type === 'suggest') {
      self.postMessage({ id: message.id, suggestions: checker.suggest(message.word) })
      return
    }
    const errors = []
    let truncated = false
    let batchBytes = 0, lastYield = performance.now()
    const sourceScan = typeof message.source === 'string'
    const segments = sourceScan ? latexSpellcheckSegments(message.source) : message.segments
    for (const segment of segments) {
      // A single huge paragraph must still yield, so split by safe whitespace boundaries.
      for (let offset = 0; offset < segment.text.length;) {
        let end = Math.min(segment.text.length, offset + 4000)
        while (end < segment.text.length && !/\s/u.test(segment.text[end])) end++
        const batch = checker.scan({ id: segment.id, text: segment.text.slice(offset, end) })
        for (const error of batch) {
          if (errors.length >= 2000) { truncated = true; break }
          const from = error.from + offset, to = error.to + offset
          errors.push({ ...error, from, to, ...(sourceScan ? { target: segment.target, position: segment.target.from + from, label: 'LaTeX', context: segment.text.slice(Math.max(0, from - 35), to + 45) } : {}) })
        }
        if (truncated) break
        batchBytes += end - offset
        offset = end
        if (batchBytes >= 8000 || performance.now() - lastYield >= 8) {
          await new Promise(resolve => setTimeout(resolve, 0))
          if (current !== generation) return
          batchBytes = 0; lastYield = performance.now()
        }
      }
      if (truncated) break
    }
    self.postMessage({ id: message.id, errors, truncated })
  } catch (error) {
    if (current === generation) self.postMessage({ id: message.id, error: error.message || 'Không thể kiểm tra chính tả.' })
  }
}
