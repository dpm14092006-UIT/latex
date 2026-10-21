const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, readFile, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { createProjectSync, parseInvitation } = require('./project-sync.cjs')
const { createRelayServer } = require('./sync-relay-server.cjs')
const { relayUrl, call, request } = require('./sync-relay-client.cjs')
const { secret, seal } = require('./lan-sync-transport.cjs')

const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const workspace = prefix => ({ version: 1, projects: [{ id: `project-${prefix}`, name: prefix, activeTaskId: `task-${prefix}`, tasks: [{ id: `task-${prefix}`, title: prefix, document: doc(`Private ${prefix}`), sourceDraft: '', sourceEdited: false, sourceTrusted: true, assets: [], settings: {} }] }], activeProjectId: `project-${prefix}`, documentTemplates: [], customTemplates: [] })
const task = (value, id = 'task-a') => value.projects.flatMap(item => item.tasks).find(item => item.id === id)
async function until(predicate, timeout = 7000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await delay(30) }
  assert.fail('Timed out waiting for sync state')
}
async function setup(t, { preferLan = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-project-sync-'))
  let relay = createRelayServer({ pollMs: 100, offlineMs: 3000, requestMs: 5000 })
  const services = []
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve))
  const port = relay.server.address().port, url = `http://127.0.0.1:${port}`
  t.after(async () => { await Promise.allSettled(services.map(service => service.stop())); await relay.stop(); await rm(directory, { recursive: true, force: true }) })
  async function create(name) {
    const service = createProjectSync({ directory: join(directory, name), name, preferLan })
    services.push(service); await service.init(); return service
  }
  const host = await create('host'), client = await create('client')
  let a = workspace('a'), b = workspace('b')
  a.projects.push(workspace('host-secret').projects[0])
  await host.enable('project-a', a, url)
  const code = (await host.projectInvitation('project-a')).code
  async function sync(service, value) {
    const result = await service.exchange(value)
    if (result.workspace) await service.acknowledge(result.receipt)
    return result.workspace || value
  }
  await client.join(code, b)
  await until(async () => { await sync(client, b); return host.status().projectSync[0].pendingPairs.length === 1 })
  assert.equal(client.status().projectSync.length, 0, 'nothing paired without host approval')
  const peer = host.status().projectSync[0].pendingPairs[0]
  await host.projectApprove('project-a', peer.id, true)
  b = await sync(client, b); a = await sync(host, a)
  return { directory, host, client, a, b, sync, create, code, url, restartRelay: async () => {
    await relay.stop(); relay = createRelayServer({ pollMs: 100, offlineMs: 3000, requestMs: 5000 })
    await new Promise(resolve => relay.server.listen(port, '127.0.0.1', resolve))
  } }
}

test('Internet pairing requires approval, scopes data to one project and keeps local projects private', async t => {
  const { host, client, a, b, sync } = await setup(t)
  assert.deepEqual(b.projects.map(item => item.id), ['project-b', 'project-a'])
  assert.equal(b.activeProjectId, 'project-b')
  assert.deepEqual(a.projects.map(item => item.id), ['project-a', 'project-host-secret'])
  assert.equal(task(b).sourceTrusted, false)
  assert.equal(task(b, 'task-b').sourceTrusted, true)
  assert.equal(client.status().projectSync[0].via, 'relay')
  task(b).document = doc('Edited from Windows through Internet')
  await sync(client, b)
  const merged = await sync(host, a)
  assert.match(JSON.stringify(task(merged).document), /Edited from Windows/)
  assert.equal(host.status().projectSync[0].peers[0].online, true)
})

test('project layouts are copied into a namespace and cannot change private documents', async t => {
  const { host, client, a, b, sync } = await setup(t)
  a.documentTemplates = [{ id: 'layout-shared', name: 'Original', source: '\\documentclass{article}{{content}}' }]
  task(a).activeDocumentTemplateId = 'layout-shared'
  b.documentTemplates = [{ id: 'layout-shared', name: 'Private template', source: '\\documentclass{book}{{content}}' }]
  task(b, 'task-b').activeDocumentTemplateId = 'layout-shared'
  await sync(host, a)
  const next = await sync(client, b)
  assert.equal(next.documentTemplates.find(item => item.id === 'layout-shared').name, 'Private template')
  assert.match(task(next).activeDocumentTemplateId, /^layout-sync-/)
  assert.equal(task(next, 'task-b').activeDocumentTemplateId, 'layout-shared')
  assert.equal(next.documentTemplates.find(item => item.id === task(next).activeDocumentTemplateId).untrusted, true)
})

test('offline edits, app restart and relay restart preserve pairing and converge', async t => {
  const { host, client, a, b, sync, create, restartRelay } = await setup(t)
  await host.stop()
  task(b).document = doc('Offline text survives')
  const offline = await client.exchange(b)
  assert.equal(offline.workspace, null)
  assert.ok(offline.status.projectSync[0].error)
  await client.stop()
  const restartedHost = await create('host'), restartedClient = await create('client')
  let next = b
  await until(async () => { next = await sync(restartedClient, next); return !restartedClient.status().projectSync[0].error })
  let merged = await sync(restartedHost, a)
  assert.match(JSON.stringify(task(merged).document), /Offline text survives/)
  await restartRelay()
  task(next).document = doc('After relay restarted')
  await until(async () => { next = await sync(restartedClient, next); return !restartedClient.status().projectSync[0].error })
  merged = await sync(restartedHost, merged)
  assert.match(JSON.stringify(task(merged).document), /After relay restarted/)
})

test('concurrent changes keep both versions; revocation blocks already paired devices', async t => {
  const { host, client, a, b, sync } = await setup(t)
  task(a).document = doc('Mac version')
  task(b).document = doc('Windows version')
  await sync(host, a)
  let received = await sync(client, b)
  const conflict = client.status().projectSync[0].conflicts[0]
  assert.ok(conflict)
  await client.projectResolve('project-a', conflict.id, 'both', conflict.currentRev)
  received = await sync(client, received)
  const text = JSON.stringify(received.projects.find(item => item.id === 'project-a'))
  assert.match(text, /Mac version/); assert.match(text, /Windows version/)
  await host.projectRevoke('project-a', host.status().projectSync[0].peers[0].id)
  await client.exchange(received)
  assert.match(client.status().projectSync[0].error, /thu hồi|hết hạn/)
})

test('invitations are single-use, host rejects denied peers, and recipients can invite a third device', async t => {
  const { host, client, b, sync, create, code } = await setup(t)
  const third = await create('third')
  await third.join(code, workspace('third'))
  assert.match(third.status().pendingJoin.error, /hết hạn|thu hồi/)
  await third.cancelJoin()
  const invite = await client.projectInvitation('project-a')
  await third.join(invite.code, workspace('third'))
  const waiting = host.status().projectSync[0].pendingPairs[0]
  assert.ok(waiting)
  await host.projectApprove('project-a', waiting.id, false)
  await third.exchange(workspace('third'))
  assert.match(third.status().pendingJoin.error, /từ chối/)
  await third.cancelJoin()
  const allowed = await host.projectInvitation('project-a')
  await third.join(allowed.code, workspace('third'))
  await host.projectApprove('project-a', host.status().projectSync[0].pendingPairs[0].id, true)
  const received = await sync(third, workspace('third'))
  assert.equal(received.projects.length, 2)
  assert.equal(host.status().projectSync[0].peers.length, 2)
  await sync(client, b)
})

test('disconnect keeps local data, stays disconnected after restart, and LAN cannot leak a scoped group', async t => {
  const { client, b, create } = await setup(t)
  await assert.rejects(client.configure('host', b), /Tắt đồng bộ project/)
  await client.disconnect('project-a', b)
  assert.ok(task(b))
  assert.equal(client.status().projectSync.length, 0)
  await client.stop()
  const restarted = await create('client')
  assert.equal(restarted.status().projectSync.length, 0)
})

test('transport enforces HTTPS, authenticates rooms and rejects ciphertext tampering and cross-project writes', async t => {
  assert.throws(() => relayUrl('http://example.com'))
  assert.throws(() => relayUrl('https://user:secret@example.com'))
  assert.throws(() => relayUrl('https://example.com/path'))
  assert.throws(() => parseInvitation('vietlatex-sync:garbage'))
  const { directory, host, code, url } = await setup(t)
  const invitation = parseInvitation(code)
  await assert.rejects(call({ ...invitation.relay, access: secret() }, '/call', { body: '{}' }), /401/)
  const folder = createHash('sha256').update('project-a').digest('hex')
  const profile = JSON.parse(await readFile(join(directory, 'client', 'project-sync', folder, 'lan-sync-v1.json'), 'utf8'))
  const payload = { requestId: randomUUID(), at: Date.now(), ops: [{ key: 'project-injected', baseRev: 0, value: { id: 'injected' } }] }
  const wire = seal(payload, secret(), 'request:/exchange')
  const response = await call(profile.connection.relay, '/call', { body: wire, headers: { 'X-Sync-Path': '/exchange', 'X-Vietlatex-Device': profile.deviceId } })
  assert.equal(JSON.parse(response.raw).status, 401)
  await assert.rejects(request(profile.connection.relay, '/exchange', { ...payload, ops: [{ key: 'project:injected', value: { id: 'injected', name: 'Bad', taskIds: [] }, baseRev: 0 }] }, profile.connection.key, profile.deviceId), /ngoài project/)
  assert.equal(host.status().projectSync[0].conflicts.length, 0)
  assert.equal(invitation.relay.url, url)
})

test('project merge refuses collisions with private document IDs', async () => {
  const { mergeProjectWorkspace } = await import('../src/services/ProjectSyncData.js')
  const local = workspace('b'), incoming = workspace('a')
  task(incoming).id = 'task-b'
  assert.throws(() => mergeProjectWorkspace(local, incoming, 'project-a'), /trùng/)
})

test('received template references cannot cause a private layout to be uploaded', async () => {
  const { mergeProjectWorkspace, projectSnapshot } = await import('../src/services/ProjectSyncData.js')
  const local = workspace('b'), incoming = workspace('a')
  task(incoming).activeDocumentTemplateId = 'layout-private'
  assert.throws(() => mergeProjectWorkspace(local, incoming, 'project-a'), /project riêng/)
  task(incoming).activeDocumentTemplateId = 'ieee-journal'
  assert.equal(task(projectSnapshot(incoming, 'project-a')).activeDocumentTemplateId, 'ieee-journal', 'built-in layouts are preserved')
})

test('multiple projects with different host devices stay independent', async t => {
  const { host, client, a, b, url, sync } = await setup(t)
  await client.enable('project-b', b, url)
  const invite = await client.projectInvitation('project-b')
  await host.join(invite.code, a)
  await until(async () => { await host.exchange(a); return client.status().projectSync.find(group => group.projectId === 'project-b').pendingPairs.length === 1 })
  const waiting = client.status().projectSync.find(group => group.projectId === 'project-b').pendingPairs[0]
  await client.projectApprove('project-b', waiting.id, true)
  const nextA = await sync(host, a), nextB = await sync(client, b)
  assert.equal(host.status().projectSync.length, 2)
  assert.equal(client.status().projectSync.length, 2)
  assert.ok(nextA.projects.some(item => item.id === 'project-b'))
  assert.ok(!nextB.projects.some(item => item.id === 'project-host-secret'))
  task(nextA, 'task-b').document = doc('Second project edit')
  task(nextB).document = doc('First project edit')
  const [roundA, roundB] = await Promise.all([sync(host, nextA), sync(client, nextB)])
  const [finalA, finalB] = await Promise.all([sync(host, roundA), sync(client, roundB)])
  assert.match(JSON.stringify(task(finalA).document), /First project edit/)
  assert.match(JSON.stringify(task(finalB, 'task-b').document), /Second project edit/)
})

test('compiled PDFs transfer through the Internet relay and remain untrusted', async t => {
  const { host, client, a, b, sync } = await setup(t)
  const input = { id: 'task-a', source: '\\documentclass{article} Alpha', images: [], assets: [] }
  const bytes = Buffer.from('%PDF-1.7\ncompiled over relay\n%%EOF')
  await host.publishPdf(a, input, bytes)
  const next = await sync(client, b)
  const downloaded = await client.getPdf(next, input)
  assert.deepEqual(downloaded.bytes, bytes)
  assert.equal(downloaded.shared, true)
  assert.equal(task(next).sourceTrusted, false)
  assert.equal(await client.getPdf(next, { ...input, source: 'different' }), null)
})

test('a paired project prefers authenticated LAN and falls back to relay after a stale address', async t => {
  const { directory, host, client, b, sync, create } = await setup(t, { preferLan: true })
  const folder = createHash('sha256').update('project-a').digest('hex')
  const file = join(directory, 'client', 'project-sync', folder, 'lan-sync-v1.json')
  await client.stop()
  const profile = JSON.parse(await readFile(file, 'utf8'))
  profile.connection.endpoints = [{ host: '127.0.0.1', port: host.status().projectSync[0].port }]
  await writeFile(file, JSON.stringify(profile))
  const direct = await create('client')
  await sync(direct, b)
  assert.equal(direct.status().projectSync[0].via, 'lan')
  await direct.stop()
  profile.connection.endpoints = [{ host: '127.0.0.1', port: 1 }]
  await writeFile(file, JSON.stringify(profile))
  const fallback = await create('client')
  await sync(fallback, b)
  assert.equal(fallback.status().projectSync[0].via, 'relay')
})

test('re-enabling a disconnected project creates fresh peer permissions', async t => {
  const { host, a, url } = await setup(t)
  const oldPeer = host.status().projectSync[0].peers[0].id
  await host.disconnect('project-a', a)
  await host.enable('project-a', a, url)
  assert.deepEqual(host.status().projectSync[0].peers, [])
  assert.ok(!host.status().projectSync[0].peers.some(peer => peer.id === oldPeer))
})

test('shutdown aborts services created during a pending enable operation', async t => {
  const { create, url } = await setup(t)
  const spare = await create('spare')
  const enabling = spare.enable('project-spare', workspace('spare'), url)
  await delay(0)
  await Promise.race([
    Promise.allSettled([enabling, spare.stop()]),
    delay(3000).then(() => { throw new Error('Shutdown waited for an orphan service') }),
  ])
  assert.ok(spare.status().projectSync.every(group => !group.connected))
})
