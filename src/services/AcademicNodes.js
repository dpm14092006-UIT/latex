import { Node, Extension } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { citationKeys, citationLabel, citationNumbers, describeEntry } from './Bibliography.js'
export const AcademicAttributes = Extension.create({
  name: 'academicAttributes',
  addGlobalAttributes() { return [{ types: ['heading', 'blockMath'], attributes: { label: { default: '', parseHTML: element => element.getAttribute('data-label') || '', renderHTML: attrs => attrs.label ? { 'data-label': attrs.label } : {} } } }] },
})
function referenceNode(name, attribute, prefix) {
  return Node.create({
    name, group: 'inline', inline: true, atom: true,
    addAttributes() { return { [attribute]: { default: '', parseHTML: element => element.getAttribute(`data-${attribute}`) || '' } } },
    parseHTML() { return [{ tag: `span[data-type="${name}"]` }] },
    renderHTML({ node }) { return ['span', { 'data-type': name, [`data-${attribute}`]: node.attrs[attribute], class: 'academic-reference', title: node.attrs[attribute] }, `${prefix}${node.attrs[attribute]}]`] },
    renderText({ node }) { return `${prefix}${node.attrs[attribute]}]` },
  })
}
export const CrossReference = referenceNode('crossReference', 'target', '[↗ ')
export const Footnote = referenceNode('footnote', 'text', '[Chú thích: ')

export const AcademicTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: element => element.getAttribute('data-caption') || '',
        renderHTML: attributes => attributes.caption ? { 'data-caption': attributes.caption } : {},
      },
      label: {
        default: '',
        parseHTML: element => element.getAttribute('data-label') || '',
        renderHTML: attributes => attributes.label ? { 'data-label': attributes.label } : {},
      },
    }
  },
})

// Citation numbers depend on the whole document and the reference list, so a plugin recomputes the visible
// label for every citation node; the node itself only stores the keys.
export const citationPluginKey = new PluginKey('citationNumbers')
export const CITATION_REFRESH = 'citationRefresh'

function citationDecorations(doc, storage) {
  const occurrences = []
  const positions = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'citation') return
    const keys = citationKeys(node.attrs.key)
    occurrences.push(keys)
    positions.push({ pos, size: node.nodeSize, keys, mode: node.attrs.mode })
  })
  const entries = storage.entries || []
  const byKey = new Map(entries.map(entry => [entry.key, entry]))
  const numbers = citationNumbers(occurrences, entries, storage.style)
  return DecorationSet.create(doc, positions.map(({ pos, size, keys, mode }) => {
    const missing = keys.filter(key => !byKey.has(key))
    const title = keys.map(key => {
      const entry = byKey.get(key)
      if (!entry) return `${key}: chưa có trong danh mục tài liệu`
      const info = describeEntry(entry)
      return `${numbers.get(key) ? `[${numbers.get(key)}] ` : ''}${[info.authors, info.year, info.title].filter(Boolean).join(' · ')}`
    }).join('\n')
    return Decoration.node(pos, pos + size, {
      'data-citation-label': citationLabel(keys, numbers, byKey, storage.style, mode),
      'data-citation-missing': missing.length ? 'true' : null,
      title,
    })
  }))
}

export const Citation = Node.create({
  name: 'citation', group: 'inline', inline: true, atom: true, selectable: true,
  addStorage() { return { entries: [], style: 'apa', onOpen: null } },
  addAttributes() { return { key: { default: '', parseHTML: element => element.getAttribute('data-key') || '' }, mode: { default: 'parenthetical', parseHTML: element => element.getAttribute('data-citation-mode') === 'narrative' ? 'narrative' : 'parenthetical' } } },
  parseHTML() { return [{ tag: 'span[data-type="citation"]' }] },
  renderHTML({ node }) { return ['span', { 'data-type': 'citation', 'data-key': node.attrs.key, 'data-citation-mode': node.attrs.mode, class: 'academic-reference academic-citation' }, ['span', { class: 'academic-citation-key' }, `[@${node.attrs.key}]`]] },
  renderText({ node }) { return `[@${node.attrs.key}]` },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-c': () => { this.storage.onOpen?.(); return Boolean(this.storage.onOpen) } }
  },
  addProseMirrorPlugins() {
    const storage = this.storage
    return [new Plugin({
      key: citationPluginKey,
      state: {
        init: (_, state) => citationDecorations(state.doc, storage),
        apply: (tr, value) => tr.docChanged || tr.getMeta(CITATION_REFRESH) ? citationDecorations(tr.doc, storage) : value,
      },
      props: {
        decorations: state => citationPluginKey.getState(state),
        handleClickOn: (view, pos, node) => {
          if (node.type.name !== 'citation' || !storage.onOpen) return false
          storage.onOpen({ pos, keys: citationKeys(node.attrs.key), mode: node.attrs.mode, node })
          return true
        },
      },
    })]
  },
})
