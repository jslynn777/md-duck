import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, relative, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { createLibraryManager, ARCHIVE_DIRECTORY } from './library-manager'
import type { LibraryEntry } from '../shared/types'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
let fixture: string, root: string, userData: string
const primary = (source: string) => join(dirname(source), '.review', 'documents', `${hash(basename(source))}.json`)
const translation = (source: string, suffix: string) => join(dirname(source), '.review', 'translations', `${hash(basename(source)).slice(0, 24)}.${suffix}.json`)
const backup = (source: string) => join(userData, 'review-backups', `${hash(source)}.json`)
async function write(path: string, content: string) { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, content) }
async function json(path: string) { return JSON.parse(await fs.readFile(path, 'utf8')) }
async function scanner(folder: string): Promise<LibraryEntry[]> {
  const files: string[] = []
  async function walk(dir: string) { for (const child of await fs.readdir(dir, { withFileTypes: true })) { if (child.name.startsWith('.') || child.isSymbolicLink()) continue; const path = join(dir, child.name); if (child.isDirectory()) await walk(path); else if (/\.(md|markdown)$/i.test(path)) files.push(path) } }
  await walk(folder)
  const targets = new Map<string, string>()
  for (const file of files) {
    let target = file.slice(0, -extname(file).length) + '.zh' + extname(file)
    try { const value = await json(translation(file, 'association')); if (value.version === 2 && value.sourceFile === basename(file)) target = join(dirname(file), value.targetRelative) } catch { /* Default sibling pairing. */ }
    if (files.includes(target) && target !== file) targets.set(file, target)
  }
  return files.filter((file) => ![...targets.values()].includes(file)).map((path) => ({ path, zhPath: targets.get(path) ?? null, title: basename(path), folder: relative(folder, dirname(path)) || '.' }))
}
const manager = (extra: { isBusy?: () => boolean } = {}) => createLibraryManager({ userData, listEntries: scanner, ...extra })
async function article(folder = 'Series/One', name = 'article.md') {
  const source = join(root, folder, name)
  const target = source.slice(0, -extname(source).length) + '.zh' + extname(source)
  await write(source, '# Example\n\n![image](assets/photo.png)\n')
  await write(target, '# 例子\n')
  await write(join(dirname(source), 'assets/photo.png'), 'image-bytes')
  const data = { version: 2, document: basename(source), notes: [{ id: 'note', comment: 'keep me' }], words: [{ id: 'word', word: 'example' }] }
  await write(primary(source), JSON.stringify(data))
  await write(backup(source), JSON.stringify(data))
  for (const suffix of ['association', 'alignment', 'draft']) await write(translation(source, suffix), JSON.stringify({ version: 2, sourceFile: basename(source), targetRelative: basename(target), sourceHash: 'keep', results: [{ value: 'draft' }] }))
  return { source, target, data }
}
beforeEach(async () => { fixture = await fs.mkdtemp(join(tmpdir(), 'mdduck-library-')); root = join(fixture, 'library'); userData = join(fixture, 'private'); await fs.mkdir(root); await fs.mkdir(userData) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(fixture, { recursive: true, force: true }) })

describe('filesystem article library', () => {
  it('shows empty folders and batch creates real independent source drafts without translations', async () => {
    const m = manager()
    await m.mutate(root, { type: 'create-folder', parent: root, name: 'Series' })
    expect((await m.refresh(root)).snapshot.folders).toEqual([expect.objectContaining({ path: join(root, 'Series') })])
    const result = await m.mutate(root, { type: 'create-articles', folder: join(root, 'Series'), titles: ['First', 'Second'] })
    expect(result.snapshot.entries).toHaveLength(2)
    expect(await fs.readFile(join(root, 'Series/First/article.md'), 'utf8')).toBe('# First\n\n')
    expect(await fs.readdir(join(root, 'Series/First'))).toEqual(['article.md'])
  })
  it('moves a bundle with original, translation, image, notes, words and private backups and restores it', async () => {
    const { source, target, data } = await article()
    const m = manager(); const initial = await m.refresh(root)
    await m.mutate(root, { type: 'stage', path: source, stage: 'review' })
    const result = await m.mutate(root, { type: 'archive', path: source })
    const destination = join(root, ARCHIVE_DIRECTORY, 'One/article.md')
    expect(result.relocations).toContainEqual({ from: source, to: destination })
    expect(await json(primary(destination))).toEqual(data)
    expect(await json(backup(destination))).toEqual(data)
    expect(await json(backup(source))).toEqual(data)
    expect(await fs.readFile(join(dirname(destination), 'assets/photo.png'), 'utf8')).toBe('image-bytes')
    expect(await fs.readFile(join(dirname(destination), basename(target)), 'utf8')).toBe('# 例子\n')
    expect(result.snapshot.entries[0]).toMatchObject({ id: initial.snapshot.entries[0].id, stage: 'review', archived: true })
    const restored = await manager().mutate(root, { type: 'restore', path: destination })
    expect(restored.snapshot.entries[0]).toMatchObject({ path: source, stage: 'review', archived: false })
    expect(await json(translation(source, 'draft'))).toMatchObject({ sourceFile: 'article.md', targetRelative: 'article.zh.md', sourceHash: 'keep' })
  })
  it('renames an ordinary loose article with all own metadata and translation, leaving another article alone', async () => {
    const { source, data } = await article('Series', 'first.md')
    await write(source, '# No assets\n')
    await write(join(dirname(source), 'other.md'), '# Other\n')
    const m = manager(); await m.refresh(root)
    const result = await m.mutate(root, { type: 'rename', path: source, name: 'renamed' })
    const destination = join(dirname(source), 'renamed.md')
    expect(await json(primary(destination))).toEqual({ ...data, document: 'renamed.md' })
    expect(await json(backup(destination))).toEqual({ ...data, document: 'renamed.md' })
    expect(await json(translation(destination, 'draft'))).toMatchObject({ sourceFile: 'renamed.md', targetRelative: 'renamed.zh.md' })
    expect(await fs.stat(primary(source)).catch(() => null)).toBeNull()
    expect(await fs.readFile(join(dirname(source), 'other.md'), 'utf8')).toBe('# Other\n')
    expect(result.snapshot.entries).toHaveLength(2)
  })
  it('rewrites custom cross-directory translation relationships when only its source bundle moves', async () => {
    const { source, target } = await article()
    const custom = join(root, 'Chinese/custom.md')
    await fs.mkdir(dirname(custom)); await fs.rename(target, custom)
    for (const suffix of ['association', 'alignment', 'draft']) await write(translation(source, suffix), JSON.stringify({ version: 2, sourceFile: basename(source), targetRelative: relative(dirname(source), custom), sourceHash: 'retained' }))
    const m = manager(); await m.refresh(root)
    const result = await m.mutate(root, { type: 'archive', path: source })
    const destination = join(root, ARCHIVE_DIRECTORY, 'One/article.md')
    expect(await json(translation(destination, 'association'))).toMatchObject({ targetRelative: '../../Chinese/custom.md' })
    expect(result.snapshot.entries).toEqual([expect.objectContaining({ path: destination, zhPath: custom })])
  })
  it('keeps stage and sibling order across manager restarts', async () => {
    await write(join(root, 'a.md'), '# A'); await write(join(root, 'b.md'), '# B')
    const m = manager(); await m.refresh(root)
    await m.mutate(root, { type: 'stage', path: join(root, 'a.md'), stage: 'done' })
    await m.mutate(root, { type: 'reorder', path: join(root, 'b.md'), direction: 'up' })
    const result = await manager().refresh(root)
    expect(result.snapshot.entries.map((entry) => basename(entry.path))).toEqual(['b.md', 'a.md'])
    expect(result.snapshot.entries[1].stage).toBe('done')
  })
  it('detects an external directory rename by unique inode and keeps portable data and identity', async () => {
    const { source } = await article()
    const m = manager(); const before = await m.refresh(root)
    await fs.rename(dirname(source), join(root, 'Series/Renamed'))
    const destination = join(root, 'Series/Renamed/article.md')
    const after = await m.refresh(root)
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.relocations).toContainEqual({ from: source, to: destination })
    expect(after.snapshot.entries[0].id).toBe(before.snapshot.entries[0].id)
    expect(await json(backup(destination))).toMatchObject({ document: 'article.md' })
  })
  it('does not guess a replacement identity from equal content', async () => {
    await write(join(root, 'a.md'), '# Same')
    const m = manager(); const before = await m.refresh(root)
    await fs.copyFile(join(root, 'a.md'), join(root, 'b.md')); await fs.unlink(join(root, 'a.md'))
    const after = await m.refresh(root)
    expect(after.relocations).toEqual([])
    expect(after.snapshot.entries[0].id).not.toBe(before.snapshot.entries[0].id)
    expect(after.snapshot.issue).toBe('LIBRARY_MISSING_ARTICLES')
  })
  it('rejects collisions and rolls a partial move back without overwriting either article', async () => {
    const { source } = await article()
    const m = manager(); await m.refresh(root)
    const destination = join(root, 'Series/Occupied'); await fs.mkdir(destination)
    await expect(m.mutate(root, { type: 'rename', path: source, name: 'Occupied' })).rejects.toThrow('LIBRARY_DESTINATION_EXISTS')
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('library.json') && String(from).includes('.tmp')) throw new Error('simulated write failure')
      return rename(from, to)
    })
    await expect(m.mutate(root, { type: 'rename', path: source, name: 'New' })).rejects.toThrow('simulated write failure')
    expect(await fs.readFile(source, 'utf8')).toContain('# Example')
    expect(await fs.stat(join(root, 'Series/New')).catch(() => null)).toBeNull()
  })
  it('preserves damaged management and article metadata and refuses mutations', async () => {
    const { source } = await article(); const m = manager(); await m.refresh(root)
    const managed = join(root, '.mdduck/library.json')
    await fs.writeFile(managed, '{damaged')
    expect((await m.refresh(root)).snapshot.issue).toBe('LIBRARY_METADATA_CORRUPT')
    await expect(m.mutate(root, { type: 'archive', path: source })).rejects.toThrow('LIBRARY_METADATA_CORRUPT')
    expect(await fs.readFile(managed, 'utf8')).toBe('{damaged')
  })
  it('preflights symlinks in article and backup destinations before any movement', async () => {
    const { source } = await article(); const m = manager(); await m.refresh(root)
    const original = await fs.readFile(source, 'utf8')
    const backups = join(userData, 'review-backups'), moved = join(userData, 'kept-backups')
    await fs.rename(backups, moved); await fs.symlink(moved, backups, 'dir')
    await expect(m.mutate(root, { type: 'archive', path: source })).rejects.toThrow('LIBRARY_PATH_UNSAFE')
    expect(await fs.readFile(source, 'utf8')).toBe(original)
    await fs.unlink(backups); await fs.rename(moved, backups)
    await fs.symlink(join(fixture, 'outside'), join(dirname(source), 'redirect'))
    await expect(m.mutate(root, { type: 'archive', path: source })).rejects.toThrow('LIBRARY_PATH_UNSAFE')
  })
  it.each(['../escape', '.review', 'CON', 'a/b', 'C:drive', 'trailing.'])('rejects unsafe cross-platform name %s', async (name) => {
    await expect(manager().mutate(root, { type: 'create-folder', parent: root, name })).rejects.toThrow('LIBRARY_INVALID_NAME')
  })
  it('blocks filesystem changes while a translation is active and queues exclusives', async () => {
    const m = manager({ isBusy: () => true })
    await expect(m.mutate(root, { type: 'create-folder', parent: root, name: 'Blocked' })).rejects.toThrow('LIBRARY_TRANSLATION_BUSY')
    const order: string[] = []
    await Promise.all([m.exclusive(async () => { await new Promise((done) => setTimeout(done, 10)); order.push('first') }), m.exclusive(async () => { order.push('second') })])
    expect(order).toEqual(['first', 'second'])
  })
})

describe('external changes and recovery details', () => {
  it('reorders independently stored bundle articles within their parent series', async () => {
    const m = manager(); await m.mutate(root, { type: 'create-articles', folder: root, titles: ['Alpha', 'Beta', 'Gamma'] })
    await m.mutate(root, { type: 'reorder', path: join(root, 'Gamma/article.md'), direction: 'up' })
    expect((await manager().refresh(root)).snapshot.entries.map((entry) => basename(dirname(entry.path)))).toEqual(['Alpha', 'Gamma', 'Beta'])
  })
  it('preserves article titles while creating Windows-compatible unique folder names', async () => {
    const m = manager(); const result = await m.mutate(root, { type: 'create-articles', folder: root, titles: ['Why ribbons?', 'Guide: artwork', 'Guide/ artwork'] })
    expect(result.snapshot.entries).toHaveLength(3)
    expect(await fs.readFile(join(root, 'Why ribbons/article.md'), 'utf8')).toBe('# Why ribbons?\n\n')
    expect(await fs.readFile(join(root, 'Guide artwork 2/article.md'), 'utf8')).toBe('# Guide/ artwork\n\n')
  })
  it('keeps a loose source external rename paired to its existing translation without old association metadata', async () => {
    const { source, target } = await article('Flat', 'a.md'); await write(source, '# Text')
    for (const suffix of ['association', 'alignment', 'draft']) await fs.unlink(translation(source, suffix))
    const m = manager(); const before = await m.refresh(root)
    const destination = join(dirname(source), 'b.md'); await fs.rename(source, destination)
    const after = await m.refresh(root)
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.snapshot.entries).toEqual([expect.objectContaining({ path: destination, zhPath: join(dirname(source), 'b.zh.md'), id: before.snapshot.entries[0].id })])
    expect(await json(primary(destination))).toMatchObject({ document: 'b.md' })
    expect(await json(translation(destination, 'association'))).toMatchObject({ sourceFile: 'b.md', targetRelative: 'b.zh.md' })
    expect((await manager().refresh(root)).relocations).toContainEqual({ from: source, to: destination })
  })
  it('recognizes an original inode at its new path even if the former path has been reused', async () => {
    const { source } = await article('Flat', 'a.md'); await write(source, '# Text')
    const m = manager(); const before = await m.refresh(root)
    const destination = join(dirname(source), 'b.md'); await fs.rename(source, destination); await write(source, '# New article')
    const after = await m.refresh(root)
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.snapshot.entries.find((entry) => entry.path === destination)?.id).toBe(before.snapshot.entries[0].id)
    expect(after.snapshot.entries.find((entry) => entry.path === source)?.id).not.toBe(before.snapshot.entries[0].id)
    expect(await json(primary(destination))).toMatchObject({ document: 'b.md' })
    expect((await manager().refresh(root)).relocations).not.toContainEqual({ from: source, to: destination })
  })
  it('restores the child article of an archived series and can rename an archive root before restoration', async () => {
    const { source } = await article(); const m = manager(); await m.refresh(root)
    await m.mutate(root, { type: 'archive', path: join(root, 'Series') })
    await m.mutate(root, { type: 'rename', path: join(root, 'Archive/Series'), name: 'Renamed series' })
    const restored = await m.mutate(root, { type: 'restore', path: join(root, 'Archive/Renamed series/One/article.md') })
    expect(restored.snapshot.entries).toEqual([expect.objectContaining({ path: source, archived: false })])
  })
  it('preserves private backup and publishes relocations after the entire library root moves', async () => {
    const { source, data } = await article(); const m = manager(); await m.refresh(root)
    const destinationRoot = join(fixture, 'Moved library'); await fs.rename(root, destinationRoot)
    const destination = join(destinationRoot, relative(root, source))
    const after = await manager().refresh(destinationRoot)
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.relocations).toContainEqual({ from: source, to: destination })
    expect(await json(backup(destination))).toEqual(data)
    expect(await json(backup(source))).toEqual(data)
  })
  it('never overwrites a destination file created after preflight', async () => {
    const source = join(root, 'a.md'); await write(source, '# original'); const m = manager(); await m.refresh(root)
    const link = fs.link.bind(fs)
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => { if (String(to) === join(root, 'b.md')) await write(String(to), '# external'); return link(from, to) })
    await expect(m.mutate(root, { type: 'rename', path: source, name: 'b.md' })).rejects.toThrow()
    expect(await fs.readFile(source, 'utf8')).toBe('# original')
    expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toBe('# external')
  })
})

describe('shared resources and deep external directory changes', () => {
  it('preserves cross-folder translations when an entire parent series is externally renamed', async () => {
    const { source, target } = await article('Series/English')
    const custom = join(root, 'Series/Chinese/custom.md'); await fs.mkdir(dirname(custom)); await fs.rename(target, custom)
    for (const suffix of ['association', 'alignment', 'draft']) await write(translation(source, suffix), JSON.stringify({ version: 2, sourceFile: 'article.md', targetRelative: '../Chinese/custom.md', marker: 'keep' }))
    const m = manager(); await m.refresh(root); await fs.rename(join(root, 'Series'), join(root, 'Renamed'))
    const result = await m.refresh(root), destination = join(root, 'Renamed/English/article.md'), newTarget = join(root, 'Renamed/Chinese/custom.md')
    expect(result.snapshot.issue).toBeUndefined()
    expect(result.snapshot.entries).toEqual([expect.objectContaining({ path: destination, zhPath: newTarget })])
    expect(await json(translation(destination, 'draft'))).toMatchObject({ targetRelative: '../Chinese/custom.md', marker: 'keep' })
  })
  it('refuses an archive that would break a resource outside the article bundle', async () => {
    const { source } = await article(); await write(source, '# Example\n![Shared](../shared.png)\n'); await write(join(root, 'Series/shared.png'), 'shared-image')
    const m = manager(); await m.refresh(root)
    await expect(m.mutate(root, { type: 'archive', path: source })).rejects.toThrow('LIBRARY_MOVE_FOLDER_WITH_ASSETS')
    expect(await fs.readFile(source, 'utf8')).toContain('../shared.png')
    expect(await fs.readFile(join(root, 'Series/shared.png'), 'utf8')).toBe('shared-image')
  })
})

describe('translation identity', () => {
  it('follows a separately renamed translation and keeps its alignment and source association', async () => {
    const { source, target } = await article()
    const m = manager(); await m.refresh(root)
    const renamed = join(dirname(target), '人工翻译.md'); await fs.rename(target, renamed)
    const result = await m.refresh(root)
    expect(result.snapshot.issue).toBeUndefined()
    expect(result.snapshot.entries).toEqual([expect.objectContaining({ path: source, zhPath: renamed })])
    expect(await json(translation(source, 'association'))).toMatchObject({ targetRelative: '人工翻译.md' })
    expect(await json(translation(source, 'alignment'))).toMatchObject({ targetRelative: '人工翻译.md', sourceHash: 'keep' })
  })
})

describe('continued editing after synchronization', () => {
  it('does not clear new annotations after an old article path is reused and edited again', async () => {
    const { source } = await article('Flat', 'a.md'); await write(source, '# Original')
    const m = manager(); await m.refresh(root)
    const moved = join(dirname(source), 'b.md'); await fs.rename(source, moved); await write(source, '# New')
    await m.refresh(root)
    const newReview = { version: 2, document: 'a.md', notes: [{ id: 'new-note', comment: 'belongs to the new article' }], words: [] }
    await write(primary(source), JSON.stringify(newReview)); await write(backup(source), JSON.stringify(newReview)); await fs.appendFile(source, '\nEdited new article')
    expect((await m.refresh(root)).snapshot.issue).toBeUndefined()
    expect(await json(primary(source))).toEqual(newReview)
    expect((await json(primary(moved))).notes[0].id).toBe('note')
    expect((await fs.readdir(join(userData, 'review-backup-history')))).toHaveLength(1)
  })
  it('follows a separately moved translation across folders by exact file identity', async () => {
    const { source, target } = await article(); const m = manager(); await m.refresh(root)
    const destination = join(root, 'Translations/custom.md'); await fs.mkdir(dirname(destination)); await fs.rename(target, destination)
    const result = await manager().refresh(root)
    expect(result.snapshot.issue).toBeUndefined()
    expect(result.snapshot.entries).toEqual([expect.objectContaining({ path: source, zhPath: destination })])
    expect(await json(translation(source, 'association'))).toMatchObject({ targetRelative: '../../Translations/custom.md' })
  })
})

describe('returning an edited article to a historical path', () => {
  it('keeps the current review state through repeated renames, including a historical sidecar copy', async () => {
    const { source } = await article('Flat', 'a.md'); await write(source, '# Plain text')
    const originalPrimary = await fs.readFile(primary(source))
    const m = manager(); await m.refresh(root)
    const renamed = join(dirname(source), 'b.md')
    await m.mutate(root, { type: 'rename', path: source, name: 'b.md' })
    const current = { version: 2, document: 'b.md', notes: [{ id: 'later-note' }], words: [] }
    await write(primary(renamed), JSON.stringify(current)); await write(backup(renamed), JSON.stringify(current))
    await fs.writeFile(primary(source), originalPrimary)
    await m.mutate(root, { type: 'rename', path: renamed, name: 'a.md' })
    expect(await json(primary(source))).toEqual({ ...current, document: 'a.md' })
    expect(await json(backup(source))).toEqual({ ...current, document: 'a.md' })
    expect((await fs.readdir(join(root, '.mdduck/recovery')))).not.toHaveLength(0)
    expect((await fs.readdir(join(userData, 'review-backup-history')))).not.toHaveLength(0)
    await m.mutate(root, { type: 'rename', path: source, name: 'b.md' })
    await m.mutate(root, { type: 'rename', path: renamed, name: 'a.md' })
    expect(await json(primary(source))).toEqual({ ...current, document: 'a.md' })
  })
  it('still refuses a sidecar belonging to an unknown destination article', async () => {
    const { source } = await article('Flat', 'a.md'); await write(source, '# Plain text')
    const m = manager(); await m.refresh(root)
    const destination = join(dirname(source), 'new.md'), foreign = { version: 2, document: 'new.md', notes: [{ id: 'foreign-note' }], words: [] }
    await write(primary(destination), JSON.stringify(foreign))
    await expect(m.mutate(root, { type: 'rename', path: source, name: 'new.md' })).rejects.toThrow('LIBRARY_DESTINATION_EXISTS')
    expect(await json(primary(destination))).toEqual(foreign)
    expect(await fs.stat(source)).not.toBeNull()
  })
})

describe('long multilingual titles', () => {
  it('bounds generated folder names by UTF-8 bytes and preserves the complete heading', async () => {
    const title = '跨平台中文文章标题'.repeat(25)
    const result = await manager().mutate(root, { type: 'create-articles', folder: root, titles: [title] })
    expect(result.snapshot.entries).toHaveLength(1)
    const name = basename(dirname(result.snapshot.entries[0].path))
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(220)
    expect(await fs.readFile(result.snapshot.entries[0].path, 'utf8')).toBe(`# ${title}\n\n`)
  })
})
