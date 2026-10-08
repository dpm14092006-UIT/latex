import { Node, mergeAttributes } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null, parseHTML: element => (element.querySelector('img') || element).getAttribute('src') },
      alt: { default: '', parseHTML: element => (element.querySelector('img') || element).getAttribute('alt') || '' },
      filename: { default: '', rendered: false },
      caption: { default: '', rendered: false, parseHTML: element => element.querySelector('figcaption')?.textContent || '' },
    }
  },
  parseHTML() { return [{ tag: 'figure[data-latex-image]' }, { tag: 'img[data-latex-image]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['figure', { 'data-latex-image': 'true', class: 'latex-image-figure' },
      ['img', mergeAttributes(HTMLAttributes, { class: 'latex-image-block' })],
      ['figcaption', {}, node.attrs.caption || ''],
    ]
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node
      const dom = document.createElement('figure')
      dom.className = 'latex-image-figure'
      dom.contentEditable = 'false'
      const image = document.createElement('img')
      image.className = 'latex-image-block'
      const caption = document.createElement('input')
      caption.type = 'text'
      caption.className = 'latex-image-caption'
      caption.placeholder = 'Nhập chú thích cho hình…'
      caption.setAttribute('aria-label', 'Chú thích hình')
      caption.maxLength = 500
      const refresh = () => {
        image.src = current.attrs.src || ''
        image.alt = current.attrs.alt || ''
        if (caption.value !== current.attrs.caption) caption.value = current.attrs.caption || ''
        caption.disabled = !editor.isEditable
      }
      const onInput = () => {
        const position = getPos()
        if (!editor.isEditable || typeof position !== 'number') return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, caption: caption.value }))
      }
      const onFocus = () => {
        if (editor.isEditable) editor.view.dispatch(closeHistory(editor.state.tr))
      }
      const onKeyDown = event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault()
          if (event.key.toLowerCase() === 'y' || event.shiftKey) editor.commands.redo()
          else editor.commands.undo()
          return
        }
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault()
          const position = getPos()
          if (typeof position === 'number') editor.commands.focus(position + current.nodeSize)
        }
      }
      caption.addEventListener('input', onInput)
      caption.addEventListener('focus', onFocus)
      caption.addEventListener('keydown', onKeyDown)
      dom.append(image, caption)
      refresh()
      return {
        dom,
        update(nextNode) {
          if (nextNode.type !== current.type) return false
          current = nextNode
          refresh()
          return true
        },
        stopEvent: event => event.target === caption,
        ignoreMutation: () => true,
        destroy() {
          caption.removeEventListener('input', onInput)
          caption.removeEventListener('focus', onFocus)
          caption.removeEventListener('keydown', onKeyDown)
        },
      }
    }
  },
})
