import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

// Measures uncached compile latency per document shape and throughput under
// duplicate/parallel load. Run with: npm run test:bench
const rounds = Math.max(1, Number(process.env.BENCH_ROUNDS) || 3)
const base = body => String.raw`\documentclass{article}\usepackage{fontspec}\begin{document}${body}\end{document}`
const bib = Buffer.from(String.raw`@book{knuth,author={Donald Knuth},title={The TeXbook},year={1984},publisher={Addison-Wesley}}`).toString('base64')
const cases = {
  single: { latex: base(String.raw`\section{A} Xin chào. $e^{i\pi}+1=0$`) },
  references: { latex: base(String.raw`\tableofcontents\section{A}\label{a} Xem mục \ref{a}.\section{B} Trang \pageref{a}.`) },
  bibliography: {
    latex: base(String.raw`\section{A} Theo \cite{knuth}.\bibliographystyle{plain}\bibliography{refs}`),
    assets: [{ filename: 'refs.bib', data: bib }],
  },
}

const backend = await startGoBackendForTests()
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  const report = {}
  for (const [name, { latex, assets = [] }] of Object.entries(cases)) {
    const times = []
    for (let round = 0; round < rounds; round++) {
      const start = performance.now()
      const pdf = await backend.compileLatex(latex, [], { assets, fresh: true })
      times.push(performance.now() - start)
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    }
    report[name] = { medianMs: Math.round(median(times)) }
  }

  const { concurrency } = (await backend.stats()).compiler
  const duplicateLatex = base(String.raw`Duplicate burst ${Date.now()}`)
  let start = performance.now()
  await Promise.all(Array.from({ length: concurrency }, () => backend.compileLatex(duplicateLatex)))
  report.duplicateBurst = { requests: concurrency, elapsedMs: Math.round(performance.now() - start) }

  start = performance.now()
  await Promise.all(Array.from({ length: concurrency }, (_, i) => backend.compileLatex(base(`Parallel ${i} ${Date.now()}`))))
  report.parallelDistinct = { requests: concurrency, elapsedMs: Math.round(performance.now() - start) }
  report.compiler = (await backend.stats()).compiler
  console.log(JSON.stringify(report, null, 2))
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(report, null, 2))

  // BENCH_ENFORCE=1 fails the run when compile speed regresses past the budget.
  if (process.env.BENCH_ENFORCE === '1') {
    const budget = JSON.parse(await readFile(new URL('./bench-budget.json', import.meta.url), 'utf8'))
    const failures = []
    const rows = []
    for (const [name, max] of Object.entries(budget.maxMs)) {
      const value = report[name].medianMs
      rows.push(`| ${name} | ${value} ms | ≤ ${max} ms |`)
      if (value > max) failures.push(`${name}: ${value} ms > ${max} ms`)
    }
    for (const [name, max] of Object.entries(budget.ratios)) {
      const ratio = report[name].medianMs / report.single.medianMs
      rows.push(`| ${name}/single | ${ratio.toFixed(2)}× | ≤ ${max}× |`)
      if (ratio > max) failures.push(`${name}/single: ${ratio.toFixed(2)}× > ${max}×`)
    }
    if (report.compiler.coalesced < budget.minCoalesced) failures.push(`coalesced ${report.compiler.coalesced} < ${budget.minCoalesced}`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      const table = ['## Compile benchmark', '', '| Metric | Value | Budget |', '|---|---|---|', ...rows, '', `Coalesced duplicates: ${report.compiler.coalesced}`, '']
      await appendFile(process.env.GITHUB_STEP_SUMMARY, table.join('\n'))
    }
    if (failures.length) {
      console.error(['Benchmark regression:', ...failures].join('\n  '))
      process.exitCode = 1
    }
  }
} finally {
  await backend.close()
}
