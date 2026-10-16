const dgram = require('node:dgram')
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto')
const { networkInterfaces } = require('node:os')
// Lets a paired client find its host again after DHCP hands the host a new
// address. Only a host holding the client's pairing key can answer a probe, and
// the client still authenticates the first encrypted request to the new address.
const DISCOVERY_PORT = 47862
const PROBE = 'vietlatex-lan-probe', HERE = 'vietlatex-lan-here'
const MAX_DATAGRAM = 512
const MAX_REPLIES_PER_SECOND = 50

function broadcastTargets() {
  const targets = new Set(['255.255.255.255'])
  for (const info of Object.values(networkInterfaces()).flat()) {
    if (info?.family !== 'IPv4' || info.internal || !info.netmask) continue
    const address = info.address.split('.').map(Number), mask = info.netmask.split('.').map(Number)
    targets.add(address.map((part, index) => (part & mask[index]) | (~mask[index] & 255)).join('.'))
  }
  return [...targets]
}
function proof(key, nonce, port) {
  return createHmac('sha256', Buffer.from(key, 'base64url')).update(`${HERE}:${nonce}:${port}`).digest('base64url')
}
function parse(raw) {
  if (raw.length > MAX_DATAGRAM) return null
  try { return JSON.parse(raw.toString('utf8')) } catch { return null }
}

// Host side. Best effort: if the port is taken the host still works by IP.
function respond({ port = DISCOVERY_PORT, keyFor, httpPort }) {
  const socket = dgram.createSocket('udp4')
  let window = 0, replies = 0
  socket.on('error', () => { try { socket.close() } catch { /* already closed */ } })
  socket.on('message', (raw, from) => {
    const probe = parse(raw)
    if (probe?.t !== PROBE || probe.v !== 1 || typeof probe.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(probe.nonce) || typeof probe.deviceId !== 'string' || !/^[a-f0-9-]{36}$/.test(probe.deviceId)) return
    const key = keyFor(probe.deviceId), listening = httpPort()
    if (!key || !listening) return
    if (Date.now() - window > 1000) { window = Date.now(); replies = 0 }
    if (++replies > MAX_REPLIES_PER_SECOND) return
    socket.send(JSON.stringify({ t: HERE, v: 1, port: listening, proof: proof(key, probe.nonce, listening) }), from.port, from.address, () => {})
  })
  socket.bind(port)
  return { close() { try { socket.close() } catch { /* bind failed or already closed */ } } }
}

// Client side: resolves { host, port } of the host holding `key`, or null.
function discover({ key, deviceId, port = DISCOVERY_PORT, targets = broadcastTargets(), timeout = 1500 }) {
  const nonce = randomBytes(18).toString('base64url')
  const socket = dgram.createSocket('udp4')
  return new Promise(resolve => {
    let done = false
    const finish = value => {
      if (done) return
      done = true; clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeout)
    socket.on('error', () => finish(null))
    socket.on('message', (raw, from) => {
      const reply = parse(raw)
      if (reply?.t !== HERE || reply.v !== 1 || !Number.isInteger(reply.port) || typeof reply.proof !== 'string') return
      const expected = Buffer.from(proof(key, nonce, reply.port)), given = Buffer.from(reply.proof)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return
      finish({ host: from.address, port: reply.port })
    })
    socket.bind(0, () => {
      try { socket.setBroadcast(true) } catch { /* unicast targets still work */ }
      const probe = Buffer.from(JSON.stringify({ t: PROBE, v: 1, deviceId, nonce }))
      for (const target of targets) socket.send(probe, port, target, () => {})
    })
  })
}
module.exports = { respond, discover, broadcastTargets, DISCOVERY_PORT }
