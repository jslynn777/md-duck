import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_PRESETS } from '../shared/ai'
import type { Preferences } from '../shared/types'
import { readReaderSettings, remapSpaceSettings, type ReaderSettings } from './space-settings'

const defaults: Preferences = { fontSize: 18, mode: 'source', sidebar: true, sidebarTab: 'files', voice: 'af_heart', speed: 1, model: 'model/default', ui: 'en' }
const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})
async function settingsFile(value?: unknown) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'md-duck-space-settings-'))
  dirs.push(dir)
  const file = join(dir, 'settings.json')
  if (value !== undefined) await fs.writeFile(file, JSON.stringify(value))
  return file
}
// These literal fixtures use POSIX paths, regardless of the test runner's OS.
// Windows-specific cases below supply their own paths and an explicit win32 platform.
const saved = (overrides: Partial<ReaderSettings> = {}): ReaderSettings => ({
  root: '/previous/library', prefs: { ...defaults, mode: 'bilingual', fontSize: 22, ui: 'zh', librarySort: 'manual' },
  openPath: '/previous/library/series/article.md', scroll: { '/previous/library/series/article.md': 'block:ending' },
  openRouterKey: 'enc:retained-secret', ...overrides
})

describe('space settings migration', () => {
  it('uses inherited preferences for a new space without writing files or checking the root exists', async () => {
    const file = await settingsFile()
    const result = await readReaderSettings(file, '/disconnected/new-space', defaults, { ui: 'zh', fontSize: 24 }, 'darwin')
    expect(result).toEqual({ root: '/disconnected/new-space', prefs: { ...defaults, ui: 'zh', fontSize: 24 }, openPath: null, scroll: {}, openRouterKey: null })
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves saved preferences, credentials and reading positions while mapping a root alias', async () => {
    const original = saved()
    const file = await settingsFile(original)
    const bytes = await fs.readFile(file, 'utf8')
    const result = await readReaderSettings(file, '/real/library', defaults, { mode: 'source', ui: 'en' }, 'darwin')
    expect(result).toEqual({ ...original, root: '/real/library', rootAliases: ['/previous/library'], openPath: '/real/library/series/article.md', scroll: { '/real/library/series/article.md': 'block:ending' } })
    expect(await fs.readFile(file, 'utf8')).toBe(bytes)
  })

  it('retains positions when the configured folder is disconnected', async () => {
    const original = saved({ root: '/unmounted/volume', openPath: '/unmounted/volume/article.md', scroll: { '/unmounted/volume/article.md': 'paragraph:8' } })
    expect(await readReaderSettings(await settingsFile(original), '/unmounted/volume', defaults, {}, 'darwin')).toEqual(original)
  })

  it('restores reading settings after saving an unfinished custom AI profile with an empty model', async () => {
    const original = saved({ prefs: { ...defaults, model: AI_PRESETS.custom.model } })
    const file = await settingsFile(original)
    expect(AI_PRESETS.custom.model).toBe('')
    const first = await readReaderSettings(file, original.root, defaults, {}, 'darwin')
    expect(first).toEqual(original)
    await fs.writeFile(file, JSON.stringify(first))
    expect(await readReaderSettings(file, original.root, defaults, first.prefs, 'darwin')).toEqual(original)
  })

  it('migrates a legacy preference key without returning it in renderer preferences', async () => {
    const result = await readReaderSettings(await settingsFile({ prefs: { ui: 'zh', openRouterKey: 'legacy-secret' } }), null, defaults, {}, 'darwin')
    expect(result.openRouterKey).toBe('raw:legacy-secret')
    expect(result.prefs).toEqual({ ...defaults, ui: 'zh' })
    const explicit = await readReaderSettings(await settingsFile({ prefs: { openRouterKey: 'stale-secret' }, openRouterKey: null }), null, defaults, {}, 'darwin')
    expect(explicit.openRouterKey).toBeNull()
  })

  it.each([
    null, [], { root: 7 }, { root: 'relative' }, { openPath: {} }, { scroll: [] },
    { scroll: { '/article.md': 4 } }, { prefs: null }, { prefs: { mode: 'invalid' } },
    { prefs: { fontSize: 0 } }, { prefs: { sidebar: 'true' } }, { prefs: { model: null } }, { openRouterKey: {} },
    { rootAliases: null }, { rootAliases: '/previous' }, { rootAliases: [7] }, { rootAliases: ['relative'] }, { rootAliases: ['/bad\0path'] }
  ])('rejects malformed saved settings without replacing them: %j', async value => {
    const file = await settingsFile(value)
    const bytes = await fs.readFile(file, 'utf8')
    await expect(readReaderSettings(file, null, defaults, {}, 'darwin')).rejects.toThrow('ERR_SPACE_SETTINGS')
    expect(await fs.readFile(file, 'utf8')).toBe(bytes)
  })

  it('does not treat corrupt JSON or permission failures as first run', async () => {
    const file = await settingsFile()
    await fs.writeFile(file, '{unclosed')
    await expect(readReaderSettings(file, null, defaults, {}, 'darwin')).rejects.toThrow('ERR_SPACE_SETTINGS')
    expect(await fs.readFile(file, 'utf8')).toBe('{unclosed')
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(new Error('private file details'), { code: 'EACCES' }))
    await expect(readReaderSettings(file, null, defaults, {}, 'darwin')).rejects.toThrow(/^ERR_SPACE_SETTINGS$/)
  })
})

describe('space root relocation', () => {
  it('retains the root history across repeated moves, reloads and a return to an earlier folder', async () => {
    const original = saved()
    const first = remapSpaceSettings(original, '/second/library', 'darwin')
    const second = remapSpaceSettings(first, '/third/library', 'darwin')
    const persisted = await readReaderSettings(await settingsFile(second), '/third/library', defaults, {}, 'darwin')
    expect(persisted.rootAliases).toEqual(['/previous/library', '/second/library'])
    expect(remapSpaceSettings(persisted, '/third/library', 'darwin').rootAliases).toEqual(persisted.rootAliases)
    const returned = remapSpaceSettings(persisted, '/previous/library', 'darwin')
    expect(returned.rootAliases).toEqual(['/second/library', '/third/library'])
    expect(returned.openPath).toBe(original.openPath)
    expect(original).not.toHaveProperty('rootAliases')
  })

  it('retains a disconnected alias for later renderer draft recovery', async () => {
    const original = saved({ root: '/offline/moved-library', rootAliases: ['/older/library'], openPath: '/offline/moved-library/article.md' })
    const migrated = await readReaderSettings(await settingsFile(original), '/mounted/library', defaults, {}, 'darwin')
    expect(migrated.rootAliases).toEqual(['/older/library', '/offline/moved-library'])
    expect(migrated.openPath).toBe('/mounted/library/article.md')
  })

  it('deduplicates Windows root history by path rules while retaining a prior spelling for draft keys', () => {
    const first = remapSpaceSettings(saved({ root: 'C:/Articles', rootAliases: ['D:\\Old', 'd:/old'], openPath: 'C:/Articles/article.md', scroll: {} }), 'c:\\articles', 'win32')
    expect(first.rootAliases).toEqual(['D:\\Old', 'C:/Articles'])
    expect(remapSpaceSettings(first, 'c:\\articles', 'win32').rootAliases).toEqual(first.rootAliases)
    const moved = remapSpaceSettings(first, 'E:\\Writing', 'win32')
    expect(moved.rootAliases).toEqual(['D:\\Old', 'C:/Articles'])
  })

  it('rejects invalid Windows aliases without replacing the saved settings', async () => {
    const value = saved({ root: 'C:\\Articles', openPath: 'C:\\Articles\\article.md', scroll: {}, rootAliases: ['C:relative'] })
    const file = await settingsFile(value)
    const original = await fs.readFile(file, 'utf8')
    await expect(readReaderSettings(file, 'D:\\Articles', defaults, {}, 'win32')).rejects.toThrow('ERR_SPACE_SETTINGS')
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('moves only descendants, preserving same-prefix siblings and the caller snapshot', () => {
    const original = saved({ scroll: { '/previous/library/series/article.md': 'one', '/previous/library-other/article.md': 'two' } })
    const snapshot = structuredClone(original)
    const next = remapSpaceSettings(original, '/next/library', 'darwin')
    expect(next.scroll).toEqual({ '/next/library/series/article.md': 'one', '/previous/library-other/article.md': 'two' })
    expect(original).toEqual(snapshot)
  })

  it('keeps conflicting source and destination reading positions for recovery', () => {
    const next = remapSpaceSettings(saved({ scroll: { '/previous/library/article.md': 'old', '/new/library/article.md': 'new' } }), '/new/library', 'darwin')
    expect(next.scroll).toEqual({ '/previous/library/article.md': 'old', '/new/library/article.md': 'new' })
  })

  it('propagates blocked root-move collisions without dropping an earlier position', () => {
    const scroll = { '/library/nested/nested/a.md': 'one', '/library/nested/a.md': 'two', '/library/a.md': 'three' }
    const next = remapSpaceSettings(saved({ root: '/library/nested', scroll }), '/library', 'darwin')
    expect(next.scroll).toEqual(scroll)
  })

  it('supports Windows drive casing, separators and same-prefix boundaries', () => {
    const next = remapSpaceSettings(saved({ root: 'C:\\Articles', openPath: 'c:/articles/series/article.md', scroll: { 'c:\\ARTICLES\\series\\article.md': 'ending', 'C:\\Articles-old\\a.md': 'outside' } }), 'D:\\Writing', 'win32')
    expect(next.root).toBe('D:\\Writing')
    expect(next.openPath).toBe('D:\\Writing\\series\\article.md')
    expect(next.scroll).toEqual({ 'D:\\Writing\\series\\article.md': 'ending', 'C:\\Articles-old\\a.md': 'outside' })
  })

  it('preserves case-equivalent Windows destination collisions and other drives', () => {
    const next = remapSpaceSettings(saved({ root: 'C:\\Old', openPath: 'C:\\Old\\article.md', scroll: { 'C:\\Old\\article.md': 'source', 'd:\\new\\article.md': 'destination', 'E:\\other.md': 'other-drive' } }), 'D:\\New', 'win32')
    expect(next.scroll).toEqual({ 'C:\\Old\\article.md': 'source', 'd:\\new\\article.md': 'destination', 'E:\\other.md': 'other-drive' })
  })

  it('supports UNC root relocation even when the source server is unavailable', async () => {
    const original = saved({ root: '\\\\old-server\\share\\Writing', openPath: '\\\\OLD-SERVER\\share\\writing\\article.md', scroll: { '\\\\old-server\\share\\Writing\\article.md': 'block:4' } })
    const next = await readReaderSettings(await settingsFile(original), '\\\\new-server\\share\\Library', defaults, {}, 'win32')
    expect(next.openPath).toBe('\\\\new-server\\share\\Library\\article.md')
    expect(next.scroll).toEqual({ '\\\\new-server\\share\\Library\\article.md': 'block:4' })
  })
})
