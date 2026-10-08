import { Fragment } from '@tiptap/pm/model'

function paragraphContent(node) {
  const content = []
  node?.content?.forEach(child => content.push(child))
  return content
}

function hasWhitespaceAtEdge(node, edge) {
  if (!node) return false
  if (node.type.name === 'hardBreak') return true
  if (!node.isText) return false
  return edge === 'start' ? /^\s/u.test(node.text) : /\s$/u.test(node.text)
}

function equalAttrs(first, second) {
  return JSON.stringify(first.attrs) === JSON.stringify(second.attrs)
}

function offsetAtIndex(parent, index) {
  let offset = 0
  for (let child = 0; child < index; child += 1) offset += parent.child(child).nodeSize
  return offset
}

function mergeFormulaWithParagraphs(schema, inlineMath, before, after) {
  const content = before ? paragraphContent(before) : []
  const last = content.at(-1)
  if (last && !hasWhitespaceAtEdge(last, 'end')) content.push(schema.text(' ', last.marks))
  content.push(inlineMath)

  const afterContent = paragraphContent(after)
  const first = afterContent[0]
  if (first && !hasWhitespaceAtEdge(first, 'start')) content.push(schema.text(' ', first.marks))
  content.push(...afterContent)

  const paragraph = before || after
  return paragraph
    ? paragraph.copy(Fragment.fromArray(content))
    : schema.nodes.paragraph.create(null, content)
}

function replaceBlockWithInline(transaction, position, blockNode, inlineNode) {
  const $position = transaction.doc.resolve(position)
  const parent = $position.parent
  const index = $position.index()
  const previous = index > 0 ? parent.child(index - 1) : null
  const next = index + 1 < parent.childCount ? parent.child(index + 1) : null
  const previousParagraph = previous?.type.name === 'paragraph' ? previous : null
  const nextParagraph = next?.type.name === 'paragraph' ? next : null

  let before = null
  let after = null
  if (previousParagraph && nextParagraph && equalAttrs(previousParagraph, nextParagraph)) {
    before = previousParagraph
    after = nextParagraph
  } else if (previousParagraph && !nextParagraph) {
    before = previousParagraph
  } else if (nextParagraph && !previousParagraph) {
    after = nextParagraph
  }

  if (before || after) {
    const firstIndex = before ? index - 1 : index
    const endIndex = after ? index + 2 : index + 1
    const parentStart = $position.start()
    const from = parentStart + offsetAtIndex(parent, firstIndex)
    const to = parentStart + offsetAtIndex(parent, endIndex)
    const paragraph = mergeFormulaWithParagraphs(transaction.doc.type.schema, inlineNode, before, after)
    const replacement = Fragment.from(paragraph)
    if (parent.canReplace(firstIndex, endIndex, replacement)) {
      transaction.replaceWith(from, to, paragraph)
      return transaction
    }
  }

  transaction.replaceRangeWith(position, position + blockNode.nodeSize, inlineNode)
  return transaction
}

export function updateMathNode(state, position, latex, displayType) {
  const current = state?.doc?.nodeAt(position)
  if (!current || !['inlineMath', 'blockMath'].includes(current.type.name)) return null

  const targetName = displayType === 'block' ? 'blockMath' : 'inlineMath'
  const targetType = state.schema.nodes[targetName]
  if (!targetType) return null

  const targetNode = targetType.create({ ...current.attrs, latex })
  const transaction = state.tr
  if (current.type === targetType) {
    transaction.setNodeMarkup(position, targetType, { ...current.attrs, latex })
    return transaction.docChanged ? transaction : null
  }

  if (current.type.name === 'blockMath') {
    return replaceBlockWithInline(transaction, position, current, targetNode)
  }

  transaction.replaceRangeWith(position, position + current.nodeSize, targetNode)
  return transaction.docChanged ? transaction : null
}
