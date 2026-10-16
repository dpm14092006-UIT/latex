import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import backendClient from '../electron/backend-client.cjs'

const { startGoBackend } = backendClient
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const preview = process.argv.includes('--preview')
const backendExecutable = join(root, 'build', 'backend', process.platform === 'win32' ? 'vietlatex-backend.exe' : 'vietlatex-backend')
const startupController = new AbortController()
let backend
let vite
let viteExited
let stopping = false
let stopPromise

async function waitForVite(timeoutMs) {
  let timeout
  try {
    return await Promise.race([
      viteExited,
      new Promise(resolveExit => { timeout = setTimeout(() => resolveExit(false), timeoutMs) }),
    ])
  } finally { clearTimeout(timeout) }
}

function stop() {
  stopping = true
  startupController.abort()
  stopPromise ??= (async () => {
    vite?.kill()
    await backend?.stop()
    if (vite && !await waitForVite(1000)) {
      vite.kill('SIGKILL')
      await waitForVite(1000)
    }
  })()
  return stopPromise
}

function stopSafely() {
  void stop().catch(error => { console.error(error); process.exitCode = 1 })
}

// Install handlers before startup so interruption also cleans up a starting backend.
process.once('SIGINT', stopSafely)
process.once('SIGTERM', stopSafely)

try {
  await access(backendExecutable).catch(() => { throw new Error('Chưa có backend Go. Chạy npm run backend:build trước.') })
  backend = await startGoBackend({ executable: backendExecutable, cwd: root, appPath: root, args: ['--listen=127.0.0.1:4317'], signal: startupController.signal })
  if (backend.baseUrl !== 'http://127.0.0.1:4317') throw new Error('Backend Go trả về địa chỉ không hợp lệ.')
  if (stopping) {
    await backend.stop()
  } else {
    console.log(`Backend Go sẵn sàng tại ${backend.baseUrl}`)
    const viteArgs = preview
      ? [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1']
      : [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1']
    vite = spawn(process.execPath, viteArgs, {
      cwd: root,
      env: { ...process.env, VIETLATEX_API_TOKEN: backend.token, VIETLATEX_APP_PATH: root },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    vite.stdout.pipe(process.stdout)
    vite.stderr.pipe(process.stderr)
    viteExited = new Promise(resolveExit => vite.once('close', () => resolveExit(true)))
    vite.once('error', error => { console.error('Không chạy được Vite:', error.message); process.exitCode = 1; stopSafely() })
    vite.once('exit', code => { if (!stopping) process.exitCode = code ?? 1; stopSafely() })
    backend.child.once('exit', code => {
      if (!stopping) {
        console.error('Backend Go đã dừng ngoài dự kiến.')
        process.exitCode = code || 1
        stopSafely()
      }
    })
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message)
    process.exitCode = 1
  }
  await stop().catch(stopError => console.error(stopError))
}
