import { describe, expect, it } from 'vitest'
import type { Block } from '../../shared/types'
import { parseDocument } from '../../shared/markdown'
import { makeQuoteAnchor } from '../../shared/quote-anchor'
import { noteReadMode, resolveNoteBlock, type NoteLocationTarget } from './note-location'

function paragraph(key: string, text: string, id: string | null = null): Block {
  return { id, key, text, source: text, kind: 'paragraph', depth: 0 }
}

function target(patch: Partial<NoteLocationTarget> = {}): NoteLocationTarget {
  return { blockId: null, blockKey: null, quote: 'Selected sentence.', quoteLang: 'source', ...patch }
}

describe('resolveNoteBlock', () => {
  it('resolves shared block ids only in the language that was quoted', () => {
    const en = paragraph('id:intro', 'Selected sentence.', 'intro')
    const zh = paragraph('id:intro', '引用的句子。', 'intro')

    expect(resolveNoteBlock(target({ blockId: 'intro' }), [en], [zh])).toEqual({
      block: en, reason: null, quoteFound: true
    })
    expect(resolveNoteBlock(target({ blockId: 'intro', quote: '引用的句子。', quoteLang: 'zh' }), [en], [zh])).toEqual({
      block: zh, reason: null, quoteFound: true
    })
  })

  it('reports a missing translation without using its source counterpart', () => {
    const en = paragraph('id:intro', 'Selected sentence.', 'intro')
    expect(resolveNoteBlock(target({ blockId: 'intro', quoteLang: 'zh' }), [en], null)).toEqual({
      block: null, reason: 'translation-missing', quoteFound: false
    })
    expect(resolveNoteBlock(target({ blockId: 'intro', quoteLang: 'zh' }), [en], [])).toEqual({
      block: null, reason: 'block-missing', quoteFound: false
    })
  })

  it('does not find an English note in the Chinese document', () => {
    const zh = paragraph('id:intro', 'Selected sentence.', 'intro')
    expect(resolveNoteBlock(target({ blockId: 'intro', blockKey: 'id:intro' }), [], [zh])).toEqual({
      block: null, reason: 'block-missing', quoteFound: false
    })
  })

  it('prefers a stable block id even when the saved key points elsewhere', () => {
    const current = paragraph('id:intro', 'Updated sentence.', 'intro')
    const other = paragraph('old-key', 'Selected sentence.')
    expect(resolveNoteBlock(target({ blockId: 'intro', blockKey: 'old-key' }), [other, current], null)).toEqual({
      block: current, reason: null, quoteFound: false
    })
  })

  it('uses an exact key to distinguish duplicate block ids', () => {
    const first = paragraph('id:intro', 'First sentence.', 'intro')
    const second = paragraph('id:intro#1', 'Selected sentence.', 'intro')
    expect(resolveNoteBlock(target({ blockId: 'intro', blockKey: second.key }), [first, second], null)).toEqual({
      block: second, reason: null, quoteFound: true
    })
    expect(resolveNoteBlock(target({ blockId: 'intro', blockKey: 'missing-key' }), [first, second], null)).toEqual({
      block: null, reason: 'block-missing', quoteFound: false
    })
  })

  it('falls back to the saved key if the stable id is no longer present', () => {
    const current = paragraph('saved-key', 'Selected sentence.')
    expect(resolveNoteBlock(target({ blockId: 'removed-id', blockKey: current.key }), [current], null)).toEqual({
      block: current, reason: null, quoteFound: true
    })
  })

  it('finds an unmarked paragraph by its unique quote after its content hash changes', () => {
    const original = parseDocument('Before. Selected sentence.', 'Article').blocks[0]
    const current = parseDocument('After. Selected sentence. More details.', 'Article').blocks[0]
    expect(current.key).not.toBe(original.key)
    expect(resolveNoteBlock(target({ blockKey: original.key }), [current], null)).toEqual({
      block: current, reason: null, quoteFound: true
    })
  })

  it('normalizes whitespace in both the quote and paragraph', () => {
    const current = paragraph('new-key', 'Before Selected\n\t sentence. After')
    expect(resolveNoteBlock(target({ blockKey: 'old-key', quote: '  Selected  sentence.\n' }), [current], null)).toEqual({
      block: current, reason: null, quoteFound: true
    })
  })

  it('rejects a quote shared by several paragraphs', () => {
    const first = paragraph('first', 'Before Selected sentence.')
    const second = paragraph('second', 'Selected sentence. After')
    expect(resolveNoteBlock(target({ blockKey: 'old-key' }), [first, second], null)).toEqual({
      block: null, reason: 'block-missing', quoteFound: false
    })
  })

  it('keeps a known paragraph when its quote has been removed', () => {
    const current = paragraph('same-key', 'The paragraph has been rewritten.')
    expect(resolveNoteBlock(target({ blockKey: current.key }), [current], null)).toEqual({
      block: current, reason: null, quoteFound: false
    })
  })

  it('relocates a draft to its contextual paragraph after the key changes', () => {
    const before = 'First context. Selected sentence. The first conclusion.'
    const start = before.indexOf('Selected sentence.')
    const anchor = makeQuoteAnchor(before, start, start + 'Selected sentence.'.length)
    const current = paragraph('changed-key', `A new opening. ${before}`)
    const other = paragraph('other-key', 'Different context. Selected sentence. The other conclusion.')
    expect(resolveNoteBlock(target({ blockKey: 'old-key', quoteAnchor: anchor }), [other, current], null)).toEqual({
      block: current, reason: null, quoteFound: true
    })
  })

  it('returns the owning block for a nested marker saved by earlier versions', () => {
    const parent = parseDocument('- Parent\n\n  - <!-- block:child -->\n\n    Selected sentence.', 'Article').blocks[0]
    expect(resolveNoteBlock(target({ blockId: 'child', blockKey: 'id:child' }), [parent], null)).toEqual({
      block: parent, reason: null, quoteFound: true
    })
  })

  it('does not use an empty quote or a removed quote to guess a paragraph', () => {
    const current = paragraph('new-key', 'A different sentence.')
    for (const quote of ['   \n', 'Selected sentence.']) {
      expect(resolveNoteBlock(target({ blockKey: 'old-key', quote }), [current], null)).toEqual({
        block: null, reason: 'block-missing', quoteFound: false
      })
    }
  })
})

describe('noteReadMode', () => {
  it('preserves bilingual mode for either quote language', () => {
    expect(noteReadMode('bilingual', 'source')).toBe('bilingual')
    expect(noteReadMode('bilingual', 'zh')).toBe('bilingual')
  })

  it('selects the quote language when reading a single language', () => {
    expect(noteReadMode('source', 'zh')).toBe('zh')
    expect(noteReadMode('zh', 'source')).toBe('source')
    expect(noteReadMode('source', 'source')).toBe('source')
    expect(noteReadMode('zh', 'zh')).toBe('zh')
  })
})
