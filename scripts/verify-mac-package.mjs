import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
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

await access(executable)
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
for (const binary of [executable, join(resources, 'backend', 'vietlatex-backend'), join(resources, 'pandoc', 'pandoc'), join(resources, 'tectonic', 'tectonic')]) {
  for (const arch of ['x86_64', 'arm64']) await run('/usr/bin/lipo', [binary, '-verify_arch', arch])
}
await run(join(resources, 'tectonic', 'tectonic'), ['--version'])
await run(process.execPath, [join(root, 'scripts', 'lan-sync-desktop.mjs')], { ...process.env, DESKTOP_EXE: executable })
console.log('Packaged Mac app passed: signature integrity, universal binaries, bundled Tectonic and two-desktop LAN regression.')
