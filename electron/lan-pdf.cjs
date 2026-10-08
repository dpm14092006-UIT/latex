const { createHash } = require('node:crypto')
const MAX_PDF_BYTES = 24 * 1024 * 1024
const MAX_CACHE_BYTES = 32 * 1024 * 1024
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function validatePdf(value) {
  if (!value || !/^[A-Za-z0-9._-]{1,160}$/.test(value.id) || ![value.documentKey, value.compileKey, value.sha256].every(key => /^[a-f0-9]{64}$/.test(key)) || typeof value.data !== 'string' || value.data.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) throw new Error('PDF đồng bộ không hợp lệ hoặc vượt 24 MB.')
  const bytes = Buffer.from(value.data, 'base64')
  if (!bytes.length || bytes.length > MAX_PDF_BYTES || bytes.toString('base64') !== value.data || bytes.subarray(0, 5).toString() !== '%PDF-' || digest(bytes) !== value.sha256) throw new Error('PDF đồng bộ bị hỏng hoặc không khớp SHA-256.')
  return bytes
}
function putPdf(cache, value, local) {
  validatePdf(value)
  delete cache[value.id]
  cache[value.id] = { ...value, local }
  let size = Object.values(cache).reduce((sum, item) => sum + Buffer.byteLength(item.data, 'base64'), 0)
  for (const id of Object.keys(cache)) {
    if (size <= MAX_CACHE_BYTES) break
    size -= Buffer.byteLength(cache[id].data, 'base64'); delete cache[id]
  }
}
const offer = ({ id, documentKey, compileKey, sha256 }) => ({ id, documentKey, compileKey, sha256 })
module.exports = { MAX_PDF_BYTES, digest, validatePdf, putPdf, offer }
