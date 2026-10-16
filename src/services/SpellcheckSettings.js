export const MAX_PERSONAL_WORDS = 10_000
export const MAX_PERSONAL_FILE_BYTES = 1024 * 1024
export const SPELLCHECK_STORAGE_KEY = 'latex-spellcheck-personal-v1'

export function sanitizeSpellcheckSettings(value) {
  return { enabled: value?.enabled === true, locale: value?.locale === 'en-GB' ? 'en-GB' : 'en-US' }
}

export function validPersonalWord(word) {
  return typeof word === 'string' && word.length <= 64 && /^[\p{L}\p{M}]+(?:['’\u2010-\u2011-][\p{L}\p{M}]+)*$/u.test(word)
}

export function sanitizePersonalWords(words) {
  if (!Array.isArray(words) || words.length > MAX_PERSONAL_WORDS) throw new Error('Từ điển tối đa 10.000 từ.')
  if (words.some(word => !validPersonalWord(word))) throw new Error('Mỗi từ tối đa 64 ký tự, chỉ gồm chữ, dấu nháy và gạch nối.')
  return [...new Set(words.map(word => word.normalize('NFC').replaceAll('’', "'")))].sort()
}

export function parsePersonalWords(text) {
  if (new TextEncoder().encode(text).length > MAX_PERSONAL_FILE_BYTES) throw new Error('Tệp từ điển vượt giới hạn 1 MiB.')
  const trimmed = text.replace(/^\uFEFF/u, '').trim()
  if (!trimmed) return []
  const value = /^(?:\[|\{)/u.test(trimmed) ? JSON.parse(trimmed) : trimmed.split(/\r?\n/u).map(word => word.trim()).filter(Boolean)
  return sanitizePersonalWords(Array.isArray(value) ? value : value.words)
}
