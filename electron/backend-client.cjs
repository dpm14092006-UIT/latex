const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const { backendEnvironment } = process.platform === 'win32' ? require('./win/environment.cjs') : require('./mac/environment.cjs')
const SHUTDOWN_REQUEST_TIMEOUT_MS = 1000

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  return new Promise(resolve => {
    const timeout = setTimeout(() => finish(null), timeoutMs)
    function finish(result) {
      clearTimeout(timeout)
      child.off('exit', onExit)
      resolve(result)
    }
    function onExit(code, signal) { finish({ code, signal }) }
    child.once('exit', onExit)
  })
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode }
  child.kill()
  const graceful = await waitForExit(child, 1000)
  if (graceful) return graceful
  // A hung backend can ignore SIGTERM. Do not leave it behind after quitting.
  child.kill('SIGKILL')
  return waitForExit(child, 1000)
}

class GoBackendClient {
  constructor(child, address, token) {
    this.child = child
    this.baseUrl = `http://${address}`
    this.token = token
    this.exitInfo = null
    this.stopPromise = null
    this.terminatePromise = null
    this.exitPromise = new Promise(resolve => {
      child.once('exit', (code, signal) => {
        this.exitInfo = { code, signal }
        resolve(this.exitInfo)
      })
    })
  }

  get alive() {
    return !this.exitInfo && this.child.exitCode === null && this.child.signalCode === null
  }

  async request(path, { method = 'GET', body, signal, contentType = 'application/json' } = {}) {
    if (signal?.aborted) throw signal.reason
    if (!this.alive) throw Object.assign(new Error('Backend biên dịch đã dừng; đang khởi động lại, hãy thử lại.'), { status: 503 })
    const headers = { 'X-Vietlatex-Token': this.token }
    if (contentType) headers['Content-Type'] = contentType
    let response
    try {
      // Keep the local API token on this backend, even if it returns a redirect.
      response = await fetch(`${this.baseUrl}${path}`, { method, headers, body, signal, redirect: 'error' })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (error?.name === 'AbortError') throw error
      if (!this.alive || await waitForExit(this.child, 200)) {
        throw Object.assign(new Error('Backend biên dịch đã dừng; đang khởi động lại, hãy thử lại.'), { status: 503, cause: error })
      }
      throw error
    }
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw Object.assign(new Error(result?.error || `Backend Go trả về lỗi ${response.status}.`), {
        status: response.status,
        log: result?.log,
        line: result?.line,
      })
    }
    return response
  }

  async environment() {
    return (await this.request('/api/environment')).json()
  }

  async compileLatex(latex, images, id, assets, fresh, signal) {
    const response = await this.request('/api/compile', {
      method: 'POST',
      body: JSON.stringify({ latex, images, assets, fresh, id }),
      signal,
    })
    return new Uint8Array(await response.arrayBuffer())
  }

  async convertWord(direction, input) {
    if (direction === 'import') {
      if (!ArrayBuffer.isView(input) || input.byteLength > 25 * 1024 * 1024) {
        throw new Error('Tệp Word vượt 25 MB hoặc không hợp lệ.')
      }
      const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      const ast = await (await this.request('/api/word/import', {
        method: 'POST',
        body: bytes,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })).json()
      return { ast }
    }
    if (direction !== 'export' || !input || typeof input !== 'object') throw new Error('Dữ liệu xuất Word không hợp lệ.')
    const response = await this.request('/api/word/export', { method: 'POST', body: JSON.stringify(input) })
    return { bytes: new Uint8Array(await response.arrayBuffer()) }
  }

  async parseLatexSource(source) {
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source, 'utf8') > 800 * 1024) {
      throw new Error('Source LaTeX vượt 800 KB hoặc không hợp lệ.')
    }
    const ast = await (await this.request('/api/latex/parse', {
      method: 'POST',
      body: source,
      contentType: 'text/plain; charset=utf-8',
    })).json()
    return { ast }
  }

  async lookupDoi(doi) {
    if (typeof doi !== 'string' || !doi.trim() || doi.length > 400) throw new Error('DOI không hợp lệ.')
    return (await this.request('/api/doi', { method: 'POST', body: JSON.stringify({ doi }) })).json()
  }

  stop() {
    this.stopPromise ??= this.shutdown()
    return this.stopPromise
  }

  async shutdown() {
    if (this.exitInfo) return this.exitInfo
    const controller = new AbortController()
    let requestTimedOut = false
    const timeout = setTimeout(() => { requestTimedOut = true; controller.abort() }, SHUTDOWN_REQUEST_TIMEOUT_MS)
    try {
      const response = await this.request('/api/shutdown', { method: 'POST', body: '{}', signal: controller.signal }).catch(() => null)
      await response?.body?.cancel().catch(() => {})
    } finally { clearTimeout(timeout) }
    if (requestTimedOut) {
      return this.terminate()
    }
    const result = await waitForExit(this.child, 4000)
    if (result) return result
    return this.terminate()
  }

  terminate() {
    this.terminatePromise ??= terminateChild(this.child)
    return this.terminatePromise
  }
}

function startGoBackend({ executable, cwd, appPath, resourcesPath, args = ['--listen=127.0.0.1:0'], signal }) {
  if (signal?.aborted) return Promise.reject(signal.reason)
  const token = randomBytes(32).toString('hex')
  const child = spawn(executable, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...backendEnvironment({ appPath, resourcesPath }),
      VIETLATEX_API_TOKEN: token,
      // The backend shuts down on its own if Electron dies without stopping it.
      VIETLATEX_PARENT_PID: String(process.pid),
      VIETLATEX_APP_PATH: appPath,
      ...(resourcesPath ? { VIETLATEX_RESOURCES_PATH: resourcesPath } : {}),
    },
  })
  child.stderr.on('data', chunk => process.stderr.write(`[Go backend] ${chunk}`))
  let settled = false
  // The startup listener is removed once settled; a later 'error' (for example a
  // failed kill) must not become an uncaught exception in the main process.
  child.on('error', error => { if (settled) console.error('[Go backend] Lỗi tiến trình:', error.message) })

  return new Promise((resolve, reject) => {
    let output = ''
    const startupTimer = setTimeout(() => finish(new Error('Backend Go khởi động quá thời gian chờ.')), 15_000)
    startupTimer.unref?.()

    function finish(error, client) {
      if (settled) return
      settled = true
      clearTimeout(startupTimer)
      child.stdout.off('data', onOutput)
      child.off('error', onError)
      child.off('exit', onExit)
      signal?.removeEventListener('abort', onAbort)
      // Keep the pipe draining after the readiness listener has been removed.
      child.stdout.resume()
      if (!client) {
        if (child.pid) void terminateChild(child).then(() => reject(error), () => reject(error))
        else reject(error)
      } else resolve(client)
    }

    function onOutput(chunk) {
      output += chunk.toString('utf8')
      const newline = output.indexOf('\n')
      if ((newline < 0 ? output.length : newline) > 16_384) return finish(new Error('Backend Go gửi dữ liệu khởi động không hợp lệ.'))
      if (newline < 0) return
      const line = output.slice(0, newline).trim()
      try {
        const ready = JSON.parse(line)
        const address = ready?.event === 'ready' && typeof ready.address === 'string' ? ready.address : ''
        if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('địa chỉ API không hợp lệ')
        const port = Number(address.slice(address.lastIndexOf(':') + 1))
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('cổng API không hợp lệ')
        finish(null, new GoBackendClient(child, address, token))
      } catch (error) {
        finish(new Error(`Không đọc được tín hiệu khởi động backend Go: ${error.message}`))
      }
    }

    function onError(error) {
      if (process.platform === 'win32' && ['UNKNOWN', 'EPERM', 'EACCES'].includes(error.code)) {
        finish(new Error(`Windows Application Control không cho chạy backend Go tại ${executable}. Hãy dùng bản backend được quản trị viên cho phép hoặc ký số theo chính sách máy. (${error.code})`))
        return
      }
      finish(new Error(`Không chạy được backend Go (${executable}): ${error.message}`))
    }

    function onExit(code, signal) {
      finish(new Error(`Backend Go thoát trước khi sẵn sàng (mã ${code ?? signal}).`))
    }

    function onAbort() { finish(signal.reason) }

    child.stdout.on('data', onOutput)
    child.once('error', onError)
    child.once('exit', onExit)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

module.exports = { startGoBackend }
