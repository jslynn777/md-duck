import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPathInsideRoot } from './allowed-path'
import { PREVIEW_READ_LIMIT, previewImagePath, readSpacePreview } from './space-preview'

let fixture: string, root: string, source: string
beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-preview-')))
  root = join(fixture, 'library')
  source = join(root, 'article.md')
  await fs.mkdir(join(root, 'assets'), { recursive: true })
})
afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }) })
const read = () => readSpacePreview(source, { scope: 'space-fixture', version: 7, isAllowed: path => isPathInsideRoot(path, root) })

describe('local space article covers', () => {
  it('finds nested, reference and table images in article order, deduplicated and limited to three', async () => {
    for (const name of ['one.png', 'two.jpg', 'three.webp', 'four.svg']) await fs.writeFile(join(root, 'assets', name), 'image fixture')
    await fs.writeFile(source, '# Article\n\nA short introduction.\n\n> - ![first](assets/one.png)\n\n![same](assets/one.png)\n\n![second][photo]\n\n| Picture |\n| --- |\n| ![third](assets/three.webp) |\n\n![fourth](assets/four.svg)\n\n[photo]: assets/two.jpg\n')
    const preview = await read()
    expect(preview.text).toContain('A short introduction.')
    const urls = preview.images.map(value => new URL(value))
    expect(urls.map(url => url.searchParams.get('path'))).toEqual(['one.png', 'two.jpg', 'three.webp'].map(name => join(root, 'assets', name)))
    for (const url of urls) {
      expect(url.protocol).toBe('md-duck:')
      expect(url.hostname).toBe('asset')
      expect(url.searchParams.get('scope')).toBe('space-fixture')
      expect(url.searchParams.get('v')).toBe('7')
    }
  })

  it('rejects outside files, symlink escapes, remote URLs and missing images while accepting an in-root symlink', async () => {
    const outside = join(fixture, 'private.png'), inside = join(root, 'assets', 'safe.png')
    await fs.writeFile(outside, 'outside'); await fs.writeFile(inside, 'inside')
    await fs.symlink(outside, join(root, 'assets', 'escape.png'))
    await fs.symlink(inside, join(root, 'assets', 'alias.png'))
    await fs.writeFile(source, `![remote](https://example.invalid/a.png)\n\n![outside](${outside})\n\n![escape](assets/escape.png)\n\n![missing](assets/missing.png)\n\n![alias](assets/alias.png)\n\n![same](assets/safe.png)\n`)
    const preview = await read()
    expect(preview.images).toHaveLength(1)
    expect(new URL(preview.images[0]).searchParams.get('path')).toBe(inside)
    await fs.unlink(source); await fs.symlink(outside, source)
    expect(await read()).toEqual({ text: '', images: [] })
  })

  it('reads at most 128 KiB and never emits unscoped URLs', async () => {
    await fs.writeFile(join(root, 'assets', 'late.png'), 'fixture')
    await fs.writeFile(source, '# Article\n\n' + 'a'.repeat(PREVIEW_READ_LIMIT) + '\n\n![late](assets/late.png)')
    expect((await read()).images).toEqual([])
    await fs.writeFile(source, 'Text.\n\n![local](assets/late.png)')
    expect(await readSpacePreview(source, { version: 1, isAllowed: path => isPathInsideRoot(path, root) })).toEqual({ text: 'Text.', images: [] })
  })
})

describe('preview local path mapping', () => {
  it('handles macOS paths and file URLs with encoded spaces', () => {
    expect(previewImagePath('/library/series/article.md', '../assets/a%20b.png', 'darwin')).toBe('/library/assets/a b.png')
    expect(previewImagePath('/library/article.md', 'file:///library/assets/a%20b.png', 'darwin')).toBe('/library/assets/a b.png')
  })
  it('handles Windows drive, rooted and UNC paths without depending on the host platform', () => {
    expect(previewImagePath('C:\\library\\series\\article.md', '..\\assets\\one.png', 'win32')).toBe('C:\\library\\assets\\one.png')
    expect(previewImagePath('C:\\library\\article.md', '/assets/one.png', 'win32')).toBe('C:\\assets\\one.png')
    expect(previewImagePath('C:\\library\\article.md', 'file:///C:/library/a%20b.jpg', 'win32')).toBe('C:\\library\\a b.jpg')
    expect(previewImagePath('\\\\server\\share\\series\\article.md', '../assets/one.png', 'win32')).toBe('\\\\server\\share\\assets\\one.png')
    expect(previewImagePath('C:\\library\\article.md', 'file://server/share/one.png', 'win32')).toBe('\\\\server\\share\\one.png')
  })
  it('rejects nonlocal schemes, drive-relative paths and encoded separators in file URLs', () => {
    for (const value of ['https://example.invalid/a.png', 'data:image/png;base64,abc', 'md-duck://asset/?path=/a.png', 'C:relative.png', '%43:relative.png', 'file:///library/a%2Fb.png', 'file:///library/a%5Cb.png', 'a%00.png']) {
      expect(previewImagePath('/library/article.md', value, 'darwin')).toBeNull()
      expect(previewImagePath('C:\\library\\article.md', value, 'win32')).toBeNull()
    }
    expect(previewImagePath('/library/article.md', '//server/share/a.png', 'darwin')).toBeNull()
    expect(previewImagePath('/library/article.md', 'file://server/share/a.png', 'darwin')).toBeNull()
  })
})
