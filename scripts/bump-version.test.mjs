import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyVersion, nextVersion } from './bump-version.mjs'

test('nextVersion supports semantic increments and explicit versions', () => {
  assert.equal(nextVersion('0.5.6', 'patch'), '0.5.7')
  assert.equal(nextVersion('0.5.6', 'minor'), '0.6.0')
  assert.equal(nextVersion('0.5.6', 'major'), '1.0.0')
  assert.equal(nextVersion('0.5.6', 'v0.5.10'), '0.5.10')
  assert.throws(() => nextVersion('0.5.6', '0.5.6'), /lớn hơn/)
  assert.throws(() => nextVersion('0.5.6', '0.4.9'), /lớn hơn/)
  assert.throws(() => nextVersion('0.5.6', 'beta'))
})

test('applyVersion changes only the app version in package.json and the lockfile root', async () => {
  const pkgText = await readFile(new URL('../package.json', import.meta.url), 'utf8')
  const lockText = await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
  const current = JSON.parse(pkgText).version
  const same = applyVersion(pkgText, lockText, current)
  assert.equal(same.pkgText, pkgText, 'formatting is preserved')
  assert.equal(same.lockText, lockText, 'formatting is preserved')
  const next = applyVersion(pkgText, lockText, '9.9.9')
  const lock = JSON.parse(next.lockText), before = JSON.parse(lockText)
  assert.equal(JSON.parse(next.pkgText).version, '9.9.9')
  assert.equal(lock.version, '9.9.9')
  assert.equal(lock.packages[''].version, '9.9.9')
  for (const [path, entry] of Object.entries(before.packages)) if (path) assert.equal(lock.packages[path].version, entry.version)
})
