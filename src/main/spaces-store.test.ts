import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpacesStore, spaceRootKey, spaceRootsOverlap } from './spaces-store'

const fixtures: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'md-duck-spaces-test-'))
  fixtures.push(dir)
  const userData = join(dir, 'profile')
  const articles = join(dir, 'articles')
  const other = join(dir, 'other')
  await Promise.all([userData, articles, other].map((path) => fs.mkdir(path)))
  return { dir, userData, articles, other, store: createSpacesStore({ userData }) }
}

describe('space registry and migration', () => {
  it('copies all legacy settings exactly before creating the first space and keeps its identity after restart', async () => {
    const { userData, articles, store } = await fixture()
    const source = join(articles, 'article.md')
    const legacy = JSON.stringify({ root: articles, prefs: { ui: 'zh', mode: 'bilingual', fontSize: 21 }, openPath: source, scroll: { [source]: 'block:details' }, openRouterKey: 'encrypted-legacy-value', futureField: { retained: true } }, null, 4)
    await fs.writeFile(join(userData, 'settings.json'), legacy)
    const loaded = await store.load()
    expect(loaded.spaces).toHaveLength(1)
    expect(loaded.activeSpaceId).toBe(loaded.spaces[0].id)
    expect(loaded.spaces[0].root).toBe(await fs.realpath(articles))
    expect(loaded.spaces[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/)
    expect(await fs.readFile(join(userData, 'settings.json'), 'utf8')).toBe(legacy)
    expect(await fs.readFile(join(userData, 'settings.pre-spaces.json'), 'utf8')).toBe(legacy)
    expect(await fs.readFile(store.settingsPath(loaded.spaces[0].id), 'utf8')).toBe(legacy)
    expect(await createSpacesStore({ userData }).load()).toEqual(loaded)
    loaded.spaces[0].name = 'mutated caller copy'
    expect(store.snapshot().spaces[0].name).toBe('articles')
  })

  it('keeps a disconnected legacy folder and its reading position available for relinking', async () => {
    const { userData, dir, store } = await fixture()
    const missing = join(dir, 'disconnected-volume')
    const legacy = JSON.stringify({ root: missing, openPath: join(missing, 'draft.md'), scroll: { [join(missing, 'draft.md')]: 'block:review' } })
    await fs.writeFile(join(userData, 'settings.json'), legacy)
    const loaded = await store.load()
    expect(loaded.spaces[0].root).toBe(missing)
    expect(await fs.readFile(store.settingsPath(loaded.spaces[0].id), 'utf8')).toBe(legacy)
  })

  it('backs up settings without a selected library and does not invent an empty-folder space', async () => {
    const { userData, store } = await fixture()
    const legacy = JSON.stringify({ root: null, prefs: { ui: 'zh', fontSize: 22 } })
    await fs.writeFile(join(userData, 'settings.json'), legacy)
    expect(await store.load()).toEqual({ version: 1, activeSpaceId: null, spaces: [] })
    expect(await fs.readFile(join(userData, 'settings.pre-spaces.json'), 'utf8')).toBe(legacy)
  })

  it('refuses corrupt legacy or registry data without overwriting a byte', async () => {
    const { userData, articles, store } = await fixture()
    const legacy = '{"root":'
    await fs.writeFile(join(userData, 'settings.json'), legacy)
    await expect(store.load()).rejects.toThrow('ERR_SPACES_LEGACY_CORRUPT')
    expect(await fs.readFile(join(userData, 'settings.json'), 'utf8')).toBe(legacy)
    await expect(fs.stat(join(userData, 'spaces.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const invalid = '{"version":17,"spaces":[]}'
    await fs.writeFile(join(userData, 'spaces.json'), invalid)
    await expect(createSpacesStore({ userData }).add(articles)).rejects.toThrow('ERR_SPACES_CORRUPT')
    expect(await fs.readFile(join(userData, 'spaces.json'), 'utf8')).toBe(invalid)
  })

  it('deduplicates real-folder aliases and serializes concurrent additions', async () => {
    const { dir, articles, store } = await fixture()
    const alias = join(dir, 'article-alias')
    await fs.symlink(articles, alias, 'dir')
    const [first, second] = await Promise.all([store.add(articles, 'First'), store.add(alias, 'Second')])
    expect(first.id).toBe(second.id)
    expect(store.snapshot().spaces).toHaveLength(1)
    expect(second.name).toBe('First')
  })

  it('rejects parent/child overlap and does not mistake a shared name prefix for containment', async () => {
    const { dir, articles, store } = await fixture()
    await fs.mkdir(join(articles, 'series'))
    const sibling = join(dir, 'articles-more')
    await fs.mkdir(sibling)
    await store.add(articles)
    await expect(store.add(join(articles, 'series'))).rejects.toThrow('ERR_SPACE_ROOT_OVERLAP')
    await expect(store.add(dir)).rejects.toThrow('ERR_SPACE_ROOT_OVERLAP')
    await expect(store.add(sibling)).resolves.toMatchObject({ root: await fs.realpath(sibling) })
    expect(store.snapshot().spaces).toHaveLength(2)
  })

  it('keeps ID, saved data and original files through rename, relocation and shortcut removal', async () => {
    const { dir, articles, userData, store } = await fixture()
    await fs.writeFile(join(articles, 'draft.md'), '# Keep this article')
    const first = await store.add(articles)
    const settings = JSON.stringify({ openPath: join(articles, 'draft.md'), scroll: { [join(articles, 'draft.md')]: 'block:2' } })
    await fs.mkdir(join(store.settingsPath(first.id), '..'), { recursive: true })
    await fs.writeFile(store.settingsPath(first.id), settings)
    expect((await store.rename(first.id, 'Writing')).id).toBe(first.id)
    const moved = join(dir, 'moved')
    await fs.rename(articles, moved)
    expect(await store.relocate(first.id, moved)).toMatchObject({ id: first.id, root: await fs.realpath(moved), name: 'Writing' })
    await store.remove(first.id)
    expect(store.snapshot()).toMatchObject({ version: 1, activeSpaceId: null, spaces: [], removed: [{ id: first.id }] })
    expect(await fs.readFile(join(moved, 'draft.md'), 'utf8')).toBe('# Keep this article')
    expect(await fs.readFile(store.settingsPath(first.id), 'utf8')).toBe(settings)
    expect((await createSpacesStore({ userData }).load()).spaces).toEqual([])
  })

  it('restores a removed folder with its stable ID, name and settings after restarting', async () => {
    const { userData, articles, store } = await fixture()
    const first = await store.add(articles, 'Saved name')
    const content = JSON.stringify({ root: articles, openPath: join(articles, 'article.md'), scroll: { [join(articles, 'article.md')]: 'block:retained' } })
    await fs.mkdir(join(store.settingsPath(first.id), '..'), { recursive: true })
    await fs.writeFile(store.settingsPath(first.id), content)
    await store.remove(first.id)
    const restarted = createSpacesStore({ userData })
    const restored = await restarted.add(articles)
    expect(restored).toMatchObject({ id: first.id, name: 'Saved name', createdAt: first.createdAt })
    expect(await fs.readFile(restarted.settingsPath(restored.id), 'utf8')).toBe(content)
    expect(restarted.snapshot().removed).toEqual([])
    expect(restarted.snapshot().activeSpaceId).toBe(first.id)
  })

  it('keeps removed recovery records when a conflicting parent space prevents restoration', async () => {
    const { articles, store } = await fixture()
    const child = join(articles, 'series')
    await fs.mkdir(child)
    const old = await store.add(child)
    await store.remove(old.id)
    const parent = await store.add(articles)
    await expect(store.add(child)).rejects.toThrow('ERR_SPACE_ROOT_OVERLAP')
    expect(store.snapshot().removed).toEqual([old])
    expect(store.snapshot().spaces.map((space) => space.id)).toEqual([parent.id])
    await store.remove(parent.id)
    expect((await store.add(child)).id).toBe(old.id)
  })

  it('keeps the last good in-memory and on-disk state after a failed registry write, then can retry', async () => {
    const { userData, articles, other, store } = await fixture()
    const first = await store.add(articles)
    const before = store.snapshot()
    const disk = await fs.readFile(join(userData, 'spaces.json'), 'utf8')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(store.add(other)).rejects.toThrow('disk unavailable')
    await expect(store.flush()).rejects.toThrow('disk unavailable')
    expect(store.snapshot()).toEqual(before)
    expect(await fs.readFile(join(userData, 'spaces.json'), 'utf8')).toBe(disk)
    await store.add(other)
    await store.activate(first.id)
    await store.flush()
    expect(store.snapshot().spaces).toHaveLength(2)
    expect(store.snapshot().activeSpaceId).toBe(first.id)
  })

  it('refuses a failed migration commit and retries without discarding any source or backup', async () => {
    const { userData, articles, store } = await fixture()
    const legacy = JSON.stringify({ root: articles, scroll: { [join(articles, 'article.md')]: 'block:1' } })
    await fs.writeFile(join(userData, 'settings.json'), legacy)
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('commit unavailable'))
    await expect(store.load()).rejects.toThrow('commit unavailable')
    expect(await fs.readFile(join(userData, 'settings.json'), 'utf8')).toBe(legacy)
    expect(await fs.readFile(join(userData, 'settings.pre-spaces.json'), 'utf8')).toBe(legacy)
    const retry = await store.load()
    expect(retry.spaces).toHaveLength(1)
    expect(await fs.readFile(store.settingsPath(retry.spaces[0].id), 'utf8')).toBe(legacy)
  })
})

describe('Windows root identity', () => {
  it('migrates a disconnected Windows drive without changing backslash paths or reading anchors', async () => {
    const { userData } = await fixture()
    const root = 'D:\\Articles\\Series'
    const source = `${root}\\01-intro\\article.md`
    const legacy = JSON.stringify({ root, prefs: { mode: 'bilingual', ui: 'zh' }, openPath: source, scroll: { [source]: 'block:details' } })
    await fs.writeFile(join(userData, 'settings.json'), legacy)
    const store = createSpacesStore({ userData, platform: 'win32' })
    const result = await store.load()
    expect(result.spaces[0].root).toBe(root)
    expect(await fs.readFile(store.settingsPath(result.spaces[0].id), 'utf8')).toBe(legacy)
    expect(await createSpacesStore({ userData, platform: 'win32' }).load()).toEqual(result)
  })

  it('handles drive-letter casing, mixed separators, trailing separators and UNC roots', () => {
    expect(spaceRootKey('C:\\Writing\\Series\\', 'win32')).toBe(spaceRootKey('c:/writing/series', 'win32'))
    expect(spaceRootsOverlap('C:\\Writing', 'c:/WRITING/series', 'win32')).toBe(true)
    expect(spaceRootsOverlap('C:\\Writing', 'C:\\Writing-more', 'win32')).toBe(false)
    expect(spaceRootsOverlap('C:\\Writing', 'D:\\Writing', 'win32')).toBe(false)
    expect(spaceRootsOverlap('\\\\Server\\Share\\Articles', '\\\\server\\share\\articles\\Series', 'win32')).toBe(true)
    expect(spaceRootsOverlap('\\\\server\\one', '\\\\server\\two', 'win32')).toBe(false)
    expect(() => spaceRootKey('C:relative', 'win32')).toThrow('ERR_SPACE_FOLDER')
  })
})
