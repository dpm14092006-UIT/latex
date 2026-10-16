import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import en from 'dictionary-en'
import { SpellcheckEngine } from '../src/services/SpellcheckEngine.js'
import { latexSpellcheckSegments } from '../src/services/LatexSpellcheckScanner.js'

// Authored fixture vocabulary; mutations are generated independently of engine results.
const vocabulary = `the and this that these those there where which when what have has had can could would should will shall may might must not with without from into over under between before after through during about above below across against around because although however therefore also both either neither each every some many much more most other another such only even just still again together
research study method result analysis data model sample system function equation theorem proof definition conclusion introduction discussion experiment variable probability distribution hypothesis observation measurement comparison difference relationship structure process development information important particular different similar possible available necessary general special scientific mathematical physical chemical biological statistical computational numerical theoretical practical accurate approximate independent dependent positive negative increase decrease constant continuous discrete finite infinite linear complex simple random normal real value values number numbers theory space time point points line lines group groups table figure caption reference references article document section chapter abstract author language English spelling receive separate occurred definitely experiment knowledge example examples computer software application editor paragraph text paper color behavior center analyze organize realize recognize useful correct common standard public personal dictionary history memory performance source formula formulas algorithm algorithms evidence estimate estimates calculate calculation calculations solution solutions problem problems matrix vector derivative integral boundary condition conditions sample samples population populations significance significant average median variance correlation regression accuracy sensitivity specific precision recall training testing validation prediction classification representation optimization transformation differentiation integration convergence divergence coefficient parameter parameters dimensional dimension dimensions sequence series limit limits length width height distance direction magnitude energy force mass velocity acceleration temperature pressure volume density surface field fields input output control controls error errors change changes improvement improvements conclusion conclusions summary summaries purpose purposes technique techniques experiment experiments subject subjects object objects design designs implementation implementations operation operations protection failure success support supports production development practical application applications explanation explanations interpretation interpretations experimental reliable reproducible observed expected estimated measured`.split(/\s+/u)

const memoryBefore = process.memoryUsage().heapUsed
const loadStart = performance.now()
const checker = new SpellcheckEngine(en.aff.toString(), en.dic.toString())
const dictionaryLoadMs = performance.now() - loadStart
const unknownFixtureWords = vocabulary.filter(word => !checker.correct(word))
const known = vocabulary.filter(word => checker.correct(word))
const mutations = new Map()
for (let index = 0; mutations.size < 500 && index < vocabulary.length * 20; index++) {
  const original = vocabulary[index % vocabulary.length]
  const round = Math.floor(index / vocabulary.length)
  const position = (index * 7 + round) % Math.max(1, original.length - 1)
  let wrong
  switch (round % 4) {
    case 0: wrong = original.slice(0, position) + original[position + 1] + original[position] + original.slice(position + 2); break
    case 1: wrong = original.slice(0, position) + original.slice(position + 1); break
    case 2: wrong = original.slice(0, position) + 'q' + original.slice(position); break
    default: wrong = original.slice(0, position) + 'z' + original.slice(position + 1)
  }
  if (wrong.length >= 2 && wrong !== original && !mutations.has(wrong)) mutations.set(wrong, original)
}
assert.equal(mutations.size, 500)
let contextual = 0, detected = 0, top5 = 0
const failures = [], suggestionTimes = []
for (const [wrong, original] of mutations) {
  if (checker.correct(wrong)) { contextual++; continue }
  detected++
  const start = performance.now()
  const suggestions = checker.suggest(wrong)
  suggestionTimes.push(performance.now() - start)
  if (suggestions.includes(original)) top5++
  else failures.push({ wrong, original, suggestions })
}
const percentile95 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)] || 0
const scans = []
for (const count of [10_000, 50_000]) {
  const text = Array.from({ length: count }, (_, index) => known[index % known.length]).join(' ')
  const start = performance.now()
  const errors = checker.scan({ id: 'bench', text })
  scans.push({ words: count, durationMs: performance.now() - start, falsePositives: errors.length })
  assert.equal(errors.length, 0)
}
const unit = String.raw`\section{The research method} We receive the result. $x = recieve$ \cite{recieve} \textbf{A useful example}.` + '\n'
const source = unit.repeat(Math.ceil(800 * 1024 / unit.length)).slice(0, 800 * 1024)
const sourceStart = performance.now()
const sourceSegments = latexSpellcheckSegments(source)
const sourceLexerMs = performance.now() - sourceStart
const report = {
  platform: process.platform, node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemoryGiB: totalmem() / 1024 ** 3,
  dictionaryLoadMs, additionalHeapMiB: (process.memoryUsage().heapUsed - memoryBefore) / 1024 ** 2,
  corpus: { kind: 'synthetic fixture; not a representative real-world accuracy claim', mutations: mutations.size, contextualValidWords: contextual, outOfDictionaryDetected: detected, top5Hits: top5, top5Rate: top5 / detected, unknownCorrectFixtureWords: unknownFixtureWords },
  suggestionP95Ms: percentile95(suggestionTimes), scans, sourceBytes: source.length, sourceSegments: sourceSegments.length, sourceLexerMs,
  missedTop5: failures,
}
await mkdir('artifacts/spellcheck', { recursive: true })
await writeFile('artifacts/spellcheck/benchmark.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, missedTop5: failures.length }, null, 2))
assert.ok(scans[0].durationMs < 1000 && scans[1].durationMs < 3000, 'scan performance budget')
assert.ok(report.suggestionP95Ms < 250, 'suggestion performance budget')
assert.ok(report.corpus.top5Rate >= .85, 'synthetic correction coverage budget')
