const { open, readFile, rename, rm, mkdir, readdir, stat, lstat, copyFile } = require('node:fs/promises')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')

const MAX_WORKSPACE_BYTES = 128 * 1024 * 1024
const STALE_WRITE_FILE_MS = 24 * 60 * 60 * 1000
const WORKSPACE_TEMP_PATTERN = /^workspace-v1\.json\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

// Windows reports EPERM/EACCES/EBUSY while antivirus, indexing or backup tools
// briefly hold the destination open; retry instead of failing the save.
async function renameWithRetry(from, to, { renameFile = rename, platform = process.platform, attempts = 12 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await renameFile(from, to) } catch (error) {
      if (platform !== 'win32' || attempt >= attempts || !TRANSIENT_RENAME_CODES.has(error?.code)) throw error
      await delay(Math.min(attempt * 25, 250))
    }
  }
}

// POSIX only persists a rename once the containing directory is synced.
async function syncDirectory(directory) {
  if (process.platform === 'win32') return
  let handle
  try { handle = await open(directory, 'r'); await handle.sync() } catch {
    // Best effort: the file data itself is already fsynced.
  } finally { await handle?.close().catch(() => {}) }
}

function createWorkspaceStore(app) {
  const userDataPath = app.getPath('userData')
  const workspacePath = join(userDataPath, 'workspace-v1.json')
  const backupPath = join(userDataPath, 'backups')
  let writes = Promise.resolve()
  let lastBackup = 0

  function validate(value) {
    if (!value || value.version !== 1 || !(Array.isArray(value.projects) && value.projects.length || !value.projects && value.document?.type === 'doc' && Array.isArray(value.document.content))) throw new Error('Snapshot workspace không hợp lệ.')
    return value
  }
  async function readSnapshot(path) {
    if ((await stat(path)).size > MAX_WORKSPACE_BYTES) throw new Error('Workspace vượt quá 128 MB.')
    return validate(JSON.parse(await readFile(path, 'utf8')))
  }
  async function listBackups() {
    await mkdir(backupPath, { recursive: true })
    const names = (await readdir(backupPath)).filter(name => /^snapshot-\d+-[a-f0-9-]+\.json$/.test(name)).sort().reverse()
    return Promise.all(names.map(async id => ({ id, createdAt: Number(id.split('-')[1]), size: (await stat(join(backupPath, id))).size })))
  }
  async function backupNow() {
    await mkdir(backupPath, { recursive: true })
    try { await readSnapshot(workspacePath) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    const id = `snapshot-${Date.now()}-${randomUUID()}.json`
    await copyFile(workspacePath, join(backupPath, id))
    lastBackup = Date.now()
    const snapshots = await listBackups()
    for (const old of snapshots.slice(15)) await rm(join(backupPath, old.id), { force: true })
    return { id }
  }
  function backup() { const pending = writes.then(backupNow); writes = pending.catch(() => {}); return pending }
  async function readBackup(id) {
    if (!/^snapshot-\d+-[a-f0-9-]+\.json$/.test(id)) throw new Error('Mã bản sao lưu không hợp lệ.')
    return readSnapshot(join(backupPath, id))
  }

  async function cleanupStaleWriteFiles() {
    let names
    try { names = await readdir(userDataPath) } catch { return }
    const staleBefore = Date.now() - STALE_WRITE_FILE_MS
    await Promise.all(names.filter(name => WORKSPACE_TEMP_PATTERN.test(name)).map(async name => {
      const path = join(userDataPath, name)
      try {
        const info = await lstat(path)
        if (info.isFile() && info.mtimeMs < staleBefore) await rm(path, { force: true })
      } catch {
        // A stale temp file is disposable; cleanup must not block workspace recovery.
      }
    }))
  }

  async function load() {
    // A crash can leave an incomplete atomic-write temp file behind. It is not
    // a recovery source, so remove only matching files that have been idle 24h.
    await cleanupStaleWriteFiles()
    try {
      return await readSnapshot(workspacePath)
    } catch (error) {
      const snapshots = await listBackups()
      for (const entry of snapshots) {
        try {
          const value = await readBackup(entry.id)
          // Preserve the broken original for manual recovery before subsequent saves.
          await rename(workspacePath, `${workspacePath}.damaged-${Date.now()}`).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
          return { ...value, recoveryMessage: `Đã khôi phục bản sao lưu ${new Date(entry.createdAt).toLocaleString('vi-VN')}. Tệp cũ được giữ riêng để phục hồi.` }
        } catch {
          // Try the next older recovery snapshot.
        }
      }
      if (error.code === 'ENOENT') return null
      throw new Error(`Không đọc được workspace; đã dừng ghi để bảo vệ dữ liệu. Tệp: ${workspacePath}. ${error.message}`, { cause: error })
    }
  }

  function save(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
      throw new Error('Dữ liệu tiến trình không hợp lệ.')
    }
    validate(value)
    const serialized = JSON.stringify(value)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKSPACE_BYTES) {
      throw new Error('Tiến trình vượt quá giới hạn lưu 128 MB.')
    }

    const write = writes.then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true })
      if (Date.now() - lastBackup > 120_000) await backupNow().catch(error => { if (error.code !== 'ENOENT') throw error })
      const temporaryPath = `${workspacePath}.${process.pid}.${randomUUID()}.tmp`
      let handle
      try {
        handle = await open(temporaryPath, 'w')
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
        await handle.close()
        handle = null
        await renameWithRetry(temporaryPath, workspacePath)
        await syncDirectory(userDataPath)
        return { saved: true, savedAt: value.savedAt || new Date().toISOString() }
      } catch (error) {
        await handle?.close().catch(() => {})
        await rm(temporaryPath, { force: true }).catch(() => {})
        throw error
      }
    })
    writes = write.catch(() => {})
    return write
  }

  // Resolves once every queued write, including ones queued while waiting, has settled.
  async function whenIdle() {
    let current
    do { current = writes; await current } while (current !== writes)
  }

  return { load, save, backup, listBackups, readBackup, whenIdle }
}

module.exports = { createWorkspaceStore, renameWithRetry, syncDirectory }
