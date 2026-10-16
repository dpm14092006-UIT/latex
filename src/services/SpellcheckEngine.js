import nspell from 'nspell'
import { lookupWord, spellcheckTokens } from './SpellcheckTokenizer.js'
import { sanitizePersonalWords } from './SpellcheckSettings.js'

class Lru {
  constructor(limit) { this.limit = limit; this.values = new Map() }
  get(key) {
    if (!this.values.has(key)) return undefined
    const value = this.values.get(key)
    this.values.delete(key); this.values.set(key, value)
    return value
  }
  set(key, value) {
    this.values.delete(key); this.values.set(key, value)
    if (this.values.size > this.limit) this.values.delete(this.values.keys().next().value)
    return value
  }
}

export class SpellcheckEngine {
  constructor(aff, dic, words = []) {
    this.spell = nspell(aff, dic)
    this.personal = new Set(sanitizePersonalWords(words))
    this.personalUpper = new Set([...this.personal].map(word => word.toUpperCase()))
    this.lookup = new Lru(20_000)
    this.suggestions = new Lru(500)
  }
  correct(raw) {
    const word = lookupWord(raw)
    const cached = this.lookup.get(word)
    if (cached !== undefined) return cached
    const parts = word.split('-')
    return this.lookup.set(word, this.personalWord(word) || this.spell.correct(word) || (parts.length > 1 && parts.every(part => this.personalWord(part) || this.spell.correct(part))))
  }
  // Like Hunspell: a sentence-initial capital or an all-caps heading also accepts
  // the literal word; other case changes do not (VietLaTeX ≠ vietlatex).
  personalWord(word) {
    if (this.personal.has(word)) return true
    if (/^[A-Z][a-z]/u.test(word) && this.personal.has(word[0].toLowerCase() + word.slice(1))) return true
    return word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase() && this.personalUpper.has(word)
  }
  suggest(raw) {
    const word = lookupWord(raw)
    if (!word || word.length > 64) return []
    const cached = this.suggestions.get(word)
    if (cached) return cached
    const transpositions = []
    for (let index = 0; index < word.length - 1; index++) {
      const candidate = word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2)
      if (candidate !== word && this.correct(candidate)) transpositions.push(candidate)
    }
    return this.suggestions.set(word, [...new Set([...transpositions, ...this.spell.suggest(word)])].slice(0, 5))
  }
  scan(segment) {
    return spellcheckTokens(segment.text).filter(token => !this.correct(token.word)).map(({ word: _word, ...token }) => ({ ...token, segmentId: segment.id, reason: 'not-in-dictionary' }))
  }
}
