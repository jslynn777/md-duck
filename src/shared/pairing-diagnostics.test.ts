import { describe, expect, it } from 'vitest'
import { alignBlocks, parseDocument } from './markdown'
import { inspectPairing, type PairingInput } from './pairing-diagnostics'
import { alignTranslatedBlocks, translationContentHash } from './translation-alignment'
import type { TranslationAlignment } from './translation'

function input(sourceText: string, zhText: string | null, alignment?: TranslationAlignment): PairingInput {
  return { sourceText, zhText, source: parseDocument(sourceText, 'Source'),
    zh: zhText === null ? null : parseDocument(zhText, 'Chinese'), alignment }
}
function sidecar(sourceText: string, zhText: string): TranslationAlignment {
  const source = parseDocument(sourceText, '').blocks
  const zh = parseDocument(zhText, '').blocks
  return { sourceHash: translationContentHash(sourceText), targetHash: translationContentHash(zhText),
    pairs: source.map((block, index) => ({ sourceKey: block.key, targetKey: zh[index].key })) }
}

describe('whole-document pairing diagnostics', () => {
  it('distinguishes a missing or empty companion from two unmarked documents', () => {
    expect(inspectPairing(input('# Source\n\nText.', null))).toMatchObject({
      status: 'missing-companion', totalSource: 2, totalZh: 0, pairedSource: 0, issues: []
    })
    expect(inspectPairing(input('Text.', '   '))).toMatchObject({ status: 'missing-companion' })
    expect(inspectPairing(input('One.\n\nTwo.', '一。\n\n二。'))).toMatchObject({
      status: 'unmarked', method: 'none', pairedSource: 0, pairedZh: 0, independent: true, issues: []
    })
  })

  it('verifies full marker coverage without making a translation correctness claim', () => {
    const report = inspectPairing(input('<!-- block:a -->\n\n# Heading\n\n<!-- block:b -->\n\nText.',
      '<!-- block:a -->\n\n# 标题\n\n<!-- block:b -->\n\n段落。'))
    expect(report).toEqual({ status: 'complete', method: 'markers', totalSource: 2, totalZh: 2,
      pairedSource: 2, pairedZh: 2, independent: false, sidecar: 'absent', issues: [] })
  })

  it('checks content after the first good pair instead of stopping early', () => {
    const data = input('<!-- block:a -->\n\nFirst.\n\n<!-- block:b -->\n\nSecond.\n\n<!-- block:a -->\n\nDuplicate.',
      '<!-- block:a -->\n\n第一。\n\n<!-- block:b -->\n\n第二。')
    expect(alignBlocks(data.source.blocks, data.zh!.blocks).warning).toBeNull()
    const report = inspectPairing(data)
    expect(report).toMatchObject({ status: 'partial', pairedSource: 1, totalSource: 3, totalZh: 2, independent: false })
    expect(report.issues).toContainEqual(expect.objectContaining({ kind: 'duplicate-marker', markerId: 'a', severity: 'warning',
      source: expect.objectContaining({ blockKey: data.source.blocks[2].key, line: 11, markerLine: 9 }) }))
  })

  it('still checks the source annotations when no companion exists', () => {
    const source = '<!-- block:a -->\n\nFirst.\n\n<!-- block:a -->\n\nSecond.\n\n<!-- block:unused -->'
    expect(inspectPairing(input(source, null))).toMatchObject({ status: 'missing-companion', pairedSource: 0,
      issues: [expect.objectContaining({ kind: 'duplicate-marker', markerId: 'a' }),
        expect.objectContaining({ kind: 'unassigned-marker', markerId: 'unused' })] })
  })

  it('recognizes the parser-supported indented standalone annotations', () => {
    expect(inspectPairing(input('  <!-- block:a -->\n\nOne.', '  <!-- block:a -->\n\n一。'))).toMatchObject({
      status: 'complete', method: 'markers', pairedSource: 1, issues: [] })
  })

  it('lists missing markers and unmatched IDs across both complete documents', () => {
    const data = input('<!-- block:a -->\n\nFirst.\n\nNo marker.\n\n<!-- block:source-only -->\n\nLast.',
      '<!-- block:a -->\n\n第一。\n\n<!-- block:zh-only -->\n\n最后。')
    const report = inspectPairing(data)
    expect(report).toMatchObject({ status: 'partial', pairedSource: 1, pairedZh: 1, totalSource: 3, totalZh: 2 })
    expect(report.issues.map((issue) => issue.kind)).toEqual(['unmarked-block', 'unmatched-marker', 'unmatched-marker'])
    expect(report.issues.find((issue) => issue.kind === 'unmarked-block')).toMatchObject({ severity: 'info',
      source: { side: 'source', blockKey: data.source.blocks[1].key, line: 5, endLine: 5 } })
    expect(report.issues.find((issue) => issue.markerId === 'source-only')).toMatchObject({
      source: { side: 'source', blockKey: 'id:source-only', line: 9, endLine: 9, markerLine: 7 } })
    expect(report.issues.find((issue) => issue.markerId === 'zh-only')?.zh?.side).toBe('zh')
  })

  it('identifies reversed anchors and keeps the existing reader rows untouched', () => {
    const data = input('<!-- block:a -->\n\nA.\n\n<!-- block:b -->\n\nB.\n\n<!-- block:c -->\n\nC.',
      '<!-- block:b -->\n\n乙。\n\n<!-- block:a -->\n\n甲。\n\n<!-- block:c -->\n\n丙。')
    const before = structuredClone(alignBlocks(data.source.blocks, data.zh!.blocks))
    const blocks = JSON.stringify([data.source.blocks, data.zh!.blocks])
    const report = inspectPairing(data)
    expect(report).toMatchObject({ status: 'partial', pairedSource: 1, independent: false })
    expect(report.issues.filter((issue) => issue.kind === 'marker-order').map((issue) => issue.markerId)).toEqual(['a', 'b'])
    expect(alignBlocks(data.source.blocks, data.zh!.blocks)).toEqual(before)
    expect(JSON.stringify([data.source.blocks, data.zh!.blocks])).toBe(blocks)
  })

  it('reports incompatible kinds, list children and table dimensions', () => {
    const cases = [
      ['<!-- block:a -->\n\n# Heading', '<!-- block:a -->\n\n段落。'],
      ['<!-- block:a -->\n\n- One.\n  - Nested.', '<!-- block:a -->\n\n- 一。'],
      ['<!-- block:a -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', '<!-- block:a -->\n\n| 甲 |\n| --- |\n| 一 |']
    ]
    for (const [source, zh] of cases) {
      expect(inspectPairing(input(source, zh))).toMatchObject({ status: 'unmatched', pairedSource: 0,
        issues: [expect.objectContaining({ kind: 'block-shape', markerId: 'a' })] })
    }
  })

  it('uses real file lines with CRLF frontmatter and inline annotations', () => {
    const source = '---\r\ntitle: Example\r\ndescription: Details\r\n---\r\n\r\n- <!-- block:a --> One.\r\n\r\n- <!-- block:missing --> Two.\r\n'
    const report = inspectPairing(input(source, '- <!-- block:a --> 一。'))
    expect(report.issues.find((issue) => issue.markerId === 'missing')).toMatchObject({
      source: { side: 'source', blockKey: 'id:missing', line: 8, endLine: 8, markerLine: 8 } })
  })

  it('locates nested annotation problems at their stable top-level reading row', () => {
    const data = input('<!-- block:outer -->\n\n- Outer.\n  - <!-- block:inner --> Child.\n  - <!-- block:inner --> Duplicate.',
      '<!-- block:outer -->\n\n- 外层。\n  - <!-- block:inner --> 子项。\n  - 第二项。')
    const report = inspectPairing(data)
    const duplicate = report.issues.find((issue) => issue.kind === 'duplicate-marker')!
    expect(duplicate.source).toMatchObject({ side: 'source', blockKey: 'id:outer', line: 5, markerLine: 5 })
    expect(duplicate.source?.nestedBlockKey).toBeTruthy()
    expect(report.status).toBe('partial')
  })

  it('reports overwritten, trailing and middle-of-paragraph annotations with useful locations', () => {
    const data = input('<!-- block:unused -->\n\n<!-- block:a -->\n\nOne.\n\nMiddle <!-- block:middle --> text.\n\n<!-- block:trailing -->',
      '<!-- block:a -->\n\n一。')
    const report = inspectPairing(data)
    expect(report.issues.filter((issue) => issue.kind === 'unassigned-marker').map((issue) => issue.markerId)).toEqual(['unused', 'middle', 'trailing'])
    expect(report.issues.find((issue) => issue.markerId === 'unused')?.source).toMatchObject({ line: 1, blockKey: 'id:a' })
    expect(report.issues.find((issue) => issue.markerId === 'middle')?.source).toMatchObject({ line: 7, blockKey: data.source.blocks[1].key })
    expect(report.issues.find((issue) => issue.markerId === 'trailing')?.source).toMatchObject({ line: 9, blockKey: data.source.blocks[1].key })
  })

  it('gives multiple same-line duplicate problems unique stable identifiers', () => {
    const data = input('<!-- block:a --> <!-- block:a --> <!-- block:a --> Text.', '<!-- block:a --> 译文。')
    const first = inspectPairing(data)
    expect(first.issues.filter((issue) => issue.kind === 'duplicate-marker')).toHaveLength(2)
    expect(new Set(first.issues.map((issue) => issue.id)).size).toBe(first.issues.length)
    expect(inspectPairing(data).issues.map((issue) => issue.id)).toEqual(first.issues.map((issue) => issue.id))
  })

  it('does not mistake marker examples in code or YAML for pairing declarations', () => {
    const source = '---\ntitle: "<!-- block:yaml -->"\n---\n\n```md\n<!-- block:example -->\n```\n\nUse `<!-- block:inline-code -->` here.'
    expect(inspectPairing(input(source, '```md\n<!-- block:example -->\n```\n\n代码示例。'))).toMatchObject({
      status: 'unmarked', method: 'none', issues: [] })
  })

  it('accepts already verified versioned pairs without demanding new markers', () => {
    const source = '# Heading\n\nParagraph.'
    const zh = '# 标题\n\n段落。'
    expect(inspectPairing(input(source, zh, sidecar(source, zh)))).toEqual({ status: 'complete', method: 'translation-sidecar',
      totalSource: 2, totalZh: 2, pairedSource: 2, pairedZh: 2, independent: false, sidecar: 'valid', issues: [] })
  })

  it('distinguishes stale and invalid sidecars without fabricating positional pairing', () => {
    const source = '# Heading\n\nParagraph.'
    const zh = '# 标题\n\n段落。'
    const alignment = sidecar(source, zh)
    expect(inspectPairing(input(source + '\n\nChanged.', zh, alignment))).toMatchObject({ status: 'unmarked',
      pairedSource: 0, independent: true, sidecar: 'stale', issues: [expect.objectContaining({ kind: 'stale-sidecar' })] })
    expect(inspectPairing(input(source, zh, { ...alignment, pairs: [{ sourceKey: 'missing', targetKey: 'missing' }] }))).toMatchObject({
      status: 'unmarked', pairedSource: 0, independent: true, sidecar: 'invalid', issues: [expect.objectContaining({ kind: 'invalid-sidecar' })] })
    expect(inspectPairing({ ...input(source, zh), alignmentState: 'stale' })).toMatchObject({ sidecar: 'stale' })
    expect(inspectPairing({ ...input(source, zh), alignmentState: 'invalid' })).toMatchObject({ sidecar: 'invalid' })
    const staleIssue = inspectPairing(input(source + '\nChanged.', zh, alignment)).issues[0]
    expect(staleIssue.source).toBeUndefined()
    expect(staleIssue.zh).toBeUndefined()
    expect(inspectPairing(input(source, zh, { ...alignment, pairs: null } as unknown as TranslationAlignment))).toMatchObject({
      status: 'unmarked', sidecar: 'invalid', issues: [expect.objectContaining({ kind: 'invalid-sidecar' })] })
  })

  it('still verifies explicit IDs when an old sidecar became stale', () => {
    const source = '<!-- block:a -->\n\nA.'
    const zh = '<!-- block:a -->\n\n甲。'
    const alignment = sidecar(source, zh)
    const changed = input(source.replace('A.', 'Updated.'), zh, alignment)
    expect(inspectPairing(changed)).toMatchObject({ status: 'complete', method: 'markers', pairedSource: 1,
      sidecar: 'stale', independent: false, issues: [expect.objectContaining({ kind: 'stale-sidecar' })] })
  })

  it('keeps the known legacy sidecar mapping after structural rendering changes', () => {
    const source = '- Outer\n  - Child\n\n![Photo][p]\n\n[p]: photo.png'
    const zh = '- 外层\n  - 子项\n\n![照片][p]\n\n[p]: photo.png'
    const data = input(source, zh)
    const left = data.source.blocks
    const right = data.zh!.blocks
    const child = (blocks: typeof left) => blocks[0].items!.find((block) => block.kind === 'listItem')!
    const alignment = { sourceHash: translationContentHash(source), targetHash: translationContentHash(zh), pairs: [
      { sourceKey: left[0].key, targetKey: right[0].key },
      { sourceKey: child(left).key, targetKey: child(right).key },
      { sourceKey: left[1].key.replace(':image', ':paragraph'), targetKey: right[1].key.replace(':image', ':paragraph') }
    ] }
    expect(inspectPairing({ ...data, alignment })).toMatchObject({ status: 'complete', sidecar: 'valid', pairedSource: 2, issues: [] })
    expect(alignTranslatedBlocks(left, right, source, zh, alignment).rows).toHaveLength(2)
  })

  it('reports nested shape differences even if a legacy shallow sidecar still renders rows', () => {
    const source = '- Outer\n  - Child'
    const zh = '- 外层'
    expect(inspectPairing(input(source, zh, sidecar(source, zh)))).toMatchObject({ sidecar: 'valid',
      status: 'unmatched', pairedSource: 0, independent: false, issues: [expect.objectContaining({ kind: 'block-shape' })] })
  })
})
