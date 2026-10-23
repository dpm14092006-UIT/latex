import { Node, Extension } from '@tiptap/core'
import { Table, TableView } from '@tiptap/extension-table'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { closeHistory, redo, undo } from '@tiptap/pm/history'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CellSelection } from '@tiptap/pm/tables'
import { citationKeys, citationLabel, citationNumbers, describeEntry } from './Bibliography.js'
import { isValidTableStyleAttribute, normalizeTableStyle, tableHeaderRowCount, TABLE_STYLE_DEFAULTS } from './TableStyles.js'
import { tableCaptionParts } from './TableCaptions.js'
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
// library keep their JSON; missing styles use the academic layout in both views.
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

const NUMERIC_CELL = /^[+−-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+−-]?\d+)?\s*%?$/u
let styledTableCount = 0

// Columns holding only numbers are right-aligned in the PDF; the draft mirrors
// that for tables without merged cells, where a column is an nth-child.
function tablePresentationCss(node, id) {
  const rows = []
  let merged = false
  node.forEach(row => {
    const cells = []
    row.forEach(cell => {
      if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) merged = true
      cells.push(cell)
    })
    rows.push(cells)
  })
  const headerRows = tableHeaderRowCount(node)
  const headerCss = headerRows ? `.ProseMirror .tableWrapper table[data-styled-table="${id}"]:is([data-table-style="academic"], [data-table-style="striped"], [data-table-style="shaded"], [data-table-style="minimal"]) > tbody > tr:nth-child(${headerRows}) > :is(th, td) { border-bottom: 1px solid var(--table-rule); }` : ''
  if (merged) return headerCss
  const body = rows.slice(headerRows)
  const columns = Math.max(0, ...rows.map(cells => cells.length))
  const selectors = []
  for (let column = 0; column < columns; column += 1) {
    const values = body.map(cells => cells[column]?.textContent.trim()).filter(Boolean)
    if (values.length && values.every(value => NUMERIC_CELL.test(value))) selectors.push(`table[data-styled-table="${id}"] > tbody > tr > :nth-child(${column + 1})`)
  }
  return `${headerCss}\n${selectors.length ? `${selectors.join(',\n')} { text-align: right; }` : ''}`
}

function tableTextField(className, label, placeholder, multiline) {
  const field = document.createElement('label')
  field.className = `table-text-field ${className}`
  field.contentEditable = 'false'
  const tag = document.createElement('span')
  tag.className = 'table-text-field-tag'
  tag.textContent = label
  const input = document.createElement(multiline ? 'textarea' : 'input')
  if (multiline) input.rows = 1
  else input.type = 'text'
  input.placeholder = placeholder
  input.spellcheck = false
  input.setAttribute('aria-label', label)
  field.append(tag, input)
  return { field, input }
}

// The resizable table view builds its own <table> and never re-applies
// attributes, so the style is mirrored on every update for the draft preview.
// The caption and the note are typed where they appear in the PDF: above or
// below the table, outside the cells ProseMirror edits.
export class StyledTableView extends TableView {
  constructor(node, cellMinWidth, view, HTMLAttributes) {
    super(node, cellMinWidth, view, HTMLAttributes)
    this.view = view
    this.id = String(++styledTableCount)
    this.table.dataset.styledTable = this.id
    this.alignStyle = document.createElement('style')
    this.number = tableTextField('table-number-field', 'Table No.', '', false)
    this.number.input.maxLength = 50
    this.caption = tableTextField('table-caption-field', 'Caption', 'Table title…', false)
    this.caption.input.maxLength = 500
    this.captionRow = document.createElement('div')
    this.captionRow.className = 'table-caption-row'
    this.captionRow.contentEditable = 'false'
    this.captionRow.append(this.number.field, this.caption.field)
    this.note = tableTextField('table-note-field', 'Ghi chú', 'Ghi chú dưới bảng: nguồn số liệu, đơn vị, giải thích ký hiệu… (có thể gõ công thức $p = n + k$)', true)
    this.note.input.maxLength = 2000
    this.dom.classList.add('styled-table')
    this.dom.prepend(this.alignStyle)
    this.listeners = []
    for (const [name, { input }] of [['tableNumber', this.number], ['caption', this.caption], ['note', this.note]]) {
      const listen = (type, handler) => {
        input.addEventListener(type, handler)
        this.listeners.push(() => input.removeEventListener(type, handler))
      }
      listen('input', event => {
        this.resizeNote()
        if (!event.isComposing) this.commit(name, input.value)
      })
      listen('compositionend', () => this.commit(name, input.value))
      listen('focus', () => { if (this.editable()) this.view.dispatch(closeHistory(this.view.state.tr)) })
      listen('keydown', event => this.onFieldKeyDown(event))
    }
    this.render(node)
  }

  editable() { return Boolean(this.view?.editable) }

  position() {
    try {
      const position = this.view.posAtDOM(this.contentDOM, 0) - 1
      return this.view.state.doc.nodeAt(position)?.type.name === 'table' ? position : null
    } catch {
      return null
    }
  }

  commit(name, value) {
    const position = this.position()
    const attrs = { ...this.node.attrs, ...tableCaptionParts(this.node.attrs) }
    if (!this.editable() || position === null || (attrs[name] || '') === value) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, { ...attrs, [name]: value }))
  }

  onFieldKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      const command = event.key.toLowerCase() === 'y' || event.shiftKey ? redo : undo
      command(this.view.state, this.view.dispatch)
      // Undo changes the text under the cursor, so the focused field follows it.
      this.render(this.node, true)
      return
    }
    // Enter leaves the field: the caption goes into the first cell, the note
    // after the table, as a writer reading top to bottom would expect.
    if (event.key === 'Enter' && !event.isComposing && !event.shiftKey) {
      event.preventDefault()
      if (event.currentTarget === this.number.input) { this.caption.input.focus(); return }
      const position = this.position()
      if (position === null) return
      const target = event.currentTarget === this.caption.input ? position + 3 : position + this.node.nodeSize
      const { state } = this.view
      this.view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(Math.min(target, state.doc.content.size)))).scrollIntoView())
      this.view.focus()
    }
  }

  resizeNote() {
    const { input } = this.note
    input.style.height = 'auto'
    if (input.scrollHeight) input.style.height = `${input.scrollHeight}px`
  }

  render(node, force = false) {
    applyTableStyle(this.table, node)
    const style = normalizeTableStyle(node.attrs)
    // Keep what the writer is typing; the node catches up on the next input.
    const attrs = { ...node.attrs, ...tableCaptionParts(node.attrs) }
    for (const [name, { input }] of [['tableNumber', this.number], ['caption', this.caption], ['note', this.note]]) {
      if ((force || document.activeElement !== input) && input.value !== (attrs[name] || '')) input.value = attrs[name] || ''
      input.readOnly = !this.editable()
    }
    this.dom.classList.toggle('has-table-note', Boolean(node.attrs.note))
    // The order the PDF prints them in: caption, table, note or table,
    // caption, note. Moving the table itself would disturb the selection in
    // its cells, so only the two fields are placed around it.
    if (style.captionPosition === 'bottom') {
      if (this.table.nextSibling !== this.captionRow) this.table.after(this.captionRow)
    } else if (this.table.previousSibling !== this.captionRow) this.table.before(this.captionRow)
    if (this.dom.lastChild !== this.note.field) this.dom.append(this.note.field)
    const css = tablePresentationCss(node, this.id)
    if (this.alignStyle.textContent !== css) this.alignStyle.textContent = css
    this.resizeNote()
  }

  update(node) {
    if (!super.update(node)) return false
    this.render(node)
    return true
  }

  stopEvent(event) {
    return this.captionRow.contains(event.target) || this.note.field.contains(event.target)
  }

  ignoreMutation(mutation) {
    if (this.captionRow.contains(mutation.target) || this.note.field.contains(mutation.target) || mutation.target === this.dom) return true
    return super.ignoreMutation(mutation)
  }

  destroy() {
    for (const remove of this.listeners) remove()
  }
}

export const AcademicTable = Table.extend({
  addOptions() {
    return { ...this.parent?.(), View: StyledTableView }
  },
  addKeyboardShortcuts() {
    const removeSelectedStructure = () => {
      const { selection } = this.editor.state
      if (!(selection instanceof CellSelection)) return false
      const rows = selection.isRowSelection()
      const columns = selection.isColSelection()
      if (rows && columns) return this.editor.commands.deleteTable()
      if (rows) return this.editor.commands.deleteRow()
      if (columns) return this.editor.commands.deleteColumn()
      return false
    }
    return { ...this.parent?.(), Backspace: removeSelectedStructure, Delete: removeSelectedStructure }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableStyleAttributes,
      tableNumber: {
        default: null,
        parseHTML: element => element.getAttribute('data-table-number'),
        renderHTML: attributes => attributes.tableNumber == null ? {} : { 'data-table-number': attributes.tableNumber },
      },
      caption: {
        default: '',
        parseHTML: element => element.getAttribute('data-caption') || '',
        renderHTML: attributes => attributes.caption ? { 'data-caption': attributes.caption } : {},
      },
      note: {
        default: '',
        parseHTML: element => element.getAttribute('data-note') || '',
        renderHTML: attributes => attributes.note ? { 'data-note': attributes.note } : {},
      },
      label: {
        default: '',
        parseHTML: element => element.getAttribute('data-label') || '',
        renderHTML: attributes => attributes.label ? { 'data-label': attributes.label } : {},
      },
    }
  },
})

// Citation numbers depend on the whole document and reference list. Manually
// inserted citations show their styled label; automatically linked citations
// keep their original source wording in the editor.
export const citationPluginKey = new PluginKey('citationNumbers')
export const CITATION_REFRESH = 'citationRefresh'

function citationPositions(doc) {
  const positions = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation') positions.push({ pos, size: node.nodeSize, key: node.attrs.key, mode: node.attrs.mode, sourceText: node.attrs.sourceText || '' })
  })
  return positions
}

const citationSignature = positions => JSON.stringify(positions.map(({ key, mode, sourceText }) => [key, mode, sourceText]))

// Ordinary typing maps previous decorations instead of re-deriving labels
// (the full rebuild costs tens of milliseconds per keystroke with hundreds of citations).
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
  return DecorationSet.create(doc, positions.map(({ pos, size, keys, mode, sourceText }) => {
    const missing = keys.filter(key => !byKey.has(key))
    const title = keys.map(key => {
      const entry = byKey.get(key)
      if (!entry) return `${key}: chưa có trong danh mục tài liệu`
      const info = describeEntry(entry)
      return `${numbers.get(key) ? `[${numbers.get(key)}] ` : ''}${[info.authors, info.year, info.title].filter(Boolean).join(' · ')}`
    }).join('\n')
    const attrs = { title }
    // Automatically linked citations keep the exact source phrase in the
    // editor. Their formatted bibliography label is generated only on export.
    if (!sourceText) attrs['data-citation-label'] = citationLabel(keys, numbers, byKey, storage.style, mode)
    if (missing.length) attrs['data-citation-missing'] = 'true'
    return Decoration.node(pos, pos + size, attrs)
  }))
}

export const Citation = Node.create({
  name: 'citation', group: 'inline', inline: true, atom: true, selectable: true,
  addStorage() { return { entries: [], style: 'apa', onOpen: null } },
  addAttributes() {
    return {
      key: { default: '', parseHTML: element => element.getAttribute('data-key') || '' },
      mode: { default: 'parenthetical', parseHTML: element => element.getAttribute('data-citation-mode') === 'narrative' ? 'narrative' : 'parenthetical' },
      sourceText: {
        default: '',
        parseHTML: element => element.getAttribute('data-citation-source') || '',
        renderHTML: attributes => attributes.sourceText ? { 'data-citation-source': attributes.sourceText } : {},
      },
      sourceParts: {
        default: null,
        parseHTML: element => {
          try {
            const value = JSON.parse(element.getAttribute('data-citation-parts') || 'null')
            return Array.isArray(value) ? value : null
          } catch { return null }
        },
        renderHTML: attributes => Array.isArray(attributes.sourceParts) ? { 'data-citation-parts': JSON.stringify(attributes.sourceParts) } : {},
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-type="citation"]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', {
      ...HTMLAttributes,
      'data-type': 'citation',
      'data-key': node.attrs.key,
      'data-citation-mode': node.attrs.mode,
      class: 'academic-reference academic-citation',
    }, ['span', { class: 'academic-citation-key' }, node.attrs.sourceText || `[@${node.attrs.key}]`]]
  },
  renderText({ node }) { return node.attrs.sourceText || `[@${node.attrs.key}]` },
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
