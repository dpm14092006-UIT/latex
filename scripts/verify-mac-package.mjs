import { promisify } from 'node:util'
import { spawn, execFile } from 'node:child_process'
import { access, readdir, readlink, realpath, open } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') throw new Error('Kiểm tra ứng dụng Mac đã đóng gói trên macOS.')
const require = createRequire(import.meta.url)
const pkg = require('../package.json')
const config = require('../electron-builder.config.cjs')
const root = fileURLToPath(new URL('..', import.meta.url))
const app = join(config.directories.output, 'mac-universal', `${pkg.build.productName}.app`)
const executable = join(app, 'Contents', 'MacOS', pkg.build.productName)
const resources = join(app, 'Contents', 'Resources')

const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} thất bại (${code}).`)))
})

const visited = new Set()
const configuredMinimum = pkg.build.mac.minimumSystemVersion.split('.').map(Number)
async function verifyMinimumMacOS(binary) {
  const { stdout } = await promisify(execFile)('/usr/bin/vtool', ['-show-build', binary])
  const versions = [...stdout.matchAll(/^\s+minos ([\d.]+)/gm), ...stdout.matchAll(/cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)/g)]
  for (const match of versions) {
    const minimum = match[1].split('.').map(Number)
    for (let index = 0; index < Math.max(minimum.length, configuredMinimum.length); index += 1) {
      const difference = (minimum[index] || 0) - (configuredMinimum[index] || 0)
      if (difference > 0) throw new Error(`Binary yêu cầu macOS ${match[1]}, cao hơn bộ cài: ${binary}`)
      if (difference < 0) break
    }
  }
}
async function verifyTexTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (/\.(exe|dll|cmd|bat)$/i.test(entry.name)) throw new Error(`Tệp Windows trong app: ${path}`)
    if (entry.isSymbolicLink()) {
      const target = await readlink(path)
      const resolved = await realpath(path)
      if (target.startsWith('/') || !resolved.startsWith(`${resources}/`)) throw new Error(`Symlink không di động: ${path}`)
      continue
    }
    if (entry.isDirectory()) { await verifyTexTree(path); continue }
    if (!entry.isFile()) continue
    const handle = await open(path, 'r')
    const header = Buffer.alloc(4)
    try { await handle.read(header, 0, 4, 0) } finally { await handle.close() }
    if (![0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf].includes(header.readUInt32BE()) && ![0xfeedface, 0xfeedfacf].includes(header.readUInt32LE())) continue
    if (!visited.has(path)) {
      await run('/usr/bin/lipo', [path, '-verify_arch', 'x86_64', 'arm64'])
      await verifyMinimumMacOS(path)
      visited.add(path)
    }
  }
}

await access(executable)
const { stdout: minimumVersion } = await promisify(execFile)('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', join(app, 'Contents', 'Info.plist')])
if (minimumVersion.trim() !== pkg.build.mac.minimumSystemVersion) throw new Error('Yêu cầu macOS trong Info.plist không khớp cấu hình bộ cài.')
const { stdout: localNetworkDescription } = await promisify(execFile)('/usr/libexec/PlistBuddy', ['-c', 'Print :NSLocalNetworkUsageDescription', join(app, 'Contents', 'Info.plist')])
if (localNetworkDescription.trim() !== pkg.build.mac.extendInfo.NSLocalNetworkUsageDescription) throw new Error('Thiếu hoặc sai mô tả quyền mạng nội bộ trong app đã đóng gói.')
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
for (const binary of [executable, join(resources, 'backend', 'vietlatex-backend'), join(resources, 'pandoc', 'pandoc'), join(resources, 'tex', 'bin', 'universal-darwin', 'xetex'), join(resources, 'tex', 'bin', 'universal-darwin', 'biber')]) {
  await run('/usr/bin/lipo', [binary, '-verify_arch', 'x86_64', 'arm64'])
  await verifyMinimumMacOS(binary)
}
await verifyTexTree(join(resources, 'tex'))
await run(process.execPath, [join(root, 'scripts', 'mac-packaged-smoke.mjs')], { ...process.env, DESKTOP_EXE: executable })
await run(process.execPath, [join(root, 'scripts', 'dark-text-pdf-desktop.mjs')], { ...process.env, DESKTOP_EXE: executable })
await run(process.execPath, [join(root, 'scripts', 'heading-numbering-desktop.mjs')], { ...process.env, DESKTOP_EXE: executable })
await run(process.execPath, [join(root, 'scripts', 'lan-sync-desktop.mjs')], { ...process.env, DESKTOP_EXE: executable })
console.log('Packaged Mac app passed: signature integrity, universal binaries and two-desktop LAN regression.')
