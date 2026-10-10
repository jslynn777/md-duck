import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseDocument } from '../../shared/markdown'
import { makeQuoteAnchor } from '../../shared/quote-anchor'
import { BlockView, findRange, quoteSelectionForRange } from './blocks'

vi.mock('@shared/words', async () => import('../../shared/words'))
vi.mock('@shared/quote-anchor', async () => import('../../shared/quote-anchor'))
vi.mock('./i18n', () => ({ useT: () => (key: string) => key }))

function render(markdown: string, dir = '/library') {
  return parseDocument(markdown, 'test').blocks.map((block) => renderToStaticMarkup(createElement(BlockView, {
    block, dir, version: 0, lang: 'source', notes: [], flash: false,
    speaking: false, paused: false, onImage: () => undefined, onAnnotate: () => undefined, onTranslate: () => undefined
  }))).join('')
}

describe('Markdown content rendering', () => {
  it('renders quoted lists, code, and nested quotes rather than silently omitting them', () => {
    const html = render('> A checklist:\n>\n> - Keep artwork.\n>\n> ```text\n> quoted code\n> ```\n>\n> > Inner quote.\n')
    expect(html).toContain('Keep artwork.')
    expect(html).toContain('<code>quoted code</code>')
    expect(html).toContain('<blockquote')
    expect(html).toContain('Inner quote.')
    expect(html.indexOf('Keep artwork.')).toBeLessThan(html.indexOf('quoted code'))
    expect(html.indexOf('quoted code')).toBeLessThan(html.indexOf('Inner quote.'))
  })

  it('keeps list paragraphs separate and places nested content before later paragraphs', () => {
    const html = render('- First paragraph.\n\n  Second paragraph.\n\n  - Nested item.\n\n  Final paragraph.\n\n  ```text\n  list code\n  ```\n')
    for (const text of ['First paragraph.', 'Second paragraph.', 'Nested item.', 'Final paragraph.']) {
      expect(html).toMatch(new RegExp(`<p[^>]*>${text.replaceAll('.', '\\.')}<\\/p>`))
    }
    expect(html).toContain('<code>list code</code>')
    expect(html.indexOf('Nested item.')).toBeLessThan(html.indexOf('Final paragraph.'))
  })

  it('renders reference images and links with the resolved destination', () => {
    const html = render('[Read][guide]\n\n![Bow][photo]\n\n[guide]: https://example.com/guide\n[photo]: assets/bow.png\n')
    expect(html).toContain('href="https://example.com/guide"')
    expect(html).toContain('alt="Bow"')
    expect(html).toContain(encodeURIComponent('/library/assets/bow.png'))
  })

  it('routes Windows absolute, file URL, and inline relative images through the local asset protocol', () => {
    const html = render('![Drive](D:/图片/photo%20one.png)\n\n![File](file:///C:/资料/photo.png)\n\nInline ![Relative](assets/配图.png).', 'C:\\资料\\文章')
    for (const destination of ['D:/图片/photo one.png', 'C:/资料/photo.png', 'C:/资料/文章/assets/配图.png']) {
      expect(html).toContain(encodeURIComponent(destination))
    }
    expect(html).not.toContain('src="file:')
  })

  it('omits unsupported image schemes without changing ordinary text', () => {
    const html = render('![Blocked](data:image/png;base64,AAAA)\n\nText ![Blocked](ftp://example.com/photo.png).')
    expect(html).not.toContain('<img')
    expect(html).toContain('Text ')
  })

  it('provides a dedicated note-text host for table and fenced code', () => {
    const html = render('| Word | Meaning |\n| --- | --- |\n| bank | river edge |\n\n```text\nbank bank\n```')
    expect(html).toMatch(/<table[^>]*data-note-text="true"/)
    expect(html).toMatch(/<pre[^>]*data-note-text="true"/)
    expect(html).toContain('data-note-cell="true"')
  })
})

// Small DOM contract fixture: real text-node offsets are asserted independently of
// whitespace normalization. Native UI verification must exercise Chromium's Range too.
class TestNode {
  parentNode: TestNode | null = null
  nodeType: number
  data = ''
  tagName = ''
  childNodes: TestNode[] = []
  attrs = new Set<string>()
  ownerDocument = { createRange: () => new TestRange(this.root()) }
  constructor(textOrTag: string, text = false, children: TestNode[] = [], attrs: string[] = []) {
    this.nodeType = text ? 3 : 1
    if (text) this.data = textOrTag
    else this.tagName = textOrTag.toUpperCase()
    this.childNodes = children
    children.forEach((child) => { child.parentNode = this })
    this.attrs = new Set(attrs)
  }
  get parentElement(): TestNode | null { return this.parentNode?.nodeType === 1 ? this.parentNode : null }
  hasAttribute(name: string) { return this.attrs.has(name) }
  contains(node: TestNode): boolean { return node === this || this.childNodes.some((child): boolean => child.contains(node)) }
  querySelector() { return this.childNodes.find((child) => child.hasAttribute('data-note-text')) ?? null }
  root(): TestNode { return this.parentNode?.root() ?? this }
  length(): number { return this.nodeType === 3 ? this.data.length : this.childNodes.reduce((n, child) => n + child.length(), 0) }
  position(node: TestNode, offset: number): number {
    let cursor = 0
    let result = -1
    const walk = (current: TestNode) => {
      cursor += 1
      if (current.nodeType === 3) {
        if (current === node) result = cursor + offset
        cursor += current.data.length + 1
      } else {
        current.childNodes.forEach((child, index) => {
          if (current === node && offset === index) result = cursor
          walk(child)
        })
        if (current === node && offset === current.childNodes.length) result = cursor
        cursor += 1
      }
    }
    walk(this)
    return result
  }
}

class TestRange {
  startContainer: TestNode
  endContainer: TestNode
  startOffset = 0
  endOffset = 0
  constructor(private root: TestNode) { this.startContainer = root; this.endContainer = root }
  setStart(node: TestNode, offset: number) { this.startContainer = node; this.startOffset = offset }
  setEnd(node: TestNode, offset: number) { this.endContainer = node; this.endOffset = offset }
  comparePoint(node: TestNode, offset: number) {
    const position = this.root.position(node, offset)
    return position < this.root.position(this.startContainer, this.startOffset) ? -1 :
      position > this.root.position(this.endContainer, this.endOffset) ? 1 : 0
  }
}

const text = (value: string) => new TestNode(value, true)
const element = (tag: string, children: TestNode[], attrs: string[] = []) => new TestNode(tag, false, children, attrs)
const asElement = (node: TestNode) => node as unknown as Element

describe('note DOM ranges', () => {
  it('highlights the second repeated word using its saved anchor', () => {
    const value = 'The bank is near the river bank.'
    const leaf = text(value)
    const host = element('span', [leaf])
    const start = value.lastIndexOf('bank')
    const range = findRange(asElement(host), 'bank', makeQuoteAnchor(value, start, start + 4))!
    expect(range.startContainer).toBe(leaf)
    expect(range.startOffset).toBe(start)
    expect(range.endOffset).toBe(start + 4)
    expect(findRange(asElement(host), 'bank')).toBeNull()
  })

  it('maps normalized spaces back to all original whitespace across inline formatting', () => {
    const first = text('Use    repeated ')
    const strong = text('spaces')
    const last = text('   in this sentence.')
    const host = element('span', [first, element('strong', [strong]), last], ['data-note-text'])
    const range = findRange(asElement(host), 'repeated spaces   in')!
    expect(range.startContainer).toBe(first)
    expect(range.startOffset).toBe(7)
    expect(range.endContainer).toBe(last)
    expect(range.endOffset).toBe(5)
    const selection = new TestRange(host)
    selection.setStart(first, 7); selection.setEnd(last, 5)
    const block = parseDocument('Use    repeated **spaces**   in this sentence.', 'spaces').blocks[0]
    expect(quoteSelectionForRange(block, asElement(host), selection as unknown as Range)).toMatchObject({
      quote: 'repeated spaces in', quoteAnchor: { start: 4, end: 22 }
    })
  })

  it('maps a table selection to the actual cell without including neighboring controls', () => {
    const word = text('Word'), meaning = text('Meaning'), bank = text('bank'), river = text('river edge')
    const host = element('table', [
      element('tr', [element('th', [word], ['data-note-cell']), element('th', [meaning], ['data-note-cell'])]),
      element('tr', [element('td', [bank], ['data-note-cell']), element('td', [river], ['data-note-cell'])])
    ], ['data-note-text'])
    const block = parseDocument('| Word | Meaning |\n| --- | --- |\n| bank | river edge |', 'table').blocks[0]
    const range = findRange(asElement(host), 'bank | river edge')!
    expect(range.startContainer).toBe(bank)
    expect(range.endContainer).toBe(river)
    const selection = new TestRange(host)
    selection.setStart(bank, 0); selection.setEnd(river, 10)
    expect(quoteSelectionForRange(block, asElement(host), selection as unknown as Range)).toMatchObject({
      quote: 'bank | river edge', quoteAnchor: { start: 15, end: 32 }
    })
    selection.setStart(bank, 0); selection.setEnd(bank, 4)
    expect(quoteSelectionForRange(block, asElement(host), selection as unknown as Range)).toMatchObject({
      quote: 'bank', quoteAnchor: { start: 15, end: 19 }
    })
  })

  it('supports repeated text in code and skips nested list markers', () => {
    const code = text('bank    bank')
    const codeHost = element('pre', [element('code', [code])])
    const range = findRange(asElement(codeHost), 'bank', makeQuoteAnchor('bank bank', 5, 9))!
    expect(range.startOffset).toBe(8)
    expect(range.endOffset).toBe(12)
    const item = text('A nested item.')
    const listHost = element('div', [element('span', [text('•')], ['data-note-ignore']), element('p', [item], ['data-note-part'])])
    expect(findRange(asElement(listHost), 'A nested item.')?.startContainer).toBe(item)
    expect(findRange(asElement(listHost), '•')).toBeNull()
  })
})
