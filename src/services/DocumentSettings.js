import { CITATION_STYLE_IDS } from './Bibliography.js'
import { sanitizeSourceMaps } from './CitationLinker.js'
export const defaultSettings = Object.freeze({ author: '', date: '', paper: 'a4paper', fontSize: 11, margin: 25.4, lineSpacing: 1.2, numberedEquations: false, tableOfContents: false, abstractEnabled: false, abstract: '', abstractTitle: 'Abstract', bibliography: '', citationStyle: 'auto' })

export function sanitizeSettings(value = {}) {
  return {
    author: String(value?.author || '').slice(0, 500),
    date: String(value?.date || '').slice(0, 100),
    paper: ['a4paper', 'letterpaper', 'a5paper'].includes(value?.paper) ? value.paper : 'a4paper',
    fontSize: [10, 11, 12].includes(Number(value?.fontSize)) ? Number(value.fontSize) : 11,
    margin: Math.max(10, Math.min(50, Number(value?.margin) || 25.4)),
    lineSpacing: Math.max(1, Math.min(2, Number(value?.lineSpacing) || 1.2)),
    numberedEquations: value?.numberedEquations === true,
    tableOfContents: value?.tableOfContents === true,
    abstractEnabled: value?.abstractEnabled === true,
    abstract: String(value?.abstract || '').slice(0, 20_000),
    abstractTitle: value?.abstractTitle === 'Tóm tắt' ? 'Tóm tắt' : 'Abstract',
    bibliography: String(value?.bibliography || '').slice(0, 500_000),
    citationStyle: CITATION_STYLE_IDS.includes(value?.citationStyle) ? value.citationStyle : 'auto',
    citationSourceMaps: sanitizeSourceMaps(value?.citationSourceMaps),
  }
}
