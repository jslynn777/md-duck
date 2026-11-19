import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { DEFAULT_MODEL, type Note } from '../shared/types'
import type { createAIService } from './ai-service'

const mocked = vi.hoisted(() => ({ userData: '', watchers: [] as Array<{ root: string; handlers: Map<string, (...args: any[]) => void>; close: ReturnType<typeof vi.fn> }> }))
vi.mock('electron', () => ({
  app: { getPath: () => mocked.userData, isPackaged: false }, BrowserWindow: {}, clipboard: { writeText: vi.fn() },
  dialog: {}, ipcMain: {}, Menu: {}, nativeImage: {}, nativeTheme: {}, protocol: {}, safeStorage: {}, shell: {},
  utilityProcess: { fork: vi.fn() }
}))
vi.mock('./speech-worker?modulePath', () => ({ default: '/unused/speech-worker.js' }))
vi.mock('./icon.png?asset', () => ({ default: '/unused/icon.png' }))
vi.mock('chokidar', () => ({ default: {
  watch: (root: string) => {
    const watcher = { root, handlers: new Map<string, (...args: any[]) => void>(), close: vi.fn(async () => {}) }
    mocked.watchers.push(watcher)
    return { ...watcher, on(event: string, listener: (...args: any[]) => void) { watcher.handlers.set(event, listener); return this } }
  }
} }))

import { createReaderSession, type ReaderSession, type ReaderSessionOptions } from './reader-session'

let fixture: string
let roots: string[]
const sessions: ReaderSession[] = []

function fakeWindow() {
  const mainFrame = {}
  const webContents = { mainFrame, send: vi.fn() }
  const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  return { window, event, send: webContents.send }
}
async function session(id: string, root: string, ai?: ReturnType<typeof createAIService>, overrides: Partial<ReaderSessionOptions> = {}) {
  const value = createReaderSession({ id, root, settingsFile: join(mocked.userData, 'spaces', id, 'settings.json'),
    ai: () => ai, ensureAI: async () => true, spaces: () => [], onSummaryChange: vi.fn(), onPreferencesChange: vi.fn(), beforeSpeech: vi.fn(), ...overrides })
  sessions.push(value)
  await value.initialize()
  return value
}
const invoke = (session: ReaderSession, event: IpcMainInvokeEvent, channel: string, ...args: unknown[]) => session.invoke(channel, event, args)
const note = (id: string): Note => ({ id, blockId: null, blockKey: 'paragraph:0', quote: 'The original paragraph.', quoteLang: 'source', comment: `A note from ${id}`, createdAt: '2026-11-17T00:00:00.000Z', status: 'open' })

beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-reader-session-')))
  mocked.userData = join(fixture, 'profile')
  roots = [join(fixture, 'first'), join(fixture, 'second')]
  await Promise.all([...roots, mocked.userData].map(root => fs.mkdir(root)))
  for (const [index, root] of roots.entries()) await fs.writeFile(join(root, 'article.md'), `# Article ${index + 1}\n\nThe original paragraph.\n`)
  mocked.watchers.length = 0
})
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(value => value.dispose()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await fs.rm(fixture, { recursive: true, force: true })
})

describe('independent article-space reader sessions', () => {
  it('counts current changes while retaining missing article history and its library warning', async () => {
    const root = roots[0], source = join(root, 'article.md'), missingSource = join(root, 'previous.md')
    await fs.writeFile(missingSource, '# Previous article\n\nKeep its comparison history.\n')
    const reader = await session('missing-history', root)
    const manifestPath = join(root, '.mdduck', 'library.json')
    const before = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    const missingEntry = before.items.find((item: { path: string }) => item.path === 'previous.md')
    const baselinePath = join(root, '.mdduck', 'change-baselines', `${createHash('sha256').update(missingEntry.id).digest('hex')}.json`)
    const baselineBefore = await fs.readFile(baselinePath, 'utf8')
    await fs.unlink(missingSource)
    await fs.appendFile(source, '\nA new paragraph to review.\n')
    await reader.refresh()
    expect(reader.state().libraryIssue).toBe('LIBRARY_MISSING_ARTICLES')
    expect(reader.summary()).toMatchObject({ availability: 'ready', changedCount: 1, changeIssue: false })
    const after = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    expect(after.items).toContainEqual(missingEntry)
    expect(await fs.readFile(baselinePath, 'utf8')).toBe(baselineBefore)
  })

  it('still reports a real comparison failure when historical articles are missing', async () => {
    const root = roots[0], missingSource = join(root, 'previous.md')
    await fs.writeFile(missingSource, '# Previous article\n')
    const reader = await session('missing-and-corrupt', root)
    const current = reader.state().library.find(entry => entry.path === join(root, 'article.md'))!
    const baselinePath = join(root, '.mdduck', 'change-baselines', `${createHash('sha256').update(current.id!).digest('hex')}.json`)
    await fs.unlink(missingSource)
    await fs.writeFile(baselinePath, '{broken comparison')
    await reader.refresh()
    expect(reader.state().libraryIssue).toBe('LIBRARY_MISSING_ARTICLES')
    expect(reader.summary()).toMatchObject({ availability: 'ready', changeIssue: true })
    expect(await fs.readFile(baselinePath, 'utf8')).toBe('{broken comparison')
  })

  it('blocks moves and translation during a local Codex task but keeps reading, notes and closing available', async () => {
    let active = true
    const reader = await session('task-guard', roots[0], undefined, { isTaskActive: () => active })
    const owner = fakeWindow(), source = join(roots[0], 'article.md')
    reader.attach(owner.window)
    await expect(invoke(reader, owner.event, 'library:manage', { type: 'archive', paths: [source] })).rejects.toThrow('ERR_CODEX_BUSY')
    await expect(invoke(reader, owner.event, 'translation:start', source)).rejects.toThrow('ERR_CODEX_BUSY')
    expect((await invoke(reader, owner.event, 'doc:open', source)).sourcePath).toBe(source)
    await invoke(reader, owner.event, 'notes:save', source, note('during-task'), reader.state().library[0].id)
    expect((await invoke(reader, owner.event, 'notes:get', source)).notes).toEqual([note('during-task')])
    await invoke(reader, owner.event, 'doc:close', source)
    expect(reader.state().openPath).toBeNull()
    expect(reader.busy()).toBe(true)
    active = false
    expect(reader.busy()).toBe(false)
  })

  it('restores bounded covers on restart and updates only the changed space, including while detached', async () => {
    const source = join(roots[0], 'article.md'), image = join(roots[0], 'cover.png')
    await fs.writeFile(image, 'fixture')
    await fs.writeFile(source, '# Original\n\nBefore.\n\n![cover](cover.png)')
    const a = await session('first', roots[0], undefined, { assetScope: 'first-scope' })
    const b = await session('second', roots[1], undefined, { assetScope: 'second-scope' })
    await a.openDocument(source)
    expect(a.summary().previewImages).toHaveLength(1)
    expect(a.summary().activity).toBeUndefined()
    await a.flush()
    await a.dispose(); sessions.splice(sessions.indexOf(a), 1)
    const reopened = await session('first', roots[0], undefined, { assetScope: 'new-first-scope' })
    expect(new URL(reopened.summary().previewImages[0]).searchParams.get('scope')).toBe('new-first-scope')
    await fs.writeFile(source, '# Revised\n\nNow more specific.\n')
    mocked.watchers.filter(value => value.root === roots[0]).at(-1)!.handlers.get('change')!(source)
    await vi.waitFor(() => expect(reopened.summary().previewText).toBe('Now more specific.'))
    expect(reopened.summary().previewImages).toEqual([])
    expect(reopened.summary().activity).toMatchObject({ kind: 'external-write', path: source })
    expect(b.summary().activity).toBeUndefined()
    expect(b.summary().previewImages).toEqual([])
  })

  it('does not restore a closed article cover after an in-flight refresh finishes', async () => {
    const first = join(roots[0], 'article.md')
    const reader = await session('first', roots[0], undefined, { assetScope: 'first-scope' })
    const owner = fakeWindow()
    reader.attach(owner.window)
    await reader.openDocument(first)
    let release!: () => void, entered = false, hold = true
    const gate = new Promise<void>(resolve => { release = resolve })
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === first && hold) { hold = false; entered = true; await gate }
      return open(...args)
    })
    const opening = reader.openDocument(first)
    await vi.waitFor(() => expect(entered).toBe(true))
    try {
      await invoke(reader, owner.event, 'doc:close', first)
      expect(reader.summary().previewText).toBe('')
    } finally { release() }
    await opening
    expect(reader.summary().previewText).toBe('')
    expect(reader.summary().previewImages).toEqual([])
    expect(reader.state().openPath).toBeNull()
  })

  it('releases the speech model on leaving a space and ignores a retired worker exit', async () => {
    const { utilityProcess } = await import('electron')
    const workers: Array<EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }> = []
    vi.mocked(utilityProcess.fork).mockImplementation(() => {
      const worker = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() })
      workers.push(worker)
      return worker as unknown as ReturnType<typeof utilityProcess.fork>
    })
    const reader = await session('speech', roots[0])
    const owner = fakeWindow()
    reader.attach(owner.window)
    await invoke(reader, owner.event, 'speech:speak', 'old-request', 'First passage.')
    reader.stopSpeech()
    expect(workers[0].kill).toHaveBeenCalledTimes(1)
    expect(owner.send).toHaveBeenCalledWith('speech:event', { type: 'cancelled', id: 'old-request' })
    await invoke(reader, owner.event, 'speech:speak', 'new-request', 'Next passage.')
    workers[0].emit('exit')
    await invoke(reader, owner.event, 'speech:speak', 'latest-request', 'Last passage.')
    expect(workers).toHaveLength(2)
    expect(workers[1].postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'latest-request' }))
    reader.attach(null)
    expect(workers[1].kill).toHaveBeenCalledTimes(1)
    expect(owner.send).toHaveBeenCalledWith('speech:event', { type: 'cancelled', id: 'latest-request' })
  })

  it('recovers private review backups after a root move and restart without changing the old backup', async () => {
    const a = await session('first', roots[0])
    const one = fakeWindow(), source = join(roots[0], 'article.md')
    a.attach(one.window)
    await invoke(a, one.event, 'notes:save', source, note('before-move'), a.state().library[0].id)
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const oldBackup = join(mocked.userData, 'review-backups', `${digest(source)}.json`)
    const original = await fs.readFile(oldBackup, 'utf8')
    await fs.unlink(join(roots[0], '.review', 'documents', `${digest('article.md')}.json`))
    const moved = join(fixture, 'relocated'), nextSource = join(moved, 'article.md')
    await fs.rename(roots[0], moved)
    await a.relocate(moved)
    await a.dispose(); sessions.splice(sessions.indexOf(a), 1)
    const reopened = await session('first', moved)
    reopened.attach(one.window)
    expect(await invoke(reopened, one.event, 'notes:get', nextSource)).toMatchObject({ notes: [note('before-move')], notesMissing: true })
    expect(await invoke(reopened, one.event, 'notes:restore', nextSource, reopened.state().library[0].id)).toMatchObject({ notes: [note('before-move')], notesMissing: false })
    expect(await fs.readFile(oldBackup, 'utf8')).toBe(original)
    expect(await fs.stat(roots[0]).catch(() => null)).toBeNull()
  })

  it('does not use historical backup paths now owned by a different registered space', async () => {
    const source = join(roots[0], 'article.md'), oldSource = join(roots[1], 'article.md')
    const digest = createHash('sha256').update(oldSource).digest('hex')
    const oldBackup = join(mocked.userData, 'review-backups', `${digest}.json`)
    await fs.mkdir(join(mocked.userData, 'review-backups'), { recursive: true })
    const original = JSON.stringify({ version: 2, document: 'article.md', notes: [note('other-space')], words: [] })
    await fs.writeFile(oldBackup, original)
    await fs.mkdir(join(mocked.userData, 'spaces', 'first'), { recursive: true })
    await fs.writeFile(join(mocked.userData, 'spaces', 'first', 'settings.json'), JSON.stringify({ root: roots[0], rootAliases: [roots[1]] }))
    const a = await session('first', roots[0], undefined, { spaces: () => [{ id: 'second', root: roots[1], name: 'Other space', createdAt: '2026-11-17T00:00:00.000Z', lastOpenedAt: '2026-11-17T00:00:00.000Z', availability: 'ready', windowOpen: false, openPath: oldSource }] })
    expect(await a.openDocument(source)).toMatchObject({ notes: [], notesMissing: false })
    expect(await fs.readFile(oldBackup, 'utf8')).toBe(original)
  })

  it('does not rewrite unchanged settings at startup', async () => {
    const settingsFile = join(mocked.userData, 'spaces', 'first', 'settings.json')
    await fs.mkdir(join(mocked.userData, 'spaces', 'first'), { recursive: true })
    const source = join(roots[0], 'article.md')
    const saved = JSON.stringify({ root: roots[0], openPath: source, scroll: { [source]: 'paragraph:kept' }, prefs: { model: DEFAULT_MODEL }, openRouterKey: null })
    await fs.writeFile(settingsFile, saved)
    const onSettingsError = vi.fn()
    const ai = { state: () => ({ provider: 'custom', profiles: { custom: { hasKey: false, model: DEFAULT_MODEL } } }) } as unknown as ReturnType<typeof createAIService>
    const rename = vi.spyOn(fs, 'rename')
    const value = await session('first', roots[0], ai, { onSettingsError })
    expect(value.state()).toMatchObject({ openPath: source, scroll: { [source]: 'paragraph:kept' } })
    expect(rename.mock.calls.some(([, destination]) => destination === settingsFile)).toBe(false)
    expect(await fs.readFile(settingsFile, 'utf8')).toBe(saved)
    expect(onSettingsError).not.toHaveBeenCalled()
  })

  it('preserves the legacy key and reading state when startup credential cleanup cannot be saved', async () => {
    const settingsFile = join(mocked.userData, 'spaces', 'first', 'settings.json')
    await fs.mkdir(join(mocked.userData, 'spaces', 'first'), { recursive: true })
    const source = join(roots[0], 'article.md')
    const saved = JSON.stringify({ root: roots[0], openPath: source, scroll: { [source]: 'paragraph:kept' }, prefs: { model: DEFAULT_MODEL }, openRouterKey: 'enc:retained-secret' })
    await fs.writeFile(settingsFile, saved)
    const onSettingsError = vi.fn()
    const ai = { state: () => ({ provider: 'custom', profiles: { custom: { hasKey: true, model: 'custom/new-model' } } }) } as unknown as ReturnType<typeof createAIService>
    const actualRename = fs.rename.bind(fs)
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === settingsFile) throw Object.assign(new Error('fixture storage failure'), { code: 'EACCES' })
      return actualRename(from, to)
    })
    try {
      const value = await session('first', roots[0], ai, { onSettingsError })
      expect(onSettingsError).toHaveBeenCalledOnce()
      expect(value.settings().openRouterKey).toBe('enc:retained-secret')
      expect(value.state()).toMatchObject({ openPath: source, scroll: { [source]: 'paragraph:kept' } })
      expect(await fs.readFile(settingsFile, 'utf8')).toBe(saved)
      expect(await value.openDocument(source)).toMatchObject({ sourcePath: source, sourceText: expect.stringContaining('The original paragraph.') })
    } finally { rename.mockRestore() }
  })

  it('flush waits for queued document state before the window can close', async () => {
    const a = await session('first', roots[0])
    const one = fakeWindow(), source = join(roots[0], 'article.md')
    a.attach(one.window)
    let release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { started = resolve })
    const readFile = fs.readFile.bind(fs)
    let hold = true
    vi.spyOn(fs, 'readFile').mockImplementation(async (file, options) => {
      if (String(file) === source && hold) { hold = false; started(); await gate }
      return readFile(file, options)
    })
    const opening = invoke(a, one.event, 'doc:open', source)
    await entered
    let finished = false
    const flushing = a.flush().then(() => { finished = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(finished).toBe(false)
    release()
    await Promise.all([opening, flushing])
    const persisted = JSON.parse(await fs.readFile(join(mocked.userData, 'spaces', 'first', 'settings.json'), 'utf8'))
    expect(persisted.openPath).toBe(source)
  })

  it('marks a moved background folder missing without discarding its reading state, then recovers on return', async () => {
    const a = await session('first', roots[0])
    const one = fakeWindow(), source = join(roots[0], 'article.md')
    a.attach(one.window)
    await invoke(a, one.event, 'doc:open', source)
    await invoke(a, one.event, 'scroll:save', source, 'paragraph:kept')
    a.attach(null)
    const watcher = mocked.watchers.find(value => value.root === roots[0])!
    const moved = join(fixture, 'externally-moved')
    await fs.rename(roots[0], moved)
    watcher.handlers.get('unlinkDir')!(roots[0])
    await vi.waitFor(() => expect(a.summary()).toMatchObject({ availability: 'missing', changeIssue: true }), { timeout: 3000 })
    expect(a.state()).toMatchObject({ root: roots[0], openPath: source, scroll: { [source]: 'paragraph:kept' } })
    expect(a.summary().changedCount).toBeUndefined()
    await fs.rename(moved, roots[0])
    watcher.handlers.get('addDir')!(roots[0])
    await vi.waitFor(() => expect(a.summary()).toMatchObject({ availability: 'ready', changeIssue: false }), { timeout: 3000 })
    expect(a.state().scroll[source]).toBe('paragraph:kept')
  })

  it('keeps documents, notes, settings and scroll positions isolated across two windows and reloads', async () => {
    const [a, b] = await Promise.all([session('first', roots[0]), session('second', roots[1])])
    const one = fakeWindow(), two = fakeWindow()
    a.attach(one.window); b.attach(two.window)
    const firstPath = join(roots[0], 'article.md'), secondPath = join(roots[1], 'article.md')
    await Promise.all([invoke(a, one.event, 'doc:open', firstPath), invoke(b, two.event, 'doc:open', secondPath)])
    await Promise.all([
      invoke(a, one.event, 'notes:save', firstPath, note('first'), a.state().library[0].id),
      invoke(b, two.event, 'notes:save', secondPath, note('second'), b.state().library[0].id),
      invoke(a, one.event, 'scroll:save', firstPath, 'paragraph:first'),
      invoke(b, two.event, 'scroll:save', secondPath, 'paragraph:second'),
      invoke(a, one.event, 'prefs:set', { fontSize: 24, ui: 'zh', mode: 'bilingual' }),
      invoke(b, two.event, 'prefs:set', { fontSize: 17, ui: 'en', mode: 'source' })
    ])
    await Promise.all([a.flush(), b.flush()])
    expect(a.state()).toMatchObject({ activeSpaceId: 'first', root: roots[0], openPath: firstPath, scroll: { [firstPath]: 'paragraph:first' }, prefs: { fontSize: 24, ui: 'zh' } })
    expect(b.state()).toMatchObject({ activeSpaceId: 'second', root: roots[1], openPath: secondPath, scroll: { [secondPath]: 'paragraph:second' }, prefs: { fontSize: 17, ui: 'en' } })
    await expect(invoke(a, one.event, 'doc:open', secondPath)).rejects.toThrow('ERR_NOT_IN_FOLDER')
    await expect(invoke(a, one.event, 'notes:save', secondPath, note('wrong-space'))).rejects.toThrow()
    await expect(invoke(b, two.event, 'notes:get', secondPath)).resolves.toMatchObject({ notes: [note('second')] })
    await Promise.all([a.dispose(), b.dispose()]); sessions.splice(0)
    const [reopenedA, reopenedB] = await Promise.all([session('first', roots[0]), session('second', roots[1])])
    expect(reopenedA.state()).toMatchObject({ openPath: firstPath, scroll: { [firstPath]: 'paragraph:first' }, prefs: { fontSize: 24, mode: 'bilingual' } })
    expect(reopenedB.state()).toMatchObject({ openPath: secondPath, scroll: { [secondPath]: 'paragraph:second' }, prefs: { fontSize: 17, mode: 'source' } })
    await expect(invoke(reopenedA, one.event, 'notes:get', firstPath)).resolves.toMatchObject({ notes: [note('first')] })
  })

  it('keeps background file events with their original space after its window switches to another space', async () => {
    const [a, b] = await Promise.all([session('first', roots[0]), session('second', roots[1])])
    const shared = fakeWindow(), another = fakeWindow()
    const firstPath = join(roots[0], 'article.md'), secondPath = join(roots[1], 'article.md')
    a.attach(shared.window)
    await invoke(a, shared.event, 'doc:open', firstPath)
    a.attach(null); b.attach(shared.window)
    await invoke(b, shared.event, 'doc:open', secondPath)
    shared.send.mockClear()
    await fs.writeFile(firstPath, '# Article 1\n\nAn AI revised the first space.\n')
    mocked.watchers.find(value => value.root === roots[0])!.handlers.get('change')!(firstPath)
    await vi.waitFor(() => expect(a.summary().changedCount).toBe(1), { timeout: 3000 })
    expect(shared.send).not.toHaveBeenCalled()
    expect(b.state().openPath).toBe(secondPath)
    a.attach(another.window)
    await invoke(a, another.event, 'doc:open', firstPath)
    await fs.writeFile(firstPath, '# Article 1\n\nA second change, only in space one.\n')
    mocked.watchers.find(value => value.root === roots[0])!.handlers.get('change')!(firstPath)
    await vi.waitFor(() => expect(another.send).toHaveBeenCalledWith('doc:update', expect.objectContaining({ sourcePath: firstPath, text: expect.stringContaining('second change') })), { timeout: 3000 })
    expect(shared.send).not.toHaveBeenCalled()
  })

  it('finishes an in-flight AI translation in its original folder after the user switches spaces', async () => {
    let respond!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { respond = resolve })
    const responseFor = (init: RequestInit) => {
      const request = JSON.parse(init.body as string)
      const input = JSON.parse(request.messages[1].content) as { segments: Array<{ id: string }> }
      const content = JSON.stringify({ translations: input.segments.map(({ id }) => ({ id, text: '译文内容' })) })
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    let requests = 0
    const fetcher = vi.fn((_url: string, init: RequestInit) => ++requests === 1 ? pending : Promise.resolve(responseFor(init)))
    vi.stubGlobal('fetch', fetcher)
    const ai = {
      state: () => ({ provider: 'custom', profiles: { custom: { hasKey: true, model: 'test/model' } } }),
      credentials: () => ({ provider: 'custom', baseUrl: 'https://ai.example.invalid/v1', model: 'test/model', key: 'fixture-key' })
    } as unknown as ReturnType<typeof createAIService>
    const [a, b] = await Promise.all([session('first', roots[0], ai), session('second', roots[1], ai)])
    const shared = fakeWindow()
    const firstPath = join(roots[0], 'article.md'), secondPath = join(roots[1], 'article.md')
    a.attach(shared.window)
    await invoke(a, shared.event, 'doc:open', firstPath)
    await invoke(a, shared.event, 'translation:start', firstPath, a.state().library[0].id)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(a.summary().activity).toMatchObject({ kind: 'translation', path: firstPath })
    expect(b.summary().activity).toBeUndefined()
    a.attach(null); b.attach(shared.window)
    await invoke(b, shared.event, 'doc:open', secondPath)
    shared.send.mockClear()
    respond(responseFor(fetcher.mock.calls[0][1]))
    await vi.waitFor(() => expect(a.busy()).toBe(false), { timeout: 3000 })
    expect(a.summary().activity?.kind).not.toBe('translation')
    expect(await invoke(a, shared.event, 'translation:info', firstPath)).toMatchObject({ task: { phase: 'complete' } })
    await vi.waitFor(async () => {
      expect(await fs.readFile(join(roots[0], 'article.zh.md'), 'utf8')).toContain('译文内容')
      expect(a.busy()).toBe(false)
    }, { timeout: 3000 })
    expect(await fs.stat(join(roots[1], 'article.zh.md')).catch(() => null)).toBeNull()
    expect(b.state().openPath).toBe(secondPath)
    expect(shared.send.mock.calls.some(([channel]) => channel === 'translation:progress' || channel === 'doc:update')).toBe(false)
  })
})
