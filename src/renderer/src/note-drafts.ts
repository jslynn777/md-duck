import { validQuoteAnchor, type QuoteAnchor } from '../../shared/quote-anchor'

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

export function readNoteDrafts(storage: Pick<Storage, 'getItem'>): NoteDrafts {
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

export function writeNoteDrafts(storage: Pick<Storage, 'setItem'>, drafts: NoteDrafts): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts }))
    return true
  } catch {
    return false
  }
}
