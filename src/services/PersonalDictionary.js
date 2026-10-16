import { SPELLCHECK_STORAGE_KEY, sanitizePersonalWords } from './SpellcheckSettings.js'
let mutationQueue = Promise.resolve()

export async function loadPersonalDictionary() {
  if (window.desktopAPI?.spelling) return window.desktopAPI.spelling.load()
  const raw = window.localStorage.getItem(SPELLCHECK_STORAGE_KEY)
  if (!raw) return { words: [], revision: 0 }
  const data = JSON.parse(raw)
  return { words: sanitizePersonalWords(data.words), revision: Number.isSafeInteger(data.revision) ? data.revision : 0 }
}

export async function mutatePersonalDictionary(action, input) {
  if (window.desktopAPI?.spelling) return window.desktopAPI.spelling.mutate(action, input)
  const mutate = () => mutateWebDictionary(action, input)
  const result = mutationQueue.then(() => navigator.locks ? navigator.locks.request(SPELLCHECK_STORAGE_KEY, mutate) : mutate())
  mutationQueue = result.catch(() => {})
  return result
}

async function mutateWebDictionary(action, input) {
  const current = await loadPersonalDictionary()
  let words
  if (action === 'add') words = sanitizePersonalWords([...new Set([...current.words, ...sanitizePersonalWords([input])])])
  else if (action === 'remove') words = current.words.filter(word => word !== sanitizePersonalWords([input])[0])
  else if (action === 'merge') words = sanitizePersonalWords([...new Set([...current.words, ...sanitizePersonalWords(input)])])
  else throw new Error('Thao tác từ điển không hợp lệ.')
  const result = { words, revision: current.revision + 1 }
  window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, JSON.stringify(result))
  return result
}

export function watchPersonalDictionary(callback) {
  if (window.desktopAPI?.spelling) return window.desktopAPI.spelling.onChange(callback)
  const listener = event => {
    if (event.key === SPELLCHECK_STORAGE_KEY) void loadPersonalDictionary().then(callback).catch(() => {})
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
