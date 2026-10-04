import { describe, expect, it } from 'vitest'
import {
  decodeNoteDraftKey,
  editNoteDraftKey,
  listNoteDrafts,
  noteDraftKey,
  readNoteDrafts,
  writeNoteDrafts
} from './note-drafts'

const STORAGE_KEY = 'md-duck:note-drafts:v1'

describe('note draft storage', () => {
  it('isolates documents, languages, and blocks without delimiter collisions', () => {
    const keys = [
      noteDraftKey('/docs/a.md', 'source', { id: 'intro', key: 'p-0' }),
      noteDraftKey('/docs/b.md', 'source', { id: 'intro', key: 'p-0' }),
      noteDraftKey('/docs/a.md', 'zh', { id: 'intro', key: 'p-0' }),
      noteDraftKey('/docs/a.md', 'source', { id: 'body', key: 'p-1' }),
      noteDraftKey('/docs/a.md', 'source', { id: null, key: 'intro' }),
      noteDraftKey('/docs/a.md', 'source', { id: null, key: 'body' }),
      noteDraftKey('/docs/a.md|source', 'zh', { id: null, key: 'intro' })
    ]
    expect(new Set(keys).size).toBe(keys.length)
    expect(noteDraftKey('/docs/a.md', 'source', { id: 'intro', key: 'p-9' })).toBe(keys[0])
  })

  it('preserves every draft, its quote, and untrimmed input after reloading', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) }
    }
    const key = noteDraftKey('/docs/a.md', 'source', { id: null, key: 'p-0' })
    const drafts = {
      [key]: { quote: 'Selected sentence.', comment: '  Rewrite this\n\n' },
      other: { quote: '另一段', comment: '' }
    }

    expect(writeNoteDrafts(storage, drafts)).toBe(true)
    expect(JSON.parse(values.get(STORAGE_KEY)!)).toEqual({ version: 1, drafts })
    expect(readNoteDrafts(storage)).toEqual(drafts)
  })

  it.each([
    null,
    '{broken json',
    'null',
    '[]',
    '{}',
    '{"version":2,"drafts":{}}',
    '{"version":1,"drafts":null}',
    '{"version":1,"drafts":[]}'
  ])('returns no drafts for an unreadable or unsupported payload: %s', (raw) => {
    expect(readNoteDrafts({ getItem: () => raw })).toEqual({})
  })

  it('retains valid drafts while ignoring malformed records', () => {
    const raw = JSON.stringify({
      version: 1,
      drafts: {
        valid: { quote: 'A quote', comment: 'unfinished' },
        missing: { quote: 'A quote' },
        invalidQuote: { quote: 123, comment: 'unfinished' },
        invalidComment: { quote: 'A quote', comment: null },
        empty: null,
        array: []
      }
    })
    expect(readNoteDrafts({ getItem: () => raw })).toEqual({
      valid: { quote: 'A quote', comment: 'unfinished' }
    })
  })

  it('handles unavailable storage without throwing', () => {
    expect(readNoteDrafts({ getItem: () => { throw new Error('Access denied') } })).toEqual({})
    expect(writeNoteDrafts({ setItem: () => { throw new Error('Quota exceeded') } }, {
      draft: { quote: 'Keep this', comment: 'unfinished' }
    })).toBe(false)
  })

  it('decodes existing block keys and new edit keys without changing the v1 format', () => {
    const sourcePath = '/docs/含有 "引号" | 文件.md'
    expect(decodeNoteDraftKey(noteDraftKey(sourcePath, 'source', { id: 'intro', key: 'p-0' })))
      .toEqual({ sourcePath, lang: 'source', kind: 'id', target: 'intro' })
    expect(decodeNoteDraftKey(noteDraftKey(sourcePath, 'zh', { id: null, key: 'p-0' })))
      .toEqual({ sourcePath, lang: 'zh', kind: 'key', target: 'p-0' })
    expect(decodeNoteDraftKey(editNoteDraftKey(sourcePath, 'zh', 'note-1')))
      .toEqual({ sourcePath, lang: 'zh', kind: 'note', target: 'note-1' })
  })

  it.each([
    'not a key',
    'null',
    '{}',
    '[]',
    '["/docs/a.md","source","id"]',
    '["/docs/a.md","source","id","intro","extra"]',
    '[123,"source","id","intro"]',
    '["/docs/a.md","en","id","intro"]',
    '["/docs/a.md","source","unknown","intro"]',
    '["/docs/a.md","source","id",null]',
    '["/docs/a.md","source","id",123]'
  ])('rejects malformed draft key: %s', (key) => {
    expect(decodeNoteDraftKey(key)).toBeNull()
  })

  it('keeps edits isolated from new notes and from other documents and languages', () => {
    const keys = [
      noteDraftKey('/docs/a.md', 'source', { id: 'same-id', key: 'p-0' }),
      noteDraftKey('/docs/a.md', 'source', { id: null, key: 'same-id' }),
      editNoteDraftKey('/docs/a.md', 'source', 'same-id'),
      editNoteDraftKey('/docs/a.md', 'zh', 'same-id'),
      editNoteDraftKey('/docs/b.md', 'source', 'same-id'),
      editNoteDraftKey('/docs/a.md', 'source', 'other-id')
    ]
    const drafts = Object.fromEntries(keys.map((key, index) => [key, {
      quote: `quote ${index}`,
      comment: `  comment ${index}\n`
    }]))
    expect(new Set(keys).size).toBe(keys.length)
    expect(listNoteDrafts(drafts)).toEqual(keys.map((key, index) => ({
      key,
      ...decodeNoteDraftKey(key),
      quote: `quote ${index}`,
      comment: `  comment ${index}\n`
    })))
  })

  it('lists only usable drafts but preserves hidden drafts through a v1 save and reload', () => {
    let stored: string | null = null
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value }
    }
    const oldKey = noteDraftKey('/docs/a.md', 'source', { id: null, key: 'p-0' })
    const editKey = editNoteDraftKey('/docs/a.md', 'zh', 'note-1')
    const blankKey = noteDraftKey('/docs/a.md', 'zh', { id: 'intro', key: 'p-0' })
    const emptyKey = editNoteDraftKey('/docs/b.md', 'source', 'note-2')
    const drafts = {
      [oldKey]: { quote: '  original quote ', comment: '  unfinished\n' },
      [editKey]: { quote: '已保存引用', comment: '正在修改' },
      [blankKey]: { quote: 'blank comment', comment: ' \t\n' },
      [emptyKey]: { quote: 'empty comment', comment: '' },
      'unrecognized-old-key': { quote: 'keep this too', comment: 'unfinished' }
    }
    expect(writeNoteDrafts(storage, drafts)).toBe(true)
    const restored = readNoteDrafts(storage)
    const visible = listNoteDrafts(restored)

    expect(JSON.parse(stored!).version).toBe(1)
    expect(restored).toEqual(drafts)
    expect(visible.map((entry) => entry.key)).toEqual([oldKey, editKey])
    expect(visible[0]).toMatchObject({ quote: '  original quote ', comment: '  unfinished\n' })
    expect(restored).toEqual(drafts)
  })
})


describe('precise quote anchors in saved drafts', () => {
  it('retains the second occurrence anchor across serialization and resume listing', () => {
    let raw = ''
    const storage = { setItem: (_key: string, value: string) => { raw = value }, getItem: () => raw }
    const key = noteDraftKey('/article.md', 'source', { id: null, key: 'paragraph' })
    const quoteAnchor = { start: 14, end: 18, prefix: 'bank near the ', suffix: '.' }
    writeNoteDrafts(storage, { [key]: { quote: 'bank', comment: 'Second occurrence.', quoteAnchor } })
    const restored = readNoteDrafts(storage)
    expect(restored[key].quoteAnchor).toEqual(quoteAnchor)
    expect(listNoteDrafts(restored)[0].quoteAnchor).toEqual(quoteAnchor)
  })

  it('preserves draft text but ignores malformed quote anchors', () => {
    const raw = JSON.stringify({ version: 1, drafts: { key: { quote: 'word', comment: 'Keep this.', quoteAnchor: { start: -1, end: 4 } } } })
    expect(readNoteDrafts({ getItem: () => raw })).toEqual({ key: { quote: 'word', comment: 'Keep this.' } })
  })
})
