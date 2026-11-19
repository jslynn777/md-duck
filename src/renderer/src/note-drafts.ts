import { validQuoteAnchor, type QuoteAnchor } from '../../shared/quote-anchor'
import type { LibraryRelocation } from '../../shared/library'
import { relocatePath, relocatePathRecords } from '../../shared/library-relocation'

export type NoteDraft = { quote: string; comment: string; quoteAnchor?: QuoteAnchor }
export type NoteDrafts = Record<string, NoteDraft>
type NoteDraftTarget = {
  sourcePath: string
  lang: 'source' | 'zh'
  kind: 'id' | 'key' | 'note'
  target: string
}
export type NoteDraftEntry = NoteDraft & NoteDraftTarget & { key: string }

const STORAGE_KEY = 'md-duck:note-drafts:v1'
const ENTRY_PREFIX = 'md-duck:note-draft:v2:'
const COMMIT_PREFIX = 'md-duck:note-draft-commit:v2:'
const LEGACY_BACKUP = 'md-duck:note-drafts:v1:spaces-backup'
type DraftStorage = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'key' | 'length'>>

export function noteDraftKey(
  sourcePath: string,
  lang: 'source' | 'zh',
  block: { id: string | null; key: string }
): string {
  return JSON.stringify([
    sourcePath,
    lang,
    block.id === null ? 'key' : 'id',
    block.id ?? block.key
  ])
}

export function editNoteDraftKey(sourcePath: string, lang: 'source' | 'zh', noteId: string): string {
  return JSON.stringify([sourcePath, lang, 'note', noteId])
}

export function decodeNoteDraftKey(key: string): NoteDraftTarget | null {
  try {
    const parts: unknown = JSON.parse(key)
    if (!Array.isArray(parts) || parts.length !== 4) return null
    const [sourcePath, lang, kind, target] = parts
    if (
      typeof sourcePath !== 'string' ||
      (lang !== 'source' && lang !== 'zh') ||
      (kind !== 'id' && kind !== 'key' && kind !== 'note') ||
      typeof target !== 'string'
    ) return null
    return { sourcePath, lang, kind, target }
  } catch {
    return null
  }
}

export function relocateNoteDraftKey(key: string, relocations: readonly LibraryRelocation[]): string {
  const target = decodeNoteDraftKey(key)
  if (!target) return key
  const sourcePath = relocatePath(target.sourcePath, relocations)
  return sourcePath === target.sourcePath ? key : JSON.stringify([sourcePath, target.lang, target.kind, target.target])
}

export function relocateNoteDrafts(drafts: NoteDrafts, relocations: readonly LibraryRelocation[]): NoteDrafts {
  const keys = Object.keys(drafts).map((from) => ({ from, to: relocateNoteDraftKey(from, relocations) }))
  return relocatePathRecords(drafts, keys)
}

/** Root moves become exact document mappings; unrelated spaces and occupied drafts stay untouched. */
export function relocateSpaceNoteDrafts(drafts: NoteDrafts, root: string, aliases: readonly string[], excludedRoots: readonly string[] = []): NoteDrafts {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '')
  const inside = (path: string, base: string): string | null => {
    const source = normalize(path), folder = normalize(base)
    const windows = /^[a-z]:\//i.test(folder) || folder.startsWith('//')
    const first = windows ? source.toLowerCase() : source, second = windows ? folder.toLowerCase() : folder
    return first.startsWith(second + '/') ? source.slice(folder.length + 1) : null
  }
  const separator = root.includes('\\') ? '\\' : '/'
  const sources = new Set(Object.keys(drafts).flatMap(key => { const decoded = decodeNoteDraftKey(key); return decoded ? [decoded.sourcePath] : [] }))
  const mapping: LibraryRelocation[] = []
  for (const source of sources) {
    if (excludedRoots.some(other => inside(source, other) !== null)) continue
    // Already-canonical locations win over a historical parent alias.
    const candidates = [root, ...[...aliases].sort((a, b) => b.length - a.length)]
    const matched = candidates.map(base => inside(source, base)).find(relative => relative !== null)
    if (matched === undefined) continue
    const target = root.replace(/[/\\]$/, '') + separator + matched.split('/').join(separator)
    if (target !== source) mapping.push({ from: source, to: target })
  }
  return relocateNoteDrafts(drafts, mapping)
}

export function listNoteDrafts(drafts: NoteDrafts): NoteDraftEntry[] {
  return Object.entries(drafts).flatMap(([key, draft]) => {
    const target = decodeNoteDraftKey(key)
    if (!target || !draft.comment.trim()) return []
    return [{ key, ...target, quote: draft.quote, comment: draft.comment, quoteAnchor: draft.quoteAnchor }]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatedDraft(value: unknown): NoteDraft | null {
  if (value === null) return null
  if (!isRecord(value) || typeof value.quote !== 'string' || typeof value.comment !== 'string') throw new Error('DRAFT_RECORD_INVALID')
  return { quote: value.quote, comment: value.comment, ...(validQuoteAnchor(value.quoteAnchor) ? { quoteAnchor: value.quoteAnchor } : {}) }
}

function entryDraft(storage: Pick<Storage, 'getItem'>, raw: string): NoteDraft | null {
  const saved: unknown = JSON.parse(raw)
  if (!isRecord(saved) || saved.version !== 2) throw new Error('DRAFT_RECORD_INVALID')
  if (saved.transaction === undefined) return validatedDraft(saved.draft)
  if (typeof saved.transaction !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(saved.transaction)) throw new Error('DRAFT_TRANSACTION_INVALID')
  return validatedDraft(storage.getItem(COMMIT_PREFIX + saved.transaction) === 'done' ? saved.draft : saved.previous)
}

function setDraft(drafts: NoteDrafts, key: string, draft: NoteDraft) {
  Object.defineProperty(drafts, key, { value: draft, configurable: true, enumerable: true, writable: true })
}

function readLegacyNoteDrafts(storage: Pick<Storage, 'getItem'>): NoteDrafts {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const saved: unknown = JSON.parse(raw)
    if (!isRecord(saved) || saved.version !== 1 || !isRecord(saved.drafts)) return {}

    return Object.fromEntries(
      Object.entries(saved.drafts)
        .filter((entry): entry is [string, NoteDraft] => {
          const draft = entry[1]
          return isRecord(draft) && typeof draft.quote === 'string' && typeof draft.comment === 'string'
        })
        .map(([key, draft]) => [key, {
          quote: draft.quote, comment: draft.comment,
          ...(validQuoteAnchor(draft.quoteAnchor) ? { quoteAnchor: draft.quoteAnchor } : {})
        }])
    )
  } catch {
    return {}
  }
}

/** Untouched legacy entries remain readable; a per-entry value or tombstone takes precedence. */
export function readNoteDrafts(storage: DraftStorage): NoteDrafts {
  const drafts = readLegacyNoteDrafts(storage)
  if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return drafts
  for (let index = 0; index < storage.length; index++) {
    try {
      const key = storage.key(index)
      if (!key?.startsWith(ENTRY_PREFIX)) continue
      const raw = storage.getItem(key)
      if (raw === null) continue
      const draftKey = decodeURIComponent(key.slice(ENTRY_PREFIX.length))
      const draft = entryDraft(storage, raw)
      if (draft === null) { delete drafts[draftKey]; continue }
      setDraft(drafts, draftKey, draft)
    } catch { /* Keep the legacy entry when its replacement is unreadable. */ }
  }
  return drafts
}

export function isNoteDraftStorageKey(key: string | null): boolean {
  return key === null || key === STORAGE_KEY || key.startsWith(ENTRY_PREFIX) || key.startsWith(COMMIT_PREFIX)
}

/** Separate keys prevent two space windows from replacing one another's entire draft map. */
export function writeNoteDraftChanges(storage: Pick<Storage, 'getItem' | 'setItem'>, previous: NoteDrafts, next: NoteDrafts): boolean {
  try {
    const legacy = storage.getItem(STORAGE_KEY)
    if (legacy !== null && storage.getItem(LEGACY_BACKUP) === null) storage.setItem(LEGACY_BACKUP, legacy)
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    const transaction = changed.length > 1 ? crypto.randomUUID() : null
    const prior = new Map<string, NoteDraft | null>()
    // Check all records before staging a batch; another window's newer draft is never replaced.
    for (const key of changed) {
      const raw = storage.getItem(ENTRY_PREFIX + encodeURIComponent(key))
      const value = raw === null ? previous[key] ?? null : entryDraft(storage, raw)
      if (JSON.stringify(value) !== JSON.stringify(previous[key] ?? null) && JSON.stringify(value) !== JSON.stringify(next[key] ?? null)) return false
      prior.set(key, value)
    }
    // Stage destination values first as an additional safeguard for interrupted relocations.
    changed.sort((a, b) => Number(!next[a]) - Number(!next[b]))
    for (const key of changed) {
      storage.setItem(ENTRY_PREFIX + encodeURIComponent(key), JSON.stringify({ version: 2, draft: next[key] ?? null,
        ...(transaction ? { transaction, previous: prior.get(key) ?? null } : {}) }))
    }
    // Before this single atomic marker, every staged key still reads as its previous value.
    if (transaction) storage.setItem(COMMIT_PREFIX + transaction, 'done')
    return true
  } catch { return false }
}

/** Preserve this window's unsaved changes while incorporating another space's entries. */
export function mergeNoteDraftChanges(previous: NoteDrafts, local: NoteDrafts, incoming: NoteDrafts): NoteDrafts {
  const merged = { ...incoming }
  for (const key of new Set([...Object.keys(previous), ...Object.keys(local)])) {
    if (JSON.stringify(previous[key]) === JSON.stringify(local[key])) continue
    if (local[key]) setDraft(merged, key, local[key])
    else delete merged[key]
  }
  return merged
}

export function writeNoteDrafts(storage: Pick<Storage, 'setItem'>, drafts: NoteDrafts): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts }))
    return true
  } catch {
    return false
  }
}
