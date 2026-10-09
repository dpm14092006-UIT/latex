// Sustained mixed-load test for the Go backend: many clients with retry/backoff, cache hits,
// mid-flight cancellations, malformed and unauthorized requests, and a responsiveness probe.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const CLIENTS = Number(process.env.STRESS_CLIENTS || 24)
const REQUESTS_PER_CLIENT = Number(process.env.STRESS_REQUESTS || 6)
const MAX_RETRIES = Number(process.env.STRESS_MAX_RETRIES || 240)
const source = text => String.raw`\documentclass{article}\usepackage{amsmath}\begin{document}\section{Stress}${text}\[\sum_{i=1}^{n} i = \frac{n(n+1)}{2}\]\end{document}`
const testTempRoot = await mkdtemp(join(tmpdir(), 'vietlatex-stress-owned-'))
const tempDirs = () => readdirSync(testTempRoot).filter(name => name.startsWith('viet-latex-') || name.startsWith('vietlatex-word-')).length
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : 0

const tempBefore = tempDirs()
const backend = await startGoBackendForTests({ env: { TMP: testTempRoot, TEMP: testTempRoot, TMPDIR: testTempRoot } })
const stats = async () => (await backend.stats()).compiler
const latencies = []
const healthLatencies = []
const peaks = { active: 0, queued: 0, admitted: 0, cacheBytes: 0, backendHeapBytes: 0, goroutines: 0, requestBodyBytesInFlight: 0 }
let completed = 0, retries = 0, cancelled = 0, rejectedInvalid = 0, shedInvalid = 0
const failures = []

async function compileWithRetry(latex) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const started = performance.now()
    try {
      const pdf = await backend.compileLatex(latex)
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
      latencies.push(performance.now() - started)
      completed++
      return
    } catch (error) {
      if (error.status !== 503) throw error
      retries++
      await delay(150 + Math.random() * 350)
    }
  }
  throw new Error('Gave up after ' + MAX_RETRIES + ' retries under load')
}

async function client(id) {
  for (let i = 0; i < REQUESTS_PER_CLIENT; i++) {
    const roll = (id * 31 + i * 17) % 10
    try {
      if (roll === 0) {
        // Cancel mid-flight: the queue slot must be released.
        const controller = new AbortController()
        const pending = backend.compileLatex(source(`Cancel ${id}-${i}`), [], { signal: controller.signal })
          .then(() => null, error => error.name === 'AbortError' || error.status === 503 ? null : error)
        await delay(20 + Math.random() * 200)
        controller.abort()
        const unexpected = await pending
        if (unexpected) throw unexpected
        cancelled++
      } else if (roll === 1) {
        // Invalid input is rejected, or may be shed with 503 if heavy-request admission is full.
        const error = await backend.compileLatex(source('x'), [{ filename: '../evil.png', data: 'AAAA' }]).then(() => null, cause => cause)
        if (error?.status === 400) rejectedInvalid++
        else if (error?.status === 503) shedInvalid++
        else throw error || new Error('Invalid assets were unexpectedly accepted.')
      } else if (roll <= 4) {
        await compileWithRetry(source(`Shared cached document ${roll}`))
      } else {
        await compileWithRetry(source(`Unique document ${id}-${i} ${'lorem ipsum '.repeat(40)}`))
      }
    } catch (error) {
      failures.push(`${id}-${i}: ${error.message}`)
    }
  }
}

let probing = true
async function probeHealth() {
  while (probing) {
    const started = performance.now()
    const sample = await backend.stats()
    const { compiler, system } = sample
    for (const key of ['active', 'queued', 'admitted', 'cacheBytes']) peaks[key] = Math.max(peaks[key], compiler[key])
    for (const key of ['backendHeapBytes', 'goroutines', 'requestBodyBytesInFlight']) peaks[key] = Math.max(peaks[key], system[key])
    assert.ok(system.requestBodyBytesInFlight <= system.requestBodyBudgetBytes, 'request body memory budget must stay bounded')
    assert.ok(compiler.queued <= compiler.maxQueue, 'waiting queue must stay bounded')
    assert.ok(compiler.cacheBytes <= 32 * 1024 * 1024, 'PDF cache must stay bounded')
    if (process.env.VIETLATEX_COMPILE_WORKERS) {
      assert.ok(compiler.active <= compiler.concurrency, 'fixed worker count must be respected')
      assert.ok(compiler.admitted <= compiler.concurrency + compiler.maxQueue, 'heavy request admission must stay bounded')
    }
    healthLatencies.push(performance.now() - started)
    await delay(100)
  }
}

try {
  const start = performance.now()
  const probe = probeHealth()
  await Promise.all(Array.from({ length: CLIENTS }, (_, id) => client(id)))
  probing = false
  await probe
  const elapsed = (performance.now() - start) / 1000

  // Unauthorized requests must be refused.
  const unauthorized = await fetch(`${backend.baseUrl}/api/compile`, { method: 'POST', body: '{}' })
  assert.equal(unauthorized.status, 401)
  await delay(300)
  const final = await stats()
  const tempAfter = tempDirs()
  const tempDirDeltaBeforeClose = tempAfter - tempBefore
  const warmIdleTempDirs = Math.min(Math.max(0, tempDirDeltaBeforeClose), final.warmIdle)
  const leakedTempDirs = Math.max(0, tempDirDeltaBeforeClose - warmIdleTempDirs)
  const report = {
    clients: CLIENTS,
    requests: CLIENTS * REQUESTS_PER_CLIENT,
    completed, retries503: retries, cancelled, rejectedInvalid, invalidLoadShed: shedInvalid, failures: failures.length,
    elapsedSeconds: Number(elapsed.toFixed(1)),
    throughputPdfPerSecond: Number((completed / elapsed).toFixed(2)),
    compileMs: { p50: Math.round(percentile(latencies, 0.5)), p95: Math.round(percentile(latencies, 0.95)), max: Math.round(Math.max(0, ...latencies)) },
    healthMs: { p50: Math.round(percentile(healthLatencies, 0.5)), p95: Math.round(percentile(healthLatencies, 0.95)), max: Math.round(Math.max(0, ...healthLatencies)) },
    tempDirDeltaBeforeClose,
    warmIdleProcesses: final.warmIdle,
    warmIdleTempDirs,
    leakedTempDirs,
    peaks,
    backend: final,
  }
  console.log(JSON.stringify(report, null, 2))
  if (failures.length) console.error(failures.slice(0, 10).join('\n'))
  assert.equal(failures.length, 0, 'no request may fail unexpectedly')
  assert.equal(final.active, 0, 'no compile may be left running')
  assert.equal(final.queued, 0, 'no compile may be left queued')
  assert.equal(final.admitted, 0, 'no HTTP admission slot may leak')
  assert.equal((await backend.stats()).system.requestBodyBytesInFlight, 0, 'no request body budget reservation may leak')
  assert.ok(final.cacheHits > 0, 'repeated documents should hit the cache')
  assert.ok(percentile(healthLatencies, 0.95) < 500, 'health endpoint must stay responsive under load')
  assert.equal(leakedTempDirs, 0, 'only the backend\'s warm idle directories may remain before shutdown')
} finally {
  probing = false
  await backend.close()
}

const tempAfterClose = tempDirs()
const tempDirDeltaAfterClose = tempAfterClose - tempBefore
console.log(JSON.stringify({ tempDirsAfterBackendClose: tempAfterClose, tempDirDeltaAfterClose }, null, 2))
assert.equal(dirname(resolve(testTempRoot)), resolve(tmpdir()))
assert.ok(basename(testTempRoot).startsWith('vietlatex-stress-owned-'))
await rm(testTempRoot, { recursive: true, force: true })
assert.equal(tempDirDeltaAfterClose, 0, 'all backend temporary directories must be cleaned up after shutdown')
console.log('STRESS OK')
