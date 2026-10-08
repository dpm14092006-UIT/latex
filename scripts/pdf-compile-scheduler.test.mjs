import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateSourcePages, PdfCompileScheduler } from '../src/services/PdfCompileScheduler.js'

const input = (source, extra = {}) => ({ id: 'doc', source, pageCount: 1, images: [], assets: [], blocked: '', ...extra })
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
function fixture() {
  let time = 0, sequence = 0
  const timers = new Map(), jobs = [], states = []
  const scheduler = new PdfCompileScheduler({
    now: () => time,
    setTimer: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id },
    clearTimer: id => timers.delete(id),
    onState: state => states.push(state),
    compile: (source, images, signal, assets, fresh) => new Promise((resolve, reject) => jobs.push({ source, images, signal, assets, fresh, resolve, reject })),
  })
  const advance = async ms => {
    const target = time + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush()
    }
    time = target
    await flush()
  }
  return { scheduler, jobs, states, advance }
}

test('first trusted document is compiled after idle and small edits wait 60 seconds', async () => {
  const f = fixture()
  f.scheduler.update(input('first'))
  await f.advance(4999)
  assert.equal(f.jobs.length, 0)
  await f.advance(1)
  f.jobs[0].resolve(new Blob(['initial'])); await flush()
  await f.advance(56300)
  f.scheduler.update(input('small change'))
  await f.advance(4999)
  assert.equal(f.jobs.length, 1)
  await f.advance(1)
  assert.equal(f.jobs.length, 1, 'one-page text edit uses the small-edit fallback')
  await f.advance(55000)
  assert.equal(f.jobs.length, 2)
  assert.equal(f.jobs[1].source, 'small change')
  f.scheduler.dispose()
})

test('two-page threshold uses editor pagination; automatic runs stay 30 seconds apart', async () => {
  const f = fixture()
  f.scheduler.update(input('page one'))
  await f.advance(5000)
  f.jobs[0].resolve(new Blob(['one'])); await flush()
  f.scheduler.update(input('two pages added', { pageCount: 3 }))
  await f.advance(29999)
  assert.equal(f.jobs.length, 1)
  await f.advance(1)
  f.jobs[1].resolve(new Blob(['three'])); await flush()
  f.scheduler.update(input('four more pages', { pageCount: 5 }))
  await f.advance(29999)
  assert.equal(f.jobs.length, 2)
  await f.advance(1)
  assert.equal(f.jobs.length, 3)
  f.scheduler.dispose()
})

test('source-edited documents estimate page thresholds from raw LaTeX length', () => {
  assert.equal(estimateSourcePages(''), 1)
  assert.equal(estimateSourcePages('x'.repeat(3000)), 1)
  assert.equal(estimateSourcePages('x'.repeat(3001)), 2)
  assert.equal(estimateSourcePages('x'.repeat(6001)), 3)
})

test('one-page mode triggers for one newly laid-out editor page', async () => {
  const f = fixture()
  f.scheduler.setMode('manual')
  const first = f.scheduler.request(input('one page'))
  f.jobs[0].resolve(new Blob(['one'])); await first
  f.scheduler.update(input('two pages', { pageCount: 2 }))
  f.scheduler.setMode('1')
  await f.advance(29999)
  assert.equal(f.jobs.length, 1)
  await f.advance(1)
  assert.equal(f.jobs.length, 2)
  f.scheduler.dispose()
})

test('manual mode never schedules automatically but an explicit request runs immediately', async () => {
  const f = fixture()
  f.scheduler.setMode('manual')
  f.scheduler.update(input('one page'))
  await f.advance(120000)
  assert.equal(f.jobs.length, 0)
  const pending = f.scheduler.request(input('latest'))
  assert.equal(f.jobs.length, 1)
  const blob = new Blob(['manual'])
  f.jobs[0].resolve(blob)
  assert.equal(await pending, blob)
  f.scheduler.dispose()
})

test('typing never cancels active compile; only newest pending revision is compiled', async () => {
  const f = fixture()
  const exportPromise = f.scheduler.request(input('first'))
  f.scheduler.update(input('second'))
  f.scheduler.update(input('third'))
  assert.equal(f.jobs.length, 1)
  assert.equal(f.jobs[0].signal.aborted, false)
  f.jobs[0].resolve(new Blob(['old'])); await flush()
  assert.equal(f.jobs.length, 2)
  assert.equal(f.jobs[1].source, 'third')
  const latest = new Blob(['latest'])
  f.jobs[1].resolve(latest)
  assert.equal(await exportPromise, latest)
  assert.equal(f.states.at(-1).status, 'ready')
  f.scheduler.dispose()
})

test('automatic work publishes stale preview and backs off for one-page edits', async () => {
  const f = fixture()
  f.scheduler.update(input('one page'))
  await f.advance(5000)
  f.jobs[0].resolve(new Blob(['previous'])); await flush()
  f.scheduler.update(input('one page with small edit'))
  assert.equal(f.states.at(-1).status, 'dirty')
  assert.equal(f.states.at(-1).stale, true)
  await f.advance(59999)
  assert.equal(f.jobs.length, 1)
  await f.advance(1)
  assert.equal(f.jobs.length, 2)
  f.scheduler.dispose()
})

test('switching document aborts previous export and does not show its late PDF', async () => {
  const f = fixture()
  const old = f.scheduler.request(input('first'))
  const rejected = assert.rejects(old, { name: 'AbortError' })
  f.scheduler.update(input('other', { id: 'other' }))
  assert.equal(f.jobs[0].signal.aborted, true)
  f.jobs[0].resolve(new Blob(['wrong document'])); await flush()
  await rejected
  assert.equal(f.states.at(-1).blob, null)
  f.scheduler.dispose()
})

test('trust gate prevents manual, automatic and in-flight exports', async () => {
  const f = fixture()
  const pending = f.scheduler.request(input('first'))
  const rejected = assert.rejects(pending, /untrusted/)
  f.scheduler.update(input('first', { blocked: 'untrusted' }))
  await rejected
  f.jobs[0].resolve(new Blob(['blocked'])); await flush()
  await assert.rejects(f.scheduler.request(input('first', { blocked: 'untrusted' })), /untrusted/)
  await f.advance(120000)
  assert.equal(f.jobs.length, 1)
  assert.equal(f.states.at(-1).status, 'blocked')
  f.scheduler.dispose()
})

test('errors do not cause automatic retry storms; manual retry can bypass cache', async () => {
  const f = fixture()
  const pending = f.scheduler.request(input('bad'))
  const rejected = assert.rejects(pending, /busy/)
  f.jobs[0].reject(new Error('busy')); await rejected
  await f.advance(120000)
  assert.equal(f.jobs.length, 1)
  const retry = f.scheduler.request(input('bad'), { fresh: true })
  assert.equal(f.jobs[1].fresh, true)
  f.jobs[1].resolve(new Blob(['ok'])); await retry
  f.scheduler.dispose()
})

test('asset changes invalidate PDF; repeated export reuses a matching PDF', async () => {
  const f = fixture()
  const original = input('same', { assets: [{ filename: 'image.png', data: 'old' }] })
  const pending = f.scheduler.request(original)
  const blob = new Blob(['pdf'])
  f.jobs[0].resolve(blob); await pending
  assert.equal(await f.scheduler.request(original), blob)
  assert.equal(f.jobs.length, 1)
  const edited = input('same', { assets: [{ filename: 'image.png', data: 'new' }] })
  f.scheduler.update(edited)
  assert.equal(f.states.at(-1).stale, true)
  const next = f.scheduler.request(edited)
  f.jobs[1].resolve(new Blob(['new'])); await next
  f.scheduler.dispose()
})

test('reverting an edit reuses current PDF and cancels scheduled work', async () => {
  const f = fixture()
  const pending = f.scheduler.request(input('original'))
  f.jobs[0].resolve(new Blob(['pdf'])); await pending
  f.scheduler.update(input('different'))
  f.scheduler.update(input('original'))
  f.scheduler.update(input('original', { pageCount: 10 }))
  await f.advance(120000)
  assert.equal(f.jobs.length, 1)
  assert.equal(f.states.at(-1).status, 'ready')
  f.scheduler.dispose()
})
