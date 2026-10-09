// In-app updates from GitHub Releases for macOS and Windows.
// macOS: the local builds use an ad-hoc signature, which Squirrel.Mac
// (electron-updater) refuses, so the app downloads the DMG itself, verifies it,
// stages the new bundle beside the installed one and swaps the bundles from a
// detached script after the normal save-and-quit handshake.
// Windows: the verified NSIS Setup.exe runs silently (/S) into the existing
// per-user install once the app has saved and quit, then relaunches it.
const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream, existsSync } = require('node:fs')
const { access, constants, mkdir, readFile, readdir, rename, rm, stat, writeFile } = require('node:fs/promises')
const { execFile, spawn } = require('node:child_process')
const { basename, dirname, join } = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { promisify } = require('node:util')

const REPOSITORY = 'dpm14092006-UIT/latex'
const DEFAULT_FEED = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_INSTALLER_BYTES = 2 * 1024 ** 3
const QUIT_WAIT_SECONDS = 120

function parseVersion(value) {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(value ?? '').trim())
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b)
  if (!left || !right) throw new Error(`Số phiên bản không hợp lệ: ${!left ? a : b}`)
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  return 0
}

const installerName = (version, platform = 'darwin') => platform === 'win32' ? `Viet-Latex-Studio-${version}-Setup.exe` : `Viet-Latex-Studio-${version}-universal.dmg`

function isReleaseDownloadUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)
  } catch { return false }
}

// Returns the newer release described by a GitHub "latest release" payload, or null.
function selectRelease(release, currentVersion, platform = 'darwin') {
  if (!release || release.draft || release.prerelease) return null
  const version = parseVersion(release.tag_name)?.join('.')
  if (!version || compareVersions(version, currentVersion) <= 0) return null
  const assets = Array.isArray(release.assets) ? release.assets : []
  const find = name => assets.find(asset => asset?.name === name && isReleaseDownloadUrl(asset.browser_download_url))
  const name = installerName(version, platform)
  const installer = find(name), checksum = find(`${name}.sha256`)
  return {
    version,
    name: typeof release.name === 'string' && release.name.trim() ? release.name.trim().slice(0, 200) : `Viet Latex Studio ${version}`,
    notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    pageUrl: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    installer: installer && checksum && Number.isSafeInteger(installer.size) && installer.size > 0 && installer.size <= MAX_INSTALLER_BYTES
      ? { name: installer.name, url: installer.browser_download_url, size: installer.size, checksumUrl: checksum.browser_download_url }
      : null,
  }
}

// Accepts the `shasum -a 256` line written by mac/copy-mac-installer.cjs and win/copy-win-installer.cjs.
function parseChecksum(text, filename) {
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match && match[2] === filename) return match[1].toLowerCase()
  }
  throw new Error(`Tệp checksum không có dòng cho ${filename}.`)
}

// /Applications/X.app/Contents/MacOS/X -> /Applications/X.app
function appBundlePath(executablePath) {
  const macos = dirname(executablePath), contents = dirname(macos), bundle = dirname(contents)
  return basename(macos) === 'MacOS' && basename(contents) === 'Contents' && bundle.endsWith('.app') ? bundle : null
}

// Arguments are passed as $1..$5, so paths with spaces or quotes never reach the shell parser.
const INSTALL_SCRIPT = `#!/bin/sh
set -u
PID="$1"; TARGET="$2"; STAGED="$3"; BACKUP="$4"; LOG="$5"
exec >>"$LOG" 2>&1
echo "$(date) chờ tiến trình $PID thoát"
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt ${QUIT_WAIT_SECONDS * 5} ]; then echo "app chưa thoát; hủy cài đặt"; rm -rf "$STAGED"; exit 1; fi
  sleep 0.2
done
mkdir -p "$(dirname "$BACKUP")"
if mv "$TARGET" "$BACKUP"; then
  if mv "$STAGED" "$TARGET"; then echo "đã cài bản mới"; else echo "không thay được app; khôi phục bản cũ"; mv "$BACKUP" "$TARGET"; fi
else
  echo "không di chuyển được app cũ; giữ nguyên"; rm -rf "$STAGED"
fi
/usr/bin/open "$TARGET"
`

function createUpdater({
  app, shell, fetch, directory, currentVersion = app.getVersion(), feedUrl = DEFAULT_FEED,
  platform = process.platform, run = promisify(execFile), launch = spawn, onStatus = () => {},
  beforeInstall = async () => {}, requestQuit = () => app.quit(), onQuit = callback => app.once('quit', callback),
  env = process.env, exists = existsSync,
}) {
  const settingsPath = join(directory, 'settings.json')
  let settings = { autoCheck: true, skippedVersion: null }
  let state = { status: 'idle', currentVersion, autoCheck: true }
  let release = null, downloadPath = null, checking = null, downloading = null, installing = false, timers = []

  const snapshot = () => ({ ...state, autoCheck: settings.autoCheck, skippedVersion: settings.skippedVersion, canInstall: installTarget() !== null })
  const update = patch => { state = { ...state, ...patch }; onStatus(snapshot()) }
  const headers = { 'User-Agent': `VietLatexStudio/${currentVersion}`, Accept: 'application/vnd.github+json' }

  function installTarget() {
    if (!app.isPackaged) return null
    if (platform === 'win32') {
      // Only an NSIS install can be updated in place; a portable .exe opens the installer instead.
      const folder = dirname(app.getPath('exe'))
      return !env.PORTABLE_EXECUTABLE_FILE && exists(join(folder, `Uninstall ${app.getName()}.exe`)) ? folder : null
    }
    if (platform !== 'darwin') return null
    const bundle = appBundlePath(app.getPath('exe'))
    // Gatekeeper runs quarantined apps from a read-only translocated copy.
    return bundle && !bundle.includes('/AppTranslocation/') ? bundle : null
  }

  async function loadSettings() {
    try {
      const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
      settings = { autoCheck: saved.autoCheck !== false, skippedVersion: parseVersion(saved.skippedVersion) ? saved.skippedVersion : null }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  }

  async function saveSettings(patch) {
    settings = { ...settings, ...patch }
    await mkdir(directory, { recursive: true })
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    onStatus(snapshot())
  }

  async function fetchOk(url, init) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } })
    if (!response.ok) throw new Error(`Máy chủ cập nhật trả về HTTP ${response.status}.`)
    return response
  }

  function check({ manual = false } = {}) {
    if (checking) return checking
    if (['downloading', 'ready'].includes(state.status) && !manual) return Promise.resolve(snapshot())
    checking = (async () => {
      update({ status: 'checking', error: null })
      try {
        const response = await fetch(feedUrl, { headers })
        // GitHub answers 404 for /releases/latest until the first release is published.
        if (!response.ok && response.status !== 404) throw new Error(`Máy chủ cập nhật trả về HTTP ${response.status}.`)
        const found = response.ok ? selectRelease(await response.json(), currentVersion, platform) : null
        const checkedAt = new Date().toISOString()
        if (!found || (!manual && found.version === settings.skippedVersion)) {
          release = null
          update({ status: 'up-to-date', checkedAt, version: null, notes: '', pageUrl: null, downloadable: false })
        } else {
          const sameAsReady = release?.version === found.version && downloadPath && state.status === 'ready'
          release = found
          if (!sameAsReady) update({ status: 'available', checkedAt, version: found.version, name: found.name, notes: found.notes, publishedAt: found.publishedAt, pageUrl: found.pageUrl, downloadable: Boolean(found.installer), progress: 0 })
          else update({ checkedAt })
        }
      } catch (error) {
        update({ status: 'error', error: `Không kiểm tra được bản cập nhật: ${error.message}` })
      }
      return snapshot()
    })().finally(() => { checking = null })
    return checking
  }

  function download() {
    if (downloading) return downloading
    if (!release?.installer) return Promise.reject(new Error('Chưa có bộ cài macOS cho bản cập nhật này.'))
    const { installer, version } = release
    downloading = (async () => {
      const folder = join(directory, 'downloads')
      const target = join(folder, installer.name), partial = `${target}.part`
      update({ status: 'downloading', progress: 0, error: null })
      try {
        await mkdir(folder, { recursive: true })
        for (const name of await readdir(folder)) if (name !== installer.name) await rm(join(folder, name), { recursive: true, force: true })
        const expected = parseChecksum(await (await fetchOk(installer.checksumUrl)).text(), installer.name)
        let existing = null
        try { existing = await stat(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
        if (existing?.size === installer.size && await fileHash(target) === expected) {
          downloadPath = target
          update({ status: 'ready', progress: 1 })
          return snapshot()
        }
        const response = await fetchOk(installer.url, { headers: { Accept: 'application/octet-stream' } })
        const length = Number(response.headers.get('content-length'))
        if (length && length !== installer.size) throw new Error('Kích thước bộ cài không khớp với bản phát hành.')
        const hash = createHash('sha256')
        let received = 0, lastReport = 0
        await pipeline(Readable.fromWeb(response.body), async function* (source) {
          for await (const chunk of source) {
            received += chunk.length
            if (received > installer.size) throw new Error('Bộ cài lớn hơn kích thước đã công bố.')
            hash.update(chunk)
            if (received - lastReport > 4 * 1024 * 1024) { lastReport = received; update({ progress: received / installer.size }) }
            yield chunk
          }
        }, createWriteStream(partial))
        if (received !== installer.size) throw new Error('Bộ cài tải về chưa đầy đủ.')
        if (hash.digest('hex') !== expected) throw new Error('SHA-256 của bộ cài không khớp; đã hủy bản tải về.')
        await rename(partial, target)
        downloadPath = target
        update({ status: 'ready', progress: 1, version })
      } catch (error) {
        await rm(partial, { force: true })
        update({ status: 'error', error: `Không tải được bản cập nhật: ${error.message}` })
        throw error
      }
      return snapshot()
    })().finally(() => { downloading = null })
    return downloading
  }

  async function fileHash(path) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
  }

  async function plist(bundle, key) {
    const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(bundle, 'Contents', 'Info.plist')])
    return stdout.trim()
  }

  async function teamIdentifier(bundle) {
    // codesign prints its details on stderr; ad-hoc signatures report "not set".
    const { stderr } = await run('/usr/bin/codesign', ['-dv', bundle]).catch(error => ({ stderr: error.stderr || '' }))
    const team = /^TeamIdentifier=(.+)$/m.exec(stderr)?.[1]?.trim()
    return team && team !== 'not set' ? team : null
  }

  // Mounts the verified DMG and copies the app next to the installed one (same
  // volume, so the final swap is a rename). Returns the staged bundle path.
  async function stageBundle(target) {
    const productApp = basename(target)
    const mountPoint = join(directory, 'mount')
    await rm(mountPoint, { recursive: true, force: true })
    await mkdir(mountPoint, { recursive: true })
    const staged = join(dirname(target), `.${productApp.replace(/\.app$/, '')}-update-${Date.now()}.app`)
    await run('/usr/bin/hdiutil', ['attach', downloadPath, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint], { timeout: 120_000 })
    try {
      const source = join(mountPoint, productApp)
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source], { timeout: 300_000 })
      if (await plist(source, 'CFBundleShortVersionString') !== release.version) throw new Error('Phiên bản trong bộ cài không khớp bản phát hành.')
      if (await plist(source, 'CFBundleIdentifier') !== await plist(target, 'CFBundleIdentifier')) throw new Error('Bộ cài không phải Viet Latex Studio.')
      const currentTeam = await teamIdentifier(target)
      if (currentTeam && await teamIdentifier(source) !== currentTeam) throw new Error('Chữ ký Developer ID của bộ cài khác bản đang cài.')
      await run('/usr/bin/ditto', [source, staged], { timeout: 600_000 })
    } catch (error) {
      await rm(staged, { recursive: true, force: true })
      throw error
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mountPoint, '-force'], { timeout: 60_000 }).catch(() => {})
    }
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {})
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged], { timeout: 300_000 })
    return staged
  }

  async function install() {
    if (installing) throw new Error('Đang cài bản cập nhật.')
    if (state.status !== 'ready' || !downloadPath) throw new Error('Hãy tải bản cập nhật trước.')
    const target = installTarget()
    if (!target) {
      // Unpackaged, translocated or portable runs: open the verified installer for a manual install.
      const error = await shell.openPath(downloadPath)
      if (error) throw new Error(error)
      return { ...snapshot(), manual: true }
    }
    installing = true
    if (platform === 'win32') {
      try {
        update({ status: 'installing', error: null })
        await beforeInstall()
        // Started from 'quit', after the workspace flush and backend shutdown;
        // a cancelled quit (failed save) therefore never replaces the app.
        const installer = downloadPath
        onQuit(() => launch(installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref())
        requestQuit()
        return snapshot()
      } catch (error) {
        update({ status: 'ready', error: `Không cài được bản cập nhật: ${error.message}` })
        throw error
      } finally { installing = false }
    }
    try {
      await access(dirname(target), constants.W_OK).catch(() => { throw new Error(`Không có quyền ghi vào ${dirname(target)}. Hãy mở bộ cài và kéo app vào Applications.`) })
      update({ status: 'installing', error: null })
      await beforeInstall()
      const staged = await stageBundle(target)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupRoot = join(app.getPath('appData'), 'VietLatex Upgrade Backups')
      await pruneAutomaticBackups(backupRoot)
      const backup = join(backupRoot, `${stamp}-auto-${currentVersion}`, basename(target))
      const script = join(directory, 'install-update.sh')
      await writeFile(script, INSTALL_SCRIPT, { mode: 0o700 })
      launch('/bin/sh', [script, String(process.pid), target, staged, backup, join(directory, 'install.log')], { detached: true, stdio: 'ignore' }).unref()
      requestQuit()
      return snapshot()
    } catch (error) {
      update({ status: 'ready', error: `Không cài được bản cập nhật: ${error.message}` })
      throw error
    } finally { installing = false }
  }

  // Each previous.app keeps a full TeX tree; keep only the two newest automatic ones.
  async function pruneAutomaticBackups(root) {
    let names
    try { names = await readdir(root) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const name of names.filter(name => /-auto-/.test(name)).sort().reverse().slice(1)) await rm(join(root, name), { recursive: true, force: true })
  }

  async function setAutoCheck(enabled) {
    await saveSettings({ autoCheck: Boolean(enabled) })
    schedule()
    return snapshot()
  }

  async function skip() {
    if (!release) return snapshot()
    await saveSettings({ skippedVersion: release.version })
    if (state.status === 'available') update({ status: 'up-to-date', version: null })
    return snapshot()
  }

  function schedule() {
    stop()
    if (!settings.autoCheck) return
    const first = setTimeout(() => void check(), CHECK_DELAY_MS)
    const repeat = setInterval(() => void check(), CHECK_INTERVAL_MS)
    first.unref?.(); repeat.unref?.()
    timers = [first, repeat]
  }

  async function start({ automatic = true } = {}) {
    await loadSettings().catch(error => console.error('Không đọc được thiết lập cập nhật:', error))
    if (automatic) schedule()
  }

  function stop() { clearTimeout(timers[0]); clearInterval(timers[1]); timers = [] }

  return { start, stop, check, download, install, skip, setAutoCheck, status: snapshot }
}

module.exports = { DEFAULT_FEED, INSTALL_SCRIPT, appBundlePath, compareVersions, createUpdater, installerName, isReleaseDownloadUrl, parseChecksum, parseVersion, selectRelease }
