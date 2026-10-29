import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { AUTHORING_EXAMPLE, getAuthoringPrompt, getExcerptRevisionPrompt, getPublishingPrompt, getRevisionPrompt } from './authoring-guide'
import { alignBlocks, parseDocument, reconcileNotes } from './markdown'
import { inspectPairing } from './pairing-diagnostics'
import type { Note } from './types'

describe('the copyable authoring examples', () => {
  it('produces a complete bilingual pair, including each list item and the table', () => {
    const source = parseDocument(AUTHORING_EXAMPLE.source, 'article')
    const zh = parseDocument(AUTHORING_EXAMPLE.zh, 'article.zh')
    expect(source.warnings).toEqual([])
    expect(zh.warnings).toEqual([])
    expect(source.blocks.map((block) => block.id)).toEqual([
      'title', 'intro', 'steps', 'check-meaning', 'check-detail', 'review-table', 'finish'
    ])
    expect(source.blocks.filter((block) => block.kind === 'listItem')).toHaveLength(2)
    expect(inspectPairing({ sourceText: AUTHORING_EXAMPLE.source, zhText: AUTHORING_EXAMPLE.zh, source, zh }))
      .toMatchObject({ status: 'complete', pairedSource: 7, pairedZh: 7, issues: [] })
    expect(alignBlocks(source.blocks, zh.blocks).rows.every((row) => row.source?.id === row.zh?.id)).toBe(true)
  })

  it.each(['zh', 'en'] as const)('the %s prompt teaches list markers that the actual parser recognizes', (language) => {
    const prompt = getAuthoringPrompt(language)
    const list = prompt.split('\n').filter((line) => /^- <!-- block:check-/.test(line)).join('\n')
    const parsed = parseDocument(list, 'steps')
    expect(parsed.blocks.map((block) => [block.kind, block.id])).toEqual([
      ['listItem', 'check-source'], ['listItem', 'check-detail']
    ])
    expect(parsed.warnings).toEqual([])
  })

  it('keeps a review attached and requests review again when the illustrated revision changes its quotation', () => {
    const changed = parseDocument(AUTHORING_EXAMPLE.source.replace('one section at a time', 'one short paragraph at a time'), 'article')
    const note: Note = { id: 'example-note', blockId: 'intro', blockKey: 'id:intro',
      quote: 'one section at a time', quoteLang: 'source', comment: 'Be more specific.',
      createdAt: '2026-10-26T00:00:00Z', status: 'open' }
    expect(reconcileNotes([note], changed.blocks, parseDocument(AUTHORING_EXAMPLE.zh, 'article.zh').blocks)[0])
      .toMatchObject({ id: 'example-note', blockId: 'intro', blockKey: 'id:intro', status: 'outdated' })
  })

  it.each(['01-a-slower-morning', '02-a-good-question'])('the downloadable %s starter has complete pairs and available local images', (folder) => {
    const root = new URL(`../../website/public/examples/md-duck-starter/${folder}/`, import.meta.url)
    const sourceText = readFileSync(new URL('article.md', root), 'utf8')
    const zhText = readFileSync(new URL('article.zh.md', root), 'utf8')
    const source = parseDocument(sourceText, 'article')
    const zh = parseDocument(zhText, 'article.zh')
    expect(source.warnings).toEqual([])
    expect(zh.warnings).toEqual([])
    expect(inspectPairing({ sourceText, zhText, source, zh }))
      .toMatchObject({ status: 'complete', pairedSource: 6, pairedZh: 6, issues: [] })
    expect(source.blocks.map((block) => [block.id, block.kind]))
      .toEqual(zh.blocks.map((block) => [block.id, block.kind]))
    for (const doc of [source, zh]) {
      const images = doc.blocks.flatMap((block) => block.inlines ?? []).filter((inline) => inline.type === 'image')
      expect(images).toHaveLength(1)
      for (const image of images) {
        expect(image.url).toMatch(/^assets\/[a-z-]+\.svg$/)
        expect(existsSync(new URL(image.url, root))).toBe(true)
      }
    }
  })
})

describe('external AI handoffs', () => {
  const languages = [
    { language: 'zh', excerpt: /截图/, flexibleFolders: /不必每篇建文件夹/, noClassification: /不会自动给文章分类/,
      missingSource: /没有全文时先索取/, localAccess: /没有权限时/,
      noPublish: /不要自动发布/, confirm: /等我明确确认本次发布后/, verify: /实际打开公开页面/,
      reader: /MD Duck 本身不连接后台/, keepLocal: /保留本地文章/ },
    { language: 'en', excerpt: /screenshot/, flexibleFolders: /do not each need a folder/, noClassification: /does not classify articles automatically/,
      missingSource: /Ask for the full text if missing/, localAccess: /Without access/,
      noPublish: /Do not publish.*automatically/, confirm: /wait for my explicit confirmation of this publication/,
      verify: /open the public page/, reader: /MD Duck itself does not connect to a CMS/, keepLocal: /Keep the local manuscript/ }
  ] as const

  it.each(languages)('the $language excerpt handoff preserves local state and does not require notes', (copy) => {
    const prompt = getExcerptRevisionPrompt(copy.language)
    expect(prompt).toMatch(copy.excerpt)
    expect(prompt).toMatch(copy.missingSource)
    expect(prompt).toMatch(copy.localAccess)
    expect(prompt).toMatch(copy.noPublish)
    for (const marker of ['<!-- block:... -->', '.review/', '.mdduck/']) expect(prompt).toContain(marker)
    // Existing copy buttons keep their exported prompt functions and usable content.
    expect(getAuthoringPrompt(copy.language)).toMatch(copy.excerpt)
    expect(getAuthoringPrompt(copy.language)).toMatch(copy.flexibleFolders)
    expect(getAuthoringPrompt(copy.language)).toMatch(copy.noClassification)
    expect(getRevisionPrompt(copy.language)).toContain('<!-- block:... -->')
  })

  it.each(languages)('the $language publishing handoff separates approval, verification and local retention', (copy) => {
    const prompt = getPublishingPrompt(copy.language)
    expect(prompt).toMatch(copy.reader)
    expect(prompt).toMatch(copy.confirm)
    expect(prompt).toMatch(copy.verify)
    expect(prompt).toMatch(copy.keepLocal)
    expect(prompt.search(copy.confirm)).toBeLessThan(prompt.search(copy.verify))
    for (const folder of ['.review/', '.mdduck/']) expect(prompt).toContain(folder)
  })
})
