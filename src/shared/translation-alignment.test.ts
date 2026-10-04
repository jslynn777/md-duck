import { describe, expect, it } from 'vitest'
import { parseDocument } from './markdown'
import { alignTranslatedBlocks, translationContentHash } from './translation-alignment'

describe('versioned translation alignment', () => {
  const left = '# Heading\n\nParagraph.'
  const right = '# 标题\n\n段落。'
  const source = parseDocument(left, '').blocks
  const target = parseDocument(right, '').blocks
  const alignment = {
    sourceHash: translationContentHash(left), targetHash: translationContentHash(right),
    pairs: source.map((block, index) => ({ sourceKey: block.key, targetKey: target[index].key }))
  }
  it('pairs unmarked documents without mutating block identity', () => {
    const result = alignTranslatedBlocks(source, target, left, right, alignment)
    expect(result.independent).toBe(false)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].source).toBe(source[0])
    expect(result.rows[0].source?.id).toBeNull()
  })
  it('rejects stale source, stale target and invalid keys even when block counts agree', () => {
    expect(alignTranslatedBlocks(source, target, left + 'x', right, alignment).independent).toBe(true)
    expect(alignTranslatedBlocks(source, target, left, right + 'x', alignment).independent).toBe(true)
    const invalid = { ...alignment, pairs: alignment.pairs.map((pair) => ({ ...pair, targetKey: 'missing' })) }
    expect(alignTranslatedBlocks(source, target, left, right, invalid).independent).toBe(true)
  })
  it('preserves explicit user-authored block-marker behavior without valid metadata', () => {
    const a = parseDocument('<!-- block:a -->\n\nEnglish', '').blocks
    const b = parseDocument('<!-- block:a -->\n\n中文', '').blocks
    expect(alignTranslatedBlocks(a, b, '', '', null)).toMatchObject({ independent: false, warning: null })
  })

  it('retains a verified old sidecar after nested rows and reference images become structural content', () => {
    const left = '# Heading\n\n- Outer item.\n  - Inner item.\n\n![Photo][photo]\n\n[photo]: assets/photo.png'
    const right = '# 标题\n\n- 外层条目。\n  - 内层条目。\n\n![照片][photo]\n\n[photo]: assets/photo.png'
    const source = parseDocument(left, '').blocks
    const target = parseDocument(right, '').blocks
    const inner = (blocks: typeof source) => blocks[1].items!.find((block) => block.kind === 'listItem')!
    const metadata = {
      sourceHash: translationContentHash(left), targetHash: translationContentHash(right),
      pairs: [
        { sourceKey: source[0].key, targetKey: target[0].key },
        { sourceKey: source[1].key, targetKey: target[1].key },
        { sourceKey: inner(source).key, targetKey: inner(target).key },
        { sourceKey: source[2].key.replace(':image', ':paragraph'), targetKey: target[2].key.replace(':image', ':paragraph') }
      ]
    }
    const result = alignTranslatedBlocks(source, target, left, right, metadata)
    expect(result.independent).toBe(false)
    expect(result.rows).toHaveLength(3)
    expect(result.rows[1].source?.text).toContain('Inner item.')
    expect(result.rows[1].zh?.text).toContain('内层条目。')
    expect(result.rows[2].source?.kind).toBe('image')
    expect(alignTranslatedBlocks(source, target, `${left}\nChanged.`, right, metadata).independent).toBe(true)
    const invalid = { ...metadata, pairs: metadata.pairs.map((pair, index) => index === 2 ? { ...pair, sourceKey: 'unknown-row' } : pair) }
    expect(alignTranslatedBlocks(source, target, left, right, invalid).independent).toBe(true)
  })

  it('reconstructs the old document-wide suffix when nested and top-level list source repeats', () => {
    const left = '- Outer\n  - Same\n\n- Same'
    const right = '- 外层\n  - 相同\n\n- 相同'
    const source = parseDocument(left, '').blocks
    const target = parseDocument(right, '').blocks
    const inner = (blocks: typeof source) => blocks[0].items!.find((block) => block.kind === 'listItem')!
    expect(inner(source).key).toBe(source[1].key)
    const metadata = {
      sourceHash: translationContentHash(left), targetHash: translationContentHash(right),
      pairs: [
        { sourceKey: source[0].key, targetKey: target[0].key },
        { sourceKey: inner(source).key, targetKey: inner(target).key },
        { sourceKey: `${source[1].key}#1`, targetKey: `${target[1].key}#1` }
      ]
    }
    expect(alignTranslatedBlocks(source, target, left, right, metadata)).toMatchObject({ independent: false, rows: [{}, {}] })
  })

  it('rejects old-looking pairs that put nested items under different owners', () => {
    const left = '- First\n  - Child\n\n- Second'
    const right = '- 第一\n\n- 第二\n  - 子项'
    const source = parseDocument(left, '').blocks
    const target = parseDocument(right, '').blocks
    const child = (blocks: typeof source, index: number) => blocks[index].items!.find((block) => block.kind === 'listItem')!
    const metadata = {
      sourceHash: translationContentHash(left), targetHash: translationContentHash(right),
      pairs: [
        { sourceKey: source[0].key, targetKey: target[0].key },
        { sourceKey: child(source, 0).key, targetKey: target[1].key },
        { sourceKey: source[1].key, targetKey: child(target, 1).key }
      ]
    }
    expect(alignTranslatedBlocks(source, target, left, right, metadata).independent).toBe(true)
  })
})
