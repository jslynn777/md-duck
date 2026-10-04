import { describe, expect, it } from 'vitest'
import { alignBlocks, formatTasks, parseDocument, reconcileNotes } from './markdown'
import type { Note } from './types'
import { makeQuoteAnchor } from './quote-anchor'

const english = `---
title: Christmas Ribbon
description: How to choose a bow that holds.
---

<!-- block:intro -->

Wired ribbon holds a bow through the party.

<!-- block:width -->

## Width

<!-- block:width-body -->

For a standard wreath, start with 2.5-inch ribbon.

<!-- block:items -->

- Wired ribbon
- Floral wire

<!-- block:photo -->

![Bow](assets/bow.png)

<!-- block:sample -->

\`\`\`text
2.5 inch
\`\`\`
`

const chinese = `<!-- block:intro -->

铁丝边丝带能让蝴蝶结在聚会后还保持形状。

<!-- block:width -->

## 宽度

<!-- block:width-body -->

普通花环先用 2.5 英寸丝带。

<!-- block:photo -->

![蝴蝶结](assets/bow.png)
`

describe('parseDocument', () => {
  it('reads frontmatter and keeps block ids in order', () => {
    const doc = parseDocument(english, 'article')
    expect(doc.title).toBe('Christmas Ribbon')
    expect(doc.description).toContain('holds')
    expect(doc.blocks.map((block) => block.id)).toEqual(['intro', 'width', 'width-body', 'items', null, 'photo', 'sample'])
    expect(doc.blocks.find((block) => block.id === 'photo')?.kind).toBe('image')
    expect(doc.blocks.find((block) => block.id === 'sample')?.kind).toBe('code')
  })

  it('reads a block marker at the start of an ordered list item', () => {
    const doc = parseDocument('<!-- block:step-share -->\n\n1. **Share your request.** Send the file.\n', 'steps')
    expect(doc.blocks.map((block) => [block.id, block.marker, block.text])).toEqual([['step-share', '1.', 'Share your request. Send the file.']])
  })

  it('keeps the previously documented inline list-marker syntax readable', () => {
    const doc = parseDocument('- <!-- block:ribbon --> **Wired ribbon**\n- <!-- block:wire --> Floral wire\n', 'list')
    expect(doc.blocks.map((block) => [block.id, block.text])).toEqual([['ribbon', 'Wired ribbon'], ['wire', 'Floral wire']])
    expect(doc.blocks[0].items?.[0].inlines).toEqual([{ type: 'strong', children: [{ type: 'text', value: 'Wired ribbon' }] }])
    expect(doc.blocks[0].source).toBe('- <!-- block:ribbon --> **Wired ribbon**')
  })

  it('retains a list marker on its own line and text after a block marker', () => {
    const doc = parseDocument('- <!-- block:separate -->\n\n  Separate text.\n\n<!-- block:inline --> Inline text.\n', 'list')
    expect(doc.blocks.map((block) => [block.id, block.text])).toEqual([['separate', 'Separate text.'], ['inline', 'Inline text.']])
    expect(doc.blocks[1].source).toBe('Inline text.')
  })

  it('drops active urls from links and images', () => {
    const doc = parseDocument('[go](javascript:alert(1))\n\n![x](data:text/html,hi)\n', 'plain')
    const rendered = JSON.stringify(doc.blocks.map((block) => block.inlines))
    expect(rendered).not.toContain('javascript:')
    expect(rendered).not.toContain('data:')
  })

  it('preserves lists, code, and further quotes inside a quote in their original order', () => {
    const doc = parseDocument('> A checklist:\n>\n> - Keep artwork.\n> - Ask about the sample.\n>\n> ```text\n> quoted code\n> ```\n>\n> > A nested quote.\n', 'quote')
    const quote = doc.blocks[0]
    expect(quote.kind).toBe('blockquote')
    expect(quote.items?.map((item) => item.kind)).toEqual(['paragraph', 'listItem', 'listItem', 'code', 'blockquote'])
    expect(quote.text).toBe('A checklist:\nKeep artwork.\nAsk about the sample.\nquoted code\nA nested quote.')
    expect(quote.items?.[3].code).toBe('quoted code')
    expect(quote.items?.[4].items?.[0].text).toBe('A nested quote.')
  })

  it('keeps list paragraphs, nested lists, and following code separate and in order', () => {
    const doc = parseDocument('- First paragraph.\n\n  Second paragraph.\n\n  - Nested item.\n\n  After the nested item.\n\n  ```text\n  list code\n  ```\n', 'list')
    expect(doc.blocks).toHaveLength(1)
    const item = doc.blocks[0]
    expect(item.items?.map((part) => part.kind)).toEqual(['paragraph', 'paragraph', 'listItem', 'paragraph', 'code'])
    expect(item.text).toBe('First paragraph.\nSecond paragraph.\nNested item.\nAfter the nested item.\nlist code')
    expect(item.items?.[4].code).toBe('list code')
  })

  it('resolves full, collapsed, and shortcut reference links and images document-wide', () => {
    const doc = parseDocument('[Read][GUIDE] and [guide][] and [guide].\n\n![Bow][photo]\n\n[guide]: https://example.com/guide\n[photo]: assets/bow.png\n', 'references')
    expect(doc.blocks).toHaveLength(2)
    expect(doc.blocks[0].inlines?.filter((inline) => inline.type === 'link').map((link) => link.url)).toEqual([
      'https://example.com/guide', 'https://example.com/guide', 'https://example.com/guide'
    ])
    expect(doc.blocks[1]).toMatchObject({ kind: 'image', inlines: [{ type: 'image', url: 'assets/bow.png', alt: 'Bow' }] })
    expect(doc.blocks[0].text).toBe('Read and guide and guide.')
  })

  it('applies unsafe-url protection to reference definitions too', () => {
    const doc = parseDocument('[Read][guide]\n\n![Bow][photo]\n\n[guide]: javascript:alert(1)\n[photo]: data:text/html,hi\n', 'unsafe')
    expect(JSON.stringify(doc.blocks)).not.toContain('"url":"javascript:')
    expect(JSON.stringify(doc.blocks)).not.toContain('"url":"data:')
    expect(doc.blocks[0].text).toBe('Read')
  })
})

describe('alignBlocks', () => {
  it('leaves a gap for a missing translation without shifting later blocks', () => {
    const en = parseDocument(english, 'article').blocks
    const zh = parseDocument(chinese, 'article').blocks
    const aligned = alignBlocks(en, zh)
    const ids = aligned.rows.map((row) => `${row.source?.id ?? '-'}|${row.zh?.id ?? '-'}`)
    expect(aligned.independent).toBe(false)
    expect(ids).toContain('width-body|width-body')
    expect(ids).toContain('items|-')
    expect(ids.indexOf('items|-')).toBeLessThan(ids.indexOf('photo|photo'))
  })

  it('does not pair unmarked documents by paragraph order', () => {
    const aligned = alignBlocks(parseDocument('One.\n\nTwo.\n', 'a').blocks, parseDocument('一。\n\n二。\n', 'b').blocks)
    expect(aligned.independent).toBe(true)
    expect(aligned.rows).toEqual([])
  })
})

describe('reconcileNotes', () => {
  const source = parseDocument(english, 'article').blocks
  const zh = parseDocument(chinese, 'article').blocks
  const note = (patch: Partial<Note>): Note => ({
    id: 'n1',
    blockId: 'width-body',
    blockKey: 'id:width-body',
    quote: '2.5-inch ribbon',
    quoteLang: 'source',
    comment: '写具体些',
    createdAt: '2026-09-24T00:00:00.000Z',
    status: 'open',
    ...patch
  })

  it('keeps a note on its block when the sentence changes', () => {
    const changed = parseDocument(english.replace('2.5-inch ribbon', '4-inch ribbon'), 'article').blocks
    const [next] = reconcileNotes([note({})], changed, zh)
    expect(next.status).toBe('outdated')
    expect(next.blockId).toBe('width-body')
  })

  it('orphans a note when the block id disappears', () => {
    const [next] = reconcileNotes([note({ blockId: 'missing' })], source, zh)
    expect(next.status).toBe('orphaned')
    expect(next.orphanReason).toBe('missing-block')
  })

  it('keeps a resolved note resolved after the text changes', () => {
    const changed = parseDocument(english.replace('2.5-inch ribbon', '4-inch ribbon'), 'article').blocks
    const [next] = reconcileNotes([note({ status: 'resolved' })], changed, zh)
    expect(next.status).toBe('resolved')
  })

  it('gives repeated unmarked paragraphs distinct keys', () => {
    const blocks = parseDocument('You could ask:\n\nOne.\n\nYou could ask:\n', 'x').blocks
    expect(new Set(blocks.map((block) => block.key)).size).toBe(3)
  })

  it('exports the english block when the comment was made on chinese', () => {
    const text = formatTasks(
      [note({ quoteLang: 'zh', quote: '2.5 英寸', comment: '和英文一起改' })],
      { folder: 'christmas-ribbon', source, zh }
    )
    expect(text).toContain('block:width-body')
    expect(text).toContain('2.5-inch ribbon')
    expect(text).toContain('和英文一起改')
    expect(text).toContain('keep existing')
  })

  it('retains the chosen unmarked block when multiple paragraphs contain the quote', () => {
    const blocks = parseDocument('The ribbon is ready. Check the sample.\n\nThe ribbon is ready. Check the artwork.\n', 'plain').blocks
    const [next] = reconcileNotes([note({ blockId: null, blockKey: blocks[1].key, quote: 'ribbon' })], blocks, null)
    expect(next.status).toBe('open')
    expect(next.blockKey).toBe(blocks[1].key)
  })

  it('uses surrounding context to retain an unmarked note after its block changes', () => {
    const original = parseDocument('The ribbon is ready. Check the sample.\n\nThe ribbon is ready. Check the artwork.\n', 'plain').blocks
    const start = original[1].text.indexOf('ribbon')
    const changed = parseDocument('The ribbon is ready. Check the sample.\n\nToday the ribbon is ready. Check the artwork.\n', 'plain').blocks
    const [next] = reconcileNotes([note({ blockId: null, blockKey: original[1].key, quote: 'ribbon',
      quoteAnchor: makeQuoteAnchor(original[1].text, start, start + 6) })], changed, null)
    expect(next.status).toBe('open')
    expect(next.blockKey).toBe(changed[1].key)
    expect(next.quoteAnchor?.start).toBe(changed[1].text.indexOf('ribbon'))
  })

  it('does not attach a legacy unmarked quote to an arbitrary repeated paragraph', () => {
    const blocks = parseDocument('The ribbon is ready. Check the sample.\n\nThe ribbon is ready. Check the artwork.\n', 'plain').blocks
    const [next] = reconcileNotes([note({ blockId: null, blockKey: 'removed', quote: 'ribbon' })], blocks, null)
    expect(next).toMatchObject({ status: 'orphaned', blockKey: null, orphanReason: 'ambiguous-quote' })
  })

  it('exports available context from ordinary Markdown without requiring block markers', () => {
    const blocks = parseDocument('Check the sample before ordering.\n\nCheck the artwork before ordering.\n', 'plain').blocks
    const text = formatTasks([note({ blockId: null, blockKey: blocks[1].key, quote: 'artwork' })], { folder: 'plain', source: blocks, zh: null })
    expect(text).toContain('Check the artwork before ordering.')
    expect(text).not.toContain('English block not found')
    expect(text).not.toContain('English block block:')
  })

  it('keeps legacy nested block markers useful for note location and export', () => {
    const blocks = parseDocument('- Outer item.\n\n  <!-- block:inner -->\n\n  - Inner ribbon.\n', 'nested').blocks
    const [next] = reconcileNotes([note({ blockId: 'inner', blockKey: 'id:inner', quote: 'ribbon' })], blocks, null)
    expect(next).toMatchObject({ status: 'open', blockKey: blocks[0].key })
    const text = formatTasks([next], { folder: 'nested', source: blocks, zh: null })
    expect(text).toContain('block:inner')
    expect(text).toContain('- Inner ribbon.')
  })

  it('exports the Chinese context without inventing an English counterpart for unmarked files', () => {
    const blocks = parseDocument('检查样稿。\n\n检查图稿。\n', 'plain').blocks
    const text = formatTasks([note({ blockId: null, blockKey: blocks[1].key, quoteLang: 'zh', quote: '图稿' })],
      { folder: 'plain', source: [], zh: blocks }, 'zh')
    expect(text).toContain('检查图稿。')
    expect(text).not.toContain('检查样稿。')
  })
})
