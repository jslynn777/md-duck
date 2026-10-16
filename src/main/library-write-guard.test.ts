import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertLibraryDocument } from './library-write-guard'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
describe('library write identity', () => {
  it('rejects a reused pathname before the watcher has refreshed its index', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'duck-write-')); roots.push(root)
    const path = join(root, 'a.md'); await fs.writeFile(path, 'original')
    const info = await fs.stat(path, { bigint: true })
    const entries = [{ path, title: 'A', folder: '.', zhPath: null, id: 'original', fileIdentity: `${info.dev}:${info.ino}` }]
    await expect(assertLibraryDocument(root, entries, path, 'original')).resolves.toBeUndefined()
    await fs.rename(path, join(root, 'b.md')); await fs.writeFile(path, 'different article')
    await expect(assertLibraryDocument(root, entries, path, 'original')).rejects.toThrow('LIBRARY_SOURCE_CHANGED')
    expect(await fs.readFile(path, 'utf8')).toBe('different article')
  })
  it('rejects an old document ID after the new article has been indexed', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'duck-write-')); roots.push(root)
    const path = join(root, 'a.md'); await fs.writeFile(path, 'new')
    const info = await fs.stat(path, { bigint: true })
    const entries = [{ path, title: 'A', folder: '.', zhPath: null, id: 'new', fileIdentity: `${info.dev}:${info.ino}` }]
    await expect(assertLibraryDocument(root, entries, path, 'old')).rejects.toThrow('LIBRARY_SOURCE_CHANGED')
    await expect(assertLibraryDocument(root, entries, path, 'new')).resolves.toBeUndefined()
    await expect(assertLibraryDocument(root, entries, path)).rejects.toThrow('LIBRARY_SOURCE_CHANGED')
    await expect(assertLibraryDocument(root, [{ ...entries[0], fileIdentity: undefined }], path, 'new')).rejects.toThrow('LIBRARY_SOURCE_CHANGED')
  })
})
