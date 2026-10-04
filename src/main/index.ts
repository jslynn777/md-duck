import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import { mkdirSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import speechWorkerPath from './speech-worker?modulePath'
import iconPath from './icon.png?asset'
import { t } from '../shared/i18n'
import { createReviewStore } from './review-store'
import { assertReviewSource } from './review-files'
import { prepareExampleLibrary } from './example-library'
import { isPathInsideRoot } from './allowed-path'
import { createWordHelpService } from './word-help'
import { createAIService, requestChat } from './ai-service'
import { createDocumentTranslator, translationPath, resolveSourcePath } from './document-translation'
import { createSettingsWriter, defaultUiLanguage } from './settings-store'
import type { AIConfigInput } from '../shared/ai'
import { buildCatalog, fallbackCatalog } from '../shared/models'
import {
  DEFAULT_MODEL,
  type AppState,
  type LibraryEntry,
  type ModelCatalog,
  type LearnedWord,
  type Note,
  type OpenedDocument,
  type Preferences,
  type SpeechEvent
} from '../shared/types'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', 'build'])
const MAX_FILES = 2000

const DEFAULT_PREFS: Preferences = {
  fontSize: 18,
  mode: 'source',
  sidebar: true,
  sidebarTab: 'files',
  voice: 'af_heart',
  speed: 1,
  model: DEFAULT_MODEL,
  ui: 'en'
}

type Settings = {
  root: string | null
  prefs: Preferences
  openPath: string | null
  scroll: Record<string, string>
  openRouterKey: string | null
}

let window: BrowserWindow | null = null
let watcher: FSWatcher | null = null
let settings: Settings
let library: LibraryEntry[] = []
let openPath = ''
let documentOpenRequest = 0
let assetVersion = 1
let saveTimer: NodeJS.Timeout | null = null
let settingsWriter: ReturnType<typeof createSettingsWriter> | null = null
let quitSaved = false
let quitSaving = false
let settingsRevision = 0
let libraryTimer: NodeJS.Timeout | null = null
let speech: UtilityProcess | null = null
let ai: ReturnType<typeof createAIService>
let translator: ReturnType<typeof createDocumentTranslator>
const fileTimers = new Map<string, NodeJS.Timeout>()

protocol.registerSchemesAsPrivileged([
  { scheme: 'md-duck', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

app.setName('MD Duck')

// An explicit profile allows first-run verification without touching normal data.
const testProfile = process.env.MD_DUCK_PROFILE_DIR
if (testProfile) {
  if (!isAbsolute(testProfile) || dirname(testProfile) === testProfile) throw new Error('MD_DUCK_PROFILE_DIR must be an absolute directory below the filesystem root')
  mkdirSync(testProfile, { recursive: true })
  app.setPath('userData', testProfile)
  app.setPath('sessionData', join(testProfile, 'session'))
}

const firstInstance = app.requestSingleInstanceLock()
if (!firstInstance) app.quit()
app.on('second-instance', () => {
  if (!window && settings) createWindow()
  if (window?.isMinimized()) window.restore()
  window?.show()
  window?.focus()
})

const reviews = createReviewStore({
  isAllowed,
  userData: app.getPath('userData'),
  candidates: async (source) => {
    const entries = await listLibrary(dirname(source))
    const candidates = []
    const seen = new Set<string>()
    for (const entry of entries) {
      const canonical = await assertReviewSource(entry.path, isAllowed).catch(() => null)
      if (!canonical || dirname(canonical) !== dirname(source) || seen.has(canonical)) continue
      seen.add(canonical)
      candidates.push({
        name: basename(canonical),
        sourceText: await fs.readFile(canonical, 'utf8'),
        zhText: entry.zhPath && await isAllowed(entry.zhPath) ? await fs.readFile(entry.zhPath, 'utf8') : null
      })
    }
    return candidates
  }
})

if (firstInstance) app.whenReady().then(async () => {
  settings = await loadSettings()
  ai = createAIService({
    storePath: join(app.getPath('userData'), 'ai-settings.json'),
    encrypt: (key) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('ERR_STORAGE')
      return `enc:${safeStorage.encryptString(key).toString('base64')}`
    },
    decrypt: decodeKey,
    legacy: { key: readKey(), model: settings.prefs.model },
    openExternal: (url) => shell.openExternal(url),
    onChange: (next) => {
      settings.prefs.model = next.profiles[next.provider].model
      scheduleSave()
      window?.webContents.send('ai:changed', next)
    }
  })
  let aiStorageError = false
  const legacyKey = settings.openRouterKey
  try {
    await ai.init()
    // Migration has reached the separate store before the legacy copy is removed.
    settings.openRouterKey = null
    settings.prefs.model = ai.state().profiles[ai.state().provider].model
    await writeSettings()
  } catch { settings.openRouterKey = legacyKey; aiStorageError = true }
  translator = createDocumentTranslator({
    isAllowed,
    onProgress: (progress) => {
      window?.webContents.send('translation:progress', progress)
      if (progress.phase === 'complete') {
        scheduleLibrary()
        void onFile(progress.targetPath)
      }
    }
  })
  buildMenu()

  protocol.handle('md-duck', async (request) => {
    const filePath = new URL(request.url).searchParams.get('path') ?? ''
    const type = IMAGE_TYPES[extname(filePath).toLowerCase()]
    if (!type || !(await isAllowed(filePath))) return new Response('forbidden', { status: 403 })
    const data = await fs.readFile(filePath).catch(() => null)
    if (!data) return new Response('missing', { status: 404 })
    return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
  })

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(iconPath).resize({ width: 256, height: 256 })
    app.dock?.setIcon(dockIcon)
  }
  if (settings.root) await watchRoot(settings.root)
  createWindow()
  if (aiStorageError) {
    void dialog.showMessageBox(window!, {
      type: 'error',
      message: settings.prefs.ui === 'zh' ? 'AI 设置暂时无法读取或安全保存' : 'AI settings could not be loaded or saved securely',
      detail: settings.prefs.ui === 'zh'
        ? '原有配置已保留，阅读仍可正常使用。请检查系统钥匙串和应用数据目录的访问权限，再重新打开 MD Duck。'
        : 'Your existing configuration is preserved and reading still works. Check access to the system keychain and application data folder, then reopen MD Duck.'
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (firstInstance && settings && BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', (event) => {
  if (!settings || quitSaved) {
    return
  }
  event.preventDefault()
  if (quitSaving) return
  quitSaving = true
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  void flushSettingsOnQuit().then(() => {
    quitSaved = true
    app.quit()
  }).catch(async () => {
    const zh = settings.prefs.ui === 'zh'
    const result = await dialog.showMessageBox({
      type: 'error',
      message: zh ? '最新设置无法保存' : 'Your latest settings could not be saved',
      detail: zh ? '返回应用可以检查磁盘和访问权限。仍然退出会放弃尚未保存的最新偏好。' : 'Return to the app to check disk space and access permissions. Quitting now discards your latest unsaved preferences.',
      buttons: zh ? ['返回应用', '重试保存', '放弃最新设置并退出'] : ['Return to app', 'Retry saving', 'Discard latest settings and quit'],
      defaultId: 0,
      cancelId: 0
    })
    quitSaving = false
    if (result.response === 2) { quitSaved = true; app.quit() }
    else if (result.response === 1) app.quit()
  })
})

// Unload guards can cancel before-quit; dispose services only after windows agree to close.
app.on('will-quit', () => {
  speech?.kill()
  ai?.dispose()
  translator?.dispose?.()
})

function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'MD Duck',
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1a18' : '#fbfaf7',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-prevent-unload', (event) => {
    const zh = settings.prefs.ui === 'zh'
    const response = dialog.showMessageBoxSync(window!, {
      type: 'warning',
      message: zh ? '批注草稿还没有保存到磁盘' : 'Note drafts have not been saved to disk',
      detail: zh ? '返回后可以重试保存。直接关闭会丢弃只保存在内存中的草稿。' : 'Return and retry saving. Closing now discards drafts stored only in memory.',
      buttons: zh ? ['返回保存', '放弃草稿并关闭'] : ['Return to save', 'Discard drafts and close'],
      defaultId: 0,
      cancelId: 0
    })
    // Preventing Electron's event explicitly permits unloading the page.
    if (response === 1) event.preventDefault()
    else { quitSaved = false; quitSaving = false }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildMenu() {
  const dev = !app.isPackaged
  const lang = settings?.prefs.ui ?? 'en'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: t(lang, 'menuFile'),
        submenu: [
          { label: t(lang, 'menuOpenFolder'), accelerator: 'CmdOrCtrl+O', click: () => void pickRoot() },
          { label: t(lang, 'menuOpenFile'), accelerator: 'CmdOrCtrl+Shift+O', click: () => void pickFile() },
          { type: 'separator' },
          { role: 'close' }
        ]
      },
      { role: 'editMenu' },
      {
        label: t(lang, 'menuView'),
        submenu: [
          ...(dev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

ipcMain.handle('state:get', () => publicState())

ipcMain.handle('root:pick', async () => {
  const opened = await pickRoot()
  return { state: publicState(), openPath: opened }
})

ipcMain.handle('file:pick', async () => {
  const opened = await pickFile()
  return { state: publicState(), openPath: opened }
})

ipcMain.handle('path:open', async (_event, target: string) => {
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) throw new Error('ERR_NOT_FOUND')
  if (stat.isDirectory()) {
    await setRoot(target)
    return { state: publicState(), openPath: null }
  }
  if (!/\.(md|markdown)$/i.test(target)) throw new Error('ERR_ONLY_MD')
  await setRoot(dirname(target))
  return { state: publicState(), openPath: await resolveSourcePath(target) }
})

ipcMain.handle('root:example', async () => {
  const source = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'examples')
  const exampleRoot = await prepareExampleLibrary(source, join(app.getPath('userData'), 'examples'))
  await setRoot(exampleRoot)
  const first = library.find((entry) => basename(entry.path) === 'article.md') ?? library[0]
  const opened = { state: publicState(), openPath: first?.path ?? null }
  window?.webContents.send('state:changed', opened)
  return opened
})

ipcMain.handle('doc:open', async (_event, filePath: string) => openDocument(filePath))
ipcMain.handle('doc:close', (_event, filePath: string) => {
  if (openPath !== filePath) return
  ++documentOpenRequest
  openPath = ''
  settings.openPath = null
  scheduleSave()
})

ipcMain.handle('prefs:set', (_event, prefs: Partial<Preferences>) => {
  const uiChanged = prefs.ui != null && prefs.ui !== settings.prefs.ui
  settings.prefs = { ...settings.prefs, ...prefs }
  if (uiChanged) buildMenu()
  scheduleSave()
  return settings.prefs
})

let modelCache: { at: number; catalog: ModelCatalog } | null = null

ipcMain.handle('models:list', async () => {
  if (modelCache && Date.now() - modelCache.at < 6 * 60 * 60 * 1000) return modelCache.catalog
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(12000) })
    if (!response.ok) return modelCache?.catalog ?? fallbackCatalog()
    const payload = (await response.json()) as { data?: Parameters<typeof buildCatalog>[0] }
    const catalog = buildCatalog(payload.data ?? [])
    modelCache = { at: Date.now(), catalog }
    return catalog
  } catch {
    return modelCache?.catalog ?? fallbackCatalog()
  }
})

ipcMain.handle('key:set', async (_event, key: string | null) => {
  const current = ai.state()
  const profile = current.profiles[current.provider]
  const next = await ai.save({ provider: current.provider, baseUrl: profile.baseUrl, model: profile.model, key })
  return next.profiles[next.provider].hasKey
})

ipcMain.handle('ai:get', () => ai.state())
ipcMain.handle('ai:save', (_event, input: AIConfigInput) => ai.save(input))
ipcMain.handle('ai:test', () => ai.test())
ipcMain.handle('ai:connect', () => ai.connectOpenRouter())
ipcMain.handle('ai:cancel-auth', () => ai.cancelAuth())
ipcMain.handle('translation:info', (_event, filePath: string) => translator.inspect(filePath))
ipcMain.handle('translation:start', async (_event, filePath: string) => {
  const credentials = ai.credentials()
  if (!credentials.key) throw new Error('NO_KEY')
  return translator.start(filePath, {
    model: credentials.model,
    identity: `${credentials.provider}:${credentials.baseUrl}:${credentials.model}`,
    request: (messages, signal) => requestChat(credentials, messages, { signal, temperature: 0.2 })
  })
})
ipcMain.handle('translation:stop', (_event, filePath: string) => translator.stop(filePath))
ipcMain.handle('translation:choose', async (_event, filePath: string) => {
  if (!window || !(await isAllowed(filePath))) throw new Error('ERR_NOT_IN_FOLDER')
  const picked = await dialog.showOpenDialog(window, {
    title: settings.prefs.ui === 'zh' ? '选择对应的中文译文' : 'Choose the Chinese translation',
    defaultPath: dirname(filePath),
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  })
  if (picked.canceled || !picked.filePaths[0]) return false
  await translator.associate(filePath, picked.filePaths[0])
  scheduleLibrary()
  if (openPath === filePath) await onFile(picked.filePaths[0])
  return true
})

ipcMain.handle('scroll:save', (_event, filePath: string, blockKey: string) => {
  settings.scroll[filePath] = blockKey
  scheduleSave()
})

ipcMain.handle('notes:save', (_event, path: string, note: Note) => reviews.saveNote(path, note))
ipcMain.handle('notes:get', (_event, path: string) => reviews.load(path))
ipcMain.handle('notes:edit', (_event, path: string, id: string, comment: string) => reviews.editNote(path, id, comment))
ipcMain.handle('notes:status', (_event, path: string, id: string, status: Note['status']) => reviews.setNoteStatus(path, id, status))
ipcMain.handle('notes:delete', (_event, path: string, id: string) => reviews.deleteNote(path, id))
ipcMain.handle('notes:restore', (_event, path: string) => reviews.restore(path))
ipcMain.handle('words:save', (_event, path: string, word: LearnedWord) => reviews.saveWord(path, word))
ipcMain.handle('words:delete', (_event, path: string, id: string) => reviews.deleteWord(path, id))
ipcMain.handle('review:legacy', async (_event, path: string) => shell.showItemInFolder(await reviews.legacyFile(path)))
ipcMain.handle('review:candidates', (_event, path: string) => reviews.listCandidates(path))
ipcMain.handle('review:associate', (_event, path: string, id: string) => reviews.associate(path, id))

ipcMain.handle('clipboard:write', (_event, text: string) => clipboard.writeText(text))

ipcMain.handle('shell:open', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
})

ipcMain.handle('shell:reveal', (_event, filePath: string) => {
  if (settings.root && isInside(filePath, settings.root)) shell.showItemInFolder(filePath)
})

ipcMain.handle('speech:speak', (_event, id: string, text: string) => {
  if (!speech) startSpeech()
  speech?.postMessage({ type: 'speak', id, text, voice: settings.prefs.voice, speed: settings.prefs.speed })
})

ipcMain.handle('speech:cancel', () => {
  speech?.postMessage({ type: 'cancel' })
})

const wordHelp = createWordHelpService()
ipcMain.handle('word:dictionary', (_event, word: string) => wordHelp.lookupDictionary(word))
ipcMain.handle('word:explain', (_event, word: string, sentence: string, detail: boolean) => {
  return wordHelp.explainWord(word, sentence, detail, ai.credentials())
})

ipcMain.handle('gloss', async (_event, word: string, sentence: string, detail: boolean, learn = false) => {
  const credentials = ai.credentials()
  const model = credentials.model
  const lang = settings.prefs.ui ?? 'en'
  const passage = word.trim().split(/\s+/).length > 8
  const instruction = learn
    ? '你是英语老师。只解释给出的那一个英文词在句子里的意思。用简体中文，两行：第一行是这个词，第二行是一句白话释义。不要解释句子里的其他词。'
    : passage
      ? '把给出的英文译成通顺的简体中文，按原来的句子顺序。不要拆成词条，不要写词性，不要解释选段里没有的内容。'
      : lang === 'zh'
        ? detail
          ? '用简体中文解释选中的词或短语在这句里的意思、一个常见搭配、一处容易混的地方。最多 6 行。不要解释句中其他词。'
          : '用简体中文说明选中内容在这句里的意思。只写一两句白话。不要写词性，不要解释没有被选中的词。'
        : detail
          ? 'Explain only the selected words in this sentence, in simplified Chinese: the meaning, one common use, and one easy confusion. At most 6 lines. Do not explain any other words.'
          : 'Say what the selected English means in this sentence, in one or two sentences of simplified Chinese. No part-of-speech label. Do not explain words that were not selected.'
  const text = await requestChat(credentials, [
    { role: 'system', content: instruction },
    { role: 'user', content: passage ? `选中：\n${word}` : `选中：${word}\n句子：${sentence}` }
  ], { temperature: 0.2 })
  return { text, model }
})

function startSpeech() {
  speech = utilityProcess.fork(speechWorkerPath, [], { serviceName: 'MD Duck Speech' })
  speech.postMessage({
    type: 'init',
    cacheDir: join(app.getPath('userData'), 'speech-cache'),
    modelDir: join(app.getPath('userData'), 'kokoro-cache')
  })
  speech.on('message', (event: SpeechEvent) => {
    window?.webContents.send('speech:event', event)
  })
  speech.on('exit', () => {
    speech = null
  })
}

function publicState(): AppState {
  return {
    root: settings.root,
    library,
    prefs: settings.prefs,
    hasKey: ai ? ai.state().profiles[ai.state().provider].hasKey : Boolean(settings.openRouterKey),
    openPath: settings.openPath,
    scroll: settings.scroll
  }
}

async function pickRoot() {
  if (!window) return null
  const picked = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return null
  await setRoot(picked.filePaths[0])
  window.webContents.send('state:changed', { state: publicState(), openPath: null })
  return null
}

async function pickFile() {
  if (!window) return null
  const picked = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  })
  const file = picked.filePaths[0]
  if (picked.canceled || !file) return null
  await setRoot(dirname(file))
  const target = await resolveSourcePath(file)
  window.webContents.send('state:changed', { state: publicState(), openPath: target })
  return target
}

async function setRoot(next: string) {
  ++documentOpenRequest
  settings.root = next
  settings.openPath = null
  openPath = ''
  scheduleSave()
  await watchRoot(next)
}

async function watchRoot(dir: string) {
  library = await listLibrary(dir)
  await watcher?.close()
  const watchedDir = await fs.realpath(dir).catch(() => dir)
  watcher = chokidar.watch(watchedDir, {
    // macOS FSEvents can miss removal of a file published by hard link.
    useFsEvents: false,
    ignoreInitial: true,
    depth: 6,
    ignored: (target) => {
      const rel = relative(watchedDir, target)
      return rel.split(sep).some((part) => part.startsWith('.') || IGNORED_DIRS.has(part))
    },
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 }
  })
  const schedule = (watchedFile: string) => {
    const file = join(dir, relative(watchedDir, watchedFile))
    clearTimeout(fileTimers.get(file))
    fileTimers.set(
      file,
      setTimeout(() => {
        fileTimers.delete(file)
        void onFile(file)
      }, 30)
    )
  }
  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule)
}

async function openDocument(filePath: string): Promise<OpenedDocument> {
  const request = ++documentOpenRequest
  if (!(await isAllowed(filePath))) throw new Error('ERR_NOT_IN_FOLDER')
  const sourcePath = await resolveSourcePath(filePath)
  if (!(await isAllowed(sourcePath))) throw new Error('ERR_NOT_IN_FOLDER')
  const zhPath = await translator.getTargetPath(sourcePath).catch(() => null)
  const [sourceText, zhText, review, translationAlignment] = await Promise.all([
    fs.readFile(sourcePath, 'utf8'),
    zhPath && zhPath !== sourcePath ? fs.readFile(zhPath, 'utf8').catch(() => null) : Promise.resolve(null),
    reviews.load(sourcePath),
    translator.loadAlignment(sourcePath).catch(() => null)
  ])
  // A missing draft document must not detach the visible article from its watcher.
  if (request === documentOpenRequest) {
    openPath = sourcePath
    settings.openPath = sourcePath
    scheduleSave()
  }
  return {
    sourcePath,
    dir: dirname(sourcePath),
    zhPath: zhText !== null ? zhPath : null,
    zhDir: zhText !== null && zhPath ? dirname(zhPath) : null,
    sourceText,
    zhText,
    notes: review.notes,
    notesMissing: review.notesMissing,
    reviewIssue: review.reviewIssue,
    legacyUnassigned: review.legacyUnassigned,
    words: review.words,
    assetVersion,
    translationAlignment,
    missing: false
  }
}

async function onFile(file: string) {
  const root = settings.root
  if (!root) return
  if (/\.(md|markdown)$/i.test(file)) scheduleLibrary()
  if (!openPath) return
  const sourcePath = openPath
  const zhPath = await translator.getTargetPath(sourcePath).catch(() => null)
  if (openPath !== sourcePath) return
  if (file === openPath || file === zhPath) {
    window?.webContents.send('doc:status', { sourcePath: openPath, status: 'updating' })
    const text = await fs.readFile(file, 'utf8').catch(() => null)
    const translationAlignment = await translator.loadAlignment(sourcePath).catch(() => null)
    if (openPath !== sourcePath) return
    assetVersion += 1
    window?.webContents.send('doc:update', {
      sourcePath: openPath,
      side: file === openPath ? 'source' : 'zh',
      text,
      missing: text === null,
      zhPath,
      zhDir: zhPath ? dirname(zhPath) : null,
      assetVersion,
      translationAlignment
    })
    return
  }
  if (IMAGE_TYPES[extname(file).toLowerCase()] && (isInside(file, dirname(openPath)) || zhPath && isInside(file, dirname(zhPath)))) {
    assetVersion += 1
    window?.webContents.send('doc:update', { sourcePath: openPath, side: 'source', text: null, missing: false, assetVersion, zhPath, zhDir: zhPath ? dirname(zhPath) : null })
  }
}

function scheduleLibrary() {
  if (libraryTimer) clearTimeout(libraryTimer)
  libraryTimer = setTimeout(async () => {
    if (!settings.root) return
    library = await listLibrary(settings.root)
    window?.webContents.send('library:update', library)
  }, 150)
}

async function listLibrary(dir: string): Promise<LibraryEntry[]> {
  const files: string[] = []
  await walk(dir, files, 0)
  const set = new Set(files)
  const translationFiles = new Set<string>()
  const targets = new Map<string, string>()
  for (const file of files) {
    const source = await resolveSourcePath(file)
    if (source !== file && set.has(source)) translationFiles.add(file)
    const target = translator ? await translator.getTargetPath(file).catch(() => null) : translationPath(file)
    if (target) {
      targets.set(file, target)
      if (set.has(target) && target !== file) translationFiles.add(target)
    }
  }
  const entries = await Promise.all(
    files
      .filter((file) => !translationFiles.has(file))
      .map(async (file) => {
        const zh = targets.get(file)
        const text = await readHead(file)
        return {
          path: file,
          zhPath: zh && zh !== file && set.has(zh) ? zh : null,
          title: titleFrom(text, basename(file)),
          folder: relative(dir, dirname(file)) || '.'
        }
      })
  )
  return entries.sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title))
}

async function walk(dir: string, files: string[], depth: number) {
  if (depth > 6 || files.length >= MAX_FILES) return
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, files, depth + 1)
    else if (/\.(md|markdown)$/i.test(entry.name)) files.push(full)
  }
}

async function readHead(file: string) {
  const handle = await fs.open(file, 'r').catch(() => null)
  if (!handle) return ''
  const buffer = Buffer.alloc(4096)
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  await handle.close()
  return buffer.subarray(0, bytesRead).toString('utf8')
}

function titleFrom(text: string, fileName: string) {
  if (text.startsWith('---')) {
    const titled = /^title:\s*(.+)$/m.exec(text)
    if (titled) return titled[1].trim().replace(/^["']|["']$/g, '')
  }
  const heading = /^#\s+(.+)$/m.exec(text)
  return heading?.[1]?.trim() || fileName.replace(/\.(md|markdown)$/i, '')
}

async function isAllowed(filePath: string) {
  return isPathInsideRoot(filePath, settings.root)
}

function isInside(filePath: string, dir: string) {
  return filePath === dir || filePath.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

function readKey() {
  return decodeKey(settings.openRouterKey)
}

function decodeKey(stored: string | null) {
  if (!stored) return null
  if (stored.startsWith('raw:')) return stored.slice(4)
  if (stored.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    } catch {
      return null
    }
  }
  return null
}

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

async function loadSettings(): Promise<Settings> {
  const raw = await fs.readFile(settingsPath(), 'utf8').catch(() => '')
  let saved: Partial<Settings> & { prefs?: Partial<Preferences> & { openRouterKey?: string } } = {}
  try {
    saved = raw ? JSON.parse(raw) : {}
  } catch {
    saved = {}
  }
  const legacyKey = saved.prefs?.openRouterKey
  let languages: string[] = []
  try { languages = app.getPreferredSystemLanguages() } catch { languages = [app.getLocale()] }
  const prefs = { ...DEFAULT_PREFS, ui: defaultUiLanguage(languages), ...saved.prefs }
  delete (prefs as Partial<Preferences> & { openRouterKey?: string }).openRouterKey
  const root = typeof saved.root === 'string' && (await fs.stat(saved.root).catch(() => null)) ? saved.root : null
  return {
    root,
    prefs,
    openPath: root && typeof saved.openPath === 'string' ? saved.openPath : null,
    scroll: saved.scroll ?? {},
    openRouterKey: saved.openRouterKey ?? (legacyKey ? `raw:${legacyKey}` : null)
  }
}

function scheduleSave() {
  settingsRevision += 1
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void writeSettings().catch(() => {
      // Keep settings in memory; quitting retries and offers an explicit choice on failure.
    })
  }, 250)
}

async function flushSettingsOnQuit() {
  let writtenRevision: number
  do {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    writtenRevision = settingsRevision
    await writeSettings()
  } while (writtenRevision !== settingsRevision)
}

async function writeSettings() {
  settingsWriter ??= createSettingsWriter(settingsPath())
  return settingsWriter.write(settings)
}
