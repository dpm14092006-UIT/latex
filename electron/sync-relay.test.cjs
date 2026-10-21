const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createHash, randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { createRelayServer } = require('./sync-relay-server.cjs')
const { call } = require('./sync-relay-client.cjs')
const { secret } = require('./lan-sync-transport.cjs')

async function setup(t, options = {}) {
  const relay = createRelayServer({ pollMs: 40, requestMs: 1000, ...options })
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve))
  t.after(() => relay.stop())
  const owner = secret()
  const route = { url: `http://127.0.0.1:${relay.server.address().port}`, room: createHash('sha256').update(owner).digest('base64url'), owner, access: secret() }
  await call(route, '/register', { token: route.owner, body: JSON.stringify({ access: route.access }) })
  return { relay, route }
}
const headers = () => ({ 'X-Sync-Path': '/exchange', 'X-Vietlatex-Device': randomUUID() })

test('relay forwards opaque packets, accepts only owner replies and removes them after delivery', async t => {
  const { route } = await setup(t)
  const pending = call(route, '/call', { body: 'opaque-ciphertext', headers: headers() })
  const poll = JSON.parse((await call(route, '/poll', { method: 'GET', token: route.owner })).raw)
  assert.equal(poll.wire, 'opaque-ciphertext')
  await assert.rejects(call(route, `/reply/${poll.id}`, { body: '{}' }), /401/)
  await call(route, `/reply/${poll.id}`, { token: route.owner, body: JSON.stringify({ status: 200, wire: 'opaque-response' }) })
  assert.deepEqual(JSON.parse((await pending).raw), { status: 200, wire: 'opaque-response' })
  await delay(20)
  await assert.rejects(call(route, `/reply/${poll.id}`, { token: route.owner, body: '{}' }), /trực tuyến/)
})

test('room identity cannot be claimed with an invitation token, including after expiry', async t => {
  let clock = 0
  const { relay, route } = await setup(t, { now: () => clock, offlineMs: 50 })
  await assert.rejects(call(route, '/register', { token: route.access, body: JSON.stringify({ access: route.access }) }), /401/)
  clock = 1000
  await delay(80)
  await assert.rejects(call(route, '/register', { token: route.access, body: JSON.stringify({ access: route.access }) }), /401/)
  await call(route, '/register', { token: route.owner, body: JSON.stringify({ access: route.access }) })
  assert.ok(relay.server.listening)
})

test('relay rejects oversized bodies early and bounds buffered packets', async t => {
  const { route } = await setup(t, { maxBytes: 128 })
  const response = await new Promise((resolve, reject) => {
    const req = http.request(`${route.url}/v1/rooms/${route.room}/call`, { method: 'POST', headers: { Authorization: `Bearer ${route.access}`, 'Content-Length': 200 * 1024 * 1024, ...headers() } }, res => { res.resume(); resolve(res.statusCode) })
    req.once('error', reject); req.end()
  })
  assert.equal(response, 413)
  const controller = new AbortController()
  const first = call(route, '/call', { body: 'x'.repeat(80), headers: headers(), signal: controller.signal }).catch(error => error)
  // Polling confirms the first packet is retained, without completing it.
  await call(route, '/poll', { method: 'GET', token: route.owner })
  await assert.rejects(call(route, '/call', { body: 'x'.repeat(80), headers: headers() }), /trực tuyến/)
  controller.abort(); await first
})

test('disconnected clients are cleaned up and host stop aborts an idle poll', async t => {
  const { route } = await setup(t)
  const controller = new AbortController(), deviceHeaders = headers()
  const pending = call(route, '/call', { body: '{}', headers: deviceHeaders, signal: controller.signal }).catch(error => error)
  await call(route, '/poll', { method: 'GET', token: route.owner })
  controller.abort(); await pending; await delay(20)
  const retryController = new AbortController()
  const retry = call(route, '/call', { body: '{}', headers: deviceHeaders, signal: retryController.signal }).catch(error => error)
  const poll = await call(route, '/poll', { method: 'GET', token: route.owner })
  assert.ok(JSON.parse(poll.raw).id)
  retryController.abort(); await retry
})
