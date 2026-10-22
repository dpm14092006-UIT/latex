import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

// Includes JSON serialization, HTTP parsing and PDF transfer, as the app does.
// Repeated requests must use cache without invoking XeLaTeX again.
const rounds = Math.max(3, Number(process.env.BENCH_ROUNDS) || 9)
const latex = String.raw`\documentclass{article}\usepackage{fontspec}\begin{document}Cached preview.\end{document}`
const backend = await startGoBackendForTests({ env: { VIETLATEX_WARM_TEX: 'off' } })
const report = { measuredAt: new Date().toISOString(), platform: process.platform, rounds, cases: {} }
if (process.env.VIETLATEX_TEST_BACKEND_EXE) {
  report.executable = process.env.VIETLATEX_TEST_BACKEND_EXE
  report.sha256 = createHash('sha256').update(await readFile(report.executable)).digest('hex')
}
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
try {
  for (const size of [0, 4 << 20, 20 << 20]) {
    const assets = []
    for (let remaining = size; remaining > 0;) {
      const bytes = Math.min(remaining, 10 << 20)
      assets.push({ filename: `asset-${assets.length}.txt`, data: Buffer.alloc(bytes, 120).toString('base64') })
      remaining -= bytes
    }
    const compile = () => backend.compileLatex(latex, [], { assets })
    assert.equal((await compile()).subarray(0, 5).toString(), '%PDF-')
    // One unmeasured repeat settles client/server buffers before sampling.
    await compile()
    const before = await backend.stats()
    const samples = []
    let peakObservedHeapBytes = 0
    for (let index = 0; index < rounds; index++) {
      const started = performance.now()
      const pdf = await compile()
      samples.push(performance.now() - started)
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
      peakObservedHeapBytes = Math.max(peakObservedHeapBytes, (await backend.stats()).system.backendHeapBytes)
    }
    const after = await backend.stats()
    assert.equal(after.compiler.completed, before.compiler.completed, 'cache repeats invoked compiler')
    assert.equal(after.compiler.cacheHits - before.compiler.cacheHits, rounds)
    report.cases[`${size >> 20}MiB`] = {
      medianMs: +percentile(samples, 0.5).toFixed(2),
      p95Ms: +percentile(samples, 0.95).toFixed(2),
      samplesMs: samples.map(value => +value.toFixed(2)),
      peakObservedGoHeapMiB: +(peakObservedHeapBytes / (1 << 20)).toFixed(2),
      cacheHits: rounds,
    }
  }
  console.log(JSON.stringify(report, null, 2))
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(report, null, 2))
} finally {
  await backend.close()
}
