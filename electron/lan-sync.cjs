const http = require('node:http')
const { hostname, networkInterfaces } = require('node:os')
const { randomUUID, createHash } = require('node:crypto')
const { mkdir, readFile, readdir, open, lstat, rm, stat } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const transport = require('./lan-sync-transport.cjs')
const pdfCache = require('./lan-pdf.cjs')
const { renameWithRetry, syncDirectory } = require('./workspace-store.cjs')
const MAX_STATE = 512 * 1024 * 1024
const MAX_RECORDS = 10000
const MAX_PAIR_BYTES = 64 * 1024
const REQUEST_WINDOW_MS = 5 * 60000
const STALE_TEMP_MS = 24 * 60 * 60 * 1000
const TEMP_PATTERN = /^lan-sync-v1\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
const hash = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const clone = value => structuredClone(value)
const label = value => value?.title || value?.name || 'Mục đã xóa'

function createLanSync({ directory, appPath = join(__dirname, '..'), name = hostname(), now = Date.now }) {
  let state, server, invite, pending, stopped = false, lastError = '', lastSyncAt = null
  const peerActivity = new Map()
  let remotePdfVersion = 0, pdfError = ''
  let queue = Promise.resolve()
  const replay = new Map(), attempts = new Map()
  // Bounds memory held by request bodies that are still being read.
  const bodyBudget = { used: 0, max: 2 * transport.MAX_WIRE_BYTES }
  // Aborted by stop() so quitting never waits for an unreachable host's timeout.
  const lifetime = new AbortController()
  const file = join(directory, 'lan-sync-v1.json')
  const modules = Promise.all(['LanSyncData', 'WorkspaceData', 'DocumentData'].map(module => import(pathToFileURL(join(appPath, 'src', 'services', `${module}.js`)).href)))
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }

  async function persist() {
    const data = JSON.stringify(state)
    if (Buffer.byteLength(data) > MAX_STATE) throw new Error('Dữ liệu đồng bộ vượt giới hạn 512 MB.')
    await mkdir(directory, { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    let handle
    try {
      handle = await open(temp, 'wx', 0o600)
      await handle.writeFile(data, 'utf8'); await handle.sync(); await handle.close(); handle = null
      await renameWithRetry(temp, file)
      await syncDirectory(directory)
    } finally { await handle?.close().catch(() => {}); await rm(temp, { force: true }).catch(() => {}) }
  }
  async function transaction(work) {
    const previous = clone(state)
    try { const result = await work(); await persist(); return result }
    catch (error) { state = previous; throw error }
  }
  async function validateWorkspace(workspace) {
    const [, data, document] = await modules
    if (!workspace || workspace.version !== 1 || Buffer.byteLength(JSON.stringify(workspace)) > 128 * 1024 * 1024) throw new Error('Workspace đồng bộ không hợp lệ hoặc vượt 128 MB.')
    const valid = data.sanitizeWorkspace(workspace)
    if (!valid || valid.projects.length !== workspace.projects.length || valid.projects.some((project, index) => project.tasks.length !== workspace.projects[index].tasks.length)) throw new Error('Workspace đồng bộ có tài liệu không hợp lệ.')
    for (const project of workspace.projects) for (const task of project.tasks) {
      if (Buffer.byteLength(task.sourceDraft || '') > 800 * 1024) throw new Error('Source đồng bộ vượt 800 KB.')
    }
    for (const [type, sanitize] of [['customTemplates', document.sanitizeFormulaTemplates], ['documentTemplates', document.sanitizeDocumentTemplates]]) {
      if (!Array.isArray(workspace[type] || []) || sanitize(workspace[type] || []).length !== (workspace[type] || []).length) throw new Error('Mẫu đồng bộ không hợp lệ.')
    }
    return workspace
  }
  async function validateRecords(records) {
    const [data, , document] = await modules
    if (!records || Array.isArray(records) || typeof records !== 'object' || Object.keys(records).length > MAX_RECORDS) throw new Error('Danh sách đồng bộ không hợp lệ.')
    for (const [key, entry] of Object.entries(records)) {
      if (!/^(project|task|customTemplates|documentTemplates):[A-Za-z0-9._-]{1,160}$/.test(key) || !entry || !Number.isSafeInteger(entry.rev) || entry.rev < 1) throw new Error('Phiên bản đồng bộ không hợp lệ.')
      const value = entry.value
      if (value === null) continue
      if (!value || value.id !== key.slice(key.indexOf(':') + 1)) throw new Error('ID đồng bộ không khớp.')
      if (key.startsWith('project:') && (typeof value.name !== 'string' || value.name.length > 160 || !Array.isArray(value.taskIds) || value.taskIds.some(id => typeof id !== 'string'))) throw new Error('Dự án đồng bộ không hợp lệ.')
      if (key.startsWith('task:') && (typeof value.projectId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(value.projectId) || value.sourceTrusted !== undefined || !document.isValidDocument(value.document))) throw new Error('Tài liệu đồng bộ không hợp lệ.')
      if ((key.startsWith('customTemplates:') || key.startsWith('documentTemplates:')) && value.untrusted !== undefined) throw new Error('Không truyền trạng thái tin cậy qua mạng.')
    }
    const values = Object.fromEntries(Object.entries(records).map(([key, entry]) => [key, entry.value]))
    const workspace = data.recordsWorkspace(values, { version: 1, projects: [], customTemplates: [], documentTemplates: [] })
    if (workspace.projects.length) await validateWorkspace(workspace)
    // Validate templates even when the group contains no documents.
    if (document.sanitizeFormulaTemplates(workspace.customTemplates).length !== workspace.customTemplates.length || document.sanitizeDocumentTemplates(workspace.documentTemplates).length !== workspace.documentTemplates.length) throw new Error('Mẫu đồng bộ không hợp lệ.')
  }
  function values(records = state.records) { return Object.fromEntries(Object.entries(records).map(([key, entry]) => [key, entry.value])) }
  async function pdfKeys(snapshot, input) {
    const [data] = await modules
    const record = data.pdfRecordInput(data.workspaceRecords(snapshot), input.id)
    if (!record || typeof input.source !== 'string' || Buffer.byteLength(input.source) > 800 * 1024) throw new Error('Phiên bản tài liệu PDF không hợp lệ.')
    return { documentKey: pdfCache.digest(data.stableJSON(record)), compileKey: pdfCache.digest(data.stableJSON(data.pdfCompileInput(input))) }
  }
  async function pdfOffers() {
    const [data] = await modules
    const records = values()
    return Object.values(state.pdfs || {}).filter(item => {
      const record = data.pdfRecordInput(records, item.id)
      return record && pdfCache.digest(data.stableJSON(record)) === item.documentKey
    }).map(pdfCache.offer)
  }
  async function publishPdf(snapshot, input, bytes) {
    return serial(() => transaction(async () => {
      await validateWorkspace(snapshot)
      if (!ArrayBuffer.isView(bytes) || bytes.byteLength > pdfCache.MAX_PDF_BYTES) throw new Error('PDF đồng bộ vượt 24 MB.')
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const entry = { id: input.id, ...await pdfKeys(snapshot, input), sha256: pdfCache.digest(buffer), data: buffer.toString('base64') }
      pdfCache.putPdf(state.pdfs ||= {}, entry, true)
      return pdfCache.offer(entry)
    }))
  }
  async function getPdf(snapshot, input) {
    return serial(async () => {
      await validateWorkspace(snapshot)
      const entry = state.pdfs?.[input.id]
      if (!entry) return null
      const keys = await pdfKeys(snapshot, input)
      if (entry.documentKey !== keys.documentKey || entry.compileKey !== keys.compileKey) return null
      return { ...pdfCache.offer(entry), bytes: pdfCache.validatePdf(entry), shared: !entry.local }
    })
  }
  async function transferPdfs(remote, offers) {
    if (!Array.isArray(offers) || offers.length > 10000) throw new Error('Danh sách PDF không hợp lệ.')
    for (const local of await pdfOffers()) {
      const entry = state.pdfs[local.id]
      if (!entry.local || offers.some(item => item.id === local.id && item.sha256 === local.sha256)) continue
      const response = await transport.request(remote.host, remote.port, '/pdf', { requestId: randomUUID(), at: Date.now(), upload: entry }, remote.key, state.deviceId, { signal: lifetime.signal })
      if (!Array.isArray(response.pdfOffers)) throw new Error('Danh sách PDF không hợp lệ.')
      offers = response.pdfOffers
    }
    for (const item of offers) {
      if (state.pdfs?.[item.id]?.sha256 === item.sha256) continue
      const response = await transport.request(remote.host, remote.port, '/pdf', { requestId: randomUUID(), at: Date.now(), id: item.id, sha256: item.sha256 }, remote.key, state.deviceId, { signal: lifetime.signal })
      if (!response.pdf) continue
      if (response.pdf.id !== item.id || response.pdf.sha256 !== item.sha256) throw new Error('PDF nhận được không khớp phiên bản yêu cầu.')
      const eligible = await pdfOffersForEntry(response.pdf)
      if (!eligible) continue
      await transaction(async () => { pdfCache.putPdf(state.pdfs ||= {}, response.pdf, false) })
    }
  }
  async function pdfOffersForEntry(entry) {
    pdfCache.validatePdf(entry)
    const [data] = await modules
    const record = data.pdfRecordInput(values(), entry.id)
    return record && pdfCache.digest(data.stableJSON(record)) === entry.documentKey
  }
  async function operations(snapshot) {
    await validateWorkspace(snapshot)
    const [data] = await modules
    return data.recordChanges(state.baseline, data.workspaceRecords(snapshot)).map(change => ({ ...change, baseRev: state.bases[change.key]?.rev || 0 }))
  }
  async function reconcile(ops, deviceId, deviceName) {
    if (!Array.isArray(ops) || ops.length > MAX_RECORDS) throw new Error('Quá nhiều thay đổi trong lượt đồng bộ.')
    const candidate = clone(state.records), conflicts = clone(state.conflicts)
    const [data] = await modules
    const seen = new Set()
    for (const op of ops) {
      if (!op || typeof op.key !== 'string' || !/^(project|task|customTemplates|documentTemplates):[A-Za-z0-9._-]{1,160}$/.test(op.key) || seen.has(op.key) || !Number.isSafeInteger(op.baseRev) || op.baseRev < 0 || !Object.hasOwn(op, 'value')) throw new Error('Thay đổi đồng bộ không hợp lệ.')
      seen.add(op.key)
      const current = candidate[op.key]
      if (data.sameRecord(current?.value, op.value)) continue
      if ((current?.rev || 0) === op.baseRev) candidate[op.key] = { rev: ++state.revision, value: op.value }
      else {
        const id = hash([op.key, deviceId, op.baseRev, op.value])
        if (!state.resolved.includes(id) && !conflicts.some(item => item.id === id)) conflicts.push({ id, key: op.key, value: op.value, currentRev: current?.rev || 0, deviceId, deviceName, createdAt: new Date().toISOString() })
      }
    }
    if (conflicts.length > 128) throw new Error('Có 128 xung đột đang chờ. Xử lý xung đột trước khi nhận thêm thay đổi.')
    if (!Object.entries(candidate).some(([key, entry]) => key.startsWith('task:') && entry.value)) {
      const [, workspace] = await modules
      const fresh = data.workspaceRecords({ projects: [workspace.createProject('Dự án mới')] })
      for (const [key, value] of Object.entries(fresh)) candidate[key] = { rev: ++state.revision, value }
    }
    await validateRecords(candidate)
    for (const conflict of conflicts) if (conflict.value) await validateRecords({ ...candidate, [conflict.key]: { rev: 1, value: conflict.value } })
    state.records = candidate; state.conflicts = conflicts
  }
  async function resolveConflict(id, choice, expectedRev) {
    if (!['current', 'incoming', 'both'].includes(choice)) throw new Error('Cách xử lý xung đột không hợp lệ.')
    const conflict = state.conflicts.find(item => item.id === id)
    if (!conflict) return
    const current = state.records[conflict.key]
    if ((current?.rev || 0) !== expectedRev) throw new Error('Mục này vừa thay đổi. Đồng bộ rồi xem lại xung đột trước khi chọn.')
    if (choice === 'incoming') state.records[conflict.key] = { rev: ++state.revision, value: conflict.value }
    if (choice === 'both') {
      const incoming = conflict.value || current?.value
      if (incoming) {
        if (conflict.key.startsWith('project:')) {
          const id = `project-${randomUUID()}`, taskIds = []
          for (const entry of Object.values(state.records)) if (entry.value?.projectId === incoming.id) {
            const taskId = `task-${randomUUID()}`; taskIds.push(taskId)
            state.records[`task:${taskId}`] = { rev: ++state.revision, value: { ...entry.value, id: taskId, projectId: id } }
          }
          state.records[`project:${id}`] = { rev: ++state.revision, value: { ...incoming, id, name: `${incoming.name} — bản xung đột`.slice(0, 160), taskIds } }
        } else {
          const prefix = conflict.key.split(':')[0], id = `${prefix === 'task' ? 'task-' : prefix === 'customTemplates' ? 'custom-' : 'layout-'}${randomUUID()}`
          const field = prefix === 'task' ? 'title' : 'name'
          state.records[`${prefix}:${id}`] = { rev: ++state.revision, value: { ...incoming, id, [field]: `${incoming[field]} — bản xung đột`.slice(0, prefix === 'task' ? 160 : 120) } }
        }
      }
    }
    state.conflicts = state.conflicts.filter(item => item.id !== id)
    state.resolved = [...state.resolved, id].slice(-4096)
    await validateRecords(state.records)
  }
  function publicStatus() {
    const preview = value => {
      if (!value) return { title: 'Đã xóa', text: '', assets: 0 }
      let text = value.sourceEdited ? value.sourceDraft || '' : value.source || value.latex || ''
      if (!text && value.document) {
        const visit = node => { if (text.length > 1600) return; if (node.text) text += `${node.text} `; if (node.attrs?.latex) text += `$${node.attrs.latex}$ `; for (const child of node.content || []) visit(child) }
        visit(value.document)
      }
      return { title: label(value), text: text.slice(0, 1600), assets: value.assets?.length || 0 }
    }
    return { mode: state.mode, deviceId: state.deviceId, name: state.name, port: server?.address()?.port || state.port,
      addresses: Object.values(networkInterfaces()).flat().filter(info => info.family === 'IPv4' && !info.internal && (() => { try { transport.validateEndpoint(info.address, 1); return true } catch { return false } })()).map(info => info.address),
      connected: state.mode === 'host' ? Boolean(server) : state.mode === 'client' && !lastError && Boolean(lastSyncAt),
      host: state.connection?.host || '', lastSyncAt, error: lastError, pdfError, pdfSupported: state.mode === 'host' || remotePdfVersion === 1,
      lastPeerSyncAt: peerActivity.size ? new Date(Math.max(...Array.from(peerActivity.values(), item => item.at))).toISOString() : null,
      peers: Object.entries(state.peers).map(([id, peer]) => ({ id, name: peer.name,
        lastSeenAt: peerActivity.has(id) ? new Date(peerActivity.get(id).at).toISOString() : null,
        receivedRevision: peerActivity.get(id)?.revision ?? null,
        pdfSupported: peerActivity.get(id)?.pdfVersion === 1 || peer.pdfVersion === 1,
        online: Boolean(server?.listening) && peerActivity.has(id) && now() - peerActivity.get(id).at < 20000,
      })),
      conflicts: state.conflicts.map(item => ({ id: item.id, key: item.key, title: label(state.records[item.key]?.value || item.value), deviceName: item.deviceName, createdAt: item.createdAt, currentRev: state.records[item.key]?.rev || 0, deleted: item.value === null, current: preview(state.records[item.key]?.value), incoming: preview(item.value) })),
    }
  }
  async function serve(req, res) {
    const end = (code, body = '{}') => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body) }
    if (stopped || req.method !== 'POST' || !['/pair', '/exchange', '/resolve', '/pdf'].includes(req.url) || req.headers.origin) return end(403)
    const remote = req.socket.remoteAddress
    const attempt = attempts.get(remote) || { count: 0, at: Date.now() }
    if (Date.now() - attempt.at > 60000) { attempt.count = 0; attempt.at = Date.now() }
    attempts.set(remote, attempt)
    if (++attempt.count > 90) return end(429)
    if (attempts.size > 1024) attempts.delete(attempts.keys().next().value)
    const deviceId = req.headers['x-vietlatex-device']
    const key = req.url === '/pair' ? invite?.expiresAt > Date.now() && invite.key : state.peers[deviceId]?.key
    if (!key) return end(401)
    // Pairing bodies are tiny and readable by anyone holding a live invitation.
    const limit = req.url === '/pair' ? MAX_PAIR_BYTES : transport.MAX_WIRE_BYTES
    if (Number(req.headers['content-length']) > limit) { req.resume(); return end(413) }
    let body
    try {
      body = transport.unseal(await transport.readBody(req, limit, bodyBudget), key, `request:${req.url}`)
      if (!body || typeof body.requestId !== 'string' || body.requestId.length > 100 || typeof deviceId !== 'string' || !/^[a-f0-9-]{36}$/.test(deviceId) || !Number.isFinite(body.at) || Math.abs(Date.now() - body.at) > REQUEST_WINDOW_MS) return end(401)
      const replayKey = `${deviceId}:${body.requestId}`
      if (replay.has(replayKey)) return end(401)
      replay.set(replayKey, Date.now())
      // A request stamped up to one window ahead stays acceptable for two
      // windows after it arrives, so remember it at least that long.
      for (const [id, at] of replay) if (Date.now() - at > 2 * REQUEST_WINDOW_MS) replay.delete(id)
      if (replay.size > 4096) replay.delete(replay.keys().next().value)
    } catch (error) { return end(error?.status || 401) }
    try {
      const operation = async () => {
        if (req.url === '/pair') {
          if (invite?.key !== key || invite.expiresAt <= Date.now()) throw new Error('Mã ghép đã hết hạn.')
          if (Object.keys(state.peers).length >= 16 && !state.peers[deviceId]) throw new Error('Nhóm đã có 16 máy.')
          const peerKey = transport.secret()
          state.peers[deviceId] = { key: peerKey, name: String(body.name || 'Máy mới').slice(0, 100), pdfVersion: body.pdfVersion === 1 ? 1 : 0 }
          return { key: peerKey, hostName: state.name }
        }
        // Revocation may have happened while the encrypted body was being read.
        if (state.peers[deviceId]?.key !== key) throw new Error('Máy này đã bị ngắt quyền kết nối.')
        if (req.url === '/pdf') {
          if (body.upload) {
            const accepted = await pdfOffersForEntry(body.upload)
            if (accepted) pdfCache.putPdf(state.pdfs ||= {}, body.upload, false)
            return { accepted: Boolean(accepted), pdfOffers: await pdfOffers() }
          }
          const available = (await pdfOffers()).some(item => item.id === body.id && item.sha256 === body.sha256)
          return { pdf: available ? state.pdfs[body.id] : null }
        }
        if (req.url === '/resolve') await resolveConflict(body.id, body.choice, body.currentRev)
        else await reconcile(body.ops, deviceId, state.peers[deviceId].name)
        const partial = req.url === '/exchange' && Number.isSafeInteger(body.sinceRev) && body.sinceRev >= 0 && body.sinceRev <= state.revision
        return { records: partial ? Object.fromEntries(Object.entries(state.records).filter(([, entry]) => entry.rev > body.sinceRev)) : state.records, partial, conflicts: state.conflicts, revision: state.revision, pdfVersion: 1, pdfOffers: body.pdfVersion === 1 ? await pdfOffers() : [] }
      }
      const result = await serial(() => (req.url === '/exchange' && Array.isArray(body.ops) && body.ops.length === 0) || (req.url === '/pdf' && !body.upload) ? operation() : transaction(operation))
      if (req.url === '/pair') invite = null // one-time invitation
      else peerActivity.set(deviceId, { at: now(), revision: req.url === '/exchange' && Number.isSafeInteger(body.sinceRev) ? body.sinceRev : peerActivity.get(deviceId)?.revision, pdfVersion: body.pdfVersion === 1 || req.url === '/pdf' ? 1 : 0 })
      end(200, transport.seal({ ...result, requestId: body.requestId }, key, `response:${req.url}`))
    } catch (error) { end(200, transport.seal({ error: error.message, requestId: body.requestId }, key, `response:${req.url}`)) }
  }
  async function startServer({ allowNewPort = false } = {}) {
    const candidate = http.createServer((req, res) => { void serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() }) })
    candidate.requestTimeout = 30000; candidate.headersTimeout = 10000; candidate.maxConnections = 16
    const listen = port => new Promise((resolve, reject) => { candidate.once('error', reject); candidate.listen(port, '0.0.0.0', () => { candidate.off('error', reject); resolve() }) })
    try { await listen(state.port || 0) } catch (error) {
      // Paired machines expect the saved port, but if another program now holds
      // it an explicit "host" request must still be able to open a new one.
      if (!allowNewPort || !state.port || error.code !== 'EADDRINUSE') throw error
      await listen(0)
    }
    candidate.on('error', error => { lastError = `Không mở được cổng đồng bộ: ${error.message}` })
    // Only a listening server counts as running (status, invitations, stop).
    server = candidate
    state.port = server.address().port
  }
  async function closeServer() {
    invite = null
    if (!server) return
    const old = server; server = null
    old.closeAllConnections()
    await new Promise(resolve => old.close(resolve))
  }
  async function cleanupStaleTemps() {
    let names
    try { names = await readdir(directory) } catch { return }
    await Promise.all(names.filter(name => TEMP_PATTERN.test(name)).map(async name => {
      try {
        const info = await lstat(join(directory, name))
        if (info.isFile() && info.mtimeMs < Date.now() - STALE_TEMP_MS) await rm(join(directory, name), { force: true })
      } catch {
        // A crash leftover (up to 512 MB) is disposable; never block startup on it.
      }
    }))
  }
  async function init() {
    await cleanupStaleTemps()
    try {
      if ((await stat(file)).size > MAX_STATE) throw new Error('Hồ sơ đồng bộ vượt giới hạn.')
      state = JSON.parse(await readFile(file, 'utf8'))
      if (state.version !== 1 || !['off', 'host', 'client'].includes(state.mode) || !state.deviceId || !state.peers || !state.baseline || !state.bases || !Array.isArray(state.conflicts)) throw new Error('Hồ sơ đồng bộ không hợp lệ; giữ nguyên tệp để phục hồi.')
      await validateRecords(state.records)
      state.resolved ||= []
      state.pdfs ||= {}
      const validPdfs = {}
      for (const entry of Object.values(state.pdfs)) {
        try { pdfCache.putPdf(validPdfs, entry, Boolean(entry.local)) }
        catch { pdfError = 'Đã bỏ cache PDF bị hỏng; bản thảo và kết nối LAN vẫn được giữ.' }
      }
      state.pdfs = validPdfs
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { version: 1, deviceId: randomUUID(), name: String(name).slice(0, 100), mode: 'off', port: 0, peers: {}, connection: null, records: {}, baseline: {}, bases: {}, revision: 0, conflicts: [], resolved: [] }
      await persist()
    }
    if (state.mode === 'host') { try { await startServer() } catch (error) { lastError = error.message } }
    return publicStatus()
  }
  async function configure(mode, snapshot, pairingCode) {
    return serial(async () => {
      if (!['off', 'host', 'client'].includes(mode)) throw new Error('Chế độ đồng bộ không hợp lệ.')
      await validateWorkspace(snapshot)
      await closeServer()
      const previous = clone(state)
      try {
        if (mode === 'client') {
          if (typeof pairingCode !== 'string' || pairingCode.length > 2048 || !pairingCode.trim().startsWith('vietlatex-lan:')) throw new Error('Dán đầy đủ mã ghép từ máy chủ.')
          const invitation = JSON.parse(Buffer.from(pairingCode.trim().slice(14), 'base64url').toString('utf8'))
          transport.validateEndpoint(invitation.host, invitation.port)
          if (invitation.v !== 1 || !Number.isFinite(invitation.expiresAt) || invitation.expiresAt <= Date.now()) throw new Error('Mã ghép đã hết hạn. Tạo mã mới trên máy chủ.')
          const result = await transport.request(invitation.host, invitation.port, '/pair', { requestId: randomUUID(), at: Date.now(), name: state.name, pdfVersion: 1 }, invitation.key, state.deviceId, { signal: lifetime.signal })
          state.connection = { host: invitation.host, port: invitation.port, key: result.key, name: result.hostName }
        } else state.connection = null
        if (mode !== state.mode || mode === 'client') {
          state.records = {}; state.baseline = {}; state.bases = {}; state.conflicts = []; state.revision = 0; state.peers = {}; state.resolved = []; state.ackRevision = -1
        }
        state.mode = mode; pending = null; lastError = ''; lastSyncAt = null
        if (mode === 'host') { await reconcile(await operations(snapshot), state.deviceId, state.name); await startServer({ allowNewPort: true }) }
        await persist()
        peerActivity.clear()
        remotePdfVersion = 0; pdfError = ''
      } catch (error) {
        await closeServer(); state = previous
        if (state.mode === 'host') await startServer().catch(() => {})
        throw error
      }
      return publicStatus()
    })
  }
  async function exchange(snapshot) {
    return serial(async () => {
      if (stopped) throw new Error('Dịch vụ đồng bộ đang dừng.')
      if (state.mode === 'off') return { status: publicStatus(), workspace: null }
      if (state.mode === 'host' && !server?.listening) throw new Error(lastError || 'Máy chủ đồng bộ chưa mở được cổng. Bật lại máy chủ LAN.')
      try {
        const ops = await operations(snapshot)
        if (state.mode === 'host') {
          if (ops.length) await transaction(() => reconcile(ops, state.deviceId, state.name))
        } else {
          const remote = state.connection
          const result = await transport.request(remote.host, remote.port, '/exchange', { requestId: randomUUID(), at: Date.now(), ops, sinceRev: state.revision, pdfVersion: 1 }, remote.key, state.deviceId, { signal: lifetime.signal })
          const records = result.partial ? { ...state.records, ...result.records } : result.records
          if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error('Phiên bản máy chủ không hợp lệ.')
          await validateRecords(records)
          if (!Array.isArray(result.conflicts) || result.conflicts.length > 128) throw new Error('Danh sách xung đột không hợp lệ.')
          if (result.revision !== state.revision || hash(result.conflicts) !== hash(state.conflicts)) await transaction(async () => {
            state.records = records; state.conflicts = result.conflicts; state.revision = result.revision
          })
          remotePdfVersion = result.pdfVersion === 1 ? 1 : 0
          if (remotePdfVersion) {
            try { await transferPdfs(remote, result.pdfOffers || []); pdfError = '' }
            catch (error) { pdfError = `Bản thảo đã nhận; PDF đang chờ đồng bộ: ${error.message}` }
          }
        }
        const [data] = await modules
        const received = data.recordsWorkspace(values(), snapshot)
        await validateWorkspace(received)
        pending = { id: randomUUID(), records: clone(state.records), baseline: data.workspaceRecords(received), revision: state.revision }
        lastSyncAt = new Date().toISOString(); lastError = ''
        return { workspace: received, receipt: pending.id, status: publicStatus() }
      } catch (error) { lastError = error.message; throw error }
    })
  }
  async function acknowledge(receipt) {
    return serial(async () => {
      if (!pending || receipt !== pending.id) throw new Error('Lượt đồng bộ đã thay đổi. Đồng bộ lại để nhận dữ liệu mới.')
      if (state.ackRevision !== pending.revision) await transaction(async () => {
        state.baseline = pending.baseline; state.bases = pending.records; state.ackRevision = pending.revision
      })
      pending = null
      return publicStatus()
    })
  }
  async function resolve(id, choice, currentRev) {
    return serial(() => transaction(async () => {
      if (state.mode === 'host') await resolveConflict(id, choice, currentRev)
      else if (state.mode === 'client') {
        const remote = state.connection
        const result = await transport.request(remote.host, remote.port, '/resolve', { requestId: randomUUID(), at: Date.now(), id, choice, currentRev }, remote.key, state.deviceId, { signal: lifetime.signal })
        await validateRecords(result.records)
        state.records = result.records; state.conflicts = result.conflicts; state.revision = result.revision
      } else throw new Error('Bật đồng bộ để xử lý xung đột.')
      return publicStatus()
    }))
  }
  async function invitation(host) {
    return serial(async () => {
      if (state.mode !== 'host' || !server) throw new Error('Bật máy chủ trước khi tạo mã ghép.')
      transport.validateEndpoint(host, state.port)
      invite = { key: transport.secret(), expiresAt: Date.now() + 10 * 60000 }
      return { code: `vietlatex-lan:${Buffer.from(JSON.stringify({ v: 1, host, port: state.port, ...invite })).toString('base64url')}`, expiresAt: invite.expiresAt }
    })
  }
  async function revoke(id) { return serial(() => transaction(async () => { delete state.peers[id]; peerActivity.delete(id); return publicStatus() })) }
  async function stop() {
    stopped = true; lifetime.abort()
    await closeServer(); await queue
    // Queued work (e.g. configure) may have reopened the server meanwhile.
    await closeServer()
  }
  return { init, status: publicStatus, configure, exchange, acknowledge, resolve, invitation, revoke, publishPdf, getPdf, stop }
}
module.exports = { createLanSync }
