const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, readdir, rm, writeFile, mkdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { appBundlePath, compareVersions, createUpdater, installerName, parseChecksum, parseVersion, selectRelease } = require('./updater.cjs')

const base = 'https://github.com/dpm14092006-UIT/latex/releases/download'
function release(version, overrides = {}) {
  const name = installerName(version)
  return {
    tag_name: `v${version}`, name: `Viet Latex Studio ${version}`, body: 'Ghi chú', draft: false, prerelease: false,
    assets: [
      { name, size: 11, browser_download_url: `${base}/v${version}/${name}` },
      { name: `${name}.sha256`, size: 90, browser_download_url: `${base}/v${version}/${name}.sha256` },
    ],
    ...overrides,
  }
}

test('versions compare numerically and reject malformed input', () => {
  assert.deepEqual(parseVersion('v0.5.10'), [0, 5, 10])
  assert.equal(parseVersion('0.5'), null)
  assert.equal(parseVersion('0.5.6-beta'), null)
  assert.equal(compareVersions('0.5.10', '0.5.9'), 1)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1)
  assert.throws(() => compareVersions('x', '1.0.0'))
})

test('selectRelease only accepts newer published releases with trusted assets', () => {
  assert.equal(selectRelease(release('0.5.6'), '0.5.6'), null)
  assert.equal(selectRelease(release('0.5.5'), '0.5.6'), null)
  assert.equal(selectRelease(release('0.5.7', { draft: true }), '0.5.6'), null)
  assert.equal(selectRelease(release('0.5.7', { prerelease: true }), '0.5.6'), null)
  assert.equal(selectRelease(release('0.5.7', { tag_name: 'nightly' }), '0.5.6'), null)
  const found = selectRelease(release('0.5.7'), '0.5.6')
  assert.equal(found.version, '0.5.7')
  assert.equal(found.installer.size, 11)
  assert.match(found.pageUrl, /releases\/tag\/v0\.5\.7$/)
  const foreign = release('0.5.7')
  foreign.assets[0].browser_download_url = 'https://evil.example/Viet-Latex-Studio-0.5.7-universal.dmg'
  assert.equal(selectRelease(foreign, '0.5.6').installer, null, 'assets outside the repository release are ignored')
  const noChecksum = release('0.5.7')
  noChecksum.assets.pop()
  assert.equal(selectRelease(noChecksum, '0.5.6').installer, null)
})

test('parseChecksum reads shasum output for the named file only', () => {
  const hash = 'a'.repeat(64)
  assert.equal(parseChecksum(`${hash}  file.dmg\n`, 'file.dmg'), hash)
  assert.equal(parseChecksum(`${'B'.repeat(64)} *file.dmg`, 'file.dmg'), 'b'.repeat(64))
  assert.throws(() => parseChecksum(`${hash}  other.dmg\n`, 'file.dmg'))
})

test('appBundlePath finds the .app around the executable', () => {
  assert.equal(appBundlePath('/Applications/Viet Latex Studio.app/Contents/MacOS/Viet Latex Studio'), '/Applications/Viet Latex Studio.app')
  assert.equal(appBundlePath('/usr/local/bin/electron'), null)
})

function fakeFetch(routes) {
  return async url => {
    const body = routes[url]
    if (body === undefined) return new Response('missing', { status: 404 })
    return typeof body === 'object' && !(body instanceof Uint8Array) ? Response.json(body) : new Response(body, { headers: { 'content-length': String(Buffer.byteLength(body)) } })
  }
}

async function harness(t, { payload = Buffer.from('hello world'), checksum, platform = 'linux', skippedVersion } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vls-updater-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  if (skippedVersion) { await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'settings.json'), JSON.stringify({ autoCheck: true, skippedVersion })) }
  const info = release('0.5.7')
  const sha = checksum || createHash('sha256').update(payload).digest('hex')
  const statuses = [], opened = []
  const updater = createUpdater({
    app: { getVersion: () => '0.5.6', isPackaged: false, getPath: () => '/tmp', quit: () => {} },
    shell: { openPath: async path => { opened.push(path); return '' } },
    fetch: fakeFetch({
      'https://feed.test/latest': info,
      [info.assets[0].browser_download_url]: payload,
      [info.assets[1].browser_download_url]: `${sha}  ${info.assets[0].name}\n`,
    }),
    feedUrl: 'https://feed.test/latest', directory, platform,
    onStatus: status => statuses.push(status.status),
  })
  await updater.start({ automatic: false })
  return { updater, directory, statuses, opened }
}

test('check, download and verify a release, then hand the DMG to Finder when not installable', async t => {
  const { updater, directory, statuses, opened } = await harness(t)
  const checked = await updater.check({ manual: true })
  assert.equal(checked.status, 'available')
  assert.equal(checked.version, '0.5.7')
  assert.equal(checked.downloadable, true)
  assert.equal(checked.canInstall, false)
  const downloaded = await updater.download()
  assert.equal(downloaded.status, 'ready')
  const file = join(directory, 'downloads', installerName('0.5.7'))
  assert.equal(await readFile(file, 'utf8'), 'hello world')
  assert.deepEqual(await readdir(join(directory, 'downloads')), [installerName('0.5.7')])
  const result = await updater.install()
  assert.equal(result.manual, true)
  assert.deepEqual(opened, [file])
  assert.ok(statuses.includes('checking') && statuses.includes('downloading'))
  // A second download reuses the verified file.
  assert.equal((await updater.download()).status, 'ready')
})

test('a checksum mismatch discards the download', async t => {
  const { updater, directory } = await harness(t, { checksum: 'f'.repeat(64) })
  await updater.check({ manual: true })
  await assert.rejects(updater.download(), /SHA-256/)
  assert.equal(updater.status().status, 'error')
  assert.deepEqual(await readdir(join(directory, 'downloads')), [])
  await assert.rejects(updater.install(), /tải bản cập nhật/)
})

test('a skipped version is hidden from automatic checks but not manual ones', async t => {
  const { updater } = await harness(t, { skippedVersion: '0.5.7' })
  assert.equal((await updater.check()).status, 'up-to-date')
  assert.equal((await updater.check({ manual: true })).status, 'available')
})

test('skip and auto-check preferences persist', async t => {
  const { updater, directory } = await harness(t)
  await updater.check({ manual: true })
  assert.equal((await updater.skip()).skippedVersion, '0.5.7')
  assert.equal((await updater.setAutoCheck(false)).autoCheck, false)
  updater.stop()
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')), { autoCheck: false, skippedVersion: '0.5.7' })
})

test('feed errors are reported without throwing', async t => {
  const { updater } = await harness(t)
  const broken = createUpdater({ app: { getVersion: () => '0.5.6', isPackaged: false, getPath: () => '/tmp' }, shell: {}, fetch: async () => new Response('', { status: 503 }), directory: join(tmpdir(), 'unused'), feedUrl: 'https://feed.test/x' })
  const status = await broken.check({ manual: true })
  assert.equal(status.status, 'error')
  assert.match(status.error, /503/)
  assert.equal(updater.status().status, 'idle')
  const empty = createUpdater({ app: { getVersion: () => '0.5.6', isPackaged: false, getPath: () => '/tmp' }, shell: {}, fetch: async () => new Response('', { status: 404 }), directory: join(tmpdir(), 'unused'), feedUrl: 'https://feed.test/x' })
  assert.equal((await empty.check({ manual: true })).status, 'up-to-date', 'no published release yet')
})

test('Windows picks the NSIS Setup.exe asset', () => {
  const info = release('0.5.7')
  const setup = installerName('0.5.7', 'win32')
  assert.equal(setup, 'Viet-Latex-Studio-0.5.7-Setup.exe')
  assert.equal(selectRelease(info, '0.5.6', 'win32').installer, null, 'a DMG-only release has nothing for Windows')
  info.assets.push(
    { name: setup, size: 11, browser_download_url: `${base}/v0.5.7/${setup}` },
    { name: `${setup}.sha256`, size: 90, browser_download_url: `${base}/v0.5.7/${setup}.sha256` },
  )
  assert.equal(selectRelease(info, '0.5.6', 'win32').installer.name, setup)
  assert.equal(selectRelease(info, '0.5.6', 'darwin').installer.name, installerName('0.5.7'))
})

test('Windows NSIS install runs the verified Setup.exe silently after the app quits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vls-updater-win-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const payload = Buffer.from('setup bytes')
  const setup = installerName('0.5.7', 'win32')
  const info = release('0.5.7', { assets: [
    { name: setup, size: payload.length, browser_download_url: `${base}/v0.5.7/${setup}` },
    { name: `${setup}.sha256`, size: 90, browser_download_url: `${base}/v0.5.7/${setup}.sha256` },
  ] })
  const calls = []
  let quitCallback = null
  const exe = join('C:', 'Users', 'u', 'AppData', 'Local', 'Programs', 'viet-latex-studio', 'Viet Latex Studio.exe')
  const updater = createUpdater({
    app: { getVersion: () => '0.5.6', isPackaged: true, getName: () => 'Viet Latex Studio', getPath: () => exe },
    shell: {}, directory, platform: 'win32', feedUrl: 'https://feed.test/latest', env: {},
    exists: path => path.endsWith('Uninstall Viet Latex Studio.exe'),
    fetch: fakeFetch({
      'https://feed.test/latest': info,
      [info.assets[0].browser_download_url]: payload,
      [info.assets[1].browser_download_url]: `${createHash('sha256').update(payload).digest('hex')}  ${setup}\n`,
    }),
    beforeInstall: async () => calls.push('backup'),
    requestQuit: () => calls.push('quit'),
    onQuit: callback => { quitCallback = callback },
    launch: (file, args, options) => { calls.push({ file, args, detached: options.detached }); return { unref() {} } },
  })
  await updater.start({ automatic: false })
  assert.equal((await updater.check({ manual: true })).canInstall, true)
  await updater.download()
  await updater.install()
  assert.deepEqual(calls, ['backup', 'quit'], 'nothing runs before the app has quit')
  quitCallback()
  assert.deepEqual(calls[2], { file: join(directory, 'downloads', setup), args: ['/S', '--updated', '--force-run'], detached: true })
})

test('a portable Windows run is not updated in place', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vls-updater-portable-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const updater = createUpdater({
    app: { getVersion: () => '0.5.6', isPackaged: true, getName: () => 'Viet Latex Studio', getPath: () => join('C:', 'Temp', 'x', 'Viet Latex Studio.exe') },
    shell: {}, fetch: async () => new Response('', { status: 404 }), directory, platform: 'win32',
    env: { PORTABLE_EXECUTABLE_FILE: join('D:', 'Viet-Latex-Studio-0.5.1-Portable.exe') }, exists: () => true,
  })
  assert.equal(updater.status().canInstall, false)
})
