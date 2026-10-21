// Opaque, memory-only forwarding. No project contents or pairing keys are stored.
const http = require('node:http')
const { randomUUID, createHash, timingSafeEqual } = require('node:crypto')
const { readBody, MAX_WIRE_BYTES, MAX_REQUEST_TIMEOUT_MS } = require('./lan-sync-transport.cjs')
const digest = value => createHash('sha256').update(value).digest()
const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)

function createRelayServer({ maxRooms = 256, maxBytes = 2 * MAX_WIRE_BYTES, pollMs = 20000, offlineMs = 60000, requestMs = MAX_REQUEST_TIMEOUT_MS, now = Date.now } = {}) {
  const rooms = new Map(), rates = new Map()
  const budget = { used: 0, max: maxBytes }
  let retained = 0
  const end = (res, status, value = '') => {
    if (res.destroyed || res.writableEnded) return
    const body = typeof value === 'string' ? value : JSON.stringify(value)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }); res.end(body)
  }
  const authorized = (token, expected) => validSecret(token) && expected && timingSafeEqual(digest(token), expected)
  function dispatch(room) {
    if (!room.poll) return
    const entry = [...room.pending.values()].find(item => !item.delivered)
    if (!entry) return
    const poll = room.poll; room.poll = null; clearTimeout(poll.timer)
    entry.delivered = true
    end(poll.res, 200, entry.message)
  }
  async function handle(req, res) {
    if (req.headers.origin) return end(res, 403)
    if (req.method === 'GET' && req.url === '/healthz') return end(res, 200, { ok: true })
    const match = /^\/v1\/rooms\/([A-Za-z0-9_-]{43})\/(register|poll|call|reply\/([a-f0-9-]{36}))$/.exec(req.url || '')
    if (!match) return end(res, 404)
    const [, id, action, replyId] = match
    if (req.method !== (action === 'poll' ? 'GET' : 'POST')) return end(res, 405)
    const ip = req.socket.remoteAddress
    const rate = rates.get(ip) || { at: now(), count: 0 }
    if (now() - rate.at > 60000) { rate.count = 0; rate.at = now() }
    rates.set(ip, rate)
    if (rates.size > 4096) rates.delete(rates.keys().next().value)
    if (++rate.count > 3000) return end(res, 429)
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!validSecret(token)) return end(res, 401)
    let room = rooms.get(id)
    if (action === 'register') {
      // The route stays bound to its owner even after a relay restart/expiry.
      // Knowing a room ID or an invitation cannot claim the room as its host.
      if (digest(token).toString('base64url') !== id) return end(res, 401)
      if (room && !authorized(token, room.owner)) return end(res, 401)
      if (!room && rooms.size >= maxRooms) return end(res, 503)
      if (Number(req.headers['content-length']) > 4096) return end(res, 413)
      const data = JSON.parse(await readBody(req, 4096, budget))
      if (!validSecret(data.access)) return end(res, 400)
      // Recheck after reading: simultaneous registration cannot take over a room.
      room = rooms.get(id)
      if (room && !authorized(token, room.owner)) return end(res, 401)
      if (!room && rooms.size >= maxRooms) return end(res, 503)
      if (!room) { room = { owner: digest(token), access: digest(data.access), pending: new Map(), seen: now(), poll: null }; rooms.set(id, room) }
      else if (!authorized(data.access, room.access)) return end(res, 409)
      room.seen = now()
      return end(res, 200, '{}')
    }
    if (!room) return end(res, 404)
    if (!authorized(token, action === 'call' ? room.access : room.owner)) return end(res, 401)
    if (action === 'poll') {
      room.seen = now()
      if (room.poll) return end(res, 409)
      const poll = { res, timer: setTimeout(() => { if (room.poll === poll) room.poll = null; end(res, 204) }, pollMs) }
      room.poll = poll
      res.once('close', () => { clearTimeout(poll.timer); if (room.poll === poll) room.poll = null })
      dispatch(room)
      return
    }
    const limit = MAX_WIRE_BYTES + 65536
    if (Number(req.headers['content-length']) > limit) return end(res, 413)
    if (action === 'call') {
      if (now() - room.seen > offlineMs) return end(res, 503)
      const path = req.headers['x-sync-path'], deviceId = req.headers['x-vietlatex-device']
      if (!['/pair', '/exchange', '/resolve', '/pdf', '/invite'].includes(path) || !/^[a-f0-9-]{36}$/.test(deviceId || '')) return end(res, 400)
      if (room.pending.size >= 16 || [...room.pending.values()].some(item => item.message.deviceId === deviceId)) return end(res, 429)
      const wire = await readBody(req, path === '/pair' ? 65536 : MAX_WIRE_BYTES, budget)
      const bytes = Buffer.byteLength(wire)
      if (retained + budget.used + bytes > maxBytes || room.pending.size >= 16 || [...room.pending.values()].some(item => item.message.deviceId === deviceId)) return end(res, 503)
      const requestId = randomUUID()
      const entry = { res, message: { id: requestId, path, deviceId, wire }, delivered: false }
      retained += bytes; budget.max = maxBytes - retained
      room.pending.set(requestId, entry)
      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true; clearTimeout(entry.timer); room.pending.delete(requestId); retained -= bytes; budget.max = maxBytes - retained
      }
      entry.timer = setTimeout(() => { cleanup(); end(res, 503) }, requestMs)
      res.once('close', cleanup)
      dispatch(room)
      return
    }
    const entry = room.pending.get(replyId)
    if (!entry) return end(res, 404)
    const raw = await readBody(req, limit, budget)
    const data = JSON.parse(raw)
    if (!Number.isInteger(data.status) || data.status < 200 || data.status > 599 || typeof data.wire !== 'string' || Buffer.byteLength(data.wire) > MAX_WIRE_BYTES) return end(res, 400)
    end(entry.res, 200, raw)
    end(res, 200, '{}')
  }
  const server = http.createServer((req, res) => { void handle(req, res).catch(error => end(res, error.status || 400)) })
  server.requestTimeout = MAX_REQUEST_TIMEOUT_MS; server.headersTimeout = 10000; server.maxConnections = 1024
  const sweep = setInterval(() => {
    for (const [id, room] of rooms) if (!room.poll && !room.pending.size && now() - room.seen > offlineMs) rooms.delete(id)
  }, Math.min(offlineMs, 30000))
  sweep.unref()
  async function stop() {
    clearInterval(sweep)
    for (const room of rooms.values()) {
      if (room.poll) { clearTimeout(room.poll.timer); end(room.poll.res, 503) }
      for (const entry of room.pending.values()) { clearTimeout(entry.timer); end(entry.res, 503) }
    }
    rooms.clear(); server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  return { server, stop }
}
if (require.main === module) {
  const relay = createRelayServer()
  const port = Number(process.env.PORT || 8787), host = process.env.RELAY_BIND || '127.0.0.1'
  relay.server.listen(port, host, () => console.log(`VietLaTeX relay listening on ${host}:${port}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void relay.stop() })
}
module.exports = { createRelayServer }
