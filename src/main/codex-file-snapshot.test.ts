import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_SNAPSHOT_HASH_LIMIT, CODEX_SNAPSHOT_MAX_FILES, CODEX_SNAPSHOT_TOTAL_HASH_LIMIT, snapshotCodexFiles } from './codex-file-snapshot'

let fixture: string, root: string
beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-codex-snapshot-')))
  root = join(fixture, 'Articles')
  await fs.mkdir(root)
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(fixture, { recursive: true, force: true }) })
async function write(path: string, content: string) { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, content) }
const changed = (before: Record<string, string>, after: Record<string, string>) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]).sort()

describe('Codex article file snapshots', () => {
  it('detects edited, created and deleted articles and images with portable relative paths', async () => {
    await write(join(root, 'Series', 'article.md'), '# Original\n')
    await write(join(root, 'Series', 'article.zh.md'), '# 原文\n')
    await write(join(root, 'Series', 'assets', 'cover.PNG'), 'before')
    await write(join(root, 'remove.markdown'), 'Remove me')
    const before = await snapshotCodexFiles(root)
    await write(join(root, 'Series', 'article.md'), '# Revised\n')
    await write(join(root, 'Series', 'assets', 'cover.PNG'), 'after image')
    await write(join(root, 'new.md'), '# New\n')
    await fs.unlink(join(root, 'remove.markdown'))
    expect(changed(before, await snapshotCodexFiles(root))).toEqual(['Series/article.md', 'Series/assets/cover.PNG', 'new.md', 'remove.markdown'])
    expect(before['Series/article.md']).toBe('sha256:' + createHash('sha256').update('# Original\n').digest('hex'))
  })

  it('hashes complete Markdown contents and does not report metadata-only touches as content changes', async () => {
    const path = join(root, 'article.md'), body = '# Example\n' + 'paragraph\n'.repeat(25_000)
    await write(path, body)
    const before = await snapshotCodexFiles(root)
    await fs.utimes(path, new Date(0), new Date(0))
    expect(await snapshotCodexFiles(root)).toEqual(before)
    await write(path, body.slice(0, -5) + 'EDIT!')
    await fs.utimes(path, new Date(0), new Date(0))
    expect(changed(before, await snapshotCodexFiles(root))).toEqual(['article.md'])
  })

  it('uses high-resolution stat fingerprints for oversized Markdown and images without reading their contents', async () => {
    const large = join(root, 'large.md'), image = join(root, 'image.png')
    await write(large, ''); await fs.truncate(large, CODEX_SNAPSHOT_HASH_LIMIT + 1)
    await write(image, 'image')
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (String(args[0]) === large || String(args[0]) === image) vi.spyOn(handle, 'read').mockImplementation(async () => { throw Error('Snapshot must not read oversized Markdown or image bytes') })
      return handle
    })
    const before = await snapshotCodexFiles(root)
    expect(before['large.md']).toMatch(/^stat:/)
    expect(before['image.png']).toMatch(/^stat:/)
    const info = await fs.stat(image)
    await write(image, 'other')
    await fs.utimes(image, info.atime, info.mtime)
    expect(changed(before, await snapshotCodexFiles(root))).toEqual(['image.png'])
  })

  it('excludes hidden metadata, dependencies, build outputs and non-article files', async () => {
    for (const path of ['.review/notes.md', '.mdduck/tasks.md', '.git/README.md', 'node_modules/dep/a.md', 'build/a.md', 'out/a.md', 'dist/a.md', 'coverage/a.md', 'article.txt', 'script.py', '.private.md']) await write(join(root, path), 'ignored')
    await write(join(root, 'Archive', 'kept.md'), 'Archived article')
    expect(Object.keys(await snapshotCodexFiles(root))).toEqual(['Archive/kept.md'])
  })

  it('never follows internal or escaping symlinks and handles a canonical root alias', async () => {
    await write(join(root, 'article.md'), 'inside')
    const outside = join(fixture, 'private')
    await write(join(outside, 'secret.md'), 'outside')
    await fs.symlink(join(outside, 'secret.md'), join(root, 'escape.md'))
    await fs.symlink(outside, join(root, 'escape-dir'), 'junction')
    await fs.symlink(join(root, 'article.md'), join(root, 'alias.md'))
    await fs.symlink(root, join(root, 'loop'), 'junction')
    const alias = join(fixture, 'root-alias')
    await fs.symlink(root, alias, 'junction')
    expect(Object.keys(await snapshotCodexFiles(alias))).toEqual(['article.md'])
  })

  it('rejects an oversized file set instead of returning an incomplete comparison', async () => {
    const snapshotRoot = root
    for (let start = 0; start <= CODEX_SNAPSHOT_MAX_FILES; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, CODEX_SNAPSHOT_MAX_FILES + 1 - start) }, (_, index) => write(join(snapshotRoot, `${start + index}.md`), '')))
    }
    await expect(snapshotCodexFiles(snapshotRoot)).rejects.toThrow('ERR_CODEX_SNAPSHOT_LIMIT')
    // Real 2,001-file I/O takes longer on Windows runners. Let it settle before
    // teardown and the next test install their FileHandle.read spies.
  }, 30_000)

  it('stops at the total Markdown hash budget without switching remaining files to stat fingerprints', async () => {
    for (let index = 0; index < 4; index++) {
      const path = join(root, `${index}.md`)
      await write(path, '')
      await fs.truncate(path, CODEX_SNAPSHOT_HASH_LIMIT)
    }
    let bytes = 0
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args), read = handle.read.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation(async (...values) => {
        const result = await read(...values)
        bytes += result.bytesRead
        return result
      })
      return handle
    })
    await expect(snapshotCodexFiles(root)).rejects.toThrow('ERR_CODEX_SNAPSHOT_LIMIT')
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThanOrEqual(CODEX_SNAPSHOT_TOTAL_HASH_LIMIT)
  })

  it('reports missing roots and unreadable subfolders rather than treating them as deletions', async () => {
    await expect(snapshotCodexFiles(join(fixture, 'missing'))).rejects.toThrow('ERR_CODEX_SNAPSHOT')
    const denied = join(root, 'denied')
    await write(join(denied, 'article.md'), 'Preserve')
    const opendir = fs.opendir.bind(fs)
    vi.spyOn(fs, 'opendir').mockImplementation(async (path, ...options) => {
      if (String(path) === denied) throw Object.assign(Error('denied fixture'), { code: 'EACCES' })
      return opendir(path, ...options)
    })
    await expect(snapshotCodexFiles(root)).rejects.toThrow('ERR_CODEX_SNAPSHOT')
  })
})
