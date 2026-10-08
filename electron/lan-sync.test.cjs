const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')
const { createLanSync } = require('./lan-sync.cjs')
const { seal, unseal, secret, request, validateEndpoint } = require('./lan-sync-transport.cjs')

const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const workspace = (prefix, text) => ({ version: 1, projects: [{ id: `project-${prefix}`, name: prefix, activeTaskId: `task-${prefix}`, tasks: [{ id: `task-${prefix}`, title: prefix, document: doc(text), sourceDraft: '', sourceEdited: false, sourceTrusted: true, assets: [], settings: {} }] }], activeProjectId: `project-${prefix}`, customTemplates: [], documentTemplates: [] })
const task = (value, id) => value.projects.flatMap(project => project.tasks).find(item => item.id === id)

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-lan-test-'))
  const services = []
  t.after(async () => { for (const service of services) await service.stop(); await rm(directory, { recursive: true, force: true }) })
  const create = async name => { const service = createLanSync({ directory: join(directory, name), name }); await service.init(); services.push(service); return service }
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
  task(a, 'task-a').document = doc('Windows edit')
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
  assert.ok(texts.some(text => text.includes('Windows edit')))
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
