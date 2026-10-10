import type { WordExplanation } from './word-help'
import type { TranslationAlignment, TranslationAlignmentInspection } from './translation'
import type { QuoteAnchor } from './quote-anchor'

export type NoteStatus = 'open' | 'outdated' | 'orphaned' | 'resolved'
export type Lang = 'source' | 'zh'
export type UiLang = 'en' | 'zh'
export type ReadMode = 'source' | 'zh' | 'bilingual'
export type SidebarTab = 'files' | 'outline'
export type VoiceId = 'af_heart' | 'af_bella' | 'am_michael' | 'bf_emma' | 'bm_george'

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'delete'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'break' }
  | { type: 'link'; url: string; children: Inline[] }
  | { type: 'image'; url: string; alt: string }

export type Block = {
  id: string | null
  key: string
  kind: 'heading' | 'paragraph' | 'code' | 'table' | 'listItem' | 'blockquote' | 'image' | 'hr'
  depth: number
  text: string
  source: string
  marker?: string
  checked?: boolean | null
  lang?: string
  inlines?: Inline[]
  items?: Block[]
  header?: Inline[][][]
  rows?: Inline[][][]
  code?: string
}

export type AlignRow = {
  key: string
  source?: Block
  zh?: Block
}

export type Note = {
  id: string
  blockId: string | null
  blockKey: string | null
  quote: string
  quoteLang: Lang
  quoteAnchor?: QuoteAnchor
  comment: string
  createdAt: string
  status: NoteStatus
  orphanReason?: string
}

export type LibraryEntry = {
  path: string
  zhPath: string | null
  title: string
  folder: string
}

export type FileMenuResult = {
  action: 'copy-path' | 'reveal' | 'open-default'
  target: 'source' | 'translation'
}

export type Preferences = {
  fontSize: number
  mode: ReadMode
  sidebar: boolean
  sidebarTab: SidebarTab
  voice: VoiceId
  speed: number
  model: string
  ui: UiLang
}

export type ModelOption = {
  id: string
  name: string
  promptPerM: number
  completionPerM: number
}

export type ModelCatalog = {
  recommended: ModelOption[]
  latest: ModelOption[]
  expensive: ModelOption[]
  live: boolean
}

export type AppState = {
  root: string | null
  library: LibraryEntry[]
  prefs: Preferences
  hasKey: boolean
  openPath: string | null
  scroll: Record<string, string>
}

export type OpenedDocument = {
  sourcePath: string
  dir: string
  zhPath?: string | null
  zhDir?: string | null
  sourceText: string
  zhText: string | null
  notes: Note[]
  notesMissing: boolean
  reviewIssue?: ReviewIssue
  legacyUnassigned?: number
  words: LearnedWord[]
  assetVersion: number
  missing: boolean
  translationAlignment?: TranslationAlignment | null
  translationAlignmentState?: TranslationAlignmentInspection['state']
}

export type DocUpdate = {
  sourcePath: string
  side: Lang
  text: string | null
  missing: boolean
  assetVersion: number
  translationAlignment?: TranslationAlignment | null
  translationAlignmentState?: TranslationAlignmentInspection['state']
  zhPath?: string | null
  zhDir?: string | null
}

export type ReviewCandidate = {
  id: string
  document: string
  noteCount: number
  wordCount: number
  quotes: string[]
}

export type ReviewIssue = 'missing' | 'corrupt' | 'unsafe' | 'unreadable' | 'legacy-corrupt' | 'backup-unavailable'
export type NotesResult = { notes: Note[]; notesMissing: boolean; reviewIssue?: ReviewIssue; legacyUnassigned?: number; words?: LearnedWord[] }

export type LearnedWord = {
  id: string
  word: string
  key: string
  sentence: string
  meaning: string
  blockId: string | null
  createdAt: string
  explanation?: WordExplanation
}

export type SpeechEvent =
  | { type: 'status'; message: string }
  | { type: 'part'; id: string; samples: Float32Array; sampleRate: number }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; message: string }

export const DEFAULT_MODEL = 'openai/gpt-4o-mini'

export const VOICES: VoiceId[] = ['af_heart', 'af_bella', 'am_michael', 'bf_emma', 'bm_george']
