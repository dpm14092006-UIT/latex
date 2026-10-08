const test = require('node:test')
const assert = require('node:assert/strict')
const { startGoBackend } = require('./backend-client.cjs')

const FAKE_BACKEND = `
const http = require('node:http')
const server = http.createServer((req, res) => {
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
