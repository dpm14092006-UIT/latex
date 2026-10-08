import { mergeAttributes, Node as TiptapNode } from '@tiptap/core'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Highlight from '@tiptap/extension-highlight'
import { OrderedList } from '@tiptap/extension-list'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'

import { normalizeColor, normalizeFontSize } from './RichTextFormats.js'

export { TEXT_COLORS, HIGHLIGHT_COLORS, FONT_SIZES, TEXT_SYMBOLS, MATH_SYMBOLS } from './RichTextFormats.js'

export const PageBreak = TiptapNode.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-page-break]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'studio-page-break', contenteditable: 'false' }), ['span', 'Ngắt trang']]
  },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent({ type: this.name }).createParagraphNear().run() }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }
  },
})

function normalizeGlobalAttribute(groups, name, normalize) {
  return groups.map(group => {
    const attribute = group.attributes?.[name]
    if (!attribute) return group
    return { ...group, attributes: { ...group.attributes, [name]: { ...attribute, parseHTML: element => normalize(attribute.parseHTML(element)) } } }
  })
}

const SafeColor = Color.extend({
  addGlobalAttributes() { return normalizeGlobalAttribute(this.parent?.() || [], 'color', normalizeColor) },
})
const SafeFontSize = FontSize.extend({
  addGlobalAttributes() { return normalizeGlobalAttribute(this.parent?.() || [], 'fontSize', normalizeFontSize) },
})
const SafeHighlight = Highlight.extend({
  addAttributes() {
    const attributes = this.parent?.() || {}
    if (!attributes.color) return attributes
    return { ...attributes, color: { ...attributes.color, parseHTML: element => normalizeColor(attributes.color.parseHTML(element)) } }
  },
}).configure({ multicolor: true })

// Gõ "1. " ở đầu dòng chỉ là văn bản (ví dụ "1. Mở đầu"), không tự đổi thành
// danh sách thụt lề. Danh sách đánh số vẫn tạo được bằng nút trên thanh công cụ.
export const ManualOrderedList = OrderedList.extend({
  addInputRules() { return [] },
})

export const richTextExtensions = [
  ManualOrderedList,
  Subscript,
  Superscript,
  TextStyle,
  SafeColor,
  SafeFontSize,
  SafeHighlight,
  PageBreak,
]
