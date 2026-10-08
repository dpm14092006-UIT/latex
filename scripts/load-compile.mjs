import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import { startGoBackendForTests } from './go-backend-test-client.mjs'
const source = text => String.raw`\documentclass{article}\begin{document}${text}\end{document}`
const backend = await startGoBackendForTests()
const stats = async () => (await backend.stats()).compiler
try {
const { concurrency, maxQueue } = await stats()
const capacity = concurrency + maxQueue
const burst = capacity + 6
const start = performance.now()
const results = await Promise.allSettled(Array.from({ length: burst }, (_, i) => backend.compileLatex(source(`Load test ${i}`))))
const accepted = results.filter(r => r.status === 'fulfilled')
const rejected = results.filter(r => r.status === 'rejected')
assert.equal(accepted.length, capacity)
assert.equal(rejected.length, burst - capacity)
assert.ok(rejected.every(r => r.reason.status === 503))
assert.ok(accepted.every(r => r.value.subarray(0, 5).toString() === '%PDF-'))
const elapsed = performance.now() - start
const cacheStart = performance.now()
await backend.compileLatex(source('Load test 0'))
const cacheMs = performance.now() - cacheStart
assert.equal((await stats()).cacheHits, 1)
const controller = new AbortController()
const cancelled = backend.compileLatex(source('Cancelled document'), [], { signal: controller.signal })
const check = assert.rejects(cancelled, { name: 'AbortError' })
await delay(50)
controller.abort()
await check
const unaffected = await backend.compileLatex(source('Unaffected document'))
assert.equal(unaffected.subarray(0, 5).toString(), '%PDF-')
console.log(JSON.stringify({ burst, accepted: accepted.length, rejected: rejected.length, elapsedMs: Math.round(elapsed), cacheMs: Number(cacheMs.toFixed(2)), stats: await stats() }, null, 2))
} finally {
await backend.close()
}
