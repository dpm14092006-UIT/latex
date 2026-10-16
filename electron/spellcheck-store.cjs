const { mkdir, readFile, rename } = require('node:fs/promises')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { renameWithRetry, syncDirectory } = require('./workspace-store.cjs')

function createSpellcheckStore(directory) {
  const filename = join(directory, 'spellcheck-v1.json')
  let queue = Promise.resolve()
  const validation = import('../src/services/SpellcheckSettings.js')
  function serialized(action) {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  async function read() {
    try {
      const raw = await readFile(filename, 'utf8')
      if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Từ điển cá nhân vượt giới hạn.')
      const data = JSON.parse(raw)
      if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('Định dạng từ điển cá nhân không hợp lệ.')
      return { words: (await validation).sanitizePersonalWords(data.words), revision: data.revision }
    } catch (error) {
      if (error.code === 'ENOENT') return { words: [], revision: 0 }
      if (error.code) throw error
      await rename(filename, `${filename}.damaged-${Date.now()}-${randomUUID()}`)
      return { words: [], revision: 0, warning: 'Từ điển cá nhân bị hỏng; đã giữ bản gốc và mở danh sách trống.' }
    }
  }
  return {
    whenIdle: async () => { let pending; do { pending = queue; await pending } while (pending !== queue) },
    load: () => serialized(read),
    mutate: (action, input) => serialized(async () => {
      const { sanitizePersonalWords, validPersonalWord } = await validation
      const current = await read()
      let words
      if (action === 'add' || action === 'remove') {
        if (!validPersonalWord(input)) throw new Error('Từ cá nhân không hợp lệ.')
        const normalized = sanitizePersonalWords([input])[0]
        words = action === 'add' ? sanitizePersonalWords([...new Set([...current.words, normalized])]) : current.words.filter(word => word !== normalized)
      } else if (action === 'merge') words = sanitizePersonalWords([...new Set([...current.words, ...sanitizePersonalWords(input)])])
      else throw new Error('Thao tác từ điển không hợp lệ.')
      const result = { version: 1, words, revision: current.revision + 1 }
      await mkdir(directory, { recursive: true })
      const temporary = `${filename}.${randomUUID()}.tmp`
      const handle = await require('node:fs/promises').open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(result) + '\n', 'utf8'); await handle.sync() } finally { await handle.close() }
      await renameWithRetry(temporary, filename)
      await syncDirectory(directory)
      return result
    }),
  }
}
module.exports = { createSpellcheckStore }
