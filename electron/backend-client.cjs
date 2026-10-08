const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const SHUTDOWN_REQUEST_TIMEOUT_MS = 1000

class GoBackendClient {
  constructor(child, address, token) {
    this.child = child
    this.baseUrl = `http://${address}`
    this.token = token
    this.exitInfo = null
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
    const headers = { 'X-Vietlatex-Token': this.token }
    if (contentType) headers['Content-Type'] = contentType
    let response
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers, body, signal })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      if (!this.alive || await Promise.race([this.exitPromise, delay(200).then(() => null)])) {
        throw Object.assign(new Error('Backend biên dịch đã dừng; đang khởi động lại, hãy thử lại.'), { status: 503, cause: error })
      }
      throw error
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw Object.assign(new Error(result.error || `Backend Go trả về lỗi ${response.status}.`), {
        status: result.status || response.status,
        log: result.log,
        line: result.line,
      })
    }
    return response
  }

  async environment() {
    return (await this.request('/api/environment')).json()
  }

  async clearCache() {
    return (await this.request('/api/cache/clear', { method: 'POST', body: '{}' })).json()
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

  async stop() {
    if (this.exitInfo) return this.exitInfo
    const controller = new AbortController()
    let requestTimedOut = false
    const timeout = setTimeout(() => { requestTimedOut = true; controller.abort() }, SHUTDOWN_REQUEST_TIMEOUT_MS)
    try {
      await this.request('/api/shutdown', { method: 'POST', body: '{}', signal: controller.signal }).catch(() => {})
    } finally { clearTimeout(timeout) }
    if (requestTimedOut) {
      this.child.kill()
      return Promise.race([this.exitPromise, delay(1000).then(() => this.exitInfo)])
    }
    const result = await Promise.race([this.exitPromise, delay(4000).then(() => null)])
    if (result) return result
    this.child.kill()
    return Promise.race([this.exitPromise, delay(1000).then(() => this.exitInfo)])
  }
}

function startGoBackend({ executable, cwd, appPath, resourcesPath, args = ['--listen=127.0.0.1:0'] }) {
  const token = randomBytes(32).toString('hex')
  const child = spawn(executable, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
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
      if (error) {
        child.kill()
        reject(error)
      } else resolve(client)
    }

    function onOutput(chunk) {
      output += chunk.toString('utf8')
      if (output.length > 16_384) return finish(new Error('Backend Go gửi dữ liệu khởi động không hợp lệ.'))
      const newline = output.indexOf('\n')
      if (newline < 0) return
      const line = output.slice(0, newline).trim()
      try {
        const ready = JSON.parse(line)
        const address = ready?.event === 'ready' && typeof ready.address === 'string' ? ready.address : ''
        if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('địa chỉ API không hợp lệ')
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

    child.stdout.on('data', onOutput)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

module.exports = { startGoBackend }
