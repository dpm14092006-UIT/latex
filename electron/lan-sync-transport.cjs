const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const http = require('node:http')
const { isIP } = require('node:net')
const MAX_WIRE_BYTES = 180 * 1024 * 1024
const MIN_REQUEST_TIMEOUT_MS = 30_000
const MAX_REQUEST_TIMEOUT_MS = 15 * 60_000
const MIN_TRANSFER_BYTES_PER_SECOND = 256 * 1024

function secret() { return randomBytes(32).toString('base64url') }
function keyBytes(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Khóa đồng bộ không hợp lệ.')
  return Buffer.from(key, 'base64url')
}
function seal(value, key, context) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv)
  cipher.setAAD(Buffer.from(`vietlatex-lan-v1:${context}`))
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: bytes.toString('base64') })
}
function unseal(raw, key, context) {
  const data = JSON.parse(raw)
  if (data.v !== 1 || typeof data.data !== 'string') throw new Error('Gói đồng bộ không hợp lệ.')
  const iv = Buffer.from(data.iv || '', 'base64'), tag = Buffer.from(data.tag || '', 'base64')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Gói đồng bộ không hợp lệ.')
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv)
  decipher.setAAD(Buffer.from(`vietlatex-lan-v1:${context}`))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data, 'base64')), decipher.final()]).toString('utf8'))
}
function localAddress(host) {
  if (isIP(host) !== 4) return false
  const [a, b] = host.split('.').map(Number)
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}
function validateEndpoint(host, port) {
  if (!localAddress(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chỉ kết nối địa chỉ IPv4 trong mạng nội bộ.')
}
function requestTimeoutForWireBytes(bytes) {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  return Math.min(MAX_REQUEST_TIMEOUT_MS, MIN_REQUEST_TIMEOUT_MS + Math.ceil(size / MIN_TRANSFER_BYTES_PER_SECOND * 1000))
}
// `budget` ({ used, max }) is shared by concurrent readers so several large
// bodies cannot together exhaust memory before they are authenticated.
async function readBody(stream, limit = MAX_WIRE_BYTES, budget) {
  let size = 0, reserved = 0
  const chunks = []
  // Returning early from a normal Readable async iterator destroys the stream,
  // which also closes its socket before the caller can send the 413/503 reply.
  const source = typeof stream.iterator === 'function' ? stream.iterator({ destroyOnReturn: false }) : stream
  try {
    for await (const chunk of source) {
      size += chunk.length
      if (size > limit) {
        stream.resume?.()
        throw Object.assign(new Error('Gói đồng bộ vượt giới hạn.'), { status: 413 })
      }
      if (budget) {
        budget.used += chunk.length; reserved += chunk.length
        if (budget.used > budget.max) {
          stream.resume?.()
          throw Object.assign(new Error('Máy chủ đồng bộ đang bận.'), { status: 503 })
        }
      }
      chunks.push(chunk)
    }
  } finally { if (budget) budget.used -= reserved }
  return Buffer.concat(chunks).toString('utf8')
}
function request(host, port, path, payload, key, deviceId, { signal } = {}) {
  validateEndpoint(host, port)
  const wire = seal(payload, key, `request:${path}`)
  if (Buffer.byteLength(wire) > MAX_WIRE_BYTES) return Promise.reject(new Error('Gói đồng bộ vượt giới hạn.'))
  return new Promise((resolve, reject) => {
    let timer
    const armTimeout = bytes => {
      clearTimeout(timer)
      timer = setTimeout(() => req.destroy(new Error('Không kết nối được máy chủ. Tiếp tục lưu trên máy và thử lại khi cùng mạng LAN.')), requestTimeoutForWireBytes(bytes))
    }
    const req = http.request({ hostname: host, port, path, method: 'POST', agent: false, signal, headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wire), 'X-Vietlatex-Device': deviceId,
    } }, async response => {
      const responseBytes = Number(response.headers['content-length'])
      armTimeout(Number.isFinite(responseBytes) ? responseBytes : MAX_WIRE_BYTES)
      try {
        const raw = await readBody(response)
        if (response.statusCode !== 200) {
          let errorCode = ''
          try { errorCode = JSON.parse(raw).code || '' } catch { /* Non-JSON errors use the status message below. */ }
          if (response.statusCode === 409 && errorCode === 'CLOCK_SKEW') throw new Error('Đồng hồ giữa hai máy lệch quá 5 phút. Hãy bật đồng bộ thời gian tự động trên cả hai máy rồi thử lại.')
          throw new Error(response.statusCode === 401 ? 'Mã ghép đã hết hạn hoặc máy này đã bị ngắt quyền kết nối.' : `Máy chủ đồng bộ trả lỗi ${response.statusCode}.`)
        }
        const result = unseal(raw, key, `response:${path}`)
        if (result.requestId !== payload.requestId) throw new Error('Phản hồi không khớp lượt đồng bộ.')
        if (result.error) throw new Error(result.error)
        resolve(result)
      } catch (error) { reject(error) }
    })
    armTimeout(Buffer.byteLength(wire))
    req.once('close', () => clearTimeout(timer))
    req.once('error', reject)
    req.end(wire)
  })
}
module.exports = { secret, seal, unseal, readBody, request, validateEndpoint, requestTimeoutForWireBytes, MAX_WIRE_BYTES, MAX_REQUEST_TIMEOUT_MS }
