import { spawn } from 'node:child_process'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(root, 'build', 'backend')
const universal = process.argv.includes('--universal')
if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Build backend trên macOS (hoặc Linux cho CI).')
if (universal && process.platform !== 'darwin') throw new Error('Build universal cần macOS và lipo.')
const run = (command, args, env = process.env) => new Promise((done, reject) => {
  const child = spawn(command, args, { cwd: join(root, 'backend'), env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${command} thất bại (${code ?? signal}).`)))
})
const build = (arch, destination) => run(process.env.GO_BINARY || 'go', ['build', '-trimpath', '-ldflags=-s -w', '-o', destination, './cmd/vietlatex-backend'], {
  ...process.env, GOOS: process.platform === 'darwin' ? 'darwin' : 'linux', GOARCH: arch, CGO_ENABLED: '0',
})
await mkdir(outputDir, { recursive: true })
const temporary = join(outputDir, '.vietlatex-backend.tmp')
const staging = join(outputDir, '.universal-staging')
try {
  if (universal) {
    await mkdir(staging, { recursive: true })
    for (const arch of ['amd64', 'arm64']) await build(arch, join(staging, arch))
    await run('/usr/bin/lipo', ['-create', join(staging, 'amd64'), join(staging, 'arm64'), '-output', temporary])
  } else await build(process.arch === 'arm64' ? 'arm64' : 'amd64', temporary)
  await chmod(temporary, 0o755)
  if (process.platform === 'darwin') await run('/usr/bin/codesign', ['--force', '--sign', '-', temporary])
  await rename(temporary, join(outputDir, 'vietlatex-backend'))
} finally {
  await rm(temporary, { force: true })
  await rm(staging, { recursive: true, force: true })
}
console.log(`Go backend ready: ${relative(root, outputDir)}`)
