import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const preview = process.argv.includes('--preview')
const extension = process.platform === 'win32' ? '.exe' : ''
const backendExecutable = join(root, 'build', 'backend', `vietlatex-backend${extension}`)
const token = randomBytes(32).toString('hex')
const env = { ...process.env, VIETLATEX_API_TOKEN: token, VIETLATEX_APP_PATH: root }
const children = new Set()
let stopping = false

await access(backendExecutable).catch(() => { throw new Error('Chưa có backend Go. Chạy npm run backend:build trước.') })

function spawnChild(command, args, childEnv = env) {
  const child = spawn(command, args, { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  children.add(child)
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  child.once('exit', () => children.delete(child))
  return child
}

const backend = spawnChild(backendExecutable, ['--listen=127.0.0.1:4317'])
const backendExited = new Promise(resolveExit => backend.once('exit', (code, signal) => resolveExit({ code, signal })))
let ready
let startupTimeout
try {
  ready = await new Promise((resolveReady, reject) => {
    let output = ''
    startupTimeout = setTimeout(() => reject(new Error('Backend Go không sẵn sàng sau 15 giây.')), 15_000)
    startupTimeout.unref?.()
    backend.stdout.on('data', chunk => {
      output += chunk.toString('utf8')
      const lineEnd = output.indexOf('\n')
      if (lineEnd < 0) return
      clearTimeout(startupTimeout)
      try { resolveReady(JSON.parse(output.slice(0, lineEnd))) } catch (error) { reject(error) }
    })
    backend.once('error', reject)
    backend.once('exit', (code, signal) => reject(new Error(`Backend Go thoát sớm (${code ?? signal}).`)))
  })
} catch (error) {
  clearTimeout(startupTimeout)
  backend.kill()
  if (process.platform === 'win32' && ['UNKNOWN', 'EPERM', 'EACCES'].includes(error.code)) {
    throw new Error(`Windows Application Control không cho chạy backend Go tại ${backendExecutable}. Hãy dùng bản backend được quản trị viên cho phép hoặc ký số theo chính sách máy.`, { cause: error })
  }
  throw error
}
if (ready?.event !== 'ready' || ready.address !== '127.0.0.1:4317') throw new Error('Backend Go trả về địa chỉ không hợp lệ.')

const viteArgs = preview
  ? [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1']
  : [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1']
const vite = spawnChild(process.execPath, viteArgs)

async function stop() {
  if (stopping) return
  stopping = true
  try {
    await fetch(`http://${ready.address}/api/shutdown`, { method: 'POST', headers: { 'X-Vietlatex-Token': token } })
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
  }
  for (const child of children) if (child !== backend) child.kill()
  const stopped = await Promise.race([backendExited, delay(5000).then(() => null)])
  if (!stopped) backend.kill()
}

process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
vite.once('exit', code => { void stop(); process.exitCode = code ?? 0 })
backend.once('exit', code => {
  if (!stopping) {
    console.error('Backend Go đã dừng ngoài dự kiến.')
    void stop()
    process.exitCode = code || 1
  }
})

if (process.platform === 'win32') process.once('SIGBREAK', () => { void stop() })
