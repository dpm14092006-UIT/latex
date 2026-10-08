const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const test = require('node:test')
const { APP_HOST, APP_SCHEME, createRendererProtocolHandler, resolveRendererAssetPath, isTrustedDevRendererUrl } = require('./app-protocol.cjs')

const distDir = resolve(tmpdir(), 'vietlatex-test', 'dist')

test('development IPC trusts only the configured loopback origin, including a non-default port', () => {
  const origin = 'http://127.0.0.1:57290'
  assert.equal(isTrustedDevRendererUrl(origin + '/index.html', origin), true)
  for (const url of ['http://127.0.0.1:5176', 'http://localhost:57290', 'https://127.0.0.1:57290', 'http://127.0.0.1.evil.test:57290', 'http://user:password@127.0.0.1:57290', 'invalid']) assert.equal(isTrustedDevRendererUrl(url, origin), false, url)
})

test('renderer protocol maps only same-origin paths into the built UI directory', () => {
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//${APP_HOST}/`), join(distDir, 'index.html'))
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//${APP_HOST}/assets/app.js`), join(distDir, 'assets', 'app.js'))
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//${APP_HOST}/assets/My%20Font.woff2`), join(distDir, 'assets', 'My Font.woff2'))
})

test('renderer protocol rejects other origins, malformed URLs, and paths outside the UI directory', () => {
  assert.equal(resolveRendererAssetPath(distDir, 'https://bundle/index.html'), null)
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//attacker/index.html`), null)
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//bundle:4317/index.html`), null)
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//bundle/%2e%2e%2fsecret.txt`), null)
  assert.equal(resolveRendererAssetPath(distDir, `${APP_SCHEME}//bundle/%5C%5Cserver%5Csecret.txt`), null)
  assert.equal(resolveRendererAssetPath(distDir, 'not a URL'), null)
})

test('renderer protocol serves GET requests only and returns generic not-found responses for unsafe paths', async () => {
  const served = []
  const handler = createRendererProtocolHandler({
    distDir,
    fetchFile: async filePath => { served.push(filePath); return new Response('ok') },
  })

  const response = await handler({ method: 'GET', url: `${APP_SCHEME}//bundle/assets/app.js` })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'ok')
  assert.deepEqual(served, [join(distDir, 'assets', 'app.js')])

  const rejectedMethod = await handler({ method: 'POST', url: `${APP_SCHEME}//bundle/index.html` })
  assert.equal(rejectedMethod.status, 405)
  assert.equal(served.length, 1)

  const rejectedPath = await handler({ method: 'GET', url: `${APP_SCHEME}//bundle/%2e%2e%2fsecret.txt` })
  assert.equal(rejectedPath.status, 404)
  assert.equal(await rejectedPath.text(), 'Not found')
  assert.equal(served.length, 1)
})

test('renderer protocol converts missing build files into a generic 404', async () => {
  const handler = createRendererProtocolHandler({ distDir, fetchFile: async () => { throw new Error('filesystem detail') } })
  const response = await handler({ method: 'GET', url: `${APP_SCHEME}//bundle/assets/missing.js` })
  assert.equal(response.status, 404)
  assert.equal(await response.text(), 'Not found')
})
