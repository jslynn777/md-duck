import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileMenuResult, LibraryEntry } from '../shared/types'
import { createFileActionService, presentFileMenu, revealTarget, type FileMenuContext } from './file-menu'

let sandbox: string
let root: string
let outside: string
let entry: LibraryEntry
let context: FileMenuContext
const reveal = vi.fn()
const copy = vi.fn()
const open = vi.fn(async () => '')
const service = () => createFileActionService(() => context, { reveal, copy, open })

beforeEach(async () => {
  vi.clearAllMocks()
  open.mockResolvedValue('')
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'md-duck-file-menu-')))
  root = join(sandbox, 'articles')
  outside = join(sandbox, 'private')
  await Promise.all([mkdir(root), mkdir(outside)])
  entry = { path: join(root, 'article.md'), zhPath: join(root, 'article.zh.md'), title: 'Article', folder: '.' }
  await Promise.all([writeFile(entry.path, '# Article'), writeFile(entry.zhPath!, '# 译文')])
  context = { root, library: [entry], revision: 1 }
})
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }) })

describe('native library file actions', () => {
  it('resolves either exact row path while keeping the source and translation distinct', async () => {
    const actions = service()
    const session = await actions.prepare(entry.zhPath)
    expect(session.sourcePath).toBe(entry.path)
    await actions.execute(session, { action: 'copy-path', target: 'translation' })
    expect(copy).toHaveBeenCalledWith(entry.zhPath)
    expect(reveal).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects arbitrary files even when inside the selected folder', async () => {
    const privateFile = join(root, 'not-listed.md')
    await writeFile(privateFile, '# Not in library')
    await expect(service().prepare(privateFile)).rejects.toThrow('ERR_NOT_IN_FOLDER')
  })

  it.each([null, 123, 'article.md', '/bad\0.md'])('rejects malformed or relative requests: %s', async (requested) => {
    await expect(service().prepare(requested)).rejects.toThrow('ERR_NOT_IN_FOLDER')
  })

  it('requires a selected root and a regular Markdown source file', async () => {
    context.root = null
    await expect(service().prepare(entry.path)).rejects.toThrow('ERR_NOT_IN_FOLDER')
    context.root = root
    await rm(entry.path)
    await mkdir(entry.path)
    await expect(service().prepare(entry.path)).rejects.toThrow('ERR_NOT_FOUND')
  })

  it('rejects a non-Markdown canonical file hidden behind a Markdown symlink', async () => {
    const textFile = join(root, 'private.txt')
    await writeFile(textFile, 'private')
    await rm(entry.path)
    await symlink(textFile, entry.path)
    await expect(service().prepare(entry.path)).rejects.toThrow('ERR_ONLY_MD')
  })

  it.each(['source', 'translation'] as const)('rejects an outside symlink request for %s', async (target) => {
    const privateFile = join(outside, 'secret.md')
    await writeFile(privateFile, '# Private')
    const path = target === 'source' ? entry.path : entry.zhPath!
    await rm(path)
    await symlink(privateFile, path)
    await expect(service().prepare(path)).rejects.toThrow('ERR_NOT_IN_FOLDER')
  })

  it.each(['missing', 'outside'] as const)('keeps source actions available when the paired translation is %s', async (kind) => {
    await rm(entry.zhPath!)
    if (kind === 'outside') {
      const privateFile = join(outside, 'secret.md')
      await writeFile(privateFile, '# Private')
      await symlink(privateFile, entry.zhPath!)
    }
    const actions = service()
    const session = await actions.prepare(entry.path)
    expect(session.translationReal).toBeNull()
    await actions.execute(session, { action: 'reveal', target: 'source' })
    expect(reveal).toHaveBeenCalledWith(entry.path)
    await expect(actions.execute(session, { action: 'reveal', target: 'translation' })).rejects.toThrow('ERR_NOT_IN_FOLDER')
    expect(reveal).toHaveBeenCalledOnce()
  })

  it('preserves a selected folder alias for copied paths and uses canonical paths for native operations', async () => {
    const alias = join(sandbox, 'selected-alias')
    await symlink(root, alias, 'dir')
    entry = { ...entry, path: join(alias, 'article.md'), zhPath: join(alias, 'article.zh.md') }
    context = { root: alias, library: [entry], revision: 2 }
    const actions = service()
    const session = await actions.prepare(entry.path)
    await actions.execute(session, { action: 'copy-path', target: 'source' })
    await actions.execute(session, { action: 'reveal', target: 'source' })
    await actions.execute(session, { action: 'open-default', target: 'translation' })
    expect(copy).toHaveBeenCalledWith(join(alias, 'article.md'))
    expect(reveal).toHaveBeenCalledWith(join(root, 'article.md'))
    expect(open).toHaveBeenCalledWith(join(root, 'article.zh.md'))
  })

  it.each(['root', 'library', 'pair', 'revision'] as const)('revalidates a changed %s after the menu opens', async (change) => {
    const actions = service()
    const session = await actions.prepare(entry.path)
    if (change === 'root') context.root = outside
    if (change === 'library') context.library = []
    if (change === 'pair') context.library = [{ ...entry, zhPath: null }]
    if (change === 'revision') context.revision++
    await expect(actions.execute(session, { action: 'reveal', target: 'source' })).rejects.toThrow('ERR_NOT_IN_FOLDER')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('rejects a file removed while its menu is open', async () => {
    const actions = service()
    const session = await actions.prepare(entry.path)
    await rm(entry.path)
    await expect(actions.execute(session, { action: 'open-default', target: 'source' })).rejects.toThrow('ERR_NOT_FOUND')
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects a menu target redirected to another file even within the root', async () => {
    const actions = service()
    const session = await actions.prepare(entry.path)
    await rm(entry.path)
    await symlink(entry.zhPath!, entry.path)
    await expect(actions.execute(session, { action: 'reveal', target: 'source' })).rejects.toThrow('ERR_NOT_IN_FOLDER')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('rejects a selected root alias redirected while the menu is open', async () => {
    const alias = join(sandbox, 'selected-alias')
    await symlink(root, alias, 'dir')
    const secondRoot = join(sandbox, 'second-root')
    await mkdir(secondRoot)
    await Promise.all([writeFile(join(secondRoot, 'article.md'), '# Other'), writeFile(join(secondRoot, 'article.zh.md'), '# 另一篇')])
    entry = { ...entry, path: join(alias, 'article.md'), zhPath: join(alias, 'article.zh.md') }
    context = { root: alias, library: [entry], revision: 2 }
    const actions = service()
    const session = await actions.prepare(entry.path)
    await rm(alias)
    await symlink(secondRoot, alias, 'dir')
    await expect(actions.execute(session, { action: 'copy-path', target: 'source' })).rejects.toThrow('ERR_NOT_IN_FOLDER')
    expect(copy).not.toHaveBeenCalled()
  })

  it('reports default-app failures instead of returning a successful action', async () => {
    const actions = service()
    const session = await actions.prepare(entry.path)
    open.mockResolvedValue('No application is associated with this file')
    await expect(actions.execute(session, { action: 'open-default', target: 'source' })).rejects.toThrow('ERR_OPEN_FILE')
    open.mockRejectedValue(new Error('OS launch failed'))
    await expect(actions.execute(session, { action: 'open-default', target: 'source' })).rejects.toThrow('ERR_OPEN_FILE')
  })

  it('cancels before a native action without modifying the active document', async () => {
    const actions = service()
    const session = await actions.prepare(entry.path)
    expect(await actions.execute(session, { action: 'reveal', target: 'source' }, () => true)).toBeNull()
    expect(reveal).not.toHaveBeenCalled()
    expect(context.library).toEqual([entry])
  })

  it('allows revealing the root directory but rejects outside and escaping links', async () => {
    expect(await revealTarget(root, root)).toBe(root)
    await expect(revealTarget(outside, root)).rejects.toThrow('ERR_NOT_IN_FOLDER')
    const escape = join(root, 'linked-directory')
    await symlink(outside, escape, 'dir')
    await expect(revealTarget(escape, root)).rejects.toThrow('ERR_NOT_IN_FOLDER')
  })
})

describe('native menu completion and cancellation', () => {
  function harness(execute: (choice: FileMenuResult, canceled: () => boolean) => Promise<FileMenuResult | null> = vi.fn(async (choice: FileMenuResult) => choice)) {
    let choose!: (choice: FileMenuResult) => void
    let closed!: () => void
    let windowClosed!: () => void
    const unsubscribe = vi.fn()
    const close = vi.fn(() => closed?.())
    const pending = presentFileMenu({
      create: (select) => { choose = select; return { popup: (callback) => { closed = callback }, close } },
      onWindowClosed: (cancel) => { windowClosed = cancel; return unsubscribe },
      execute
    })
    return { ...pending, choose, closed, windowClosed, unsubscribe, close, execute }
  }

  it('resolves dismissed menus without executing an action and removes its window listener', async () => {
    const menu = harness()
    menu.closed()
    expect(await menu.result).toBeNull()
    expect(menu.execute).not.toHaveBeenCalled()
    expect(menu.unsubscribe).toHaveBeenCalledOnce()
  })

  it('waits for an asynchronous click when native menu closure comes first', async () => {
    let complete!: (choice: FileMenuResult) => void
    const execute = vi.fn(() => new Promise<FileMenuResult>((resolve) => { complete = resolve }))
    const menu = harness(execute)
    const result: FileMenuResult = { action: 'copy-path', target: 'translation' }
    menu.choose(result)
    menu.closed()
    expect(menu.unsubscribe).not.toHaveBeenCalled()
    complete(result)
    expect(await menu.result).toEqual(result)
    expect(menu.execute).toHaveBeenCalledOnce()
    expect(menu.unsubscribe).toHaveBeenCalledOnce()
  })

  it('rejects asynchronous action failures and cleans up the window listener', async () => {
    const menu = harness(vi.fn(async () => { throw new Error('ERR_OPEN_FILE') }))
    menu.choose({ action: 'open-default', target: 'source' })
    menu.closed()
    await expect(menu.result).rejects.toThrow('ERR_OPEN_FILE')
    expect(menu.unsubscribe).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'windowClosed'] as const)('settles and closes its native popup on %s without executing later clicks', async (method) => {
    const menu = harness()
    menu[method]()
    menu.choose({ action: 'reveal', target: 'source' })
    expect(await menu.result).toBeNull()
    expect(menu.close).toHaveBeenCalledOnce()
    expect(menu.execute).not.toHaveBeenCalled()
    expect(menu.unsubscribe).toHaveBeenCalledOnce()
  })

  it('prevents pending selection work after cancellation', async () => {
    let complete!: () => void
    let isCanceled!: () => boolean
    const nativeAction = vi.fn()
    const execute = vi.fn((choice: FileMenuResult, canceled: () => boolean) => new Promise<FileMenuResult | null>((resolve) => {
      isCanceled = canceled
      complete = () => { if (!canceled()) nativeAction(); resolve(canceled() ? null : choice) }
    }))
    const menu = harness(execute)
    menu.choose({ action: 'reveal', target: 'source' })
    menu.windowClosed()
    expect(isCanceled()).toBe(true)
    complete()
    expect(await menu.result).toBeNull()
    expect(nativeAction).not.toHaveBeenCalled()
  })
})
