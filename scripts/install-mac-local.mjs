// One-time local update. Keep the old app and the complete profile for recovery.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify, isDeepStrictEqual } from 'node:util'
import { cp, mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { upgradeSnapshot } from './upgrade-snapshot.mjs'

if (process.platform !== 'darwin') throw new Error('Cập nhật cục bộ này dành cho macOS.')
const require = createRequire(import.meta.url)
const pkg = require('../package.json'), config = require('../electron-builder.config.cjs')
const root = fileURLToPath(new URL('..', import.meta.url)), exec = promisify(execFile)
const source = resolve(config.directories.output, 'mac-universal', `${pkg.build.productName}.app`)
const installed = join('/Applications', `${pkg.build.productName}.app`)
const executable = join(installed, 'Contents', 'MacOS', pkg.build.productName)
let profile = process.env.VIETLATEX_USER_DATA ? resolve(process.env.VIETLATEX_USER_DATA) : join(homedir(), 'Library', 'Application Support', pkg.name)
if (!process.env.VIETLATEX_USER_DATA) {
  try {
    const location = JSON.parse(await readFile(join(profile, 'user-data-location.json'), 'utf8'))
    if (location.version !== 1 || typeof location.path !== 'string' || !isAbsolute(location.path)) throw new Error('Vị trí dữ liệu không hợp lệ.')
    profile = resolve(location.path)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
profile = await realpath(profile)
const workspaceFile = join(profile, 'workspace-v1.json')
assert.ok((await lstat(workspaceFile)).isFile(), 'workspace must be a regular file to create an independent backup')
assert.ok(sanitizeWorkspace(JSON.parse(await readFile(workspaceFile))), 'current workspace must be valid before updating')
const info = await lstat(installed)
assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'installed app must be a real directory')
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', source])
const { stdout: version } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(source, 'Contents', 'Info.plist')])
assert.equal(version.trim(), pkg.version)
// Reopen a copy with the actual package before touching the running app.
const { stdout: copyCheck } = await exec(process.execPath, [join(root, 'scripts', 'mac-upgrade-profile-smoke.mjs')], {
  cwd: root, env: { ...process.env, UPGRADE_DEV: 'false', UPGRADE_PROFILE: profile, DESKTOP_EXE: join(source, 'Contents', 'MacOS', pkg.build.productName) }, timeout: 90000,
})
console.log(copyCheck.trim())
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(homedir(), 'Library', 'Application Support', 'VietLatex Upgrade Backups', stamp)
await mkdir(backup, { recursive: true, mode: 0o700 })
const staged = join('/Applications', `.${pkg.build.productName}-update-${stamp}.app`)
await cp(source, staged, { recursive: true, verbatimSymlinks: true })
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged])
async function runningPids() {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,comm='])
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    return match && match[2] === executable ? [Number(match[1])] : []
  })
}
for (const pid of await runningPids()) process.kill(pid, 'SIGTERM')
const deadline = Date.now() + 30000
while ((await runningPids()).length && Date.now() < deadline) await delay(250)
if ((await runningPids()).length) throw new Error('App chưa lưu/thoát xong. Giữ nguyên app và dữ liệu; chưa cài bản mới.')
// The old app's SIGTERM handler flushes the editor before exit. Back up that final state.
const finalBytes = await readFile(workspaceFile)
const expected = sanitizeWorkspace(JSON.parse(finalBytes))
assert.ok(expected)
await cp(profile, join(backup, 'profile'), { recursive: true, verbatimSymlinks: true })
const hash = data => createHash('sha256').update(data).digest('hex')
assert.equal(hash(await readFile(join(backup, 'profile', 'workspace-v1.json'))), hash(finalBytes))
await rename(installed, join(backup, 'previous.app'))
try { await rename(staged, installed) } catch (error) { await rename(join(backup, 'previous.app'), installed); throw error }
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed])
assert.equal(hash(await readFile(workspaceFile)), hash(finalBytes), 'install must not write into the profile')
const record = { version: pkg.version, installed, profile, backup, workspaceSHA256: hash(finalBytes), profileUnchangedDuringInstall: true, previousAppRetained: true }
await writeFile(join(backup, 'upgrade.json'), JSON.stringify(record, null, 2), { mode: 0o600 })
await exec('/usr/bin/open', ['-a', installed, ...(process.env.VIETLATEX_USER_DATA ? ['--env', `VIETLATEX_USER_DATA=${profile}`] : [])])
await delay(3000)
const reopened = sanitizeWorkspace(JSON.parse(await readFile(workspaceFile)))
record.documentsPreservedAfterReopen = isDeepStrictEqual(upgradeSnapshot(reopened), upgradeSnapshot(expected))
record.running = Boolean((await runningPids()).length)
record.projects = expected.projects.length
record.documents = expected.projects.reduce((count, project) => count + project.tasks.length, 0)
await writeFile(join(backup, 'upgrade.json'), JSON.stringify(record, null, 2), { mode: 0o600 })
assert.ok(record.documentsPreservedAfterReopen, 'documents changed after reopening; retain backup and investigate')
assert.ok(record.running, 'updated app must be running')
console.log(JSON.stringify(record))
