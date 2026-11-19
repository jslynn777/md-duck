import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import speechWorkerPath from './speech-worker?modulePath'
import { createReviewStore } from './review-store'
import { assertReviewSource } from './review-files'
import { isPathInsideRoot } from './allowed-path'
import { createFileActionService, presentFileMenu, revealTarget } from './file-menu'
import { createWordHelpService } from './word-help'
import { createAIService, requestChat } from './ai-service'
import { createDocumentTranslator, translationPath, resolveSourcePath } from './document-translation'
import { createSettingsWriter } from './settings-store'
import { assertLibraryDocument } from './library-write-guard'
import { createLibraryManager } from './library-manager'
import { createDocumentChangeStore } from './document-change-store'
import type { LibraryChange, LibraryCommand, LibraryFolder } from '../shared/library'
import { relocateScroll } from '../shared/library-relocation'
import type { AIConfigInput } from '../shared/ai'
import { buildCatalog, fallbackCatalog } from '../shared/models'
import {
  DEFAULT_MODEL,
  type AppState,
  type FileMenuResult,
  type LibraryEntry,
  type ModelCatalog,
  type LearnedWord,
  type Note,
  type OpenedDocument,
  type Preferences,
  type SpeechEvent
} from '../shared/types'

import type { SpaceSummary } from '../shared/spaces'
import { remapSpaceSettings, readReaderSettings, type ReaderSettings } from './space-settings'
import { readSpacePreview } from './space-preview'
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

type Settings = ReaderSettings

export type ReaderSessionOptions = {
  id: string | null
  root: string | null
  assetScope?: string
  settingsFile: string
  defaultPrefs?: Partial<Preferences>
  ai: () => ReturnType<typeof createAIService> | undefined
  ensureAI: (settings: ReaderSettings) => Promise<boolean>
  spaces: () => SpaceSummary[]
  onSummaryChange: () => void
  onPreferencesChange: () => void
  onSettingsError?: () => void
  isTaskActive?: () => boolean
  beforeSpeech: () => void
}

export const READER_CHANNELS = ['doc:open',
  'changes:get',
  'changes:acknowledge',
  'library:manage',
  'doc:close',
  'prefs:set',
  'models:list',
  'key:set',
  'ai:get',
  'ai:save',
  'ai:test',
  'ai:connect',
  'ai:cancel-auth',
  'translation:info',
  'translation:start',
  'translation:stop',
  'translation:choose',
  'scroll:save',
  'notes:save',
  'notes:get',
  'notes:edit',
  'notes:status',
  'notes:delete',
  'notes:restore',
  'words:save',
  'words:delete',
  'review:legacy',
  'review:candidates',
  'review:associate',
  'clipboard:write',
  'shell:open',
  'shell:reveal',
  'file:menu',
  'speech:speak',
  'speech:cancel',
  'word:dictionary',
  'word:explain',
  'gloss'] as const

/** A library owns its watcher, mutation queues and in-flight AI jobs independently of its visible window. */
export function createReaderSession(options: ReaderSessionOptions) {
  let window: BrowserWindow | null = null
  let watcher: FSWatcher | null = null
  let settings: Settings
  let library: LibraryEntry[] = []
  let libraryFolders: LibraryFolder[] = []
  let libraryIssue: string | undefined
  let managingLibrary = false
  let libraryChangeRevision = 0
  let latestLibraryChange: LibraryChange | undefined
  const activeTranslations = new Set<string>()
  let fileActionRevision = 0
  let fileMenuRequest = 0
  let cancelFileMenu: (() => void) | null = null
  let openPath = ''
  let documentOpenRequest = 0
  let assetVersion = 1
  let saveTimer: NodeJS.Timeout | null = null
  let settingsWriter: ReturnType<typeof createSettingsWriter> | null = null
  let settingsRevision = 0
  let libraryTimer: NodeJS.Timeout | null = null
  let speech: UtilityProcess | null = null
  let speechRequestId: string | null = null
  let translator: ReturnType<typeof createDocumentTranslator>
  const fileTimers = new Map<string, NodeJS.Timeout>()

  let disposed = false
  let relocating = false
  let previewText = ''
  let previewImages: string[] = []
  let previewRequest = 0
  let externalActivity: SpaceSummary['activity']
  let activityRevision = 0
  let translationStartedAt = ''
  let availability: SpaceSummary['availability'] = 'ready'
  const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>()
  const reviews = createReviewStore({
    isAllowed,
    userData: app.getPath('userData'),
    backupAliases: source => {
      const root = settings?.root
      if (!root) return []
      const inside = (parent: string, child: string) => {
        const suffix = relative(parent, child)
        return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
      }
      if (!inside(root, source)) return []
      const suffix = relative(root, source)
      const others = options.spaces().filter(space => space.id !== options.id)
      return [...(settings.rootAliases ?? [])].reverse().map(alias => join(alias, suffix))
        .filter(alias => alias !== source && !others.some(space => inside(space.root, alias)))
    },
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

  const libraryManager = createLibraryManager({
    userData: app.getPath('userData'),
    listEntries: listLibrary,
    isBusy: () => activeTranslations.size > 0 || !!options.isTaskActive?.()
  })
  const documentChanges = createDocumentChangeStore()
  let libraryApplyTail: Promise<unknown> = Promise.resolve()

  async function initialize() {
    settings = await readReaderSettings(options.settingsFile, options.root, DEFAULT_PREFS, options.defaultPrefs)
    const aiReady = await options.ensureAI(settings)
    const ai = options.ai()
    if (aiReady && ai) {
      const model = ai.state().profiles[ai.state().provider].model
      if (settings.openRouterKey !== null || settings.prefs.model !== model) {
        const legacyKey = settings.openRouterKey
        settings.openRouterKey = null
        settings.prefs.model = model
        try { await writeSettings() } catch {
          settings.openRouterKey = legacyKey
          options.onSettingsError?.()
        }
      }
    }
    translator = createDocumentTranslator({
      isAllowed,
      onProgress: (progress) => {
        if (progress.phase === 'running') {
          if (!activeTranslations.size) translationStartedAt = new Date().toISOString()
          activeTranslations.add(progress.sourcePath)
        }
        else { activeTranslations.delete(progress.sourcePath); scheduleLibrary() }
        options.onSummaryChange()
        send('translation:progress', progress)
        if (progress.phase === 'complete') {
          scheduleLibrary()
          void onFile(progress.targetPath)
        }
      }
    })
    if (settings.root) await watchRoot(settings.root)
    if (settings.openPath && library.some(entry => entry.path === settings.openPath)) {
      await refreshPreview()
    }
  }

  function handleReady(channel: (typeof READER_CHANNELS)[number], listener: Parameters<typeof ipcMain.handle>[1]) { handlers.set(channel, listener) }
  handleReady('doc:open', async (_event, filePath: string) => libraryManager.exclusive(() => openDocument(filePath)))
  handleReady('changes:get', (_event, filePath: string, documentId?: string) => libraryManager.exclusive(async () => {
    const { root, entry } = await changeTarget(filePath, documentId)
    return documentChanges.inspect(root, entry)
  }))
  handleReady('changes:acknowledge', (_event, filePath: string, revision: string, documentId?: string) => libraryManager.exclusive(async () => {
    const { root, entry } = await changeTarget(filePath, documentId)
    const result = await documentChanges.acknowledge(root, entry, revision)
    if (settings.root === root) {
      const entries = library.map(item => item.id === entry.id ? { ...item, zhPath: result.current.zhText === null ? null : entry.zhPath } : item)
      await applyLibraryChange(root, { snapshot: { entries, folders: libraryFolders, issue: libraryIssue }, relocations: [] })
    }
    return result
  }))
  handleReady('library:manage', async (event, command: LibraryCommand) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !settings.root) throw new Error('ERR_NOT_IN_FOLDER')
    if (managingLibrary) throw new Error('LIBRARY_BUSY')
    if (options.isTaskActive?.()) throw new Error('ERR_CODEX_BUSY')
    const root = settings.root
    managingLibrary = true
    try {
      const change = await libraryManager.mutate(root, command)
      change.root = root
      await applyLibraryChange(root, change)
      return change
    } finally { managingLibrary = false }
  })
  handleReady('doc:close', (_event, filePath: string) => {
    if (openPath !== filePath) return
    ++documentOpenRequest
    openPath = ''
    settings.openPath = null
    ++previewRequest
    previewText = ''
    previewImages = []
    options.onSummaryChange()
    scheduleSave()
  })

  handleReady('prefs:set', (_event, prefs: Partial<Preferences>) => {
    const uiChanged = prefs.ui != null && prefs.ui !== settings.prefs.ui
    settings.prefs = { ...settings.prefs, ...prefs }
    if (uiChanged) options.onPreferencesChange()
    scheduleSave()
    return settings.prefs
  })

  let modelCache: { at: number; catalog: ModelCatalog } | null = null

  handleReady('models:list', async () => {
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

  handleReady('key:set', async (_event, key: string | null) => {
    const current = options.ai()!.state()
    const profile = current.profiles[current.provider]
    const next = await options.ai()!.save({ provider: current.provider, baseUrl: profile.baseUrl, model: profile.model, key })
    return next.profiles[next.provider].hasKey
  })

  handleReady('ai:get', () => options.ai()!.state())
  handleReady('ai:save', (_event, input: AIConfigInput) => options.ai()!.save(input))
  handleReady('ai:test', () => options.ai()!.test())
  handleReady('ai:connect', () => options.ai()!.connectOpenRouter())
  handleReady('ai:cancel-auth', () => options.ai()!.cancelAuth())
  handleReady('translation:info', (_event, filePath: string) => translator.inspect(filePath))
  handleReady('translation:start', async (_event, filePath: string, documentId?: string) => libraryManager.exclusive(async () => {
    if (options.isTaskActive?.()) throw new Error('ERR_CODEX_BUSY')
    await assertLibraryDocument(settings.root, library, filePath, documentId)
    const credentials = options.ai()!.credentials()
    if (!credentials.key) throw new Error('NO_KEY')
    return translator.start(filePath, {
      model: credentials.model,
      identity: `${credentials.provider}:${credentials.baseUrl}:${credentials.model}`,
      request: (messages, signal) => requestChat(credentials, messages, { signal, temperature: 0.2 })
    })
  }))
  handleReady('translation:stop', (_event, filePath: string) => translator.stop(filePath))
  handleReady('translation:choose', async (_event, filePath: string, documentId?: string) => {
    if (!window || !(await isAllowed(filePath))) throw new Error('ERR_NOT_IN_FOLDER')
    const picked = await dialog.showOpenDialog(window, {
      title: settings.prefs.ui === 'zh' ? '选择对应的中文译文' : 'Choose the Chinese translation',
      defaultPath: dirname(filePath),
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return false
    await libraryManager.exclusive(async () => {
      await assertLibraryDocument(settings.root, library, filePath, documentId)
      await translator.associate(filePath, picked.filePaths[0])
    })
    scheduleLibrary()
    if (openPath === filePath) await onFile(picked.filePaths[0])
    return true
  })

  handleReady('scroll:save', (_event, filePath: string, blockKey: string) => libraryManager.exclusive(async () => {
    if (filePath !== openPath || !(await isAllowed(filePath)) || !(await fs.stat(filePath).catch(() => null))?.isFile()) return
    settings.scroll[filePath] = blockKey
    scheduleSave()
  }))

  handleReady('notes:save', (_event, path: string, note: Note, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.saveNote(path, note)
  }))
  handleReady('notes:get', (_event, path: string) => libraryManager.exclusive(() => reviews.load(path)))
  handleReady('notes:edit', (_event, path: string, id: string, comment: string, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.editNote(path, id, comment)
  }))
  handleReady('notes:status', (_event, path: string, id: string, status: Note['status'], documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.setNoteStatus(path, id, status)
  }))
  handleReady('notes:delete', (_event, path: string, id: string, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.deleteNote(path, id)
  }))
  handleReady('notes:restore', (_event, path: string, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.restore(path)
  }))
  handleReady('words:save', (_event, path: string, word: LearnedWord, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.saveWord(path, word)
  }))
  handleReady('words:delete', (_event, path: string, id: string, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.deleteWord(path, id)
  }))
  handleReady('review:legacy', async (_event, path: string) => shell.showItemInFolder(await reviews.legacyFile(path)))
  handleReady('review:candidates', (_event, path: string) => libraryManager.exclusive(() => reviews.listCandidates(path)))
  handleReady('review:associate', (_event, path: string, id: string, documentId?: string) => libraryManager.exclusive(async () => {
    await assertLibraryDocument(settings.root, library, path, documentId)
    return reviews.associate(path, id)
  }))

  handleReady('clipboard:write', (_event, text: string) => clipboard.writeText(text))

  handleReady('shell:open', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })

  handleReady('shell:reveal', async (_event, filePath: string) => {
    const root = settings.root
    const canonical = await revealTarget(filePath, root)
    if (settings.root !== root) throw new Error('ERR_NOT_IN_FOLDER')
    shell.showItemInFolder(canonical)
  })

  const fileActions = createFileActionService(
    () => ({ root: settings.root, library, revision: fileActionRevision }),
    { reveal: (path) => shell.showItemInFolder(path), open: (path) => shell.openPath(path), copy: (path) => clipboard.writeText(path) }
  )

  handleReady('file:menu', async (event, filePath: string, position?: { x: number; y: number }) => {
    const targetWindow = window
    if (!targetWindow || targetWindow.isDestroyed() || event.sender !== targetWindow.webContents || event.senderFrame !== targetWindow.webContents.mainFrame) {
      throw new Error('ERR_NOT_IN_FOLDER')
    }
    const request = ++fileMenuRequest
    cancelFileMenu?.()
    const session = await fileActions.prepare(filePath)
    if (request !== fileMenuRequest || window !== targetWindow || targetWindow.isDestroyed()) return null
    const zh = settings.prefs.ui === 'zh'
    const labels = {
      reveal: zh ? process.platform === 'darwin' ? '在 Finder 中显示' : '显示文件所在位置' : process.platform === 'darwin' ? 'Show in Finder' : 'Show in folder',
      open: zh ? '用默认应用打开' : 'Open with default app',
      copy: zh ? '复制完整路径' : 'Copy full path',
      translation: zh ? '译文文件' : 'Translation file'
    }
    const pending = presentFileMenu({
      create: (choose) => {
        const items = (target: FileMenuResult['target']) => [
          { label: labels.reveal, click: () => choose({ action: 'reveal', target }) },
          { label: labels.open, click: () => choose({ action: 'open-default', target }) },
          { label: labels.copy, click: () => choose({ action: 'copy-path', target }) }
        ]
        const menu = Menu.buildFromTemplate([
          ...items('source'),
          ...(session.translationReal ? [{ type: 'separator' as const }, { label: labels.translation, submenu: items('translation') }] : [])
        ])
        return {
          popup: (callback) => {
            const bounds = targetWindow.getContentBounds()
            const zoom = targetWindow.webContents.getZoomFactor()
            const anchor = position && typeof position === 'object' && Number.isFinite(position.x) && Number.isFinite(position.y)
              ? {
                  x: Math.max(0, Math.min(bounds.width - 1, Math.round(position.x * zoom))),
                  y: Math.max(0, Math.min(bounds.height - 1, Math.round(position.y * zoom)))
                }
              : {}
            menu.popup({ window: targetWindow, ...anchor, callback })
          },
          close: () => menu.closePopup()
        }
      },
      onWindowClosed: (cancel) => {
        targetWindow.once('closed', cancel)
        return () => targetWindow.removeListener('closed', cancel)
      },
      execute: (choice, canceled) => fileActions.execute(session, choice, () => canceled() || targetWindow.isDestroyed())
    })
    cancelFileMenu = pending.cancel
    try { return await pending.result } finally {
      if (cancelFileMenu === pending.cancel) cancelFileMenu = null
    }
  })

  handleReady('speech:speak', (_event, id: string, text: string) => {
    options.beforeSpeech()
    speechRequestId = id
    if (!speech) startSpeech()
    speech?.postMessage({ type: 'speak', id, text, voice: settings.prefs.voice, speed: settings.prefs.speed })
  })

  handleReady('speech:cancel', () => {
    speechRequestId = null
    speech?.postMessage({ type: 'cancel' })
  })

  const wordHelp = createWordHelpService()
  handleReady('word:dictionary', (_event, word: string) => wordHelp.lookupDictionary(word))
  handleReady('word:explain', (_event, word: string, sentence: string, detail: boolean) => {
    return wordHelp.explainWord(word, sentence, detail, options.ai()!.credentials())
  })

  handleReady('gloss', async (_event, word: string, sentence: string, detail: boolean, learn = false) => {
    const credentials = options.ai()!.credentials()
    const model = credentials.model
    const lang = settings.prefs.ui ?? 'en'
    const passage = word.trim().split(/\s+/).length > 8
    const instruction = learn
      ? '你是英语老师。只解释给出的那一个英文词在句子里的意思。用简体中文，两行：第一行是这个词，第二行是一句白话释义。不要解释句子里的其他词。'
      : passage
        ? '把给出的原文译成通顺的简体中文，按原来的句子顺序。不要拆成词条，不要写词性，不要解释选段里没有的内容。'
        : lang === 'zh'
          ? detail
            ? '用简体中文解释选中的词或短语在这句里的意思、一个常见搭配、一处容易混的地方。最多 6 行。不要解释句中其他词。'
            : '用简体中文说明选中内容在这句里的意思。只写一两句白话。不要写词性，不要解释没有被选中的词。'
          : detail
            ? 'Explain only the selected words in this sentence, in simplified Chinese: the meaning, one common use, and one easy confusion. At most 6 lines. Do not explain any other words.'
            : 'Say what the selected text means in this sentence, in one or two sentences of simplified Chinese. No part-of-speech label. Do not explain words that were not selected.'
    const text = await requestChat(credentials, [
      { role: 'system', content: instruction },
      { role: 'user', content: passage ? `选中：\n${word}` : `选中：${word}\n句子：${sentence}` }
    ], { temperature: 0.2 })
    return { text, model }
  })

  function startSpeech() {
    const worker = utilityProcess.fork(speechWorkerPath, [], { serviceName: 'MD Duck Speech' })
    speech = worker
    worker.postMessage({
      type: 'init',
      cacheDir: join(app.getPath('userData'), 'speech-cache'),
      modelDir: join(app.getPath('userData'), 'kokoro-cache'),
      voiceDirectory: app.isPackaged ? join(process.resourcesPath, 'kokoro-voices') : resolve('src/main/data/kokoro-voices')
    })
    worker.on('message', (event: SpeechEvent) => {
      if (speech === worker) send('speech:event', event)
    })
    worker.on('exit', () => {
      if (speech === worker) speech = null
    })
  }

  function releaseSpeech() {
    const worker = speech
    const id = speechRequestId
    speech = null
    speechRequestId = null
    worker?.kill()
    if (id) send('speech:event', { type: 'cancelled', id })
  }

  function publicState(): AppState {
    return {
      activeSpaceId: options.id,
      spaces: options.spaces(),
      spaceRootAliases: settings.rootAliases,
      root: settings.root,
      library,
      folders: libraryFolders,
      libraryIssue,
      libraryChange: latestLibraryChange,
      prefs: settings.prefs,
      hasKey: options.ai() ? options.ai()!.state().profiles[options.ai()!.state().provider].hasKey : Boolean(settings.openRouterKey),
      openPath: settings.openPath,
      scroll: settings.scroll
    }
  }

  async function watchRoot(dir: string) {
    await watcher?.close()
    if (libraryTimer) { clearTimeout(libraryTimer); libraryTimer = null }
    for (const timer of fileTimers.values()) clearTimeout(timer)
    fileTimers.clear()
    if (!await checkRootAvailability(dir)) {
      libraryIssue = 'ERR_NOT_FOUND'
      options.onSummaryChange()
      return
    }
    const change = await libraryManager.refresh(dir)
    if (settings.root !== dir) return
    await applyLibraryChange(dir, change, false)
    const watchedDir = await fs.realpath(dir).catch(() => dir)
    watcher = chokidar.watch(watchedDir, {
      // Chokidar 4 uses native fs.watch without the former FSEvents backend.
      ignoreInitial: true,
      depth: 24,
      ignored: (target) => {
        const rel = relative(watchedDir, target)
        return rel.split(sep).some((part) => part.startsWith('.') || IGNORED_DIRS.has(part))
      },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 }
    })
    const schedule = (watchedFile: string) => {
      if (settings.root !== dir) return
      const file = join(dir, relative(watchedDir, watchedFile))
      clearTimeout(fileTimers.get(file))
      fileTimers.set(
        file,
        setTimeout(() => {
          fileTimers.delete(file)
          if (managingLibrary) { scheduleLibrary(); return }
          if (settings.root === dir) {
            if (/\.(md|markdown)$/i.test(file) || IMAGE_TYPES[extname(file).toLowerCase()]) {
              const revision = ++activityRevision
              void isAllowed(file).then(allowed => {
                if (!allowed || disposed || settings.root !== dir || revision !== activityRevision) return
                externalActivity = { kind: 'external-write', at: new Date().toISOString(), path: file }
                options.onSummaryChange()
              })
            }
            void onFile(file).catch(() => scheduleLibrary())
          }
        }, 30)
      )
    }
    watcher.on('add', schedule).on('change', schedule).on('unlink', schedule)
      .on('addDir', () => { if (settings.root === dir) scheduleLibrary() })
      .on('unlinkDir', () => { if (settings.root === dir) scheduleLibrary() })
      .on('error', () => { availability = 'unreadable'; options.onSummaryChange() })
  }

  async function openDocument(filePath: string): Promise<OpenedDocument> {
    const request = ++documentOpenRequest
    if (!(await isAllowed(filePath))) throw new Error('ERR_NOT_IN_FOLDER')
    const sourcePath = await resolveSourcePath(filePath)
    if (!(await isAllowed(sourcePath))) throw new Error('ERR_NOT_IN_FOLDER')
    const entry = library.find((item) => item.path === sourcePath)
    if (entry?.id && entry.fileIdentity) await assertLibraryDocument(settings.root, library, sourcePath, entry.id)
    const zhPath = await translator.getTargetPath(sourcePath).catch(() => null)
    const [sourceText, zhText, review, alignmentInspection] = await Promise.all([
      fs.readFile(sourcePath, 'utf8'),
      zhPath && zhPath !== sourcePath ? fs.readFile(zhPath, 'utf8').catch(() => null) : Promise.resolve(null),
      reviews.load(sourcePath),
      translator.inspectAlignment(sourcePath).catch(() => ({ alignment: null, state: 'invalid' as const }))
    ])
    // A missing draft document must not detach the visible article from its watcher.
    if (request === documentOpenRequest) {
      openPath = sourcePath
      settings.openPath = sourcePath
      await refreshPreview()
      options.onSummaryChange()
      scheduleSave()
    }
    return {
      sourcePath,
      assetScope: options.assetScope,
      documentId: library.find((entry) => entry.path === sourcePath)?.id,
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
      translationAlignment: alignmentInspection.alignment,
      translationAlignmentState: alignmentInspection.state,
      missing: false
    }
  }

  async function onFile(file: string) {
    const root = settings.root
    if (!root) return
    if (/\.(md|markdown)$/i.test(file)) scheduleLibrary()
    if (file === settings.openPath || IMAGE_TYPES[extname(file).toLowerCase()]) await refreshPreview()
    if (!openPath) return
    const sourcePath = openPath
    const request = documentOpenRequest
    const zhPath = await translator.getTargetPath(sourcePath).catch(() => null)
    if (openPath !== sourcePath || request !== documentOpenRequest) return
    if (file === openPath || file === zhPath) {
      send('doc:status', { sourcePath: openPath, status: 'updating' })
      const text = await fs.readFile(file, 'utf8').catch(() => null)
      const alignmentInspection = await translator.inspectAlignment(sourcePath).catch(() => ({ alignment: null, state: 'invalid' as const }))
      if (openPath !== sourcePath || request !== documentOpenRequest) return
      assetVersion += 1
      send('doc:update', {
        sourcePath: openPath,
        side: file === openPath ? 'source' : 'zh',
        text,
        missing: text === null,
        zhPath,
        zhDir: zhPath ? dirname(zhPath) : null,
        assetVersion,
        translationAlignment: alignmentInspection.alignment,
        translationAlignmentState: alignmentInspection.state
      })
      return
    }
    if (IMAGE_TYPES[extname(file).toLowerCase()] && (isInside(file, dirname(openPath)) || zhPath && isInside(file, dirname(zhPath)))) {
      assetVersion += 1
      send('doc:update', { sourcePath: openPath, side: 'source', text: null, missing: false, assetVersion, zhPath, zhDir: zhPath ? dirname(zhPath) : null })
    }
  }

  async function refreshPreview() {
    const request = ++previewRequest, source = settings.openPath, root = settings.root
    const preview = source ? await readSpacePreview(source, { scope: options.assetScope, version: request, isAllowed }) : { text: '', images: [] }
    if (disposed || request !== previewRequest || settings.root !== root || settings.openPath !== source) return
    previewText = preview.text
    previewImages = preview.images
    options.onSummaryChange()
  }

  function scheduleLibrary() {
    if (libraryTimer) clearTimeout(libraryTimer)
    const root = settings?.root
    if (disposed) return
    libraryTimer = setTimeout(() => {
      libraryTimer = null
      if (!root || settings.root !== root) return
      void checkRootAvailability(root).then(async available => {
        if (!available) throw new Error('ERR_NOT_FOUND')
        await applyLibraryChange(root, await libraryManager.refresh(root))
      }).catch(() => {
        if (settings.root !== root) return
        libraryIssue = 'LIBRARY_REFRESH_FAILED'
        options.onSummaryChange()
        send('library:changed', { snapshot: { entries: library, folders: libraryFolders, issue: libraryIssue }, relocations: [] })
      })
    }, 350)
  }

  async function checkRootAvailability(root: string) {
    try {
      const info = await fs.stat(root)
      availability = info.isDirectory() ? 'ready' : 'unreadable'
    } catch (error) {
      availability = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'
    }
    return availability === 'ready'
  }

  function applyLibraryChange(root: string, change: LibraryChange, notify = true) {
    // Every relocation must reach settings and the reader before a newer scan.
    // This queue is separate from the manager lock also held by acknowledgement.
    const next = libraryApplyTail.catch(() => undefined).then(() => applyLibraryChangeNow(root, change, notify))
    libraryApplyTail = next
    return next
  }

  async function applyLibraryChangeNow(root: string, change: LibraryChange, notify: boolean) {
    if (settings.root !== root) return
    change.root = root
    change.revision = ++libraryChangeRevision
    change.snapshot.entries = await documentChanges.summarize(root, change.snapshot.entries)
    if (settings.root !== root) return
    latestLibraryChange = change
    const previousTranslation = library.find((entry) => entry.path === openPath)?.zhPath
    library = change.snapshot.entries
    libraryFolders = change.snapshot.folders
    libraryIssue = change.snapshot.issue
    ++fileActionRevision
    options.onSummaryChange()
    const moves = new Map(change.relocations.map(({ from, to }) => [from, to]))
    const nextOpen = openPath ? moves.get(openPath) : undefined
    if (change.relocations.length) {
      settings.scroll = relocateScroll(settings.scroll, change.relocations)
      if (settings.openPath) settings.openPath = moves.get(settings.openPath) ?? settings.openPath
      if (nextOpen) { openPath = nextOpen; ++documentOpenRequest }
      await writeSettings()
    }
    if (notify) send('library:changed', change)
    const currentTranslation = library.find((entry) => entry.path === openPath)?.zhPath
    if (!nextOpen && previousTranslation !== currentTranslation) ++documentOpenRequest
    if (notify && openPath && (nextOpen || previousTranslation !== currentTranslation)) {
      await onFile(openPath)
      if (currentTranslation) await onFile(currentTranslation)
    }
  }

  async function changeTarget(filePath: string, documentId?: string) {
    const root = settings.root
    await assertLibraryDocument(root, library, filePath, documentId)
    if (!root) throw new Error('ERR_NOT_IN_FOLDER')
    const entry = library.find(item => item.path === filePath)!
    // Resolve the current companion even if its watcher event has not refreshed
    // the list yet (for example, an AI creating/removing a translation).
    const zhPath = await translator.getTargetPath(filePath)
    return { root, entry: { ...entry, zhPath: zhPath === filePath ? null : zhPath } }
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
    if (depth > 24 || files.length >= MAX_FILES) return
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
    return isPathInsideRoot(filePath, settings?.root ?? null)
  }

  function isInside(filePath: string, dir: string) {
    return filePath === dir || filePath.startsWith(dir.endsWith(sep) ? dir : dir + sep)
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
    settingsWriter ??= createSettingsWriter(options.settingsFile)
    return settingsWriter.write(settings)
  }

  function send(channel: string, payload: unknown) {
    if (!window || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  return {
    id: options.id,
    initialize,
    channels: () => [...handlers.keys()],
    invoke: (channel: string, event: Electron.IpcMainInvokeEvent, args: unknown[]) => {
      if (disposed || relocating) throw new Error('LIBRARY_BUSY')
      const handler = handlers.get(channel)
      if (!handler) throw new Error('ERR_UNKNOWN_COMMAND')
      return handler(event, ...args)
    },
    attach: (next: BrowserWindow | null) => {
      ++documentOpenRequest
      ++fileMenuRequest
      cancelFileMenu?.()
      releaseSpeech()
      window = next
    },
    window: () => window,
    state: publicState,
    settings: () => settings,
    flush: async () => {
      await libraryManager.exclusive(async () => undefined)
      await libraryApplyTail
      await flushSettingsOnQuit()
    },
    allowed: isAllowed,
    refresh: async () => { if (settings.root && !disposed && !relocating && !managingLibrary && !activeTranslations.size) { await watchRoot(settings.root); await refreshPreview() } },
    openDocument: (path: string) => libraryManager.exclusive(() => openDocument(path)),
    busy: () => managingLibrary || activeTranslations.size > 0 || !!options.isTaskActive?.(),
    stopSpeech: releaseSpeech,
    setModel: (model: string) => { if (settings) { settings.prefs.model = model; scheduleSave() } },
    summary: () => {
      // Missing historical entries remain recoverable in the library manifest;
      // they do not invalidate comparisons for the articles still present.
      const comparisonUnavailable = availability !== 'ready' || !!libraryIssue && libraryIssue !== 'LIBRARY_MISSING_ARTICLES'
      return {
        openPath: settings?.openPath ?? null,
        lastTitle: library.find(entry => entry.path === settings?.openPath)?.title,
        previewText,
        previewImages,
        activity: activeTranslations.size ? { kind: 'translation' as const, at: translationStartedAt, path: activeTranslations.values().next().value } : externalActivity,
        changedCount: !comparisonUnavailable ? library.filter(entry => entry.changes?.changed).length : undefined,
        changeIssue: comparisonUnavailable || library.some(entry => !!entry.changes?.issue),
        availability,
        windowOpen: !!window && !window.isDestroyed()
      }
    },
    relocate: async (root: string) => {
      if (managingLibrary || activeTranslations.size || options.isTaskActive?.()) throw new Error('LIBRARY_BUSY')
      relocating = true
      try {
        await libraryManager.exclusive(async () => undefined)
        await libraryApplyTail
        ++documentOpenRequest
        const previous = settings.root
        const next = remapSpaceSettings(settings, root)
        settingsWriter ??= createSettingsWriter(options.settingsFile)
        await settingsWriter.write(next)
        settings = next
        openPath = settings.openPath ?? ''
        try { await watchRoot(root); await refreshPreview() } catch {
          libraryIssue = 'LIBRARY_REFRESH_FAILED'
          availability = 'unreadable'
          options.onSummaryChange()
        }
        return previous
      } finally { relocating = false }
    },
    dispose: async () => {
      disposed = true
      ++documentOpenRequest
      cancelFileMenu?.()
      if (saveTimer) clearTimeout(saveTimer)
      if (libraryTimer) clearTimeout(libraryTimer)
      for (const timer of fileTimers.values()) clearTimeout(timer)
      fileTimers.clear()
      await watcher?.close()
      await libraryManager.exclusive(async () => undefined)
      releaseSpeech()
      translator?.dispose()
      await libraryApplyTail.catch(() => undefined)
      await flushSettingsOnQuit()
    }
  }
}

export type ReaderSession = ReturnType<typeof createReaderSession>
