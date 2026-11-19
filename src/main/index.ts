import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, protocol, safeStorage, shell } from 'electron'
import { appendFileSync, mkdirSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import iconPath from './icon.png?asset'
import { t } from '../shared/i18n'
import { DEFAULT_MODEL, type AppState, type Preferences } from '../shared/types'
import { spaceContextPrompt, spaceOpenUrl, type SpaceRecord, type SpaceSummary, type SpaceTarget } from '../shared/spaces'
import { createSpacesStore, spaceRootKey, spaceRootsOverlap } from './spaces-store'
import { createSpaceAssetRegistry } from './space-assets'
import { createSpaceLaunchData, parseSpaceLaunchData, parseSpaceOpenUrl, parseSpaceTargetArgs, resolveSpaceArticle } from './space-target'
import { createReaderSession, READER_CHANNELS, type ReaderSession } from './reader-session'
import { readReaderSettings, type ReaderSettings } from './space-settings'
import { createSettingsWriter, defaultUiLanguage } from './settings-store'
import { createAIService } from './ai-service'
import { createStartup } from './startup'
import { createStartupProbe } from './startup-probe'
import { windowChrome } from './window-options'
import { prepareExampleLibrary } from './example-library'
import { resolveSourcePath } from './document-translation'
import { createCodexRunner, type CodexRunner } from './codex-runner'
import { snapshotCodexFiles } from './codex-file-snapshot'
import type { CodexTaskInput, CodexApprovalResponse } from '../shared/codex-task'

app.setName('MD Duck')
const testProfile = process.env.MD_DUCK_PROFILE_DIR
if (testProfile) {
  if (!isAbsolute(testProfile) || dirname(testProfile) === testProfile) throw new Error('MD_DUCK_PROFILE_DIR must be an absolute directory below the filesystem root')
  mkdirSync(testProfile, { recursive: true })
  app.setPath('userData', testProfile)
  app.setPath('sessionData', join(testProfile, 'session'))
}
const userData = app.getPath('userData')
// Isolated runtime checks only. Normal installations never create these traces.
function traceSpaceRuntime(event: string, detail?: unknown) {
  if (!testProfile) return
  try { appendFileSync(join(testProfile, `spaces-runtime-trace-${process.pid}.jsonl`), `${JSON.stringify({ event, detail, at: Date.now(), pid: process.pid })}\n`) } catch { /* diagnostics must not affect startup */ }
}
traceSpaceRuntime('main-loaded')
const startupProbe = createStartupProbe(testProfile, process.env.MD_DUCK_STARTUP_CHECK_REPORT, app.getVersion())
const store = createSpacesStore({ userData })
const assets = createSpaceAssetRegistry()
const assetScopes = new Map<string, string>()
const sessions = new Map<string, Promise<ReaderSession>>()
const readySessions = new Map<string, ReaderSession>()
const codexRunners = new Map<string, CodexRunner>()
const startingTasks = new Set<string>()
const mutatingSpaces = new Set<string>()
const failedSessions = new Set<string>()
const bindings = new Map<number, ReaderSession>()
const windows = new Set<BrowserWindow>()
const registered = new Set<string>()
const homeDefaultsWriter = createSettingsWriter(join(userData, 'home-settings.json'))
let lastActiveSession: ReaderSession | undefined
let initialWindow: BrowserWindow | null = null
let ai: ReturnType<typeof createAIService> | undefined
let aiReady: Promise<void> | undefined
let aiStorageReady = true
let defaults: Preferences = { fontSize: 18, mode: 'source', sidebar: true, sidebarTab: 'files', voice: 'af_heart', speed: 1, model: DEFAULT_MODEL, ui: 'en' }
let quitting = false
let quitSaved = false
let summaryTimer: NodeJS.Timeout | undefined
let operationTail: Promise<unknown> = Promise.resolve()
const pendingTargets: SpaceTarget[] = []
let invalidTarget = false

protocol.registerSchemesAsPrivileged([{ scheme: 'md-duck', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

function queueOperation<T>(task: () => Promise<T>): Promise<T> {
  const next = operationTail.catch(() => undefined).then(task)
  operationTail = next
  return next
}
function currentWindow() { return BrowserWindow.getFocusedWindow() ?? [...windows].find(win => !win.isDestroyed()) ?? null }
function sessionFor(win: BrowserWindow) {
  const session = bindings.get(win.id)
  if (!session) throw new Error('ERR_SPACE_NOT_READY')
  return session
}
function recordFor(id: string) {
  const record = store.snapshot().spaces.find(space => space.id === id)
  if (!record) throw new Error('ERR_SPACE_NOT_FOUND')
  return record
}
function taskActive(id: string | null) {
  return !!id && (startingTasks.has(id) || !!codexRunners.get(id)?.busy())
}
async function codexFor(win: BrowserWindow, id: string) {
  if (quitting) throw new Error('ERR_CODEX_CLOSED')
  if (mutatingSpaces.has(id)) throw new Error('ERR_CODEX_BUSY')
  const record = recordFor(id)
  // A late click from the old reader must never start work in a different space.
  if (sessionFor(win).id !== id) throw new Error('ERR_SPACE_NOT_READY')
  let runner = codexRunners.get(id)
  if (runner?.isDisposed() && !runner.busy()) { codexRunners.delete(id); runner = undefined }
  if (runner && spaceRootKey(runner.status().root) !== spaceRootKey(record.root)) throw new Error('ERR_CODEX_ROOT_CHANGED')
  if (!runner) {
    runner = createCodexRunner({ spaceId: id, root: record.root, appVersion: app.getVersion(),
      storePath: join(userData, 'codex-tasks', `${id}.json`),
      snapshotFiles: () => snapshotCodexFiles(record.root),
      onDiagnostic: testProfile ? event => traceSpaceRuntime('codex-protocol', { spaceId: id, ...event }) : undefined,
      onChange: snapshot => {
        for (const target of windows) if (!target.isDestroyed()) target.webContents.send('codex:changed', snapshot)
        broadcastSpaces()
      } })
    codexRunners.set(id, runner)
  }
  await runner.initialize()
  if (quitting) throw new Error('ERR_CODEX_CLOSED')
  if (mutatingSpaces.has(id) || spaceRootKey(recordFor(id).root) !== spaceRootKey(runner.status().root)) throw new Error('ERR_CODEX_SPACE_CHANGED')
  return runner
}
async function mutateSpace<T>(id: string, action: () => Promise<T>) {
  mutatingSpaces.add(id)
  try { return await action() } finally { mutatingSpaces.delete(id) }
}
function summaries(): SpaceSummary[] {
  let records: SpaceRecord[]
  try { records = store.snapshot().spaces } catch { return [] }
  return records.map(record => {
    const task = codexRunners.get(record.id)?.status().task
    return { ...record, openPath: null, availability: failedSessions.has(record.id) ? 'unreadable' : 'ready', unavailableReason: failedSessions.has(record.id) ? 'settings' : undefined, changeIssue: failedSessions.has(record.id), windowOpen: false,
      ...readySessions.get(record.id)?.summary(),
      codexTask: task ? { phase: task.phase, activity: task.activity, updatedAt: task.updatedAt } : undefined }
  })
}
function broadcastSpaces() {
  if (summaryTimer) clearTimeout(summaryTimer)
  summaryTimer = setTimeout(() => {
    summaryTimer = undefined
    const value = summaries()
    for (const win of windows) if (!win.isDestroyed()) win.webContents.send('spaces:changed', value)
  }, 60)
}
function opened(win: BrowserWindow) {
  const state = sessionFor(win).state()
  return { state, openPath: state.openPath }
}
function notifyState(win: BrowserWindow) { if (!win.isDestroyed()) win.webContents.send('state:changed', opened(win)) }
function setWindowTitle(win: BrowserWindow, session: ReaderSession) {
  const name = session.id ? recordFor(session.id).name : ''
  win.setTitle(name ? `${name} — MD Duck` : 'MD Duck')
}
function attach(win: BrowserWindow, session: ReaderSession) {
  bindings.get(win.id)?.attach(null)
  bindings.set(win.id, session)
  session.attach(win)
  lastActiveSession = session
  setWindowTitle(win, session)
  buildMenu()
  broadcastSpaces()
}
function showWindow(win: BrowserWindow) {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
function decodeKey(stored: string | null) {
  if (!stored) return null
  if (stored.startsWith('raw:')) return stored.slice(4)
  if (stored.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) } catch { return null }
  }
  return null
}
async function ensureAI(settings: ReaderSettings) {
  if (!aiReady) {
    ai = createAIService({
      storePath: join(userData, 'ai-settings.json'),
      encrypt: key => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('ERR_STORAGE')
        return `enc:${safeStorage.encryptString(key).toString('base64')}`
      },
      decrypt: decodeKey,
      legacy: { key: decodeKey(settings.openRouterKey), model: settings.prefs.model },
      openExternal: url => shell.openExternal(url),
      onChange: next => {
        for (const session of readySessions.values()) session.setModel(next.profiles[next.provider].model)
        for (const win of windows) if (!win.isDestroyed()) win.webContents.send('ai:changed', next)
      }
    })
    aiReady = ai.init().catch(() => { aiStorageReady = false })
  }
  await aiReady
  return aiStorageReady
}
async function getSession(id: string | null, inherited = defaults, homeWindow?: number): Promise<ReaderSession> {
  const key = id ?? `__home__${homeWindow ?? ''}`
  let pending = sessions.get(key)
  if (!pending) {
    const record = id ? recordFor(id) : null
    const assetScope = assets.register(path => session.allowed(path))
    const session = createReaderSession({
      id, root: record?.root ?? null,
      assetScope,
      settingsFile: id ? store.settingsPath(id) : join(userData, homeWindow ? `home-settings-${homeWindow}.json` : 'home-settings.json'),
      defaultPrefs: inherited,
      ai: () => ai,
      ensureAI,
      spaces: summaries,
      onSummaryChange: broadcastSpaces,
      onPreferencesChange: buildMenu,
      onSettingsError: () => {
        void dialog.showMessageBox({ type: 'warning',
          message: inherited.ui === 'zh' ? '空间设置暂时无法保存' : 'Space settings could not be saved',
          detail: inherited.ui === 'zh'
            ? `「${record?.name ?? 'MD Duck'}」仍可继续阅读，原有配置已保留。请检查可用磁盘空间及应用数据目录权限，再重试保存。`
            : `You can keep reading in “${record?.name ?? 'MD Duck'}”. Your original configuration is preserved. Check free disk space and access to the application data folder before retrying.` })
      },
      beforeSpeech: () => { for (const other of readySessions.values()) if (other !== session) other.stopSpeech() },
      isTaskActive: () => taskActive(id)
    })
    assetScopes.set(key, assetScope)
    for (const channel of session.channels()) registerSessionChannel(channel)
    pending = session.initialize().then(() => {
      readySessions.set(key, session)
      failedSessions.delete(key)
      broadcastSpaces()
      return session
    }).catch(error => { assets.remove(assetScope); assetScopes.delete(key); sessions.delete(key); failedSessions.add(key); broadcastSpaces(); throw error })
    sessions.set(key, pending)
  }
  return pending
}

async function switchSpace(win: BrowserWindow, id: string, newWindow = false) {
  recordFor(id)
  const previous = bindings.get(win.id)
  await previous?.flush()
  const session = await getSession(id, previous?.state().prefs)
  const existing = session.window()
  await store.activate(id)
  if (existing && !existing.isDestroyed()) {
    showWindow(existing)
    broadcastSpaces()
    return opened(win)
  }
  if (newWindow) {
    const created = await createWindow(session)
    notifyState(created)
    showWindow(created)
  } else {
    attach(win, session)
  }
  return opened(win)
}
async function openFolder(win: BrowserWindow, root: string, file?: string) {
  const canonical = await fs.realpath(root)
  const containing = store.snapshot().spaces.find(space => spaceRootsOverlap(space.root, canonical) && spaceRootKey(space.root) !== spaceRootKey(canonical) && !relative(space.root, canonical).startsWith('..') && !isAbsolute(relative(space.root, canonical)))
  const record = containing ?? await store.add(canonical)
  await switchSpace(win, record.id)
  const session = await getSession(record.id)
  const targetWindow = session.window()!
  if (file) {
    const source = await resolveSourcePath(await fs.realpath(file))
    if (!await session.allowed(source)) throw new Error('ERR_NOT_IN_FOLDER')
    await session.openDocument(source)
    if (targetWindow !== win) notifyState(targetWindow)
  }
  return opened(win)
}
async function pickRoot(win: BrowserWindow) {
  const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return opened(win)
  return openFolder(win, picked.filePaths[0])
}
async function pickFile(win: BrowserWindow) {
  const picked = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] })
  if (picked.canceled || !picked.filePaths[0]) return opened(win)
  const path = picked.filePaths[0]
  return openFolder(win, dirname(path), path)
}

function guarded(channel: string, handler: (win: BrowserWindow, event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
  if (registered.has(channel)) return
  registered.add(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    await startup.ready()
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !windows.has(win) || event.senderFrame !== win.webContents.mainFrame) throw new Error('ERR_NOT_IN_FOLDER')
    const result = await handler(win, event, ...args)
    if (channel === 'state:get') startupProbe.mark('state-served')
    if (channel === 'doc:open') startupProbe.mark('document-restored')
    return result
  })
}
function registerSessionChannel(channel: string) {
  guarded(channel, (win, event, ...args) => sessionFor(win).invoke(channel, event, args))
}
for (const channel of READER_CHANNELS) registerSessionChannel(channel)
guarded('state:get', win => sessionFor(win).state())
guarded('spaces:list', async () => {
  await Promise.all(store.snapshot().spaces.map(async record => {
    try {
      const session = await getSession(record.id)
      if (session.summary().availability !== 'ready') await session.refresh()
    } catch { /* Keep a failed space visible so the saved shortcut is recoverable. */ }
  }))
  return summaries()
})
guarded('spaces:switch', (win, _event, id: string) => queueOperation(() => switchSpace(win, id)))
guarded('spaces:window', (win, _event, id: string) => queueOperation(async () => { await switchSpace(win, id, true) }))
guarded('spaces:add', win => queueOperation(() => pickRoot(win)))
guarded('root:pick', win => queueOperation(() => pickRoot(win)))
guarded('file:pick', win => queueOperation(() => pickFile(win)))
guarded('path:open', (win, _event, path: string) => queueOperation(async () => {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('ERR_NOT_FOUND')
  const stat = await fs.stat(path).catch(() => null)
  if (!stat) throw new Error('ERR_NOT_FOUND')
  if (stat.isDirectory()) return openFolder(win, path)
  if (!/\.(md|markdown)$/i.test(path)) throw new Error('ERR_ONLY_MD')
  return openFolder(win, dirname(path), path)
}))
guarded('root:example', win => queueOperation(async () => {
  const source = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'examples')
  const root = await prepareExampleLibrary(source, join(userData, 'examples'))
  return openFolder(win, root)
}))
guarded('spaces:rename', (_win, _event, id: string, name: string) => queueOperation(async () => {
  await store.rename(id, name)
  const session = readySessions.get(id)
  if (session?.window()) setWindowTitle(session.window()!, session)
  broadcastSpaces()
  return summaries()
}))
guarded('spaces:remove', (win, _event, id: string) => queueOperation(() => mutateSpace(id, async () => {
  recordFor(id)
  if (taskActive(id)) throw new Error('ERR_CODEX_BUSY')
  const session = await getSession(id)
  if (session.busy()) throw new Error('LIBRARY_BUSY')
  const owner = session.window()
  if (owner && owner !== win) throw new Error('ERR_SPACE_WINDOW_OPEN')
  await session.flush()
  // Retain every setting and review file. Only remove the shortcut from the registry.
  const home = owner ? await getSession(null, session.state().prefs, owner.id) : null
  await codexRunners.get(id)?.dispose()
  codexRunners.delete(id)
  await store.remove(id)
  if (owner && home) { attach(owner, home); notifyState(owner) }
  try { await session.dispose() } catch {
    // The pre-removal flush already succeeded. Cleanup cannot reverse the
    // durable shortcut removal or leave a disposed session available to reopen.
  } finally {
    const scope = assetScopes.get(id)
    if (scope) assets.remove(scope)
    assetScopes.delete(id)
    readySessions.delete(id)
    sessions.delete(id)
    broadcastSpaces()
  }
  return opened(win)
})))
guarded('spaces:relocate', (win, _event, id: string) => queueOperation(() => mutateSpace(id, async () => {
  const old = recordFor(id)
  if (taskActive(id)) throw new Error('ERR_CODEX_BUSY')
  const session = await getSession(id)
  if (session.busy()) throw new Error('LIBRARY_BUSY')
  if (session.window() && session.window() !== win) throw new Error('ERR_SPACE_WINDOW_OPEN')
  const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: dirname(old.root) })
  if (picked.canceled || !picked.filePaths[0]) return opened(win)
  if (taskActive(id)) throw new Error('ERR_CODEX_BUSY')
  await session.flush()
  const target = await fs.realpath(picked.filePaths[0])
  if (!(await fs.stat(target)).isDirectory()) throw new Error('ERR_SPACE_FOLDER')
  if (store.snapshot().spaces.some(space => space.id !== id && spaceRootsOverlap(space.root, target))) throw new Error('ERR_SPACE_ROOT_OVERLAP')
  await codexRunners.get(id)?.dispose()
  codexRunners.delete(id)
  await session.relocate(target)
  try { await store.relocate(id, target) } catch (error) {
    // A registry write failure must not leave this live reader pointing somewhere
    // different from its durable shortcut. No article files are moved here.
    try { await session.relocate(old.root) } finally {
      if (session.window()) notifyState(session.window()!)
      broadcastSpaces()
    }
    throw error
  }
  broadcastSpaces()
  return opened(win)
})))
guarded('spaces:context', async (win, _event, id: string, path?: string) => {
  const record = recordFor(id)
  const session = await getSession(id)
  let relativePath: string | undefined
  const chosen = path ?? session.state().openPath
  if (chosen) {
    try {
      const actual = await fs.realpath(chosen)
      if (!await session.allowed(actual)) throw new Error('ERR_NOT_IN_FOLDER')
      const candidate = relative(record.root, actual).split('\\').join('/')
      await resolveSpaceArticle(record.root, candidate)
      relativePath = candidate
    } catch (error) { if (path !== undefined) throw error }
  }
  return { text: spaceContextPrompt({ space: record, relativePath }, sessionFor(win).state().prefs.ui), url: spaceOpenUrl({ spaceId: id, relativePath }) }
})

guarded('codex:status', async (win, _event, id: string) => (await codexFor(win, id)).status())
guarded('codex:check', async (win, _event, id: string) => (await codexFor(win, id)).check())
for (const operation of ['start', 'resume'] as const) {
  guarded(`codex:${operation}`, async (win, _event, id: string, input: CodexTaskInput) => {
    // Serialize target validation with folder relocation, but keep stop responsive
    // while the app-server handshake or the model's first turn is pending.
    const runner = await queueOperation(async () => {
      if (quitting || taskActive(id)) throw new Error('ERR_CODEX_BUSY')
      const runner = await codexFor(win, id)
      if (sessionFor(win).busy()) throw new Error('LIBRARY_BUSY')
      startingTasks.add(id)
      return runner
    })
    try { return await runner[operation](input) } finally { startingTasks.delete(id) }
  })
}
guarded('codex:stop', async (win, _event, id: string) => (await codexFor(win, id)).stop())
guarded('codex:takeover', async (win, _event, id: string) => (await codexFor(win, id)).takeover())
guarded('codex:respond', async (win, _event, id: string, response: CodexApprovalResponse) => (await codexFor(win, id)).respond(response))

ipcMain.handle('startup:restart', event => {
  if (!BrowserWindow.fromWebContents(event.sender) || startup.phase() !== 'failed') return
  app.relaunch(); app.quit()
})

function registerImageProtocol() {
  protocol.handle('md-duck', async request => {
    const asset = await assets.resolve(request.url)
    if (!asset) return new Response('forbidden', { status: 403 })
    const data = await fs.readFile(asset.path).catch(() => null)
    return data ? new Response(data, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-store' } }) : new Response('missing', { status: 404 })
  })
}
async function createWindow(session?: ReaderSession): Promise<BrowserWindow> {
  const win = new BrowserWindow({ width: 1320, height: 860, minWidth: 900, minHeight: 600, title: 'MD Duck', icon: iconPath,
    ...windowChrome(process.platform), backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1a18' : '#fbfaf7', show: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  windows.add(win)
  if (session) attach(win, session)
  if (win.isVisible()) startupProbe.mark('window-visible')
  win.once('show', () => startupProbe.mark('window-visible'))
  win.on('focus', () => {
    buildMenu()
    const current = bindings.get(win.id)
    if (!current) return
    lastActiveSession = current
    if (current.id) void store.activate(current.id).then(broadcastSpaces).catch(() => undefined)
  })
  win.on('closed', () => {
    const session = bindings.get(win.id)
    session?.attach(null)
    void session?.flush().catch(() => undefined)
    bindings.delete(win.id)
    windows.delete(win)
    if (initialWindow === win) initialWindow = null
    broadcastSpaces()
  })
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-prevent-unload', event => {
    const zh = bindings.get(win.id)?.state().prefs.ui === 'zh'
    const response = dialog.showMessageBoxSync(win, { type: 'warning', message: zh ? '批注草稿还没有保存到磁盘' : 'Note drafts have not been saved to disk',
      detail: zh ? '返回后可以重试保存。直接关闭会丢弃只保存在内存中的草稿。' : 'Return and retry saving. Closing now discards drafts stored only in memory.',
      buttons: zh ? ['返回保存', '放弃草稿并关闭'] : ['Return to save', 'Discard drafts and close'], defaultId: 0, cancelId: 0 })
    if (response === 1) event.preventDefault()
    else { quitSaved = false; quitting = false }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
  })
  try {
    if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await win.loadFile(join(__dirname, '../renderer/index.html'))
    startupProbe.mark('renderer-loaded')
  } catch {
    if (!win.isDestroyed()) {
      await dialog.showMessageBox(win, { type: 'error', message: 'MD Duck could not load the reader. Please restart the app.' })
      throw new Error('ERR_STARTUP')
    }
  }
  return win
}
function buildMenu() {
  const lang = currentWindow() ? bindings.get(currentWindow()!.id)?.state().prefs.ui ?? defaults.ui : defaults.ui
  const withWindow = (action: (win: BrowserWindow) => Promise<unknown>) => { void startup.ready().then(() => queueOperation(async () => {
    const win = currentWindow()
    if (!win) return
    await action(win)
    notifyState(win)
  })).catch(() => undefined) }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: t(lang, 'menuFile'), submenu: [
      { label: t(lang, 'menuOpenFolder'), accelerator: 'CmdOrCtrl+O', click: () => withWindow(pickRoot) },
      { label: t(lang, 'menuOpenFile'), accelerator: 'CmdOrCtrl+Shift+O', click: () => withWindow(pickFile) },
      { type: 'separator' }, { role: 'close' }, ...(process.platform !== 'darwin' ? [{ role: 'quit' as const }] : [])
    ] }, { role: 'editMenu' },
    { label: t(lang, 'menuView'), submenu: [
      { label: lang === 'zh' ? '所有空间' : 'All spaces', accelerator: 'CmdOrCtrl+Shift+S', click: () => currentWindow()?.webContents.send('spaces:overview') },
      ...(!app.isPackaged ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []), { role: 'togglefullscreen' }
    ] }, { role: 'windowMenu' }
  ]))
}
async function initialize() {
  defaults.ui = defaultUiLanguage(app.getPreferredSystemLanguages())
  const registry = await store.load()
  if (!registry.activeSpaceId) {
    const homeFile = join(userData, 'home-settings.json')
    const defaultFile = await fs.stat(homeFile).catch(() => null) ? homeFile : join(userData, 'settings.json')
    const legacy = await readReaderSettings(defaultFile, null, defaults)
    defaults = legacy.prefs
    await ensureAI(legacy)
  }
  let session: ReaderSession
  try { session = await getSession(registry.activeSpaceId) } catch (error) {
    if (!registry.activeSpaceId) throw error
    // A damaged space must not block the other local folders. Its original
    // configuration stays untouched and its card remains available to retry.
    session = await getSession(null)
  }
  defaults = session.state().prefs
  if (initialWindow && !initialWindow.isDestroyed()) attach(initialWindow, session)
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(iconPath).resize({ width: 256, height: 256 }))
  if (app.isPackaged && !testProfile) app.setAsDefaultProtocolClient('mdduck')
  buildMenu()
  startupProbe.mark('initialized')
  if (!aiStorageReady && initialWindow && !initialWindow.isDestroyed()) {
    void dialog.showMessageBox(initialWindow, { type: 'error',
      message: defaults.ui === 'zh' ? 'AI 设置暂时无法读取或安全保存' : 'AI settings could not be loaded or saved securely',
      detail: defaults.ui === 'zh' ? '原有配置已保留，文章阅读不受影响。请检查系统凭据存储和应用数据目录权限。' : 'Your existing configuration is preserved and reading remains available. Check system credential storage and access to the application data folder.' })
  }
  // Background libraries remain monitored; change badges never invent an AI task status.
  for (const record of registry.spaces) if (record.id !== session.id && !failedSessions.has(record.id)) void getSession(record.id).catch(() => broadcastSpaces())
}
const startup = createStartup({ registerProtocols: registerImageProtocol, openWindow: async () => { initialWindow = await createWindow() }, initialize })
traceSpaceRuntime('single-instance-lock-start')
const launchData = createSpaceLaunchData(process.argv)
const firstInstance = app.requestSingleInstanceLock(launchData)
traceSpaceRuntime('single-instance-lock-result', { firstInstance })
if (!firstInstance) app.quit()
function collectTarget(args: string[], data?: unknown) {
  try {
    // Chromium can reorder switch arguments before delivering second-instance.
    // Prefer the original process's parsed intent, validated again here.
    const forwarded = parseSpaceLaunchData(data)
    if (forwarded?.invalid) throw new Error('ERR_SPACE_TARGET')
    const target = forwarded ? forwarded.target : parseSpaceTargetArgs(args)
    if (target) pendingTargets.push(target)
    traceSpaceRuntime('target-collected', { found: !!target })
  } catch { invalidTarget = true; traceSpaceRuntime('target-invalid') }
}
collectTarget(process.argv, launchData)
app.on('open-url', (event, url) => { event.preventDefault(); try { pendingTargets.push(parseSpaceOpenUrl(url)) } catch { invalidTarget = true }; void processTargets() })
app.on('second-instance', (_event, args, _directory, data) => { traceSpaceRuntime('second-instance-received'); collectTarget(args, data); void processTargets(true) })
async function processTargets(activate = false) {
  traceSpaceRuntime('targets-requested', { ready: app.isReady(), count: pendingTargets.length })
  if (!app.isReady()) return
  try { await startup.ready() } catch { return }
  await queueOperation(async () => {
    traceSpaceRuntime('targets-processing', { count: pendingTargets.length })
    if (invalidTarget) { invalidTarget = false; await dialog.showMessageBox({ type: 'error', message: defaults.ui === 'zh' ? '无法打开这个空间链接' : 'This space link could not be opened', detail: defaults.ui === 'zh' ? '空间标识或文章路径无效。请在 MD Duck 中重新复制空间说明。' : 'The space ID or article path is invalid. Copy the space instructions again in MD Duck.' }) }
    while (pendingTargets.length) {
      const target = pendingTargets.shift()!
      try {
        const record = recordFor(target.spaceId)
        const path = target.relativePath ? await resolveSpaceArticle(record.root, target.relativePath) : undefined
        const session = await getSession(record.id)
        let win = session.window()
        if (!win || win.isDestroyed()) {
          // External AI targets open their own space instead of hijacking an unrelated reader.
          win = await createWindow(session)
        }
        await store.activate(record.id)
        if (path) await session.openDocument(path)
        notifyState(win); showWindow(win)
      } catch {
        await dialog.showMessageBox({ type: 'error', message: defaults.ui === 'zh' ? '找不到指定空间或文章' : 'The requested space or article could not be found', detail: defaults.ui === 'zh' ? '请检查文件夹位置，并从对应空间重新复制说明。没有改动任何文章。' : 'Check the folder location and copy instructions from the correct space. No article was modified.' })
      }
    }
    if (activate && currentWindow()) showWindow(currentWindow()!)
    traceSpaceRuntime('targets-complete')
  })
}
async function activateWindow() {
  if (!firstInstance || !app.isReady()) return
  try { await startup.ready() } catch { if (initialWindow) showWindow(initialWindow); return }
  await queueOperation(async () => {
    const existing = currentWindow()
    if (existing) { showWindow(existing); return }
    const session = await getSession(store.snapshot().activeSpaceId, defaults, BrowserWindow.getAllWindows().length + 1)
    const win = await createWindow(session); notifyState(win); showWindow(win)
  })
}
if (firstInstance) void app.whenReady().then(async () => { await startup.start(); await processTargets() })
app.on('activate', () => { void activateWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', event => {
  if (quitSaved || !readySessions.size) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void queueOperation(async () => {
    const stopped = await Promise.allSettled([...codexRunners].map(async ([id, runner]) => {
      await runner.dispose()
      if (codexRunners.get(id) === runner) codexRunners.delete(id)
    }))
    const failed = stopped.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    await Promise.all([...readySessions.values()].map(session => session.flush()))
    if (lastActiveSession && !lastActiveSession.id) await homeDefaultsWriter.write(lastActiveSession.settings())
    await store.flush()
  }).then(() => { quitSaved = true; app.quit() }).catch(async error => {
    quitting = false
    const zh = defaults.ui === 'zh'
    if (/ERR_CODEX/.test(String(error))) {
      const result = await dialog.showMessageBox({ type: 'error',
        message: zh ? '还不能确认 Codex 任务已经停止' : 'Codex task shutdown could not be confirmed',
        detail: zh ? '应用保持打开，已经写入的文章仍保留。可以返回任务面板检查，或重试停止后退出。' : 'The app remains open and saved article changes are preserved. Return to the task panel, or retry stopping before quitting.',
        buttons: zh ? ['返回应用', '重试停止并退出'] : ['Return to app', 'Retry stopping and quit'], defaultId: 0, cancelId: 0 })
      if (result.response === 1) app.quit()
      return
    }
    const result = await dialog.showMessageBox({ type: 'error', message: zh ? '空间设置无法保存' : 'Space settings could not be saved',
      buttons: zh ? ['返回应用', '重试保存', '放弃最新设置并退出'] : ['Return to app', 'Retry saving', 'Discard latest settings and quit'], defaultId: 0, cancelId: 0 })
    if (result.response === 2) { quitSaved = true; app.quit() } else if (result.response === 1) app.quit()
  })
})
app.on('will-quit', () => { ai?.dispose(); for (const session of readySessions.values()) void session.dispose().catch(() => undefined) })
