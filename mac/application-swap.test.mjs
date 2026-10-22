import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { applicationRecoveryPaths, replaceApplication } from './application-swap.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'vietlatex-app-swap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = Object.fromEntries(['installed', 'staged', 'previous', 'rejected'].map(key => [key, join(root, `${key}.app`)]))
  for (const [path, text] of [[paths.installed, 'old app'], [paths.staged, 'new app']]) {
    await mkdir(path); await writeFile(join(path, 'bundle.txt'), text)
  }
  return paths
}
const contents = path => readFile(join(path, 'bundle.txt'), 'utf8')

test('homes on another device retain atomic swap paths beside the installed app', () => {
  const installed = join('Applications', 'Studio.app'), backup = join('External Home', 'Backup')
  const local = applicationRecoveryPaths({ installed, backup, stamp: 'test', sameDevice: true })
  assert.equal(local.previous, join(backup, 'previous.app'))
  assert.equal(local.archiveCopyRequired, false)
  const external = applicationRecoveryPaths({ installed, backup, stamp: 'test', sameDevice: false })
  assert.equal(dirname(external.previous), dirname(installed))
  assert.equal(dirname(external.rejected), dirname(installed))
  assert.equal(external.archivedPrevious, join(backup, 'previous.app'))
  assert.equal(external.archiveCopyRequired, true)
})

test('verified application replacement retains the exact previous app', async t => {
  const paths = await fixture(t)
  await replaceApplication({ ...paths, verify: async path => assert.equal(await contents(path), 'new app') })
  assert.equal(await contents(paths.installed), 'new app')
  assert.equal(await contents(paths.previous), 'old app')
  await assert.rejects(lstat(paths.rejected), { code: 'ENOENT' })
})

test('verification failure restores the old app and preserves rejected bundle for diagnosis', async t => {
  const paths = await fixture(t)
  await assert.rejects(replaceApplication({ ...paths, verify: async () => { throw new Error('signature mismatch') } }), /đã khôi phục ứng dụng cũ.*signature mismatch/u)
  assert.equal(await contents(paths.installed), 'old app')
  assert.equal(await contents(paths.rejected), 'new app')
  await assert.rejects(lstat(paths.previous), { code: 'ENOENT' })
})

test('existing recovery copies and missing stage are rejected before moving the old app', async t => {
  const paths = await fixture(t)
  await mkdir(paths.previous)
  await assert.rejects(replaceApplication({ ...paths, verify: async () => {} }), /đã tồn tại/u)
  assert.equal(await contents(paths.installed), 'old app')
  await rm(paths.previous, { recursive: true })
  await rm(paths.staged, { recursive: true })
  await assert.rejects(replaceApplication({ ...paths, verify: async () => {} }), { code: 'ENOENT' })
  assert.equal(await contents(paths.installed), 'old app')
})

test('overlapping paths never move or overwrite installed data', async t => {
  const paths = await fixture(t)
  await assert.rejects(replaceApplication({ ...paths, previous: join(paths.installed, 'backup'), verify: async () => {} }), /phải tách biệt/u)
  assert.equal(await contents(paths.installed), 'old app')
})

test('symlink stages never move or overwrite installed data', { skip: process.platform === 'win32' }, async t => {
  const paths = await fixture(t)
  const target = paths.staged + '.target'
  await mkdir(target)
  await rm(paths.staged, { recursive: true })
  await symlink(target, paths.staged, 'dir')
  await assert.rejects(replaceApplication({ ...paths, verify: async () => {} }), /thư mục thật/u)
  assert.equal(await contents(paths.installed), 'old app')
})
