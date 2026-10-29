import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createDocumentChangeStore } from './document-change-store'
import { createLibraryManager } from './library-manager'
import type { LibraryEntry } from '../shared/types'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'md-duck-change-store-')); roots.push(root)
  const folder = join(root, '01-article'); await fs.mkdir(folder)
  const entry: LibraryEntry = { id: 'stable-article-id', path: join(folder, 'article.md'), zhPath: join(folder, 'article.zh.md'), title: 'An article', folder: '01-article' }
  await fs.writeFile(entry.path, '# Original\n\nBefore.\n'); await fs.writeFile(entry.zhPath!, '# 原稿\n\n之前。\n')
  const store = createDocumentChangeStore()
  const record = join(root, '.mdduck', 'change-baselines', createHash('sha256').update(entry.id!).digest('hex') + '.json')
  return { root, entry, store, record }
}

describe('persistent document change awareness', () => {
  it('establishes first-scan baselines without marking existing articles and does not emit on inspection', async () => {
    const { root, entry, store, record } = await fixture()
    const entries = await store.summarize(root, [entry])
    expect(entries[0].changes).toEqual({ changed: false, source: false, translation: false })
    const baseline = await fs.readFile(record, 'utf8')
    expect((await store.inspect(root, entry)).changed).toBe(false)
    expect(await fs.readFile(record, 'utf8')).toBe(baseline)
  })

  it('remembers changes across repeated opens, rescans and a new process/store instance', async () => {
    const { root, entry, store } = await fixture()
    await store.summarize(root, [entry]); await fs.writeFile(entry.path, '# Original\n\nAfter.\n')
    expect((await store.summarize(root, [entry]))[0].changes).toEqual({ changed: true, source: true, translation: false })
    const current = await store.inspect(root, entry)
    expect(current.baseline.sourceText).toContain('Before.')
    expect((await store.inspect(root, entry)).changed).toBe(true)
    const restarted = createDocumentChangeStore()
    expect((await restarted.summarize(root, [entry]))[0].changes?.changed).toBe(true)
    expect((await restarted.inspect(root, entry)).revision).toBe(current.revision)
  })

  it('ignores mtime-only saves, but detects source and translation changes independently', async () => {
    const { root, entry, store } = await fixture()
    await store.summarize(root, [entry]); await fs.utimes(entry.path, new Date(), new Date())
    expect((await store.summarize(root, [entry]))[0].changes?.changed).toBe(false)
    await fs.writeFile(entry.zhPath!, '# 原稿\n\n改后。\n')
    expect((await store.summarize(root, [entry]))[0].changes).toEqual({ changed: true, source: false, translation: true })
    await fs.unlink(entry.zhPath!)
    expect((await store.inspect(root, entry)).current.zhText).toBeNull()
    expect((await store.summarize(root, [{ ...entry, zhPath: null }]))[0].changes?.translation).toBe(true)
  })

  it('detects a newly added translation and a reverted source no longer differs', async () => {
    const { root, entry, store } = await fixture()
    const single = { ...entry, zhPath: null }
    await store.summarize(root, [single])
    expect((await store.summarize(root, [entry]))[0].changes?.translation).toBe(true)
    const original = await fs.readFile(entry.path, 'utf8')
    await fs.writeFile(entry.path, 'A newer passage')
    await store.summarize(root, [entry]); await fs.writeFile(entry.path, original)
    expect((await store.inspect(root, single)).changed).toBe(false)
  })

  it('only acknowledges the exact displayed version and preserves a newer edit on a stale click', async () => {
    const { root, entry, store, record } = await fixture()
    await store.summarize(root, [entry]); await fs.writeFile(entry.path, 'Version A')
    const shown = await store.inspect(root, entry)
    const before = await fs.readFile(record, 'utf8')
    await fs.writeFile(entry.path, 'Version B')
    await expect(store.acknowledge(root, entry, shown.revision)).rejects.toThrow('ERR_DOCUMENT_CHANGED')
    expect(await fs.readFile(record, 'utf8')).toBe(before)
    const latest = await store.inspect(root, entry)
    const acknowledged = await store.acknowledge(root, entry, latest.revision)
    expect(acknowledged.changed).toBe(false)
    expect(acknowledged.baseline.sourceText).toBe('Version B')
    expect((await createDocumentChangeStore().inspect(root, entry)).changed).toBe(false)
  })

  it('does not clear an edit written during the acknowledgement metadata commit', async () => {
    const { root, entry, store } = await fixture()
    await store.summarize(root, [entry]); await fs.writeFile(entry.path, 'Visible version')
    const shown = await store.inspect(root, entry)
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      await fs.writeFile(entry.path, 'Newer version arriving during click')
      return rename(from, to)
    })
    const result = await store.acknowledge(root, entry, shown.revision)
    expect(result.changed).toBe(true)
    expect(result.baseline.sourceText).toBe('Visible version')
    expect(result.current.sourceText).toBe('Newer version arriving during click')
  })

  it('keeps the same pending baseline when an article is renamed, moved or archived by identity', async () => {
    const { root, entry, store } = await fixture()
    await store.summarize(root, [entry]); await fs.writeFile(entry.path, 'Pending change')
    const folder = join(root, 'Archive', 'renamed'); await fs.mkdir(join(root, 'Archive'))
    await fs.rename(join(root, '01-article'), folder)
    const moved = { ...entry, path: join(folder, 'article.md'), zhPath: join(folder, 'article.zh.md'), archived: true }
    const state = await store.inspect(root, moved)
    expect(state.changed).toBe(true); expect(state.baseline.sourceText).toContain('Before.')
    expect((await store.summarize(root, [moved]))[0].changes?.source).toBe(true)
    await store.acknowledge(root, moved, state.revision)
    const restoredFolder = join(root, 'restored'); await fs.rename(folder, restoredFolder)
    const restored = { ...entry, path: join(restoredFolder, 'article.md'), zhPath: join(restoredFolder, 'article.zh.md') }
    expect((await store.inspect(root, restored)).changed).toBe(false)
  })

  it('carries baseline records when the complete library moves', async () => {
    const { root, entry, store } = await fixture()
    await store.summarize(root, [entry]); await fs.writeFile(entry.path, 'Offline change')
    const moved = root + '-moved'; roots.push(moved); await fs.rename(root, moved)
    const relocated = { ...entry, path: entry.path.replace(root, moved), zhPath: entry.zhPath!.replace(root, moved) }
    expect((await createDocumentChangeStore().inspect(moved, relocated)).changed).toBe(true)
  })

  it('integrates with real library IDs through an atomic AI save and the archive transaction', async () => {
    const { root, entry, store } = await fixture()
    const listEntries = async (base: string) => {
      const result: LibraryEntry[] = []
      const scan = async (folder: string) => {
        for (const item of await fs.readdir(folder, { withFileTypes: true })) {
          if (item.name.startsWith('.')) continue
          const path = join(folder, item.name)
          if (item.isDirectory()) await scan(path)
          else if (item.name === 'article.md') result.push({ path, zhPath: join(folder, 'article.zh.md'), title: 'An article', folder: relative(base, folder) })
        }
      }
      await scan(base); return result
    }
    await fs.mkdir(join(root, 'profile'))
    const manager = createLibraryManager({ userData: join(root, 'profile'), listEntries })
    const initial = await manager.refresh(root)
    const original = initial.snapshot.entries[0]
    await store.summarize(root, [original])
    await fs.writeFile(entry.path + '.new', 'Saved atomically by an editor')
    await fs.rename(entry.path + '.new', entry.path)
    const updated = (await manager.refresh(root)).snapshot.entries[0]
    expect(updated.id).toBe(original.id)
    expect((await store.summarize(root, [updated]))[0].changes?.changed).toBe(true)
    const archived = await manager.mutate(root, { type: 'archive', path: dirname(updated.path) })
    const moved = archived.snapshot.entries[0]
    expect(moved.id).toBe(original.id); expect(moved.archived).toBe(true)
    expect((await store.inspect(root, moved)).baseline.sourceText).toContain('Before.')
    expect((await store.inspect(root, moved)).current.sourceText).toBe('Saved atomically by an editor')
  })

  it('preserves corrupt baseline bytes and reports unavailable rather than clearing pending state', async () => {
    const { root, entry, store, record } = await fixture()
    await store.summarize(root, [entry]); await fs.writeFile(record, '{broken')
    expect((await store.summarize(root, [entry]))[0].changes?.issue).toBe('DOCUMENT_CHANGES_UNAVAILABLE')
    await expect(store.inspect(root, entry)).rejects.toThrow('DOCUMENT_CHANGES_UNAVAILABLE')
    await expect(store.acknowledge(root, entry, 'anything')).rejects.toThrow('DOCUMENT_CHANGES_UNAVAILABLE')
    expect(await fs.readFile(record, 'utf8')).toBe('{broken')
  })

  it('never reads or writes through a symlinked metadata folder or source/translation', async () => {
    const { root, entry, store } = await fixture()
    const outside = await fs.mkdtemp(join(tmpdir(), 'md-duck-change-outside-')); roots.push(outside)
    await fs.symlink(outside, join(root, '.mdduck'), 'dir')
    expect((await store.summarize(root, [entry]))[0].changes?.issue).toBe('DOCUMENT_CHANGES_UNAVAILABLE')
    expect(await fs.readdir(outside)).toEqual([])
    await fs.unlink(join(root, '.mdduck')); await store.summarize(root, [entry])
    const target = join(outside, 'private.md'); await fs.writeFile(target, 'Private text')
    await fs.unlink(entry.zhPath!); await fs.symlink(target, entry.zhPath!)
    await expect(store.inspect(root, entry)).rejects.toThrow('DOCUMENT_CHANGES_UNAVAILABLE')
    expect(await fs.readFile(target, 'utf8')).toBe('Private text')
  })

  it('refuses a source outside the requested library without creating baseline data', async () => {
    const { root, entry, store } = await fixture()
    const other = await fs.mkdtemp(join(tmpdir(), 'md-duck-other-library-')); roots.push(other)
    const invalid = { ...entry, path: join(other, 'outside.md') }; await fs.writeFile(invalid.path, 'Do not read')
    expect((await store.summarize(root, [invalid]))[0].changes?.issue).toBe('DOCUMENT_CHANGES_UNAVAILABLE')
    await expect(fs.stat(join(root, '.mdduck'))).rejects.toThrow()
  })
})
