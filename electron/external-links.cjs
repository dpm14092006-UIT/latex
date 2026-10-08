const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function safeExternalUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) return null
    return parsed.href
  } catch {
    return null
  }
}

module.exports = { safeExternalUrl }
