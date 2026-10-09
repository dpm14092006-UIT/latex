// Builds the Windows x64 NSIS installer into release-desktop/win.
//   node win/build-win.mjs [--dir]
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (process.platform !== 'win32') throw new Error('Tạo bộ cài Windows trên Windows.')
const dirOnly = process.argv.includes('--dir')
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} thất bại (${code ?? signal}).`)))
})
const node = (script, args = [], env) => run(process.execPath, [join(root, script), ...args], env)

try { await access(join(root, 'tools', 'pandoc', 'pandoc.exe')) } catch { await node('win/setup-pandoc.mjs') }
await node('scripts/build-backend.mjs')
await node('node_modules/vite/bin/vite.js', ['build'], { ...process.env, BUILD_DESKTOP_APP: 'true' })
await node('node_modules/electron-builder/cli.js', ['--config', join('win', 'electron-builder.config.cjs'), '--win', dirOnly ? 'dir' : 'nsis', '--x64', '--publish', 'never'])
await node('win/verify-win-package.mjs')
if (!dirOnly) await node('win/copy-win-installer.cjs')
