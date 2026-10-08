import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, process.env.FULL_CHECK_OUTPUT || 'artifacts/full-check')
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this suite using npm run check:full.')
await mkdir(output, { recursive: true })

// Keep browser/Electron suites sequential: some use the same Vite port,
// and performance budgets need an otherwise idle test machine.
const suites = [
  { name: 'check' },
  { name: 'test:go:race' },
  { name: 'smoke:math-paste' },
  { name: 'smoke:latex' },
  { name: 'smoke:serializer' },
  { name: 'test:ui' },
  { name: 'image-captions-ui', args: ['scripts/image-captions-ui.mjs'] },
  { name: 'test:project-tabs' },
  { name: 'test:project-pdf' },
  { name: 'test:pdf-batching' },
  { name: 'test:citation-scan' },
  { name: 'test:review-fixes' },
  { name: 'formula-recognition-ui', args: ['scripts/formula-recognition-ui.mjs'] },
  { name: 'test:desktop' },
  { name: 'test:sync:desktop' },
  { name: 'test:quit-failure' },
  { name: 'test:desktop:dist' },
  { name: 'test:headings' },
  { name: 'test:dark-text' },
  { name: 'test:load', env: { VIETLATEX_COMPILE_WORKERS: '4' } },
  { name: 'test:stress', env: { STRESS_CLIENTS: '64', STRESS_REQUESTS: '8', VIETLATEX_COMPILE_WORKERS: '4' } },
  { name: 'test:bench', env: { BENCH_ENFORCE: '1', BENCH_ROUNDS: '5', BENCH_OUTPUT: join(output, 'benchmark.json'), VIETLATEX_COMPILE_WORKERS: '4' } },
  { name: 'audit', args: [npmCli, 'audit', '--audit-level=low'] },
]

const only = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',')
let report = { startedAt: new Date().toISOString(), platform: process.platform, node: process.version, results: [] }
if (only) {
  if (only.some(name => !suites.some(suite => suite.name === name))) throw new Error('Unknown suite in --only.')
  report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))
  if (!report.finishedAt) throw new Error('Wait for the full run to finish before rechecking selected suites.')
  delete report.finishedAt
  delete report.summary
}
for (const suite of suites.filter(suite => !only || only.includes(suite.name))) {
  const logPath = join(output, `${suite.name.replaceAll(':', '-')}.log`)
  const previous = report.results.find(result => result.name === suite.name)
  const history = previous?.previousAttempts || []
  if (previous) {
    const { previousAttempts: _previousAttempts, ...attempt } = previous
    if (previous.logPath) {
      const archivedLog = `${previous.logPath}.${Date.now()}.previous`
      await rename(previous.logPath, archivedLog).catch(error => { if (error.code !== 'ENOENT') throw error })
      attempt.logPath = archivedLog
    }
    history.push(attempt)
  }
  const record = result => {
    const entry = { ...result, ...(history.length ? { previousAttempts: history } : {}) }
    const index = report.results.findIndex(result => result.name === suite.name)
    if (index < 0) report.results.push(entry)
    else report.results[index] = entry
  }
  if (suite.skip) {
    console.log(`SKIP ${suite.name}: ${suite.skip}`)
    record({ name: suite.name, status: 'skipped', reason: suite.skip })
  } else {
    console.log(`RUN  ${suite.name}`)
    const started = performance.now()
    const log = createWriteStream(logPath)
    const result = await new Promise(done => {
      const child = spawn(process.execPath, suite.args || [npmCli, 'run', suite.name], {
        cwd: root, env: { ...process.env, ...suite.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.pipe(log, { end: false })
      child.stderr.pipe(log, { end: false })
      let spawnError
      child.once('error', error => { spawnError = error.message })
      child.once('close', (code, signal) => log.end(() => done({ code, signal, ...(spawnError ? { error: spawnError } : {}) })))
    })
    const status = result.code === 0 ? 'passed' : 'failed'
    record({ name: suite.name, status, durationMs: Math.round(performance.now() - started), logPath, ...result })
    console.log(`${status === 'passed' ? 'PASS' : 'FAIL'} ${suite.name} (${Math.round((performance.now() - started) / 1000)} s) — ${logPath}`)
  }
  // Persist after every suite so an interrupted run retains its evidence.
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
}
report.finishedAt = new Date().toISOString()
report.summary = Object.fromEntries(['passed', 'failed', 'skipped'].map(status => [status, report.results.filter(result => result.status === status).length]))
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.summary))
if (report.summary.failed) process.exitCode = 1
