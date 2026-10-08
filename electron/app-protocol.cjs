const { isAbsolute, relative, resolve, sep } = require('node:path')

const APP_SCHEME = 'vietlatex:'
const APP_HOST = 'bundle'

function resolveRendererAssetPath(distDir, rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== APP_SCHEME || url.host !== APP_HOST || url.username || url.password || url.port) return null

    const pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\\') || pathname.includes('\0')) return null
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    if (!relativePath) return null

    const root = resolve(distDir)
    const assetPath = resolve(root, relativePath)
    const fromRoot = relative(root, assetPath)
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null
    return assetPath
  } catch {
    return null
  }
}

function createRendererProtocolHandler({ distDir, fetchFile, ResponseClass = Response }) {
  return async function handleRendererRequest(request) {
    if (request.method !== 'GET') return new ResponseClass('Method not allowed', { status: 405 })

    const assetPath = resolveRendererAssetPath(distDir, request.url)
    if (!assetPath) return new ResponseClass('Not found', { status: 404 })

    try {
      return await fetchFile(assetPath)
    } catch {
      return new ResponseClass('Not found', { status: 404 })
    }
  }
}

function isTrustedDevRendererUrl(rawUrl, configuredUrl) {
  try {
    const url = new URL(rawUrl)
    const configured = new URL(configuredUrl)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.origin === configured.origin
  } catch { return false }
}

module.exports = { APP_HOST, APP_SCHEME, createRendererProtocolHandler, resolveRendererAssetPath, isTrustedDevRendererUrl }
