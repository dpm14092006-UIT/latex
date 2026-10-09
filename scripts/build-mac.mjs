import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
if (process.platform !== 'darwin') throw new Error('Tạo bộ cài DMG universal trên macOS.')
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} thất bại (${code ?? signal}).`)))
})
const node = (script, args = []) => run(process.execPath, [join(root, 'scripts', script), ...args])
try { await access(join(root, 'tools', 'pandoc', 'pandoc')) } catch { await node('setup-pandoc.mjs') }
await node('setup-tex.mjs')
for (const binary of ['tools/pandoc/pandoc', 'tools/tex/bin/universal-darwin/xetex']) {
  for (const arch of ['x86_64', 'arm64']) await run('/usr/bin/lipo', [join(root, binary), '-verify_arch', arch])
}
await node('build-backend.mjs', ['--universal'])
for (const arch of ['x86_64', 'arm64']) await run('/usr/bin/lipo', [join(root, 'build', 'backend', 'vietlatex-backend'), '-verify_arch', arch])
await run(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { ...process.env, BUILD_DESKTOP_APP: 'true' })
await run(process.execPath, [join(root, 'node_modules', 'electron-builder', 'cli.js'), '--config', 'electron-builder.config.cjs', '--mac', ...(process.argv.includes('--dir') ? ['--dir'] : ['dmg']), '--universal', '--publish', 'never'])
await node('verify-mac-package.mjs')
if (!process.argv.includes('--dir')) {
  await run(process.env.PYTHON_BINARY || 'python3', [join(root, 'scripts', 'package-mac-source.py')])
  await node('copy-mac-installer.cjs')
}
