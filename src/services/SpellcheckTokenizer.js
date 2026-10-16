// Keep offsets in the original UTF-16 string. Normalization is only for lookup.
export function lookupWord(word) {
  return word.normalize('NFC').replaceAll('’', "'").replace(/[\u2010\u2011]/gu, '-')
}

export function spellcheckTokens(text) {
  const exclusions = [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b10\.\d{4,9}\/[^\s<>]+|(?:[A-Za-z]:\\|\.{0,2}\/)[^\s<>]+|`[^`]*`/gu)].map(match => [match.index, match.index + match[0].length])
  const tokens = []
  let excluded = 0
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:['’\u2010\u2011-][\p{L}\p{M}\p{N}_]+)*/gu)) {
    const from = match.index, to = from + match[0].length
    while (excluded < exclusions.length && exclusions[excluded][1] <= from) excluded++
    if (exclusions[excluded] && exclusions[excluded][0] < to) continue
    const original = match[0]
    // Do not split non-English words/identifiers into apparently English fragments.
    if (original.length > 64 || /[^A-Za-z'’\u2010\u2011-]/u.test(original) || original.length < 2) continue
    tokens.push({ from, to, original, word: lookupWord(original) })
  }
  return tokens
}
