const assert = require('node:assert/strict')
const { mkdtemp, rm, writeFile, utimes, access } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')
const { createWorkspaceStore } = require('./workspace-store.cjs')

test('invalid saves preserve the last readable workspace and allow subsequent writes', async t => {
  const userData = await mkdtemp(join(tmpdir(), 'vietlatex-workspace-invalid-'))
  t.after(() => rm(userData, { recursive: true, force: true }))
  const store = createWorkspaceStore({ getPath: () => userData })
  const original = { version: 1, projects: [{ id: 'original' }] }
  await store.save(original)
  for (const invalid of [{ version: 1 }, { version: 1, projects: [] }, { version: 1, projects: 'broken' }]) {
    await assert.rejects(async () => store.save(invalid), /không hợp lệ/)
    assert.deepEqual(await store.load(), original)
  }
  const next = { version: 1, projects: [{ id: 'next' }] }
  await store.save(next)
  assert.deepEqual(await store.load(), next)
})

test('workspace startup removes only old atomic-write leftovers', async t => {
  const userData = await mkdtemp(join(tmpdir(), 'vietlatex-workspace-store-'))
  t.after(() => rm(userData, { recursive: true, force: true }))

  const workspace = { version: 1, projects: [{ id: 'project-1' }] }
  await writeFile(join(userData, 'workspace-v1.json'), JSON.stringify(workspace))

  const staleTemp = join(userData, `workspace-v1.json.1234.${randomUUID()}.tmp`)
  const recentTemp = join(userData, `workspace-v1.json.1234.${randomUUID()}.tmp`)
  const unrelated = join(userData, 'workspace-v1.json.notes.tmp')
  await Promise.all([writeFile(staleTemp, 'incomplete'), writeFile(recentTemp, 'still recent'), writeFile(unrelated, 'keep')])
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  await utimes(staleTemp, old, old)

  const store = createWorkspaceStore({ getPath: () => userData })
  assert.deepEqual(await store.load(), workspace)
  await assert.rejects(access(staleTemp), { code: 'ENOENT' })
  await access(recentTemp)
  await access(unrelated)
})
