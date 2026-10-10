import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppState, DocUpdate, FileMenuResult, LearnedWord, LibraryEntry, ModelCatalog, Note, NotesResult, OpenedDocument, Preferences, ReviewCandidate, SpeechEvent } from '../shared/types'
import type { DictionaryResult, WordExplanation } from '../shared/word-help'
import type { AIConfigInput, AISettings } from '../shared/ai'
import type { TranslationInfo, TranslationState } from '../shared/translation'

type Opened = { state: AppState; openPath: string | null }

export type DuckApi = {
  platform: NodeJS.Platform
  restartStartup: () => Promise<void>
  getState: () => Promise<AppState>
  pickRoot: () => Promise<Opened>
  pickFile: () => Promise<Opened>
  openPath: (path: string) => Promise<Opened>
  openExample: () => Promise<Opened>
  pathForFile: (file: File) => string
  openDoc: (path: string) => Promise<OpenedDocument>
  closeDoc: (path: string) => Promise<void>
  setPrefs: (prefs: Partial<Preferences>) => Promise<Preferences>
  setKey: (key: string | null) => Promise<boolean>
  getAISettings: () => Promise<AISettings>
  saveAISettings: (config: AIConfigInput) => Promise<AISettings>
  testAIConnection: () => Promise<AISettings>
  connectOpenRouter: () => Promise<AISettings>
  cancelAIAuth: () => Promise<void>
  getTranslationInfo: (path: string) => Promise<TranslationInfo>
  startTranslation: (path: string) => Promise<TranslationState>
  stopTranslation: (path: string) => Promise<TranslationState>
  chooseTranslation: (path: string) => Promise<boolean>
  onAISettings: (callback: (settings: AISettings) => void) => () => void
  onTranslation: (callback: (state: TranslationState) => void) => () => void
  saveScroll: (path: string, blockKey: string) => Promise<void>
  saveNote: (path: string, note: Note) => Promise<NotesResult>
  getNotes: (path: string) => Promise<NotesResult & { words: LearnedWord[] }>
  editNote: (path: string, id: string, comment: string) => Promise<NotesResult>
  setNoteStatus: (path: string, id: string, status: Note['status']) => Promise<NotesResult>
  deleteNote: (path: string, id: string) => Promise<NotesResult>
  restoreNotes: (path: string) => Promise<NotesResult>
  revealLegacyReview: (path: string) => Promise<void>
  listReviewCandidates: (path: string) => Promise<ReviewCandidate[]>
  associateReview: (path: string, candidateId: string) => Promise<NotesResult & { words: LearnedWord[] }>
  copyText: (text: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  reveal: (path: string) => Promise<void>
  showFileMenu: (path: string, position?: { x: number; y: number }) => Promise<FileMenuResult | null>
  speak: (id: string, text: string) => Promise<void>
  cancelSpeech: () => Promise<void>
  gloss: (word: string, sentence: string, detail: boolean, learn?: boolean) => Promise<{ text: string; model: string }>
  lookupDictionary: (word: string) => Promise<DictionaryResult>
  explainWord: (word: string, sentence: string, detail: boolean) => Promise<WordExplanation>
  saveWord: (path: string, word: LearnedWord) => Promise<LearnedWord[]>
  deleteWord: (path: string, id: string) => Promise<LearnedWord[]>
  listModels: () => Promise<ModelCatalog>
  onState: (callback: (opened: Opened) => void) => () => void
  onLibrary: (callback: (entries: LibraryEntry[]) => void) => () => void
  onDoc: (callback: (update: DocUpdate) => void) => () => void
  onDocStatus: (callback: (status: { sourcePath: string; status: 'updating' }) => void) => () => void
  onSpeech: (callback: (event: SpeechEvent) => void) => () => void
}

const api: DuckApi = {
  platform: process.platform,
  restartStartup: () => ipcRenderer.invoke('startup:restart'),
  getState: () => ipcRenderer.invoke('state:get'),
  pickRoot: () => ipcRenderer.invoke('root:pick'),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  openPath: (path) => ipcRenderer.invoke('path:open', path),
  openExample: () => ipcRenderer.invoke('root:example'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openDoc: (path) => ipcRenderer.invoke('doc:open', path),
  closeDoc: (path) => ipcRenderer.invoke('doc:close', path),
  setPrefs: (prefs) => ipcRenderer.invoke('prefs:set', prefs),
  setKey: (key) => ipcRenderer.invoke('key:set', key),
  getAISettings: () => ipcRenderer.invoke('ai:get'),
  saveAISettings: (config) => ipcRenderer.invoke('ai:save', config),
  testAIConnection: () => ipcRenderer.invoke('ai:test'),
  connectOpenRouter: () => ipcRenderer.invoke('ai:connect'),
  cancelAIAuth: () => ipcRenderer.invoke('ai:cancel-auth'),
  getTranslationInfo: (path) => ipcRenderer.invoke('translation:info', path),
  startTranslation: (path) => ipcRenderer.invoke('translation:start', path),
  stopTranslation: (path) => ipcRenderer.invoke('translation:stop', path),
  chooseTranslation: (path) => ipcRenderer.invoke('translation:choose', path),
  onAISettings: (callback) => subscribe('ai:changed', callback),
  onTranslation: (callback) => subscribe('translation:progress', callback),
  saveScroll: (path, blockKey) => ipcRenderer.invoke('scroll:save', path, blockKey),
  saveNote: (path, note) => ipcRenderer.invoke('notes:save', path, note),
  getNotes: (path) => ipcRenderer.invoke('notes:get', path),
  editNote: (path, id, comment) => ipcRenderer.invoke('notes:edit', path, id, comment),
  setNoteStatus: (path, id, status) => ipcRenderer.invoke('notes:status', path, id, status),
  deleteNote: (path, id) => ipcRenderer.invoke('notes:delete', path, id),
  restoreNotes: (path) => ipcRenderer.invoke('notes:restore', path),
  revealLegacyReview: (path) => ipcRenderer.invoke('review:legacy', path),
  listReviewCandidates: (path) => ipcRenderer.invoke('review:candidates', path),
  associateReview: (path, candidateId) => ipcRenderer.invoke('review:associate', path, candidateId),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  showFileMenu: (path, position) => ipcRenderer.invoke('file:menu', path, position),
  speak: (id, text) => ipcRenderer.invoke('speech:speak', id, text),
  cancelSpeech: () => ipcRenderer.invoke('speech:cancel'),
  gloss: (word, sentence, detail, learn) => ipcRenderer.invoke('gloss', word, sentence, detail, learn),
  lookupDictionary: (word) => ipcRenderer.invoke('word:dictionary', word),
  explainWord: (word, sentence, detail) => ipcRenderer.invoke('word:explain', word, sentence, detail),
  saveWord: (path, word) => ipcRenderer.invoke('words:save', path, word),
  deleteWord: (path, id) => ipcRenderer.invoke('words:delete', path, id),
  listModels: () => ipcRenderer.invoke('models:list'),
  onState: (callback) => subscribe('state:changed', callback),
  onLibrary: (callback) => subscribe('library:update', callback),
  onDoc: (callback) => subscribe('doc:update', callback),
  onDocStatus: (callback) => subscribe('doc:status', callback),
  onSpeech: (callback) => subscribe('speech:event', callback)
}

contextBridge.exposeInMainWorld('api', api)

function subscribe<T>(channel: string, callback: (payload: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
