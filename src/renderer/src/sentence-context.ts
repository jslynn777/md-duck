const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

/** Resolve the sentence at the clicked character, including later occurrences of a word. */
export function sentenceAt(text: string, offset: number): string {
  const position = Math.max(0, Math.min(text.length - 1, offset))
  for (const item of sentenceSegmenter.segment(text)) {
    if (position >= item.index && position < item.index + item.segment.length) {
      return item.segment.replace(/\s+/g, ' ').trim()
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

function contextHost(element: Element): Element | null {
  const block = element.closest('[data-key]')
  if (!block) return null
  // A quote can contain several paragraphs; table cells are independent contexts too.
  const host = element.closest('p, .text, th, td') ?? block
  return block.contains(host) ? host : null
}

/** Read only the text that surrounds this rendered word; never change the user's selection. */
export function sentenceForElement(element: Element): string | undefined {
  const host = contextHost(element)
  if (!host) return undefined
  const prefix = element.ownerDocument.createRange()
  prefix.selectNodeContents(host)
  prefix.setEndBefore(element)
  const text = host.textContent ?? ''
  return sentenceAt(text, prefix.toString().length) || undefined
}

/** Get the context for a selected word using its actual position in the paragraph. */
export function sentenceForRange(range: Range): string | undefined {
  const start = range.startContainer
  const element = start.nodeType === 1 ? start as Element : start.parentElement
  const host = element ? contextHost(element) : null
  if (!host || !host.contains(range.endContainer)) return undefined
  const prefix = range.cloneRange()
  prefix.selectNodeContents(host)
  prefix.setEnd(start, range.startOffset)
  return sentenceAt(host.textContent ?? '', prefix.toString().length) || undefined
}
