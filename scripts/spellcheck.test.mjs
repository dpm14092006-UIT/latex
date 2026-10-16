import assert from 'node:assert/strict'
import test from 'node:test'
import en from 'dictionary-en'
import gb from 'dictionary-en-gb'
import { SpellcheckEngine } from '../src/services/SpellcheckEngine.js'
import { spellcheckTokens } from '../src/services/SpellcheckTokenizer.js'
import { parsePersonalWords, sanitizeSpellcheckSettings, sanitizePersonalWords } from '../src/services/SpellcheckSettings.js'
import { sanitizeSettings } from '../src/services/DocumentSettings.js'
import { createTask, createProject, sanitizeWorkspace } from '../src/services/WorkspaceData.js'
import { workspaceRecords, recordsWorkspace } from '../src/services/LanSyncData.js'

const us = new SpellcheckEngine(en.aff.toString(), en.dic.toString())
const uk = new SpellcheckEngine(gb.aff.toString(), gb.dic.toString())
test('English dictionaries find common typos, retain case and offer actual corrections', () => {
  for (const [wrong, right] of [['recieve', 'receive'], ['teh', 'the'], ['seperate', 'separate'], ['occured', 'occurred'], ['definately', 'definitely']]) {
    assert.equal(us.correct(wrong), false, wrong)
    assert.ok(us.suggest(wrong).includes(right), `${wrong}: ${us.suggest(wrong)}`)
  }
  for (const word of ['receive', 'The', 'THE', "don't", 'don’t', "researcher's", 'well-known']) assert.equal(us.correct(word), true, word)
  assert.equal(us.correct('Recieve'), false)
  assert.equal(us.correct('color'), true); assert.equal(us.correct('colour'), false)
  assert.equal(uk.correct('colour'), true); assert.equal(uk.correct('color'), false)
})
test('personal literal words preserve casing and do not silently learn a dictionary flag', () => {
  const custom = new SpellcheckEngine(en.aff.toString(), en.dic.toString(), ['VietLaTeX', 'quasifrobnicator'])
  assert.equal(custom.correct('VietLaTeX'), true)
  assert.equal(custom.correct('vietlatex'), false)
  assert.equal(custom.correct('Quasifrobnicator'), true)
  assert.equal(custom.correct('QUASIFROBNICATOR'), true, 'all-caps headings accept personal words')
  assert.equal(custom.correct('VIETLATEX'), true)
  assert.equal(custom.correct('quasiFrobnicator'), false)
  assert.equal(custom.correct('well-QUASIFROBNICATOR'), true)
  assert.equal(us.correct('quasifrobnicator'), false)
  assert.throws(() => sanitizePersonalWords(['word/S']))
  assert.throws(() => sanitizePersonalWords(['word\nother']))
  assert.throws(() => sanitizePersonalWords(Array(10001).fill('word')))
})
test('token offsets survive emoji and smart apostrophes; URLs and identifiers remain opaque', () => {
  const value = "😀 recieve don’t user's well-known https://badword.invalid/recieve badword@recieve.invalid 10.1000/recieve alpha_2 123abc tiếng `recieve` C:\\recieve\\file"
  const tokens = spellcheckTokens(value)
  assert.deepEqual(tokens.map(token => token.original), ['recieve', 'don’t', "user's", 'well-known'])
  for (const token of tokens) assert.equal(value.slice(token.from, token.to), token.original)
})
test('settings and personal imports validate old/new documents', () => {
  assert.deepEqual(sanitizeSpellcheckSettings(), { enabled: false, locale: 'en-US' })
  assert.deepEqual(sanitizeSpellcheckSettings({ enabled: 'yes', locale: 'invalid' }), { enabled: false, locale: 'en-US' })
  assert.deepEqual(parsePersonalWords('VietLaTeX\r\nVietLaTeX\nquasifrobnicator'), ['VietLaTeX', 'quasifrobnicator'])
  assert.deepEqual(parsePersonalWords('{"words":["VietLaTeX"]}'), ['VietLaTeX'])
  const task = createTask('Test'); task.settings = sanitizeSettings({ spellcheck: { enabled: true, locale: 'en-GB' } })
  const workspace = sanitizeWorkspace({ version: 1, projects: [createProject('Test', task)] })
  assert.deepEqual(workspace.projects[0].tasks[0].settings.spellcheck, { enabled: true, locale: 'en-GB' })
  const roundtrip = recordsWorkspace(workspaceRecords(workspace), workspace)
  assert.deepEqual(roundtrip.projects[0].tasks[0].settings.spellcheck, task.settings.spellcheck)
})
