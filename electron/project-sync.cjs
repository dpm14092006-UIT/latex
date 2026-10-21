const { createHash, randomUUID } = require('node:crypto')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir, readFile, open, rm } = require('node:fs/promises')
const { createLanSync } = require('./lan-sync.cjs')
const { renameWithRetry, syncDirectory } = require('./workspace-store.cjs')
const { secret } = require('./lan-sync-transport.cjs')
const { relayUrl, validateRoute } = require('./sync-relay-client.cjs')

function parseInvitation(code) {
  if (typeof code !== 'string' || code.length > 4096 || !code.trim().startsWith('vietlatex-sync:')) throw new Error('Dán đầy đủ mã vietlatex-sync: từ thiết bị đã có project.')
  const value = JSON.parse(Buffer.from(code.trim().slice(15), 'base64url').toString('utf8'))
  if (value.v !== 1 || !/^[A-Za-z0-9._-]{1,160}$/.test(value.projectId || '') || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(value.key || '')) throw new Error('Mã ghép không hợp lệ hoặc đã hết hạn.')
  validateRoute(value.relay)
  return value
}
function createProjectSync({ directory, appPath = join(__dirname, '..'), name, preferLan = true, defaultRelayUrl = '' }) {
  const legacy = createLanSync({ directory, appPath, name })
  const root = join(directory, 'project-sync'), file = join(root, 'index-v1.json')
  const groups = new Map(), receipts = new Map(), services = new Set()
  const data = import(pathToFileURL(join(appPath, 'src/services/ProjectSyncData.js')).href)
  let pendingJoin = null, stopped = false, control = Promise.resolve(), configuredRelay = defaultRelayUrl ? relayUrl(defaultRelayUrl) : ''
  const exclusive = work => { const result = control.then(work); control = result.catch(() => {}); return result }
  function groupStatus(group) { return { ...group.service.status(), error: group.error || group.service.status().error, projectName: group.name } }
  function status() {
    return { ...legacy.status(), defaultRelayUrl: configuredRelay, projectSync: [...groups.values()].map(groupStatus), pendingJoin: pendingJoin ? { projectId: pendingJoin.id, expiresAt: pendingJoin.expiresAt, error: pendingJoin.error || '' } : null }
  }
  async function persist() {
    await mkdir(root, { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    let handle
    try {
      handle = await open(temp, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ version: 1, defaultRelayUrl: configuredRelay, groups: [...groups.values()].map(group => ({ id: group.id, name: group.name })) })); await handle.sync(); await handle.close(); handle = null
      await renameWithRetry(temp, file); await syncDirectory(root)
    } finally { await handle?.close().catch(() => {}); await rm(temp, { force: true }).catch(() => {}) }
  }
  async function create(id, projectName, resume = true) {
    if (stopped) throw new Error('Dịch vụ đồng bộ đang dừng.')
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(id)) throw new Error('ID project không hợp lệ.')
    const folder = createHash('sha256').update(id).digest('hex')
    const service = createLanSync({ directory: join(root, folder), appPath, name, projectId: id, preferLan, resume })
    services.add(service)
    try { await service.init(); if (stopped) throw new Error('Dịch vụ đồng bộ đang dừng.') }
    catch (error) { await service.stop(); services.delete(service); throw error }
    return { id, name: String(projectName || 'Project được chia sẻ').slice(0, 160), service, error: '' }
  }
  async function init() {
    await legacy.init()
    let index
    try { const raw = await readFile(file, 'utf8'); if (raw.length > 65536) throw new Error('Hồ sơ project quá lớn.'); index = JSON.parse(raw) }
    catch (error) { if (error.code !== 'ENOENT') throw error; return status() }
    if (index.version !== 1 || !Array.isArray(index.groups) || index.groups.length > 32) throw new Error('Hồ sơ đồng bộ project không hợp lệ.')
    if (index.defaultRelayUrl) configuredRelay = relayUrl(index.defaultRelayUrl)
    for (const item of index.groups) {
      if (groups.has(item.id)) throw new Error('Hồ sơ project bị trùng.')
      groups.set(item.id, await create(item.id, item.name))
    }
    if (groups.size && legacy.status().mode !== 'off') throw new Error('Đồng bộ workspace và project không thể chạy đồng thời.')
    return status()
  }
  function requireGroup(id) { const group = groups.get(id); if (!group) throw new Error('Project chưa bật đồng bộ.'); return group }
  async function ensureAvailable(id) {
    if (stopped) throw new Error('Dịch vụ đồng bộ đang dừng.')
    if (legacy.status().mode !== 'off') throw new Error('Tắt đồng bộ LAN toàn workspace trước khi bật đồng bộ từng project.')
    if (groups.has(id)) throw new Error('Project này đã được ghép trên máy.')
    if (groups.size >= 32) throw new Error('Máy này đã đồng bộ 32 project.')
  }
  async function enable(id, workspace, url) {
    return exclusive(async () => {
      await ensureAvailable(id)
      const project = workspace.projects.find(item => item.id === id)
      if (!project) throw new Error('Không tìm thấy project.')
      const group = await create(id, project.name, false)
      const previousRelay = configuredRelay
      try {
        const owner = secret(), room = createHash('sha256').update(owner).digest('base64url')
        await group.service.configure('host', (await data).projectSnapshot(workspace, id), { relay: { url: relayUrl(url), room, access: secret(), owner } })
        groups.set(id, group); configuredRelay = relayUrl(url); await persist()
      } catch (error) { groups.delete(id); configuredRelay = previousRelay; await group.service.stop(); services.delete(group.service); throw error }
      return status()
    })
  }
  async function joinProject(code, workspace) {
    return exclusive(async () => {
      const invitation = parseInvitation(code)
      await ensureAvailable(invitation.projectId)
      if (workspace.projects.some(item => item.id === invitation.projectId)) throw new Error('Máy đã có project cùng ID. Nhân bản hoặc đổi project cũ trước khi ghép để giữ các sửa đổi hiện có.')
      if (pendingJoin) throw new Error('Đang chờ ghép một project khác. Hủy yêu cầu đó trước.')
      const group = await create(invitation.projectId, undefined, false)
      try { await group.service.configure('off', { version: 1, projects: [], customTemplates: [], documentTemplates: [] }) }
      catch (error) { await group.service.stop(); services.delete(group.service); throw error }
      pendingJoin = { ...group, code, expiresAt: invitation.expiresAt }
      await tryJoin()
      return status()
    })
  }
  async function tryJoin() {
    const group = pendingJoin
    if (!group) return
    if (group.expiresAt <= Date.now()) { group.error = 'Mã ghép đã hết hạn. Hủy yêu cầu rồi lấy mã mới.'; return }
    try {
      const result = group.service.status().mode === 'client' ? group.service.status() : await group.service.configure('client', { version: 1, projects: [], customTemplates: [], documentTemplates: [] }, group.code)
      if (result.pendingPair) { group.error = ''; return }
      groups.set(group.id, group)
      try { await persist() } catch (error) { groups.delete(group.id); throw error }
      pendingJoin = null
    } catch (error) { group.error = error.message }
  }
  async function exchange(workspace) {
    return exclusive(async () => {
      if (legacy.status().mode !== 'off') { const result = await legacy.exchange(workspace); return { ...result, status: status() } }
      await tryJoin()
      let merged = workspace
      const accepted = []
      for (const group of groups.values()) {
        try {
          const result = await group.service.exchange((await data).projectSnapshot(merged, group.id))
          if (result.workspace) {
            merged = (await data).mergeProjectWorkspace(merged, result.workspace, group.id)
            const project = merged.projects.find(item => item.id === group.id)
            group.name = project.name
            accepted.push({ service: group.service, receipt: result.receipt })
          }
          group.error = ''
        } catch (error) { group.error = error.message }
      }
      const receipt = randomUUID()
      // The renderer may defer applying while a dialog is open. Only the most
      // recent exchange can be acknowledged; never accumulate old snapshots.
      receipts.clear(); receipts.set(receipt, accepted)
      return { workspace: accepted.length ? merged : null, receipt, status: status() }
    })
  }
  async function acknowledge(receipt) {
    return exclusive(async () => {
      if (legacy.status().mode !== 'off') { await legacy.acknowledge(receipt); return status() }
      const entries = receipts.get(receipt)
      if (!entries) throw new Error('Lượt đồng bộ đã thay đổi. Thử đồng bộ lại.')
      for (const entry of entries) await entry.service.acknowledge(entry.receipt)
      receipts.delete(receipt)
      return status()
    })
  }
  async function disconnect(id, workspace) {
    return exclusive(async () => {
      const group = requireGroup(id)
      // Persist removal first. Failure leaves the group active and reviewable.
      groups.delete(id)
      try { await persist() } catch (error) { groups.set(id, group); throw error }
      try { await group.service.configure('off', (await data).projectSnapshot(workspace, id)) }
      finally { await group.service.stop(); services.delete(group.service) }
      return status()
    })
  }
  async function cancelJoin() { return exclusive(async () => { const old = pendingJoin; pendingJoin = null; await old?.service.stop(); if (old) services.delete(old.service); return status() }) }
  function forPdf(workspace, input) {
    if (legacy.status().mode !== 'off') return legacy
    const project = workspace.projects.find(project => input.id === `compilation-${project.id}` || project.tasks.some(task => task.id === input.id))
    return groups.get(project?.id)?.service
  }
  async function publishPdf(workspace, input, bytes) {
    const service = forPdf(workspace, input)
    // Local preview may publish while no group is enabled.
    if (!service) return legacy.publishPdf(workspace, input, bytes)
    const snapshot = service === legacy ? workspace : (await data).projectSnapshot(workspace, service.status().projectId)
    return service.publishPdf(snapshot, input, bytes)
  }
  async function getPdf(workspace, input) {
    const service = forPdf(workspace, input)
    if (!service) return legacy.getPdf(workspace, input)
    return service.getPdf(service === legacy ? workspace : (await data).projectSnapshot(workspace, service.status().projectId), input)
  }
  async function stop() {
    stopped = true
    // Abort network operations before waiting for the coordinator queue.
    await Promise.allSettled([legacy.stop(), ...[...services].map(service => service.stop())])
    await control
    await Promise.allSettled([...services].map(service => service.stop()))
  }
  return { init, status, enable, join: joinProject, disconnect, cancelJoin, exchange, acknowledge, publishPdf, getPdf, stop,
    configure: async (...args) => { if (groups.size || pendingJoin) throw new Error('Tắt đồng bộ project trước khi dùng LAN toàn workspace.'); await legacy.configure(...args); return status() },
    invitation: (...args) => legacy.invitation(...args),
    revoke: async (...args) => { await legacy.revoke(...args); return status() },
    setKeepAwake: async (...args) => { await legacy.setKeepAwake(...args); return status() },
    resolve: async (...args) => { await legacy.resolve(...args); return status() },
    projectInvitation: id => requireGroup(id).service.internetInvitation(),
    projectApprove: async (id, device, allowed) => { await requireGroup(id).service.approvePair(device, allowed); return status() },
    projectRevoke: async (id, device) => { await requireGroup(id).service.revoke(device); return status() },
    projectResolve: async (id, conflict, choice, revision) => { await requireGroup(id).service.resolve(conflict, choice, revision); return status() },
    projectKeepAwake: async (id, enabled) => { await requireGroup(id).service.setKeepAwake(enabled); return status() },
    interrupt: () => { legacy.interrupt(); for (const group of groups.values()) group.service.interrupt(); pendingJoin?.service.interrupt() },
  }
}
module.exports = { createProjectSync, parseInvitation }
