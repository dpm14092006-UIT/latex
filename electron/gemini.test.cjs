const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createGemini, preferredModel } = require('./gemini.cjs')

const KEY = 'AIzaTestKey_0123456789abcdefghij'
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`enc:${value}`),
  decryptString: buffer => { const text = buffer.toString(); if (!text.startsWith('enc:')) throw new Error('bad'); return text.slice(4) },
}
const models = { models: [
  { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-lite', displayName: 'Lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.0-pro-preview', displayName: 'Preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
] }
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })

async function setup(t, respond) {
  const directory = await mkdtemp(join(tmpdir(), 'vietlatex-ai-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = []
  const fetch = async (url, init) => { calls.push({ url, init }); return respond(url, init) }
  return { directory, calls, gemini: createGemini({ directory, safeStorage, fetch }) }
}

test('the key is verified, stored encrypted and only sent in a header', async t => {
  const { directory, calls, gemini } = await setup(t, () => json(200, models))
  const saved = await gemini.setKey(`  ${KEY} `)
  assert.equal(saved.model, 'models/gemini-2.5-flash', 'newest stable flash model is the default')
  assert.ok(!saved.models.some(model => model.id.includes('embedding')))
  const file = await readFile(join(directory, 'ai-v1.json'), 'utf8')
  assert.ok(!file.includes(KEY), 'plain key never reaches disk')
  assert.equal(calls[0].init.headers['x-goog-api-key'], KEY)
  assert.ok(!calls[0].url.includes(KEY), 'key is not placed in the URL')
  assert.equal(calls[0].init.redirect, 'error')
  assert.deepEqual(await gemini.status(), { provider: 'gemini', configured: true, model: 'models/gemini-2.5-flash', encryption: true })
  await gemini.clearKey()
  assert.equal((await gemini.status()).configured, false)
})

test('invalid keys and unavailable encryption are refused before saving', async t => {
  const { gemini, calls } = await setup(t, () => json(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }))
  await assert.rejects(gemini.setKey('short'), /định dạng/)
  assert.equal(calls.length, 0)
  await assert.rejects(gemini.setKey(KEY), /không hợp lệ hoặc đã bị thu hồi/)
  assert.equal((await gemini.status()).configured, false)
  const plain = createGemini({ directory: tmpdir(), safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, fetch: async () => json(200, models) })
  await assert.rejects(plain.setKey(KEY), /kho mã hóa/)
})

test('generate uses a fixed prompt per action and returns plain text', async t => {
  let request
  const { gemini } = await setup(t, (url, init) => {
    if (url.endsWith(':generateContent')) {
      request = { url, body: JSON.parse(init.body) }
      return json(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking', thought: true }, { text: '```latex\nThe result $x^2$ holds.\n```' }] } }] })
    }
    return json(200, models)
  })
  await gemini.setKey(KEY)
  const result = await gemini.generate({ action: 'to-english', text: 'Kết quả $x^2$ đúng.' })
  assert.equal(result.text, 'The result $x^2$ holds.')
  assert.ok(request.url.endsWith('/models/gemini-2.5-flash:generateContent'))
  assert.match(request.body.systemInstruction.parts[0].text, /tiếng Anh/)
  assert.equal(request.body.contents[0].parts[0].text, 'Kết quả $x^2$ đúng.')
  await assert.rejects(gemini.generate({ action: '__proto__', text: 'x' }), /không hợp lệ/)
  await assert.rejects(gemini.generate({ action: 'custom', text: 'x' }), /không hợp lệ/)
  await assert.rejects(gemini.generate({ action: 'grammar', text: '   ' }), /Chưa có nội dung/)
  await assert.rejects(gemini.generate({ action: 'grammar', text: 'x'.repeat(20_001) }), /vượt/)
  await assert.rejects(gemini.setModel('../../etc'), /không hợp lệ/)
})

test('quota, blocked prompts, network failures and cancellation give clear messages', async t => {
  let mode = 'quota'
  const { gemini } = await setup(t, (url, init) => {
    if (!url.endsWith(':generateContent')) return json(200, models)
    if (mode === 'quota') return json(429, { error: { status: 'RESOURCE_EXHAUSTED' } })
    if (mode === 'blocked') return json(200, { promptFeedback: { blockReason: 'SAFETY' } })
    if (mode === 'offline') throw new TypeError('fetch failed')
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  })
  await gemini.setKey(KEY)
  await assert.rejects(gemini.generate({ action: 'grammar', text: 'Hello' }), /hạn mức/)
  mode = 'blocked'
  await assert.rejects(gemini.generate({ action: 'grammar', text: 'Hello' }), /từ chối/)
  mode = 'offline'
  await assert.rejects(gemini.generate({ action: 'grammar', text: 'Hello' }), /kết nối/)
  mode = 'hang'
  const pending = gemini.generate({ action: 'grammar', text: 'Hello' })
  setTimeout(() => gemini.cancel(), 20)
  await assert.rejects(pending, /Đã hủy/)
})

test('a key that can no longer be decrypted asks to enter it again', async t => {
  const { directory, gemini } = await setup(t, () => json(200, models))
  await gemini.setKey(KEY)
  const other = createGemini({ directory, safeStorage: { ...safeStorage, decryptString: () => { throw new Error('locked') } }, fetch: async () => json(200, models) })
  await assert.rejects(other.generate({ action: 'grammar', text: 'Hello' }), /nhập lại key/)
})

test('preferred model skips previews and lite variants', () => {
  assert.equal(preferredModel([{ id: 'models/gemini-1.5-flash' }, { id: 'models/gemini-2.5-flash-preview-05-20' }, { id: 'models/gemini-2.0-flash' }]), 'models/gemini-2.0-flash')
  assert.equal(preferredModel([{ id: 'models/gemini-2.5-pro' }]), 'models/gemini-2.5-pro')
  assert.equal(preferredModel([{ id: 'models/gemini-exp-1206' }]), 'models/gemini-exp-1206')
})
