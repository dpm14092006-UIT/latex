const http = require('node:http')
const https = require('node:https')
const { setTimeout: delay } = require('node:timers/promises')
const { createHash } = require('node:crypto')
const transport = require('./lan-sync-transport.cjs')

function relayUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 1000) throw new Error('Nhập địa chỉ HTTPS của máy chủ đồng bộ.')
  const url = new URL(raw)
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Máy chủ đồng bộ phải dùng HTTPS, không kèm đường dẫn hoặc mật khẩu. HTTP chỉ dành cho thử nghiệm trên máy này.')
  return url.origin
}
function validateRoute(route, hosting = false) {
  relayUrl(route?.url)
  for (const field of ['room', 'access', ...(hosting ? ['owner'] : [])]) {
    if (typeof route[field] !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(route[field])) throw new Error('Thông tin ghép project không hợp lệ.')
  }
  if (hosting && createHash('sha256').update(route.owner).digest('base64url') !== route.room) throw new Error('Máy chủ project không khớp mã định danh.')
}
function call(route, path, { method = 'POST', token = route.access, body = '', headers = {}, signal, timeout = 35000, limit = transport.MAX_WIRE_BYTES + 65536 } = {}) {
  validateRoute(route)
  return new Promise((resolve, reject) => {
    const url = new URL(`/v1/rooms/${route.room}${path}`, relayUrl(route.url))
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, signal, agent: false, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers,
    } }, async res => {
      try {
        const raw = await transport.readBody(res, limit)
        if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(res.statusCode === 503 || res.statusCode === 404 ? 'Máy giữ project chưa trực tuyến hoặc máy chủ chuyển tiếp đang khởi động lại.' : `Máy chủ chuyển tiếp trả lỗi ${res.statusCode}.`)
        resolve({ status: res.statusCode, raw })
      } catch (error) { reject(error) }
    })
    const timer = setTimeout(() => req.destroy(new Error('Kết nối đồng bộ hết thời gian; dữ liệu vẫn được lưu trên máy.')), timeout)
    req.once('close', () => clearTimeout(timer))
    req.once('error', reject)
    req.end(body)
  })
}
async function request(route, path, payload, key, deviceId, { signal } = {}) {
  const body = transport.seal(payload, key, `request:${path}`)
  if (Buffer.byteLength(body) > transport.MAX_WIRE_BYTES) throw new Error('Gói đồng bộ vượt giới hạn.')
  const { raw } = await call(route, '/call', { body, signal, headers: { 'X-Sync-Path': path, 'X-Vietlatex-Device': deviceId }, timeout: transport.requestTimeoutForWireBytes(Buffer.byteLength(body)) + 30000 })
  const envelope = JSON.parse(raw)
  if (envelope.status !== 200) throw new Error(envelope.status === 401 ? 'Mã ghép hết hạn hoặc thiết bị đã bị thu hồi quyền.' : envelope.status === 409 ? 'Đồng hồ giữa hai máy lệch quá 5 phút. Bật đồng bộ thời gian tự động rồi thử lại.' : `Máy giữ project trả lỗi ${envelope.status}.`)
  const result = transport.unseal(envelope.wire, key, `response:${path}`)
  if (result.requestId !== payload.requestId) throw new Error('Phản hồi không khớp lượt đồng bộ.')
  if (result.error) throw new Error(result.error)
  return result
}
function host(route, dispatch, onStatus = () => {}) {
  validateRoute(route, true)
  const controller = new AbortController()
  const signal = controller.signal
  const work = (async () => {
    let backoff = 1000
    while (!signal.aborted) {
      try {
        await call(route, '/register', { token: route.owner, body: JSON.stringify({ access: route.access }), signal, limit: 4096 })
        onStatus('')
        backoff = 1000
        while (!signal.aborted) {
          const { raw } = await call(route, '/poll', { method: 'GET', token: route.owner, signal })
          if (!raw) continue
          const message = JSON.parse(raw)
          // Stopping must not wait for a dispatch queued behind configure().
          let abort
          const aborted = new Promise((_, reject) => { abort = () => reject(new Error('Relay stopped')); signal.addEventListener('abort', abort, { once: true }) })
          let result
          try { result = await Promise.race([dispatch(message), aborted]) }
          finally { signal.removeEventListener('abort', abort) }
          await call(route, `/reply/${message.id}`, { token: route.owner, body: JSON.stringify(result), signal, timeout: transport.requestTimeoutForWireBytes(Buffer.byteLength(result.wire)) + 30000, limit: 4096 })
        }
      } catch (error) {
        if (signal.aborted) break
        onStatus(error.message)
        await delay(backoff, undefined, { signal }).catch(() => {})
        backoff = Math.min(backoff * 2, 30000)
      }
    }
  })()
  return { stop: async () => { controller.abort(); await work } }
}
module.exports = { relayUrl, validateRoute, call, request, host }
