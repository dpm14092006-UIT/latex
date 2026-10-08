import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'

test('Electron downloader proxy works with the audited global-agent override', async t => {
  const proxy = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end(request.url)
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { proxy.closeAllConnections(); proxy.close(resolve) }))
  // This test runs in its own Node test worker. All traffic stays on loopback;
  // the proxy replies directly so no external download is made.
  process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`
  process.env.GLOBAL_AGENT_NO_PROXY = ''
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
  builderRequire('@electron/get').initializeProxy()
  assert.equal(globalThis.GLOBAL_AGENT.HTTP_PROXY, process.env.GLOBAL_AGENT_HTTP_PROXY)
  const echoed = await new Promise((resolve, reject) => {
    const request = http.get('http://example.invalid/electron-asset', response => {
      let data = ''
      response.on('data', chunk => { data += chunk })
      response.on('end', () => resolve(data))
      response.on('error', reject)
    })
    request.setTimeout(3000, () => request.destroy(new Error('Local test proxy timed out.')))
    request.on('error', reject)
  })
  assert.equal(echoed, 'http://example.invalid/electron-asset')
})
