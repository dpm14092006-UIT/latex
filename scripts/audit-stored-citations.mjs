// Read-only audit: never edits the user's workspace or compiles imported LaTeX.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { bibtexForCompile, citationDiagnostics, parseBibtex, resolveCitationStyle, shortAuthors } from '../src/services/Bibliography.js'
import { builtInDocumentTemplates, toLatex } from '../src/services/DocumentSerializer.js'
import { bytesToBase64 } from '../src/services/ProjectAssets.js'
import { startGoBackendForTests } from './go-backend-test-client.mjs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const workspace = JSON.parse(await readFile(process.argv[2], 'utf8'))
const results = []
const compileCases = []
for (const project of workspace.projects || []) for (const task of project.tasks || []) {
  if (!task.settings?.bibliography) continue
  const entries = parseBibtex(task.settings.bibliography)
  const template = [...builtInDocumentTemplates, ...(workspace.documentTemplates || [])].find(item => item.id === task.activeDocumentTemplateId)?.source
  const style = resolveCitationStyle(task.settings.citationStyle, template)
  const compiled = parseBibtex(bibtexForCompile(task.settings.bibliography, style))
  const diagnostics = citationDiagnostics(task.document, entries)
  const latex = toLatex(task.document, task.title, template, task.settings).latex
  let namedAuthorBeforeCitation = 0
  const normalize = value => String(value || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
  function inspect(node) {
    let previous = ''
    for (const child of node.content || []) {
      if (child.type === 'text') previous += child.text
      else {
        if (child.type === 'citation' && child.attrs?.mode !== 'narrative' && entries.some(entry => entry.key === child.attrs.key && normalize(previous).endsWith(normalize(shortAuthors(entry))))) namedAuthorBeforeCitation++
        previous = ''
        inspect(child)
      }
    }
  }
  inspect(task.document)
  const generatedKeys = [...latex.matchAll(/\\cite(?:p|t)?\{([^}]+)\}/g)].flatMap(match => match[1].split(','))
  const storedDraftKeys = [...String(task.sourceDraft || '').matchAll(/\\cite(?:p|t)?\{([^}]+)\}/g)].flatMap(match => match[1].split(','))
  results.push({ document: task.title, storedStyle: task.settings.citationStyle, effectiveStyle: style, references: entries.length,
    underscoreKeys: entries.filter(entry => entry.key.includes('_')).length,
    compiledKeysChanged: entries.filter((entry, index) => entry.key !== compiled[index]?.key).map(entry => entry.key),
    missingREF: diagnostics.missing, duplicateKeys: diagnostics.duplicates, invalidKeys: diagnostics.invalidKeys,
    generatedCitationKeysMissing: [...new Set(generatedKeys.filter(key => !entries.some(entry => entry.key === key)))],
    sourceDraftPresent: Boolean(task.sourceDraft), draftCitationKeysMissing: [...new Set(storedDraftKeys.filter(key => !entries.some(entry => entry.key === key)))],
    sourceTrusted: task.sourceTrusted === true,
    namedAuthorBeforeCitation,
  })
  if (process.argv.includes('--compile') && task.sourceTrusted === true) compileCases.push({ task, template })
}
if (compileCases.length) {
  const backend = await startGoBackendForTests()
  try {
    await mkdir('artifacts/full-audit', { recursive: true })
    for (const [index, { task, template }] of compileCases.entries()) for (const citationStyle of ['apa', 'unsrt']) {
      const { latex, images } = toLatex(task.document, task.title, template, { ...task.settings, citationStyle })
      const assets = [...(task.assets || []).filter(asset => asset.filename.toLowerCase() !== 'references.bib'), { filename: 'references.bib', data: bytesToBase64(new TextEncoder().encode(bibtexForCompile(task.settings.bibliography, citationStyle))) }]
      const bytes = await backend.compileLatex(latex, images, { assets })
      const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
      try {
        const pdf = await loading.promise
        let text = ''
        for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str).join(' ')
        if (/\[\?\]/.test(text)) throw Error('Stored document still contains an unresolved citation.')
        const file = `artifacts/full-audit/stored-document-${index + 1}-${citationStyle}.pdf`
        await writeFile(file, bytes)
        console.error(`Stored document ${index + 1}: ${citationStyle}, ${pdf.numPages} pages, no [?].`)
      } finally { await loading.destroy() }
    }
  } finally { await backend.close() }
}
console.log(JSON.stringify(results, null, 2))
