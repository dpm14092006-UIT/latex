import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (process.platform !== 'darwin') throw new Error('Tạo bộ cài DMG universal trên macOS. Windows vẫn chạy được backend cross-compile, nhưng không thay thế kiểm thử bộ cài Mac.')
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} thất bại (${code}).`)))
})
const pandoc = join(root, 'tools', 'pandoc', 'pandoc')
try { await access(pandoc) } catch { await run(process.execPath, [join(root, 'scripts', 'setup-pandoc.mjs')]) }
for (const arch of ['x86_64', 'arm64']) await run('/usr/bin/lipo', [pandoc, '-verify_arch', arch])
const tectonic = join(root, 'tools', 'tectonic', 'tectonic')
try { await access(tectonic) } catch { await run(process.execPath, [join(root, 'scripts', 'setup-tectonic.mjs')]) }
for (const arch of ['x86_64', 'arm64']) await run('/usr/bin/lipo', [tectonic, '-verify_arch', arch])
await run(process.execPath, [join(root, 'scripts', 'build-backend.mjs'), '--universal'])
for (const arch of ['x86_64', 'arm64']) await run('/usr/bin/lipo', [join(root, 'build', 'backend', 'vietlatex-backend'), '-verify_arch', arch])
await run(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { ...process.env, BUILD_DESKTOP_APP: 'true' })
await run(process.execPath, [join(root, 'node_modules', 'electron-builder', 'cli.js'), '--config', 'electron-builder.config.cjs', '--mac', 'dmg', '--universal', '--publish', 'never'])
await run(process.execPath, [join(root, 'scripts', 'copy-mac-installer.cjs')])
