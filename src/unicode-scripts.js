export const unicodeSubscripts = new Map(Object.entries({
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n',
  'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
}))

export const unicodeSuperscripts = new Map(Object.entries({
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
}))

const scriptRuns = new RegExp(`([${[...unicodeSubscripts.keys()].join('')}]+)|([${[...unicodeSuperscripts.keys()].join('')}]+)`, 'gu')

// Keep complete runs (e.g. ₁₂ or ²⁻) together. Rendering scripts with ordinary
// glyphs avoids relying on a font's sparse Unicode super/subscript coverage.
export function replaceUnicodeScripts(value, render) {
  return String(value ?? '').replace(scriptRuns, (_match, subscript, superscript) => {
    const mapping = subscript ? unicodeSubscripts : unicodeSuperscripts
    const content = [...(subscript || superscript)].map(character => mapping.get(character)).join('')
    return render(subscript ? 'subscript' : 'superscript', content)
  })
}
