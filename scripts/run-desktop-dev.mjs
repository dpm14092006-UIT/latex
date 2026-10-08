import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const build = spawn(process.execPath, [join(root, 'scripts', 'build-backend.mjs')], { cwd: root, stdio: 'inherit' })
const buildCode = await new Promise((done, reject) => {
  build.once('error', reject)
  build.once('exit', code => done(code ?? 1))
})
if (buildCode !== 0) process.exit(buildCode)

const children = new Set()
function start(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

const vite = start(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5176', '--strictPort'])
process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5176'
const electron = start(process.execPath, [join(root, 'node_modules', 'electron', 'cli.js'), '.'])
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}
electron.once('exit', code => stop(code ?? 0))
vite.once('exit', code => {
  if (!stopping) {
    electron.kill()
    stop(code ?? 1)
  }
})
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
