import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeSpaceArticlePath, spaceContextPrompt, spaceOpenUrl, type SpaceRecord } from '../shared/spaces'
import { createSpaceLaunchData, parseSpaceLaunchData, parseSpaceOpenUrl, parseSpaceTargetArgs, resolveSpaceArticle } from './space-target'

const fixtures: string[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map((path) => fs.rm(path, { recursive: true, force: true }))) })

describe('explicit AI space targeting', () => {
  it('round trips an article with Unicode, whitespace, URL punctuation and Windows separators', () => {
    const target = { spaceId: 'a67367f1-af92-4f73-b735-dc9e854ef065', relativePath: '系列 01/notes & questions #1?.md' }
    expect(parseSpaceOpenUrl(spaceOpenUrl(target))).toEqual(target)
    expect(normalizeSpaceArticlePath('series\\01-example\\article.md')).toBe('series/01-example/article.md')
    expect(parseSpaceOpenUrl('mdduck://open?space=sp_yituo')).toEqual({ spaceId: 'sp_yituo' })
  })

  it.each([
    'https://open?space=abc', 'mdduck://other?space=abc', 'mdduck://user@open?space=abc',
    'mdduck://open:999?space=abc', 'mdduck://open/other?space=abc', 'mdduck://open?space=abc#fragment',
    'mdduck://open', 'mdduck://open?space=', 'mdduck://open?space=../escape',
    'mdduck://open?space=one&space=two', 'mdduck://open?space=one&path=a.md&path=b.md',
    'mdduck://open?space=one&unknown=x', 'mdduck://open?space=one&path=',
    'mdduck://open?space=one&path=../outside.md', 'mdduck://open?space=one&path=%2e%2e%2foutside.md',
    'mdduck://open?space=one&path=C%3A%5Coutside.md', 'mdduck://open?space=one&path=%2Ftmp%2Foutside.md',
    'mdduck://open?space=one&path=a.md%00', 'mdduck://open?space=one&path=readme.exe'
  ])('rejects malformed or ambiguous URL %s', (url) => {
    expect(() => parseSpaceOpenUrl(url)).toThrow('ERR_SPACE_TARGET')
  })

  it('parses explicit CLI flags without binding to whichever space is visible', () => {
    expect(parseSpaceTargetArgs(['/Applications/MD Duck.app/Contents/MacOS/MD Duck', '--mdduck-space', 'space-1', '--mdduck-file', 'series/second.md'])).toEqual({ spaceId: 'space-1', relativePath: 'series/second.md' })
    expect(parseSpaceTargetArgs(['C:\\Program Files\\MD Duck\\MD Duck.exe', '--mdduck-space=space-2', '--mdduck-file=series\\article.md'])).toEqual({ spaceId: 'space-2', relativePath: 'series/article.md' })
    expect(parseSpaceTargetArgs(['electron', '--inspect=9229', 'out/main/index.js'])).toBeNull()
    expect(parseSpaceTargetArgs(['electron', spaceOpenUrl({ spaceId: 'space-3' })])).toEqual({ spaceId: 'space-3' })
  })

  it.each([
    ['--mdduck-file', 'article.md'], ['--mdduck-space'], ['--mdduck-space='],
    ['--mdduck-space', 'a', '--mdduck-space', 'b'],
    ['--mdduck-space', 'a', '--mdduck-file', '../b.md'],
    ['--mdduck-space', 'a', '--mdduck-file'],
    ['mdduck://open?space=a', '--mdduck-space', 'b'],
    ['mdduck://open?space=a', 'mdduck://open?space=b']
  ].map((args) => ({ args })))('rejects incomplete or conflicting CLI arguments $args', ({ args }) => {
    expect(() => parseSpaceTargetArgs(args)).toThrow('ERR_SPACE_TARGET')
  })

  it('preserves the original explicit target when Electron reorders second-instance arguments', () => {
    const data = createSpaceLaunchData(['electron', 'repo', '--mdduck-space', 'space-a', '--mdduck-file', '系列 01/article.md'])
    expect(data).toEqual({ mdduckLaunch: { version: 1, target: { spaceId: 'space-a', relativePath: '系列 01/article.md' }, invalid: false } })
    expect(() => parseSpaceTargetArgs(['electron', '--mdduck-file', '--mdduck-space', 'repo', 'space-a', '系列 01/article.md'])).toThrow('ERR_SPACE_TARGET')
    expect(parseSpaceLaunchData(JSON.parse(JSON.stringify(data)))).toEqual({ target: { spaceId: 'space-a', relativePath: '系列 01/article.md' }, invalid: false })
    expect(parseSpaceLaunchData(createSpaceLaunchData(['--mdduck-space=space-b', '--mdduck-file=series\\article.md']))).toEqual({ target: { spaceId: 'space-b', relativePath: 'series/article.md' }, invalid: false })
    expect(parseSpaceLaunchData(createSpaceLaunchData(['mdduck://open?space=space-c']))).toEqual({ target: { spaceId: 'space-c' }, invalid: false })
  })

  it('distinguishes ordinary activation, invalid targeting and launchers without metadata', () => {
    expect(createSpaceLaunchData(['electron', 'repo'])).toEqual({ mdduckLaunch: { version: 1, target: null, invalid: false } })
    expect(parseSpaceLaunchData(createSpaceLaunchData(['--mdduck-file', '../other.md']))).toEqual({ target: null, invalid: true })
    for (const value of [undefined, null, false, 'legacy', {}, { other: true }]) expect(parseSpaceLaunchData(value)).toBeUndefined()
  })

  it.each([
    null, [], false, {}, { version: 2, target: null, invalid: false },
    { version: 1, target: null }, { version: 1, invalid: false },
    { version: 1, target: null, invalid: 0 }, { version: 1, target: null, invalid: false, future: true },
    { version: 1, target: 'space-a', invalid: false },
    { version: 1, target: { spaceId: 'space-a' }, invalid: true },
    { version: 1, target: { spaceId: '../space-a' }, invalid: false },
    { version: 1, target: { spaceId: 'space-a', extra: 'unsafe' }, invalid: false },
    { version: 1, target: { spaceId: 'space-a', relativePath: '../other.md' }, invalid: false },
    { version: 1, target: { spaceId: 'space-a', relativePath: '/other.md' }, invalid: false },
    { version: 1, target: { spaceId: 'space-a', relativePath: undefined }, invalid: false },
    { version: 1, target: { spaceId: 'space-a', relativePath: 9 }, invalid: false }
  ])('rejects malformed second-instance metadata without silently falling back: %j', (envelope) => {
    expect(() => parseSpaceLaunchData({ mdduckLaunch: envelope })).toThrow('ERR_SPACE_TARGET')
  })

  it('resolves existing articles but refuses symlinks escaping the target root or absent files', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'md-duck-target-test-'))
    fixtures.push(dir)
    const root = join(dir, 'space')
    await fs.mkdir(root)
    const article = join(root, 'article.md')
    await fs.writeFile(article, '# Article')
    const outside = join(dir, 'outside.md')
    await fs.writeFile(outside, '# Other space')
    await fs.symlink(outside, join(root, 'escape.md'))
    await expect(resolveSpaceArticle(root, 'article.md')).resolves.toBe(await fs.realpath(article))
    await expect(resolveSpaceArticle(root, 'escape.md')).rejects.toThrow('ERR_SPACE_TARGET')
    await expect(resolveSpaceArticle(root, 'missing.md')).rejects.toThrow('ERR_SPACE_DOCUMENT_MISSING')
    await expect(resolveSpaceArticle(root, '../outside.md')).rejects.toThrow('ERR_SPACE_TARGET')
  })

  it('includes the selected space, current file and real authoring rules in both languages', () => {
    const space: SpaceRecord = { id: 'space-one', name: '亿拓文章', root: 'C:\\Articles\\yituo', createdAt: '2026-11-17T00:00:00Z', lastOpenedAt: '2026-11-17T00:00:00Z' }
    for (const language of ['zh', 'en'] as const) {
      const prompt = spaceContextPrompt({ space, relativePath: 'series/article.md' }, language)
      expect(prompt).toContain(space.root)
      expect(prompt).toContain(space.id)
      expect(prompt).toContain('series/article.md')
      expect(prompt).toContain(spaceOpenUrl({ spaceId: space.id, relativePath: 'series/article.md' }))
      expect(prompt).toContain('assets/')
      expect(prompt).toContain('article.zh.md')
      expect(prompt).toContain('.review/')
    }
  })
})
