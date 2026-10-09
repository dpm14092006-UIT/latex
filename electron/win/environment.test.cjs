const test = require('node:test')
const assert = require('node:assert/strict')
const { delimiter, join } = require('node:path')
const { backendEnvironment } = require('./environment.cjs')

test('Windows environment keeps PATH and appends MiKTeX once', () => {
  const local = join('C:', 'Users', 'u', 'AppData', 'Local')
  const miktex = join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64')
  const system = join('C:', 'Windows')
  const env = backendEnvironment({ env: { Path: [system, miktex].join(delimiter), LOCALAPPDATA: local, OTHER: '1' } })
  assert.equal(env.OTHER, '1')
  assert.deepEqual(env.Path.split(delimiter), [system, miktex])
  assert.equal(env.PATH, undefined, 'does not add a second PATH key')
})
