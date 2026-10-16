import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createLibraryManager } from './library-manager'
import { createReviewStore } from './review-store'
import type { LibraryEntry, Note } from '../shared/types'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
let fixture: string, root: string, userData: string
const primary = (source: string) => join(dirname(source), '.review', 'documents', `${hash(basename(source))}.json`)
const metadata = (source: string, suffix: string) => join(dirname(source), '.review', 'translations', `${hash(basename(source)).slice(0, 24)}.${suffix}.json`)
const backup = (source: string) => join(userData, 'review-backups', `${hash(source)}.json`)
const journal = () => join(root, '.mdduck', 'transaction.json')
async function write(path: string, content: string) { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, content) }
async function json(path: string) { return JSON.parse(await fs.readFile(path, 'utf8')) }
async function scanner(folder: string): Promise<LibraryEntry[]> {
  const files: string[] = []
  async function walk(dir: string) {
    for (const child of await fs.readdir(dir, { withFileTypes: true })) {
      if (child.name.startsWith('.') || child.isSymbolicLink()) continue
      const path = join(dir, child.name)
      if (child.isDirectory()) await walk(path)
      else if (/\.(md|markdown)$/i.test(path)) files.push(path)
    }
  }
  await walk(folder)
  const targets = new Map<string, string>()
  for (const file of files) {
    let target = file.slice(0, -extname(file).length) + '.zh' + extname(file)
    try {
      const value = await json(metadata(file, 'association'))
      if (value.version === 2 && value.sourceFile === basename(file)) target = resolve(dirname(file), value.targetRelative)
    } catch { /* Existing conventional pairing. */ }
    if (files.includes(target) && target !== file) targets.set(file, target)
  }
  return files.filter((path) => ![...targets.values()].includes(path)).map((path) => ({ path, zhPath: targets.get(path) ?? null, title: basename(path), folder: relative(folder, dirname(path)) || '.' }))
}
const manager = () => createLibraryManager({ userData, listEntries: scanner })
const reviews = () => createReviewStore({ userData, isAllowed: async (path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }, candidates: async (source) => (await scanner(dirname(source))).filter((entry) => dirname(entry.path) === dirname(source)).map((entry) => ({ name: basename(entry.path), sourceText: '# Original\n\nA sentence that has a saved note.\n', zhText: '# 原文\n\n有批注的句子。\n' })) })
const note: Note = { id: 'kept-note', blockId: null, blockKey: 'paragraph', quote: 'A sentence that has a saved note.', quoteLang: 'source', comment: '  An actual saved annotation.\n', createdAt: '2026-10-16T00:00:00.000Z', status: 'open' }
async function article(relativePath = 'Series/One/article.md') {
  const source = join(root, relativePath)
  await write(source, '# Original\n\nA sentence that has a saved note.\n')
  await write(source.slice(0, -3) + '.zh.md', '# 原文\n\n有批注的句子。\n')
  await reviews().saveNote(source, note)
  return source
}

beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'mdduck-library-safety-')))
  root = join(fixture, 'library'); userData = join(fixture, 'private')
  await fs.mkdir(root); await fs.mkdir(userData)
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(fixture, { recursive: true, force: true }) })

describe('library data continuity under filesystem changes', () => {
  it('rejects stale management dialogs and protects the reserved archive container', async () => {
    const source = await article('a.md')
    const m = manager()
    const initial = await m.refresh(root)
    const entry = initial.snapshot.entries[0]
    await fs.rename(source, join(root, 'b.md'))
    await write(source, '# Another article\n')
    await expect(m.mutate(root, { type: 'archive', path: source, documentId: entry.id, expectedIdentity: entry.fileIdentity })).rejects.toThrow('LIBRARY_SOURCE_CHANGED')
    expect(await fs.readFile(source, 'utf8')).toContain('Another article')
    await fs.mkdir(join(root, 'Archive'))
    await expect(m.mutate(root, { type: 'rename', path: join(root, 'Archive'), name: 'Gone' })).rejects.toThrow('LIBRARY_ROOT_IMMOVABLE')
    expect((await fs.stat(join(root, 'Archive'))).isDirectory()).toBe(true)
  })
  it('recovers an interrupted leaf move before scanning and retains real review-store records', async () => {
    const source = await article('a.md')
    await manager().refresh(root)
    const target = join(root, 'interrupted.md')
    const info = await fs.lstat(source, { bigint: true })
    await fs.rename(source, target)
    await write(journal(), JSON.stringify({ version: 1, moves: [{ from: source, to: target, identity: `${info.dev}:${info.ino}` }], writes: [], created: [] }))
    const restored = await manager().refresh(root)
    expect(restored.snapshot.issue).toBeUndefined()
    expect(await fs.stat(target).catch(() => null)).toBeNull()
    expect(await fs.readFile(source, 'utf8')).toContain('A sentence')
    expect((await reviews().load(source)).notes).toEqual([note])
    expect(await fs.stat(journal()).catch(() => null)).toBeNull()
  })

  it('preserves a conflicting external replacement and leaves recovery material intact', async () => {
    const source = await article('a.md')
    await manager().refresh(root)
    const target = join(root, 'interrupted.md')
    const info = await fs.lstat(source, { bigint: true })
    await fs.rename(source, target)
    await write(source, '# External replacement that must survive\n')
    const receipt = JSON.stringify({ version: 1, moves: [{ from: source, to: target, identity: `${info.dev}:${info.ino}` }], writes: [], created: [] })
    await write(journal(), receipt)
    const result = await manager().refresh(root)
    expect(result.snapshot.issue).toBe('LIBRARY_RECOVERY_REQUIRED')
    expect(await fs.readFile(source, 'utf8')).toBe('# External replacement that must survive\n')
    expect(await fs.readFile(target, 'utf8')).toContain('A sentence that has a saved note.')
    expect(await fs.readFile(journal(), 'utf8')).toBe(receipt)
    expect((await json(backup(source))).notes).toEqual([note])
  })

  it('rejects corrupt article sidecars before moving an archive and preserves their bytes', async () => {
    const source = await article()
    await manager().refresh(root)
    const corrupt = '{broken-annotation-json'
    await fs.writeFile(primary(source), corrupt)
    await expect(manager().mutate(root, { type: 'archive', path: source })).rejects.toThrow('LIBRARY_ARTICLE_METADATA_CORRUPT')
    expect(await fs.readFile(primary(source), 'utf8')).toBe(corrupt)
    expect(await fs.readFile(source, 'utf8')).toContain('A sentence')
    expect((await json(backup(source))).notes).toEqual([note])
    expect(await fs.stat(join(root, 'Archive/One')).catch(() => null)).toBeNull()
  })

  it('rolls back a failed loose-file rename after rewriting document-specific sidecars', async () => {
    const source = await article('Series/a.md')
    const m = manager(); await m.refresh(root)
    const originalPrimary = await fs.readFile(primary(source), 'utf8')
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('library.json') && String(from).endsWith('.tmp')) throw new Error('simulated manifest failure')
      return rename(from, to)
    })
    await expect(m.mutate(root, { type: 'rename', path: source, name: 'b' })).rejects.toThrow('simulated manifest failure')
    expect(await fs.readFile(source, 'utf8')).toContain('A sentence')
    expect(await fs.readFile(primary(source), 'utf8')).toBe(originalPrimary)
    expect(await fs.stat(join(root, 'Series/b.md')).catch(() => null)).toBeNull()
    expect(await fs.stat(journal()).catch(() => null)).toBeNull()
  })

  it('follows an offline folder rename and preserves saved notes, cross-folder translation, and paused translation input', async () => {
    const source = await article()
    const custom = join(root, 'Chinese/手工译文.md')
    await fs.mkdir(dirname(custom)); await fs.rename(source.slice(0, -3) + '.zh.md', custom)
    for (const suffix of ['association', 'alignment', 'draft']) await write(metadata(source, suffix), JSON.stringify({ version: 2, sourceFile: 'article.md', targetRelative: relative(dirname(source), custom), sourceHash: 'fixed-source-hash', results: ['保留的半篇译稿'], phase: 'paused' }))
    const before = await manager().refresh(root)
    await fs.rename(dirname(source), join(root, 'Series/新目录'))
    const target = join(root, 'Series/新目录/article.md')
    const after = await manager().refresh(root)
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.snapshot.entries).toEqual([expect.objectContaining({ path: target, zhPath: custom, id: before.snapshot.entries[0].id })])
    expect(after.relocations).toContainEqual({ from: source, to: target })
    expect((await reviews().load(target)).notes).toEqual([note])
    expect((await json(metadata(target, 'draft')))).toMatchObject({ sourceHash: 'fixed-source-hash', results: ['保留的半篇译稿'], targetRelative: '../../Chinese/手工译文.md' })
    expect((await json(backup(source))).notes).toEqual([note])
    expect((await json(backup(target))).notes).toEqual([note])
  })

  it('keeps the original annotation attached to the moved file when its old path is immediately reused', async () => {
    const source = await article('a.md')
    const before = await manager().refresh(root)
    const target = join(root, 'b.md')
    await fs.rename(source, target)
    await write(source, '# A completely new article\n')
    const after = await manager().refresh(root)
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.relocations).toContainEqual({ from: source, to: target })
    expect(after.snapshot.entries.find((entry) => entry.path === target)?.id).toBe(before.snapshot.entries[0].id)
    expect(after.snapshot.entries.find((entry) => entry.path === source)?.id).not.toBe(before.snapshot.entries[0].id)
    expect((await reviews().load(target)).notes).toEqual([note])
    expect((await reviews().load(source)).notes).toEqual([])
  })

  it('restores a whole archived series after its archive directory was renamed', async () => {
    const source = await article()
    const m = manager(); await m.refresh(root)
    await m.mutate(root, { type: 'archive', path: join(root, 'Series') })
    await m.mutate(root, { type: 'rename', path: join(root, 'Archive/Series'), name: 'Renamed series' })
    await manager().mutate(root, { type: 'restore', path: join(root, 'Archive/Renamed series') })
    expect((await reviews().load(source)).notes).toEqual([note])
    expect(await fs.readFile(source.slice(0, -3) + '.zh.md', 'utf8')).toContain('有批注的句子')
  })

  it('keeps a custom translation in another subfolder connected when their whole series moves offline', async () => {
    const source = await article('Series/English/article.md')
    const target = join(root, 'Series/Chinese/custom.md')
    await fs.mkdir(dirname(target)); await fs.rename(source.slice(0, -3) + '.zh.md', target)
    await write(metadata(source, 'association'), JSON.stringify({ version: 2, sourceFile: 'article.md', targetRelative: '../Chinese/custom.md' }))
    await manager().refresh(root)
    await fs.rename(join(root, 'Series'), join(root, 'Renamed'))
    const after = await manager().refresh(root)
    const nextSource = join(root, 'Renamed/English/article.md'), nextTarget = join(root, 'Renamed/Chinese/custom.md')
    expect(after.snapshot.issue).toBeUndefined()
    expect(after.snapshot.entries).toEqual([expect.objectContaining({ path: nextSource, zhPath: nextTarget })])
    expect((await reviews().load(nextSource)).notes).toEqual([note])
    expect(await json(metadata(nextSource, 'association'))).toMatchObject({ targetRelative: '../Chinese/custom.md' })
  })

  it('refuses to break relative assets outside a moved article bundle', async () => {
    const source = await article()
    await fs.appendFile(source, '\n![Shared illustration](../shared.png)\n')
    await write(join(root, 'Series/shared.png'), 'shared-image-bytes')
    await manager().refresh(root)
    await expect(manager().mutate(root, { type: 'archive', path: source })).rejects.toThrow('LIBRARY_MOVE_FOLDER_WITH_ASSETS')
    expect(await fs.readFile(source, 'utf8')).toContain('../shared.png')
    expect(await fs.readFile(join(root, 'Series/shared.png'), 'utf8')).toBe('shared-image-bytes')
    expect((await reviews().load(source)).notes).toEqual([note])
  })

  it.each(['add', 'delete'] as const)('restores the current annotation state after an archived %s operation', async (operation) => {
    const source = await article()
    const m = manager(); await m.refresh(root)
    await m.mutate(root, { type: 'archive', path: source })
    const archived = join(root, 'Archive/One/article.md')
    const added: Note = { ...note, id: 'added-in-archive', comment: 'A later annotation retained on restore.' }
    if (operation === 'add') await reviews().saveNote(archived, added)
    else await reviews().deleteNote(archived, note.id)
    await manager().mutate(root, { type: 'restore', path: archived })
    expect((await reviews().load(source)).notes).toEqual(operation === 'add' ? [note, added] : [])
  })

})
