const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, readFile, writeFile, utimes, access } = require('node:fs/promises')
const http = require('node:http')
const net = require('node:net')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')
const { createLanSync } = require('./lan-sync.cjs')
const { seal, unseal, secret, request, validateEndpoint, readBody, requestTimeoutForWireBytes, MAX_WIRE_BYTES, MAX_REQUEST_TIMEOUT_MS } = require('./lan-sync-transport.cjs')

const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const workspace = (prefix, text) => ({ version: 1, projects: [{ id: `project-${prefix}`, name: prefix, activeTaskId: `task-${prefix}`, tasks: [{ id: `task-${prefix}`, title: prefix, document: doc(text), sourceDraft: '', sourceEdited: false, sourceTrusted: true, assets: [], settings: {} }] }], activeProjectId: `project-${prefix}`, customTemplates: [], documentTemplates: [] })
const task = (value, id) => value.projects.flatMap(project => project.tasks).find(item => item.id === id)

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-lan-test-'))
  const services = []
  t.after(async () => { for (const service of services) await service.stop(); await rm(directory, { recursive: true, force: true }) })
  const create = async (name, options = {}) => { const service = createLanSync({ directory: join(directory, name), name, ...options }); await service.init(); services.push(service); return service }
  const host = await create('host'), client = await create('client')
  let a = workspace('a', 'Alpha'), b = workspace('b', 'Beta')
  await host.configure('host', a)
  const code = (await host.invitation('127.0.0.1')).code
  await client.configure('client', b, code)
  const sync = async (service, value) => { const result = await service.exchange(value); await service.acknowledge(result.receipt); return result.workspace }
  b = await sync(client, b); a = await sync(host, a)
  return { directory, host, client, a, b, sync, create }
}

test('encrypted transport rejects tampering, wrong keys, wrong direction and non-LAN endpoints', () => {
  const key = secret(), wire = seal({ text: 'Nội dung tiếng Việt' }, key, 'request:/exchange')
  assert.equal(unseal(wire, key, 'request:/exchange').text, 'Nội dung tiếng Việt')
  assert.throws(() => unseal(wire, secret(), 'request:/exchange'))
  assert.throws(() => unseal(wire, key, 'response:/exchange'))
  const changed = JSON.parse(wire); changed.data = Buffer.from('changed').toString('base64')
  assert.throws(() => unseal(JSON.stringify(changed), key, 'request:/exchange'))
  assert.throws(() => validateEndpoint('8.8.8.8', 4317))
  assert.throws(() => validateEndpoint('example.com', 4317))
  assert.throws(() => validateEndpoint('192.168.1.1', 0))
})

test('LAN request deadline scales with encrypted payload size and has a hard cap', () => {
  assert.equal(requestTimeoutForWireBytes(0), 30_000)
  assert.equal(requestTimeoutForWireBytes(1024 * 1024), 34_000)
  assert.ok(requestTimeoutForWireBytes(MAX_WIRE_BYTES) > 30_000)
  assert.ok(requestTimeoutForWireBytes(MAX_WIRE_BYTES) < MAX_REQUEST_TIMEOUT_MS)
  assert.equal(requestTimeoutForWireBytes(MAX_WIRE_BYTES * 100), MAX_REQUEST_TIMEOUT_MS)
})

test('two LAN services merge independent projects, preserve IDs/assets/templates and keep trust local', async t => {
  const { host, client, a, b, sync } = await setup(t)
  assert.equal(a.projects.length, 2)
  assert.equal(b.projects.length, 2)
  assert.equal(task(b, 'task-a').sourceTrusted, false)
  assert.equal(task(b, 'task-b').sourceTrusted, true)
  task(a, 'task-a').assets = [{ filename: 'data.txt', data: Buffer.from('Dữ liệu').toString('base64') }]
  a.documentTemplates.push({ id: 'layout-demo', name: 'Mẫu', source: '\\documentclass{article}{{content}}', untrusted: false })
  const nextA = await sync(host, a), nextB = await sync(client, b)
  assert.deepEqual(task(nextB, 'task-a').assets, task(nextA, 'task-a').assets)
  assert.equal(nextB.documentTemplates[0].untrusted, true)
  task(nextA, 'task-a').document = doc('Changed A')
  task(nextB, 'task-b').document = doc('Changed B')
  await sync(host, nextA)
  const merged = await sync(client, nextB)
  assert.match(JSON.stringify(task(merged, 'task-a').document), /Changed A/)
  assert.match(JSON.stringify(task(merged, 'task-b').document), /Changed B/)
  assert.equal(client.status().conflicts.length, 0)
})

test('concurrent edits survive retries and restart; keep-both produces an editable copy', async t => {
  const { directory, host, client, a, b, sync, create } = await setup(t)
  task(a, 'task-a').document = doc('MacBook A edit')
  task(b, 'task-a').document = doc('Mac edit')
  await sync(host, a)
  // Do not acknowledge to simulate a crash after the host commits the request.
  const response = await client.exchange(b)
  assert.equal(response.status.conflicts.length, 1)
  await client.exchange(b)
  assert.equal(client.status().conflicts.length, 1, 'retry cannot duplicate conflicts')
  await client.stop()
  const restarted = await create('client')
  await restarted.exchange(b)
  const conflict = restarted.status().conflicts[0]
  await restarted.resolve(conflict.id, 'both', conflict.currentRev)
  const merged = await sync(restarted, b)
  const texts = merged.projects.flatMap(project => project.tasks).map(item => JSON.stringify(item.document))
  assert.ok(texts.some(text => text.includes('MacBook A edit')))
  assert.ok(texts.some(text => text.includes('Mac edit')))
  const persisted = JSON.parse(await readFile(join(directory, 'host', 'lan-sync-v1.json'), 'utf8'))
  assert.equal(persisted.conflicts.length, 0)
})

test('offline edits reconnect after host restart on its saved port', async t => {
  const { host, client, a, b, sync, create } = await setup(t)
  const port = host.status().port
  await host.stop()
  task(b, 'task-b').document = doc('Edited offline')
  await assert.rejects(client.exchange(b))
  const restarted = await create('host')
  assert.equal(restarted.status().port, port)
  const merged = await sync(client, b)
  assert.match(JSON.stringify(task(merged, 'task-b').document), /Edited offline/)
  const hostView = await sync(restarted, a)
  assert.match(JSON.stringify(task(hostView, 'task-b').document), /Edited offline/)
})

test('host status distinguishes a listening server from recent peer contact, including old clients', async t => {
  const { directory, host, b, client, create, sync } = await setup(t)
  await host.stop()
  let clock = Date.now()
  const restarted = await create('host', { now: () => clock })
  assert.equal(restarted.status().connected, true, 'server is listening')
  assert.equal(restarted.status().peers[0].online, false, 'listening is not proof a peer is online')
  assert.equal(restarted.status().lastPeerSyncAt, null)
  const next = await sync(client, b)
  assert.equal(restarted.status().peers[0].online, true)
  assert.ok(restarted.status().peers[0].receivedRevision > 0)
  const contact = restarted.status().lastPeerSyncAt
  clock += 21000
  await sync(restarted, next)
  assert.equal(restarted.status().peers[0].online, false, 'local polling does not refresh peer activity')
  assert.equal(restarted.status().lastPeerSyncAt, contact)
  const profile = JSON.parse(await readFile(join(directory, 'client', 'lan-sync-v1.json'), 'utf8'))
  const result = await request(profile.connection.host, profile.connection.port, '/exchange', { requestId: randomUUID(), at: Date.now(), ops: [], sinceRev: profile.revision }, profile.connection.key, profile.deviceId)
  assert.equal(result.revision, profile.revision, 'unchanged v1 request used by Windows still works')
  assert.deepEqual(result.pdfOffers, [], 'old clients never receive PDF payloads')
  assert.equal(restarted.status().peers[0].online, true)
  await restarted.revoke(profile.deviceId)
  assert.deepEqual(restarted.status().peers, [])
  assert.equal(restarted.status().lastPeerSyncAt, null)
})

test('LAN messages do not report successful delivery while conflicts or disconnected peers remain', async () => {
  const { lanSyncLabel, lanSyncResultMessage } = await import('../src/services/LanSyncStatus.js')
  assert.match(lanSyncLabel({ mode: 'host', peers: [{ online: false }] }), /chờ máy/)
  assert.match(lanSyncResultMessage({ mode: 'host', peers: [{ online: false }] }), /Chưa có máy khác/)
  assert.match(lanSyncLabel({ mode: 'client', connected: true, conflicts: [{}] }), /1 xung đột/)
  assert.match(lanSyncResultMessage({ mode: 'client', connected: true, conflicts: [{}] }), /chưa đồng bộ/)
  assert.match(lanSyncLabel({ mode: 'client', connected: true, error: 'Offline' }), /mất kết nối/)
  assert.equal(lanSyncResultMessage({ mode: 'client', connected: true, conflicts: [] }), 'Đã đồng bộ và lưu trên máy.')
  assert.equal(lanSyncResultMessage({ mode: 'client', connected: true, pdfError: 'PDF pending' }), 'PDF pending')
})

test('tombstones propagate deletion without resurrecting unchanged offline copies', async t => {
  const { host, client, a, b, sync } = await setup(t)
  a.projects = a.projects.filter(project => project.id !== 'project-b')
  await sync(host, a)
  const received = await sync(client, b)
  assert.equal(task(received, 'task-b'), undefined)
  const again = await sync(client, received)
  assert.equal(task(again, 'task-b'), undefined)
})

test('delete-versus-edit keeps recoverable content and stale conflict choices are rejected', async t => {
  const { host, client, a, b, sync } = await setup(t)
  task(a, 'task-a').document = doc('Keep this revision')
  b.projects = b.projects.filter(project => project.id !== 'project-a')
  await sync(host, a)
  let received = await sync(client, b)
  const conflict = client.status().conflicts.find(item => item.key === 'task:task-a')
  assert.ok(conflict.deleted)
  task(a, 'task-a').document = doc('Newer revision')
  await sync(host, a)
  await assert.rejects(client.resolve(conflict.id, 'incoming', conflict.currentRev), /vừa thay đổi/)
  received = await sync(client, received)
  const refreshed = client.status().conflicts.find(item => item.key === 'task:task-a')
  await client.resolve(refreshed.id, 'current', refreshed.currentRev)
  const final = await sync(client, received)
  assert.match(JSON.stringify(task(final, 'task-a').document), /Newer revision/)
})

test('one-use pairing, revocation, invalid records and replay requests cannot mutate the host', async t => {
  const { directory, host, client, b } = await setup(t)
  const other = createLanSync({ directory: join(directory, 'other') }); await other.init(); t.after(() => other.stop())
  const invite = await host.invitation('127.0.0.1')
  await other.configure('client', workspace('c', 'C'), invite.code)
  const fourth = createLanSync({ directory: join(directory, 'fourth') }); await fourth.init(); t.after(() => fourth.stop())
  await assert.rejects(fourth.configure('client', workspace('d', 'D'), invite.code))
  const state = JSON.parse(await readFile(join(directory, 'client', 'lan-sync-v1.json'), 'utf8'))
  const payload = { requestId: randomUUID(), at: Date.now(), ops: [{ key: '__proto__', value: {}, baseRev: 0 }] }
  await assert.rejects(request(state.connection.host, state.connection.port, '/exchange', payload, state.connection.key, state.deviceId), /không hợp lệ/)
  await assert.rejects(request(state.connection.host, state.connection.port, '/exchange', payload, state.connection.key, state.deviceId), /hết hạn/)
  await host.revoke(client.status().deviceId)
  await assert.rejects(client.exchange(b), /ngắt quyền/)
})

test('renderer rebase preserves typing during network I/O and makes conflict copies', async () => {
  const { rebaseSyncWorkspace } = await import('../src/services/LanSyncData.js')
  const base = workspace('a', 'Original'), live = structuredClone(base), remote = structuredClone(base)
  task(live, 'task-a').document = doc('Typed while syncing')
  task(remote, 'task-a').document = doc('Remote revision')
  const result = rebaseSyncWorkspace(base, live, remote)
  const texts = result.workspace.projects.flatMap(project => project.tasks).map(item => JSON.stringify(item.document))
  assert.equal(result.recovered, 1)
  assert.ok(texts.some(text => text.includes('Typed while syncing')))
  assert.ok(texts.some(text => text.includes('Remote revision')))
})

test('a remote template update invalidates local LaTeX trust in its unchanged documents', async () => {
  const { workspaceRecords, recordsWorkspace } = await import('../src/services/LanSyncData.js')
  const local = workspace('a', 'Content')
  task(local, 'task-a').activeDocumentTemplateId = 'layout-demo'
  local.documentTemplates = [{ id: 'layout-demo', name: 'Template', source: '{{content}}', untrusted: false }]
  const remote = workspaceRecords(local)
  remote['documentTemplates:layout-demo'].source = '\\input{external}{{content}}'
  const result = recordsWorkspace(remote, local)
  assert.equal(task(result, 'task-a').sourceTrusted, false)
  assert.equal(result.documentTemplates[0].untrusted, true)
})

test('idle polls send no documents and do not rewrite the persistent sync profile', async t => {
  const { directory, host, client, a, b, sync } = await setup(t)
  const local = await sync(client, b)
  const hostFile = join(directory, 'host', 'lan-sync-v1.json')
  const clientFile = join(directory, 'client', 'lan-sync-v1.json')
  const beforeHost = await readFile(hostFile, 'utf8'), beforeClient = await readFile(clientFile, 'utf8')
  const persisted = JSON.parse(beforeClient)
  const result = await request(persisted.connection.host, persisted.connection.port, '/exchange', { requestId: randomUUID(), at: Date.now(), ops: [], sinceRev: persisted.revision }, persisted.connection.key, persisted.deviceId)
  assert.equal(result.partial, true)
  assert.deepEqual(result.records, {})
  await sync(client, local)
  await sync(host, a)
  assert.equal(await readFile(hostFile, 'utf8'), beforeHost)
  assert.equal(await readFile(clientFile, 'utf8'), beforeClient)
})

test('stop aborts a request to an unreachable host instead of waiting for its timeout', async t => {
  const { host, client, b } = await setup(t)
  const port = host.status().port
  await host.stop()
  // Accepts connections but never answers, like a host that went to sleep mid-request.
  const sockets = new Set()
  const blackHole = net.createServer(socket => { sockets.add(socket); socket.on('error', () => {}) })
  await new Promise(resolve => blackHole.listen(port, '127.0.0.1', resolve))
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => blackHole.close(resolve)) })
  const pending = client.exchange(b)
  pending.catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 200))
  const startedAt = Date.now()
  await client.stop()
  assert.ok(Date.now() - startedAt < 3000, 'stop must not wait for the 30 s request timeout')
  await assert.rejects(pending)
})

test('replay protection covers requests stamped ahead of the host clock', async t => {
  const { directory } = await setup(t)
  const persisted = JSON.parse(await readFile(join(directory, 'client', 'lan-sync-v1.json'), 'utf8'))
  const send = payload => request(persisted.connection.host, persisted.connection.port, '/exchange', payload, persisted.connection.key, persisted.deviceId)
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const ahead = { requestId: randomUUID(), at: Date.now() + 4.5 * 60000, ops: [], sinceRev: persisted.revision }
  await send(ahead)
  t.mock.timers.tick(6 * 60000)
  // Any later request prunes the replay cache.
  await send({ requestId: randomUUID(), at: Date.now(), ops: [], sinceRev: persisted.revision })
  await assert.rejects(send(ahead), /hết hạn|ngắt quyền/)
})

test('clock skew reports how to repair the time mismatch', async t => {
  const { directory } = await setup(t)
  const persisted = JSON.parse(await readFile(join(directory, 'client', 'lan-sync-v1.json'), 'utf8'))
  const payload = { requestId: randomUUID(), at: Date.now() + 6 * 60_000, ops: [], sinceRev: persisted.revision }
  await assert.rejects(
    request(persisted.connection.host, persisted.connection.port, '/exchange', payload, persisted.connection.key, persisted.deviceId),
    /Đồng hồ giữa hai máy lệch quá 5 phút.*đồng bộ thời gian tự động/,
  )
})

test('pairing rejects oversized bodies before reading them and readBody enforces a shared budget', async t => {
  const { host } = await setup(t)
  await host.invitation('127.0.0.1')
  const responseStatus = (headers, send) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: host.status().port, path: '/pair', method: 'POST', agent: false, headers: { ...headers, 'X-Vietlatex-Device': randomUUID() } }, response => { response.resume(); resolve(response.statusCode) })
    req.on('error', reject)
    send(req)
  })
  // Send headers without uploading the oversized body: the server must reject
  // immediately. Writing it concurrently can race a closed socket on macOS.
  assert.equal(await responseStatus({ 'Content-Length': 1024 * 1024 }, req => req.flushHeaders()), 413)
  // A chunked request cannot be rejected from its headers; overflowing while
  // reading must keep the socket alive long enough to deliver the 413 response.
  assert.equal(await responseStatus({}, req => { req.write(Buffer.alloc(64 * 1024)); req.end(Buffer.alloc(1)) }), 413)

  const budget = { used: 0, max: 10 }
  const chunks = async function* (sizes) { for (const size of sizes) yield Buffer.alloc(size, 97) }
  await assert.rejects(readBody(chunks([6, 6]), 100, budget), { status: 503 })
  assert.equal(budget.used, 0, 'a failed read releases its reservation')
  await assert.rejects(readBody(chunks([6, 6]), 8), { status: 413 })
  assert.equal(await readBody(chunks([4, 4]), 100, budget), 'aaaaaaaa')
  assert.equal(budget.used, 0)
})

test('a host whose saved port is taken reports disconnected and can be re-enabled on a new port', async t => {
  const { host, a, create } = await setup(t)
  const port = host.status().port
  await host.stop()
  const blocker = net.createServer()
  await new Promise(resolve => blocker.listen(port, '0.0.0.0', resolve))
  t.after(() => new Promise(resolve => blocker.close(resolve)))
  const restarted = await create('host')
  assert.equal(restarted.status().connected, false)
  await assert.rejects(restarted.invitation('127.0.0.1'), /Bật máy chủ/)
  await restarted.configure('host', a)
  assert.equal(restarted.status().connected, true)
  assert.notEqual(restarted.status().port, port)
})

test('startup removes only stale sync-profile temp files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-lan-temp-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stale = join(directory, `lan-sync-v1.json.${randomUUID()}.tmp`), recent = join(directory, `lan-sync-v1.json.${randomUUID()}.tmp`)
  await Promise.all([writeFile(stale, 'partial'), writeFile(recent, 'in progress')])
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  await utimes(stale, old, old)
  const service = createLanSync({ directory, name: 'temp' })
  t.after(() => service.stop())
  await service.init()
  await assert.rejects(access(stale), { code: 'ENOENT' })
  await access(recent)
})

test('compiled PDFs transfer both directions, survive restart and never grant source trust', async t => {
  const { host, client, a, b, sync, create } = await setup(t)
  const input = { id: 'task-a', source: '\\documentclass{article} Alpha', images: [], assets: [] }
  const bytes = Buffer.from('%PDF-1.7\ncompiled Alpha\n%%EOF')
  await host.publishPdf(a, input, bytes)
  const remote = await sync(client, b)
  const downloaded = await client.getPdf(remote, input)
  assert.deepEqual(downloaded.bytes, bytes)
  assert.equal(downloaded.shared, true)
  assert.equal(task(remote, 'task-a').sourceTrusted, false)
  assert.equal(await client.getPdf(remote, { ...input, source: 'different source' }), null)
  assert.equal(await client.getPdf(remote, { ...input, assets: [{ filename: 'data.csv', data: 'changed' }] }), null)
  const edited = structuredClone(remote); task(edited, 'task-a').document = doc('New manuscript')
  assert.equal(await client.getPdf(edited, input), null)
  await client.stop()
  const restarted = await create('client')
  assert.deepEqual((await restarted.getPdf(remote, input)).bytes, bytes)
  const bInput = { ...input, id: 'task-b', source: 'Beta source' }, bBytes = Buffer.from('%PDF-1.7\ncompiled Beta\n%%EOF')
  await restarted.publishPdf(remote, bInput, bBytes)
  await sync(restarted, remote)
  const hostView = await sync(host, a)
  assert.deepEqual((await host.getPdf(hostView, bInput)).bytes, bBytes)
  assert.equal((await host.getPdf(hostView, bInput)).shared, true)
  await assert.rejects(host.publishPdf(a, input, Buffer.from('not a PDF')), /PDF/)
})

test('stale PDF is not offered after a remote manuscript edit; damaged cache preserves LAN documents', async t => {
  const { directory, host, client, a, b, sync, create } = await setup(t)
  const input = { id: 'task-a', source: 'original', images: [], assets: [] }
  await host.publishPdf(a, input, Buffer.from('%PDF-1.7\noriginal\n%%EOF'))
  task(a, 'task-a').document = doc('changed')
  const current = await sync(host, a), remote = await sync(client, b)
  assert.equal(await client.getPdf(remote, input), null)
  await host.stop()
  const file = join(directory, 'host', 'lan-sync-v1.json')
  const saved = JSON.parse(await readFile(file, 'utf8')); saved.pdfs['task-a'].data = 'corrupt'
  await writeFile(file, JSON.stringify(saved))
  const restarted = await create('host')
  assert.equal(restarted.status().mode, 'host')
  assert.match(restarted.status().pdfError, /hỏng/)
  assert.equal(await restarted.getPdf(current, input), null)
  assert.match(JSON.stringify((await sync(restarted, current)).projects), /changed/)
})

test('PDF upload verifies digest before mutation and idle PDF downloads do not rewrite the profile', async t => {
  const { directory, host, a } = await setup(t)
  const input = { id: 'task-a', source: 'source', images: [], assets: [] }
  const bytes = Buffer.from('%PDF-1.7\nverified\n%%EOF')
  const published = await host.publishPdf(a, input, bytes)
  const clientProfile = JSON.parse(await readFile(join(directory, 'client', 'lan-sync-v1.json'), 'utf8'))
  const send = body => request(clientProfile.connection.host, clientProfile.connection.port, '/pdf', { requestId: randomUUID(), at: Date.now(), ...body }, clientProfile.connection.key, clientProfile.deviceId)
  await assert.rejects(send({ upload: { ...published, data: Buffer.from('%PDF-1.7\ntampered').toString('base64') } }), /SHA-256/)
  assert.deepEqual((await host.getPdf(a, input)).bytes, bytes)
  const file = join(directory, 'host', 'lan-sync-v1.json'), before = await readFile(file, 'utf8')
  assert.equal((await send({ id: input.id, sha256: published.sha256 })).pdf.data, bytes.toString('base64'))
  assert.equal(await readFile(file, 'utf8'), before, 'viewing an already shared PDF never writes the profile')
})
