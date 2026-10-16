const test = require('node:test')
const assert = require('node:assert/strict')
const { startGoBackend } = require('./backend-client.cjs')

const FAKE_BACKEND = `
const http = require('node:http')
const server = http.createServer((req, res) => {
  if (req.headers['x-vietlatex-token'] !== process.env.VIETLATEX_API_TOKEN) { res.statusCode = 403; res.end('{}'); return }
  if (req.url === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return }
  res.statusCode = 404; res.end('{}')
})
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ event: 'ready', address: '127.0.0.1:' + server.address().port }) + String.fromCharCode(10))
})
`
const HANGING_SHUTDOWN_BACKEND = FAKE_BACKEND.replace(
  "  res.statusCode = 404; res.end('{}')",
  "  if (req.url === '/api/shutdown') return\n  res.statusCode = 404; res.end('{}')",
)

function fakeBackendArgs(script = FAKE_BACKEND) {
  // Base64 preserves the fixture script exactly across subprocess arguments.
  return ['-e', `eval(Buffer.from('${Buffer.from(script).toString('base64')}', 'base64').toString())`]
}

test('startGoBackend parses ready signal and reports dead backend clearly', async () => {
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs() })
  try {
    assert.match(client.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(client.alive, true)
    const health = await (await client.request('/api/health')).json()
    assert.deepEqual(health, { ok: true })

    client.child.kill()
    await client.exitPromise
    assert.equal(client.alive, false)
    await assert.rejects(client.request('/api/health'), /Backend biên dịch đã dừng; đang khởi động lại, hãy thử lại\./)
  } finally {
    if (client.alive) client.child.kill()
  }
})

test('a process error after startup does not throw out of the main process', async () => {
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs() })
  const originalError = console.error
  console.error = () => {}
  try {
    assert.doesNotThrow(() => client.child.emit('error', Object.assign(new Error('kill failed'), { code: 'EPERM' })))
  } finally {
    console.error = originalError
    client.child.kill()
    await client.exitPromise
  }
})

test('stop kills a backend that never answers its shutdown request', async () => {
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(HANGING_SHUTDOWN_BACKEND) })
  try {
    const startedAt = Date.now()
    await client.stop()
    assert.ok(Date.now() - startedAt < 3000, 'shutdown must not wait indefinitely for an HTTP response')
    assert.equal(client.alive, false)
  } finally {
    if (client.alive) client.child.kill()
  }
})

test('stop also terminates a hung backend that ignores SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const script = "process.on('SIGTERM', () => {});\n" + HANGING_SHUTDOWN_BACKEND
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) })
  try {
    const startedAt = Date.now()
    const result = await client.stop()
    assert.ok(Date.now() - startedAt < 4000)
    assert.equal(client.alive, false, 'backend must be gone before stop resolves')
    assert.equal(result.signal, 'SIGKILL')
  } finally {
    if (client.alive) { client.child.kill('SIGKILL'); await client.exitPromise }
  }
})

test('stop shares one shutdown request between concurrent callers', async () => {
  const script = FAKE_BACKEND.replace(
    "  res.statusCode = 404; res.end('{}')",
    "  if (req.url === '/api/shutdown') { res.end('{}'); setTimeout(() => server.close(() => process.exit(0)), 50); return }\n  res.statusCode = 404; res.end('{}')",
  )
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) })
  try {
    const first = client.stop()
    const second = client.stop()
    assert.equal(first, second)
    await first
    assert.equal(client.alive, false)
  } finally {
    if (client.alive) await client.terminate()
  }
})

test('invalid or null error JSON preserves the HTTP status', async () => {
  const script = FAKE_BACKEND.replace(
    "  res.statusCode = 404; res.end('{}')",
    "  res.statusCode = 422; res.end(req.url === '/api/null' ? 'null' : '{\\\"error\\\":\\\"invalid document\\\",\\\"status\\\":200}')",
  )
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) })
  try {
    await assert.rejects(client.request('/api/null'), { status: 422, message: 'Backend Go trả về lỗi 422.' })
    await assert.rejects(client.request('/api/error'), { status: 422, message: 'invalid document' })
  } finally { await client.terminate() }
})

test('cancellation preserves custom abort reason without waiting for backend exit', async () => {
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(HANGING_SHUTDOWN_BACKEND) })
  try {
    const controller = new AbortController()
    const reason = new Error('compile was superseded')
    const pending = client.request('/api/shutdown', { method: 'POST', signal: controller.signal })
    controller.abort(reason)
    await assert.rejects(pending, error => error === reason)

    client.child.kill()
    await client.exitPromise
    await assert.rejects(client.request('/api/health', { signal: controller.signal }), error => error === reason)
  } finally {
    if (client.alive) await client.terminate()
  }
})

test('redirects cannot forward the API token to another server', async () => {
  const { createServer } = require('node:http')
  let leakedToken
  const destination = createServer((req, res) => {
    leakedToken = req.headers['x-vietlatex-token']
    res.end('{}')
  })
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve))
  const script = FAKE_BACKEND.replace(
    "  res.statusCode = 404; res.end('{}')",
    `  res.statusCode = 302; res.setHeader('Location', 'http://127.0.0.1:${destination.address().port}/api/health'); res.end()`,
  )
  let client
  try {
    client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) })
    await assert.rejects(client.request('/api/redirect'), TypeError)
    assert.equal(leakedToken, undefined)
  } finally {
    await client?.terminate()
    await new Promise(resolve => destination.close(resolve))
  }
})

test('rejects readiness ports outside the valid TCP range and terminates the child', async () => {
  for (const port of [0, 65536]) {
    const script = `process.stdout.write(JSON.stringify({ event: 'ready', address: '127.0.0.1:${port}' }) + '\\n'); setInterval(() => {}, 1000)`
    await assert.rejects(startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) }), /cổng API không hợp lệ/)
  }
})

test('startup cancellation stops a backend before it sends ready', async () => {
  const controller = new AbortController()
  const reason = new Error('startup was interrupted')
  const pending = startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs('setInterval(() => {}, 1000)'), signal: controller.signal })
  controller.abort(reason)
  await assert.rejects(pending, error => error === reason)
  await assert.rejects(startGoBackend({ executable: 'unused-path', cwd: __dirname, appPath: __dirname, signal: controller.signal }), error => error === reason)
  const emptyReasonController = new AbortController()
  const emptyReasonPending = startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs('setInterval(() => {}, 1000)'), signal: emptyReasonController.signal })
  emptyReasonController.abort(null)
  await assert.rejects(emptyReasonPending, error => error === null)
})

test('accepts a short readiness line followed by a large stdout chunk', async () => {
  const script = FAKE_BACKEND.replace(
    "process.stdout.write(JSON.stringify({ event: 'ready', address: '127.0.0.1:' + server.address().port }) + String.fromCharCode(10))",
    "process.stdout.write(JSON.stringify({ event: 'ready', address: '127.0.0.1:' + server.address().port }) + String.fromCharCode(10) + 'x'.repeat(64 * 1024))",
  )
  const client = await startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) })
  try { assert.deepEqual(await (await client.request('/api/health')).json(), { ok: true }) }
  finally { await client.terminate() }
})

test('startup failure kills a backend that ignores SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const { mkdtemp, readFile, rm } = require('node:fs/promises')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-backend-startup-'))
  const pidFile = join(directory, 'pid')
  const script = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); process.stdout.write('invalid ready\\n'); setInterval(() => {}, 1000)`
  let pid
  try {
    await assert.rejects(startGoBackend({ executable: process.execPath, cwd: __dirname, appPath: __dirname, args: fakeBackendArgs(script) }), /Không đọc được tín hiệu khởi động/)
    pid = Number(await readFile(pidFile, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ } }
    await rm(directory, { recursive: true, force: true })
  }
})
