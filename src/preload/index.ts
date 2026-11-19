import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppState, DocUpdate, FileMenuResult, LearnedWord, LibraryEntry, ModelCatalog, Note, NotesResult, OpenedDocument, Preferences, ReviewCandidate, SpeechEvent } from '../shared/types'
import type { DictionaryResult, WordExplanation } from '../shared/word-help'
import type { AIConfigInput, AISettings } from '../shared/ai'
import type { TranslationInfo, TranslationState } from '../shared/translation'
import type { LibraryChange, LibraryCommand } from '../shared/library'
import type { DocumentChangeState } from '../shared/document-changes'
import type { SpaceSummary } from '../shared/spaces'
import type { CodexApprovalResponse, CodexTaskInput, CodexTaskSnapshot } from '../shared/codex-task'

type Opened = { state: AppState; openPath: string | null }

export type DuckApi = {
  platform: NodeJS.Platform
  restartStartup: () => Promise<void>
  getState: () => Promise<AppState>
  listSpaces: () => Promise<SpaceSummary[]>
  switchSpace: (id: string) => Promise<Opened>
  openSpaceWindow: (id: string) => Promise<void>
  addSpace: () => Promise<Opened>
  renameSpace: (id: string, name: string) => Promise<SpaceSummary[]>
  removeSpace: (id: string) => Promise<Opened>
  relocateSpace: (id: string) => Promise<Opened>
  getSpaceContext: (id: string, path?: string) => Promise<{ text: string; url: string }>
  onSpaces: (callback: (spaces: SpaceSummary[]) => void) => () => void
  onSpaceOverview: (callback: () => void) => () => void
  getCodexTask: (spaceId: string) => Promise<CodexTaskSnapshot>
  checkCodex: (spaceId: string) => Promise<CodexTaskSnapshot>
  startCodexTask: (spaceId: string, input: CodexTaskInput) => Promise<CodexTaskSnapshot>
  resumeCodexTask: (spaceId: string, input: CodexTaskInput) => Promise<CodexTaskSnapshot>
  stopCodexTask: (spaceId: string) => Promise<CodexTaskSnapshot>
  takeoverCodexTask: (spaceId: string) => Promise<CodexTaskSnapshot>
  respondCodexApproval: (spaceId: string, response: CodexApprovalResponse) => Promise<CodexTaskSnapshot>
  onCodexTask: (callback: (snapshot: CodexTaskSnapshot) => void) => () => void
  pickRoot: () => Promise<Opened>
  pickFile: () => Promise<Opened>
  openPath: (path: string) => Promise<Opened>
  openExample: () => Promise<Opened>
  pathForFile: (file: File) => string
  openDoc: (path: string) => Promise<OpenedDocument>
  getDocumentChanges: (path: string, documentId?: string) => Promise<DocumentChangeState>
  acknowledgeDocumentChanges: (path: string, revision: string, documentId?: string) => Promise<DocumentChangeState>
  closeDoc: (path: string) => Promise<void>
  setPrefs: (prefs: Partial<Preferences>) => Promise<Preferences>
  setKey: (key: string | null) => Promise<boolean>
  getAISettings: () => Promise<AISettings>
  saveAISettings: (config: AIConfigInput) => Promise<AISettings>
  testAIConnection: () => Promise<AISettings>
  connectOpenRouter: () => Promise<AISettings>
  cancelAIAuth: () => Promise<void>
  getTranslationInfo: (path: string) => Promise<TranslationInfo>
  startTranslation: (path: string, documentId?: string) => Promise<TranslationState>
  stopTranslation: (path: string) => Promise<TranslationState>
  chooseTranslation: (path: string, documentId?: string) => Promise<boolean>
  onAISettings: (callback: (settings: AISettings) => void) => () => void
  onTranslation: (callback: (state: TranslationState) => void) => () => void
  saveScroll: (path: string, blockKey: string) => Promise<void>
  saveNote: (path: string, note: Note, documentId?: string) => Promise<NotesResult>
  getNotes: (path: string) => Promise<NotesResult & { words: LearnedWord[] }>
  editNote: (path: string, id: string, comment: string, documentId?: string) => Promise<NotesResult>
  setNoteStatus: (path: string, id: string, status: Note['status'], documentId?: string) => Promise<NotesResult>
  deleteNote: (path: string, id: string, documentId?: string) => Promise<NotesResult>
  restoreNotes: (path: string, documentId?: string) => Promise<NotesResult>
  revealLegacyReview: (path: string) => Promise<void>
  listReviewCandidates: (path: string) => Promise<ReviewCandidate[]>
  associateReview: (path: string, candidateId: string, documentId?: string) => Promise<NotesResult & { words: LearnedWord[] }>
  copyText: (text: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  reveal: (path: string) => Promise<void>
  showFileMenu: (path: string, position?: { x: number; y: number }) => Promise<FileMenuResult | null>
  manageLibrary: (command: LibraryCommand) => Promise<LibraryChange>
  onLibraryChange: (callback: (change: LibraryChange) => void) => () => void
  speak: (id: string, text: string) => Promise<void>
  cancelSpeech: () => Promise<void>
  gloss: (word: string, sentence: string, detail: boolean, learn?: boolean) => Promise<{ text: string; model: string }>
  lookupDictionary: (word: string) => Promise<DictionaryResult>
  explainWord: (word: string, sentence: string, detail: boolean) => Promise<WordExplanation>
  saveWord: (path: string, word: LearnedWord, documentId?: string) => Promise<LearnedWord[]>
  deleteWord: (path: string, id: string, documentId?: string) => Promise<LearnedWord[]>
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
  listSpaces: () => ipcRenderer.invoke('spaces:list'),
  switchSpace: (id) => ipcRenderer.invoke('spaces:switch', id),
  openSpaceWindow: (id) => ipcRenderer.invoke('spaces:window', id),
  addSpace: () => ipcRenderer.invoke('spaces:add'),
  renameSpace: (id, name) => ipcRenderer.invoke('spaces:rename', id, name),
  removeSpace: (id) => ipcRenderer.invoke('spaces:remove', id),
  relocateSpace: (id) => ipcRenderer.invoke('spaces:relocate', id),
  getSpaceContext: (id, path) => ipcRenderer.invoke('spaces:context', id, path),
  onSpaces: (callback) => subscribe('spaces:changed', callback),
  onSpaceOverview: (callback) => subscribe('spaces:overview', callback),
  getCodexTask: (id) => ipcRenderer.invoke('codex:status', id),
  checkCodex: (id) => ipcRenderer.invoke('codex:check', id),
  startCodexTask: (id, input) => ipcRenderer.invoke('codex:start', id, input),
  resumeCodexTask: (id, input) => ipcRenderer.invoke('codex:resume', id, input),
  stopCodexTask: (id) => ipcRenderer.invoke('codex:stop', id),
  takeoverCodexTask: (id) => ipcRenderer.invoke('codex:takeover', id),
  respondCodexApproval: (id, response) => ipcRenderer.invoke('codex:respond', id, response),
  onCodexTask: (callback) => subscribe('codex:changed', callback),
  pickRoot: () => ipcRenderer.invoke('root:pick'),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  openPath: (path) => ipcRenderer.invoke('path:open', path),
  openExample: () => ipcRenderer.invoke('root:example'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openDoc: (path) => ipcRenderer.invoke('doc:open', path),
  getDocumentChanges: (path, documentId) => ipcRenderer.invoke('changes:get', path, documentId),
  acknowledgeDocumentChanges: (path, revision, documentId) => ipcRenderer.invoke('changes:acknowledge', path, revision, documentId),
  closeDoc: (path) => ipcRenderer.invoke('doc:close', path),
  setPrefs: (prefs) => ipcRenderer.invoke('prefs:set', prefs),
  setKey: (key) => ipcRenderer.invoke('key:set', key),
  getAISettings: () => ipcRenderer.invoke('ai:get'),
  saveAISettings: (config) => ipcRenderer.invoke('ai:save', config),
  testAIConnection: () => ipcRenderer.invoke('ai:test'),
  connectOpenRouter: () => ipcRenderer.invoke('ai:connect'),
  cancelAIAuth: () => ipcRenderer.invoke('ai:cancel-auth'),
  getTranslationInfo: (path) => ipcRenderer.invoke('translation:info', path),
  startTranslation: (path, documentId) => ipcRenderer.invoke('translation:start', path, documentId),
  stopTranslation: (path) => ipcRenderer.invoke('translation:stop', path),
  chooseTranslation: (path, documentId) => ipcRenderer.invoke('translation:choose', path, documentId),
  onAISettings: (callback) => subscribe('ai:changed', callback),
  onTranslation: (callback) => subscribe('translation:progress', callback),
  saveScroll: (path, blockKey) => ipcRenderer.invoke('scroll:save', path, blockKey),
  saveNote: (path, note, documentId) => ipcRenderer.invoke('notes:save', path, note, documentId),
  getNotes: (path) => ipcRenderer.invoke('notes:get', path),
  editNote: (path, id, comment, documentId) => ipcRenderer.invoke('notes:edit', path, id, comment, documentId),
  setNoteStatus: (path, id, status, documentId) => ipcRenderer.invoke('notes:status', path, id, status, documentId),
  deleteNote: (path, id, documentId) => ipcRenderer.invoke('notes:delete', path, id, documentId),
  restoreNotes: (path, documentId) => ipcRenderer.invoke('notes:restore', path, documentId),
  revealLegacyReview: (path) => ipcRenderer.invoke('review:legacy', path),
  listReviewCandidates: (path) => ipcRenderer.invoke('review:candidates', path),
  associateReview: (path, candidateId, documentId) => ipcRenderer.invoke('review:associate', path, candidateId, documentId),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  showFileMenu: (path, position) => ipcRenderer.invoke('file:menu', path, position),
  manageLibrary: (command) => ipcRenderer.invoke('library:manage', command),
  onLibraryChange: (callback) => subscribe('library:changed', callback),
  speak: (id, text) => ipcRenderer.invoke('speech:speak', id, text),
  cancelSpeech: () => ipcRenderer.invoke('speech:cancel'),
  gloss: (word, sentence, detail, learn) => ipcRenderer.invoke('gloss', word, sentence, detail, learn),
  lookupDictionary: (word) => ipcRenderer.invoke('word:dictionary', word),
  explainWord: (word, sentence, detail) => ipcRenderer.invoke('word:explain', word, sentence, detail),
  saveWord: (path, word, documentId) => ipcRenderer.invoke('words:save', path, word, documentId),
  deleteWord: (path, id, documentId) => ipcRenderer.invoke('words:delete', path, id, documentId),
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
