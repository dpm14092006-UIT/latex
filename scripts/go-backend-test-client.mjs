import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const executable = join(root, 'build', 'backend', 'vietlatex-backend')

export async function startGoBackendForTests({ env = {} } = {}) {
  const token = randomBytes(32).toString('hex')
  // Optional source-mode backend for development.
  const goRun = process.env.VIETLATEX_TEST_BACKEND === 'go-run'
  const child = spawn(goRun ? 'go' : executable, [...(goRun ? ['-C', 'backend', 'run', './cmd/vietlatex-backend'] : []), '--listen=127.0.0.1:0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env, VIETLATEX_API_TOKEN: token, VIETLATEX_APP_PATH: root },
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000) })
  let exitInfo
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
    resolveExit(exitInfo)
  }))

  let output = ''
  let startupTimeout
  let ready
  try {
    ready = await Promise.race([
      new Promise((resolveReady, reject) => {
      child.stdout.on('data', chunk => {
        output += chunk.toString('utf8')
        const newline = output.indexOf('\n')
        if (newline < 0) return
        try { resolveReady(JSON.parse(output.slice(0, newline))) } catch (error) { reject(error) }
      })
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(`Go backend exited early (${code ?? signal}): ${stderr}`)))
      }),
      new Promise((_, reject) => {
        startupTimeout = setTimeout(() => reject(new Error('Go backend startup timed out.')), 15_000)
        startupTimeout.unref?.()
      }),
    ])
  } catch (error) {
    child.kill()
    throw error
  } finally {
    clearTimeout(startupTimeout)
  }
  if (ready?.event !== 'ready' || !/^127\.0\.0\.1:\d+$/.test(ready.address)) {
    child.kill()
    throw new Error('Go backend returned an invalid ready address.')
  }

  const baseUrl = `http://${ready.address}`
  async function request(path, { method = 'GET', body, signal, contentType = 'application/json' } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'X-Vietlatex-Token': token, ...(contentType ? { 'Content-Type': contentType } : {}) },
      body,
      signal,
    })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw Object.assign(new Error(result.error || `Backend returned ${response.status}.`), { status: response.status, log: result.log, line: result.line })
    }
    return response
  }

  return {
    baseUrl,
    async compileLatex(latex, images = [], { assets = [], fresh = false, signal } = {}) {
      const response = await request('/api/compile', { method: 'POST', body: JSON.stringify({ latex, images, assets, fresh }), signal })
      return Buffer.from(await response.arrayBuffer())
    },
    async convertWord(direction, input) {
      if (direction === 'import') {
        const response = await request('/api/word/import', {
          method: 'POST', body: Buffer.from(input),
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        return { ast: await response.json() }
      }
      const response = await request('/api/word/export', { method: 'POST', body: JSON.stringify(input) })
      return { bytes: new Uint8Array(await response.arrayBuffer()) }
    },
    async stats() {
      return (await request('/api/health')).json()
    },
    async close() {
      if (exitInfo) return
      await request('/api/shutdown', { method: 'POST', body: '{}' }).catch(() => {})
      await Promise.race([exited, delay(4000)])
      if (!exitInfo) child.kill()
    },
  }
}
