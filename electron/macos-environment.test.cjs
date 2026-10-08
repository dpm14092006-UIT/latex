const test = require('node:test')
const assert = require('node:assert/strict')
const { backendEnvironment } = require('./macos-environment.cjs')

test('Finder environment finds bundled TeX and keeps caches outside Applications', () => {
  const env = backendEnvironment({ appPath: '/Applications/Viết.app/Contents/Resources/app.asar', resourcesPath: '/Applications/Viết.app/Contents/Resources', home: '/Users/test', env: { PATH: '/usr/bin:/bin' } })
  assert.equal(env.PATH.split(':')[0], '/Applications/Viết.app/Contents/Resources/tex/bin/universal-darwin')
  assert.ok(env.PATH.includes('/Library/TeX/texbin'))
  assert.ok(env.PATH.includes('/opt/homebrew/bin'))
  assert.ok(env.TEXMFVAR.startsWith('/Users/test/Library/Caches/'))
  assert.ok(env.TEXMFCONFIG.startsWith('/Users/test/Library/Application Support/'))
})

test('custom TeX and shell environment remain available without duplicate PATH entries', () => {
  const env = backendEnvironment({ appPath: '/tmp/source', home: '/Users/test', env: { XELATEX_PATH: '/custom tex/bin/xelatex', PATH: '/usr/bin:/usr/bin', TEXMFVAR: '/tmp/cache', LANG: 'vi_VN.UTF-8' } })
  assert.equal(env.PATH.split(':')[0], '/custom tex/bin')
  assert.equal(env.PATH.split(':').filter(path => path === '/usr/bin').length, 1)
  assert.ok(env.PATH.includes('/tmp/source/tools/tex/bin/universal-darwin'))
  assert.equal(env.TEXMFVAR, '/tmp/cache')
  assert.equal(env.LANG, 'vi_VN.UTF-8')
})
