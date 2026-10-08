import { Node, Extension } from '@tiptap/core'
import { Table, TableView } from '@tiptap/extension-table'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { citationKeys, citationLabel, citationNumbers, describeEntry } from './Bibliography.js'
import { isValidTableStyleAttribute, normalizeTableStyle, TABLE_STYLE_DEFAULTS } from './TableStyles.js'
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

// Table style attributes default to null so documents saved before the table
// library keep their JSON; the serializer and the view fall back to defaults.
const tableStyleAttributes = Object.fromEntries(Object.keys(TABLE_STYLE_DEFAULTS).map(name => {
  const attribute = `data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
  return [name, {
    default: null,
    parseHTML: element => {
      const raw = element.getAttribute(attribute)
      const value = name === 'headerBold' ? (raw === 'true' ? true : raw === 'false' ? false : null) : raw
      return value !== null && isValidTableStyleAttribute(name, value) ? value : null
    },
    renderHTML: attributes => attributes[name] === null || attributes[name] === undefined ? {} : { [attribute]: String(attributes[name]) },
  }]
}))

function applyTableStyle(table, node) {
  const style = normalizeTableStyle(node.attrs)
  table.dataset.tableStyle = style.tableStyle
  table.dataset.tableFont = style.fontSize
  table.dataset.tableSpacing = style.rowSpacing
  table.dataset.tableWidth = style.tableWidth
  table.dataset.headerBold = String(style.headerBold)
}

// The resizable table view builds its own <table> and never re-applies
// attributes, so the style is mirrored on every update for the draft preview.
export class StyledTableView extends TableView {
  constructor(node, cellMinWidth, view, HTMLAttributes) {
    super(node, cellMinWidth, view, HTMLAttributes)
    applyTableStyle(this.table, node)
  }

  update(node) {
    if (!super.update(node)) return false
    applyTableStyle(this.table, node)
    return true
  }
}

export const AcademicTable = Table.extend({
  addOptions() {
    return { ...this.parent?.(), View: StyledTableView }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableStyleAttributes,
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

function citationPositions(doc) {
  const positions = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation') positions.push({ pos, size: node.nodeSize, key: node.attrs.key, mode: node.attrs.mode })
  })
  return positions
}

const citationSignature = positions => positions.map(({ key, mode }) => `${key}|${mode}`).join('\n')

// Labels depend only on the ordered citation keys, so ordinary typing maps the previous decorations instead of
// re-deriving every label (the full rebuild costs tens of milliseconds per keystroke with hundreds of citations).
function citationState(doc, storage, previous = null, mapping = null) {
  const positions = citationPositions(doc)
  const signature = citationSignature(positions)
  if (previous && mapping && previous.signature === signature) {
    const decorations = previous.decorations.map(mapping, doc)
    const mapped = decorations.find().map(decoration => decoration.from).sort((a, b) => a - b)
    if (mapped.length === positions.length && mapped.every((from, index) => from === positions[index].pos)) return { decorations, signature }
  }
  return { decorations: citationDecorations(doc, storage, positions), signature }
}

function citationDecorations(doc, storage, citations) {
  const positions = citations.map(item => ({ ...item, keys: citationKeys(item.key) }))
  const occurrences = positions.map(item => item.keys)
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
        init: (_, state) => citationState(state.doc, storage),
        apply: (tr, value) => tr.getMeta(CITATION_REFRESH) ? citationState(tr.doc, storage)
          : tr.docChanged ? citationState(tr.doc, storage, value, tr.mapping) : value,
      },
      props: {
        decorations: state => citationPluginKey.getState(state).decorations,
        handleClickOn: (view, pos, node) => {
          if (node.type.name !== 'citation' || !storage.onOpen) return false
          storage.onOpen({ pos, keys: citationKeys(node.attrs.key), mode: node.attrs.mode, node })
          return true
        },
      },
    })]
  },
})
