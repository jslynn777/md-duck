import { describe, expect, it } from 'vitest'
import { compareDocumentChanges, type DocumentContent } from './document-changes'
import { parseDocument } from './markdown'

const content = (sourceText: string, zhText: string | null = null): DocumentContent => ({ sourceText, zhText })
const marked = (...blocks: Array<[string, string]>) => blocks.map(([id, text]) => `<!-- block:${id} -->\n\n${text}`).join('\n\n')
const diff = (before: string, after: string) => compareDocumentChanges(content(before), content(after))

describe('compareDocumentChanges', () => {
  it('does not report another save of identical original and translated files', () => {
    const original = content('# A guide\n\nKeep the source.', '# 指南\n\n保留原稿。')
    expect(compareDocumentChanges(original, { ...original })).toEqual([])
  })

  it('uses stable block IDs and provides the real rendered target for a modified paragraph', () => {
    const before = marked(['title', '# Inquiry'], ['detail', 'Ask for a quote.'])
    const after = marked(['title', '# Inquiry'], ['detail', 'State the product, size and quantity.'])
    expect(diff(before, after)).toEqual([expect.objectContaining({
      side: 'source', kind: 'modified', before: 'Ask for a quote.', after: 'State the product, size and quantity.',
      beforeKey: 'id:detail', afterKey: 'id:detail', targetKey: 'id:detail'
    })])
  })

  it('reports additions without falsely marking all subsequent paragraphs as moved', () => {
    const before = marked(['a', 'First.'], ['b', 'Second.'])
    const after = marked(['intro', 'New introduction.'], ['a', 'First.'], ['b', 'Second.'])
    expect(diff(before, after)).toEqual([expect.objectContaining({ kind: 'added', targetKey: 'id:intro', before: '', after: 'New introduction.' })])
  })

  it('retains deleted text and jumps to the closest surviving paragraph', () => {
    const before = marked(['a', 'First.'], ['gone', 'This was removed.'], ['b', 'Last.'])
    const after = marked(['a', 'First.'], ['b', 'Last.'])
    expect(diff(before, after)).toEqual([expect.objectContaining({ kind: 'deleted', before: 'This was removed.', after: '', targetKey: 'id:b', beforeKey: 'id:gone' })])
  })

  it('can inspect complete deletion without inventing a target that no longer exists', () => {
    const changes = diff(marked(['a', 'First.'], ['b', 'Last.']), '')
    expect(changes).toHaveLength(2)
    expect(changes.every(change => change.kind === 'deleted' && change.targetKey === null)).toBe(true)
  })

  it('aligns an unmarked edit between unchanged blocks instead of reporting two unrelated changes', () => {
    const before = '# Guide\n\nA vague explanation.\n\nThe ending stays.'
    const after = '# Guide\n\nA detailed explanation with a useful next step.\n\nThe ending stays.'
    const change = diff(before, after)
    const targetKey = parseDocument(after, '').blocks[1].key
    expect(change).toEqual([expect.objectContaining({ kind: 'modified', before: 'A vague explanation.', targetKey, afterKey: targetKey })])
    expect(change[0].beforeKey).not.toBe(change[0].afterKey)
  })

  it('distinguishes an unmarked insertion from a neighboring unmodified paragraph', () => {
    const before = '# Guide\n\nFirst.\n\nLast.'
    const after = '# Guide\n\nFirst.\n\nInserted.\n\nLast.'
    expect(diff(before, after)).toEqual([expect.objectContaining({ kind: 'added', after: 'Inserted.' })])
  })

  it('reports a paragraph moved among stable IDs once', () => {
    const before = marked(['a', 'First.'], ['b', 'Second.'], ['c', 'Third.'])
    const after = marked(['b', 'Second.'], ['c', 'Third.'], ['a', 'First.'])
    expect(diff(before, after)).toEqual([expect.objectContaining({ kind: 'moved', before: 'First.', after: 'First.', targetKey: 'id:a' })])
  })

  it('detects reordering of unmarked paragraphs too', () => {
    const changes = diff('First.\n\nSecond.\n\nThird.', 'Second.\n\nThird.\n\nFirst.')
    expect(changes).toEqual([expect.objectContaining({ kind: 'moved', before: 'First.', after: 'First.' })])
  })

  it('does not collapse repeated paragraphs or reuse the same target', () => {
    const before = 'Same.\n\nSame.\n\nEnding.'
    const after = 'Same.\n\nEdited copy.\n\nEnding.'
    expect(diff(before, after)).toEqual([expect.objectContaining({ kind: 'modified', before: 'Same.', after: 'Edited copy.' })])
    const removed = diff('Same.\n\nSame.', 'Same.')
    expect(removed).toHaveLength(1)
    expect(removed[0].kind).toBe('deleted')
    expect(removed[0].beforeKey).toContain('#1')
  })

  it('keeps later paragraphs inspectable when an article contains duplicate explicit markers', () => {
    const before = marked(['same', 'First occurrence.'], ['same', 'Second occurrence.'], ['end', 'Last.'])
    const after = marked(['same', 'First occurrence.'], ['same', 'Second occurrence was edited.'], ['end', 'Last.'])
    const parsed = parseDocument(after, '')
    expect(parsed.warnings).toContain('duplicate:same')
    const changes = diff(before, after)
    expect(changes).toEqual([expect.objectContaining({ kind: 'modified', before: 'Second occurrence.', after: 'Second occurrence was edited.', targetKey: parsed.blocks[1].key })])
    expect(changes[0].targetKey).not.toBe('id:same')
  })

  it('shows Markdown formatting and link destination edits despite equal plain text', () => {
    expect(diff('A **good** guide.', 'A *good* guide.')).toEqual([expect.objectContaining({ kind: 'modified', before: 'A **good** guide.', after: 'A *good* guide.' })])
    expect(diff('[Read more](https://old.example)', '[Read more](https://new.example)')).toEqual([expect.objectContaining({ kind: 'modified' })])
  })

  it('shows reference definitions when a changed reference URL is outside the paragraph source', () => {
    const before = '[Read more][guide]\n\n[guide]: https://old.example'
    const after = '[Read more][guide]\n\n[guide]: https://new.example'
    expect(diff(before, after)).toEqual([expect.objectContaining({ kind: 'modified', before, after })])
  })

  it('compares translations independently when the source is untouched', () => {
    const changes = compareDocumentChanges(content('Original.', '较笼统的译文。'), content('Original.', '说明更准确的译文。'))
    expect(changes).toEqual([expect.objectContaining({ side: 'zh', kind: 'modified', before: '较笼统的译文。', after: '说明更准确的译文。' })])
  })

  it('retains a removed translation for review and recognizes an added translation', () => {
    const removed = compareDocumentChanges(content('Original.', '# 中文\n\n原来的翻译。'), content('Original.'))
    expect(removed).toHaveLength(2)
    expect(removed.every(change => change.kind === 'deleted' && change.side === 'zh' && change.targetKey === null)).toBe(true)
    const added = compareDocumentChanges(content('Original.'), content('Original.', '新的翻译。'))
    expect(added).toEqual([expect.objectContaining({ side: 'zh', kind: 'added', after: '新的翻译。' })])
  })

  it('does not produce an empty detail list when an empty translation file is added or removed', () => {
    expect(compareDocumentChanges(content('Same.'), content('Same.', ''))).toEqual([expect.objectContaining({ side: 'zh', kind: 'added' })])
    expect(compareDocumentChanges(content('Same.', ''), content('Same.'))).toEqual([expect.objectContaining({ side: 'zh', kind: 'deleted' })])
  })

  it('provides an inspectable fallback for frontmatter-only and marker-only changes', () => {
    const before = '---\ntitle: Old title\n---\n\nArticle body.'
    const after = '---\ntitle: New title\n---\n\nArticle body.'
    expect(diff(before, after)).toEqual([expect.objectContaining({ id: 'source:document', kind: 'modified', before, after })])
    const markerChange = diff('<!-- block:a -->\n\nSame.', '<!-- block:b -->\n\nSame.')
    expect(markerChange.map(change => change.kind).sort()).toEqual(['added', 'deleted'])
  })

  it('does not match content with distinct explicit identities just because the words are similar', () => {
    const changes = diff(marked(['old', 'A sentence.']), marked(['new', 'An updated sentence.']))
    expect(changes.map(change => change.kind).sort()).toEqual(['added', 'deleted'])
  })

  it('handles a long fully removed document with unique, inspectable entries', () => {
    const before = Array.from({ length: 2000 }, (_, index) => `Paragraph ${index}.`).join('\n\n')
    const changes = diff(before, '')
    expect(changes).toHaveLength(2000)
    expect(new Set(changes.map(change => change.id)).size).toBe(2000)
    expect(changes.every(change => change.targetKey === null)).toBe(true)
  })
})
