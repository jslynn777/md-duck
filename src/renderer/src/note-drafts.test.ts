import { describe, expect, it } from 'vitest'
import {
  decodeNoteDraftKey,
  editNoteDraftKey,
  listNoteDrafts,
  noteDraftKey,
  readNoteDrafts,
  relocateNoteDraftKey,
  relocateNoteDrafts,
  type NoteDrafts,
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

describe('draft continuity through library moves', () => {
  const block = { id: null, key: 'paragraph-17' }

  it('moves source, translation, and note edit drafts with quotes and precise anchors intact', () => {
    const from = 'C:\\文章库\\圣诞系列\\article.md'
    const to = 'C:\\文章库\\归档\\article.md'
    const keys = [noteDraftKey(from, 'source', block), noteDraftKey(from, 'zh', { id: 'intro', key: 'heading' }), editNoteDraftKey(from, 'source', 'saved-note')]
    const otherKey = noteDraftKey(`${from}.backup`, 'source', block)
    const quoteAnchor = { start: 8, end: 12, prefix: 'the old ', suffix: ' nearby' }
    const drafts = Object.fromEntries([...keys, otherKey, 'unknown-legacy-key'].map((key, index) => [key, {
      quote: `quote ${index}`, comment: `  unfinished ${index}\n`, quoteAnchor
    }]))
    const moved = relocateNoteDrafts(drafts, [{ from, to }])
    expect(Object.keys(moved)).toHaveLength(5)
    for (const key of keys) {
      const newKey = relocateNoteDraftKey(key, [{ from, to }])
      expect(decodeNoteDraftKey(newKey)?.sourcePath).toBe(to)
      expect(moved[newKey]).toBe(drafts[key])
      expect(moved).not.toHaveProperty(key)
    }
    expect(moved[otherKey]).toBe(drafts[otherKey])
    expect(moved['unknown-legacy-key']).toBe(drafts['unknown-legacy-key'])
    expect(drafts[keys[0]].quoteAnchor).toBe(quoteAnchor)
    expect(drafts).toHaveProperty(keys[0])
  })

  it('keeps both versions when a destination already has a different draft', () => {
    const a = noteDraftKey('/old/article.md', 'source', block)
    const b = noteDraftKey('/new/article.md', 'source', block)
    const drafts = { [a]: { quote: 'first', comment: 'unsaved first' }, [b]: { quote: 'second', comment: 'unsaved second' } }
    expect(relocateNoteDrafts(drafts, [{ from: '/old/article.md', to: '/new/article.md' }])).toEqual(drafts)
  })

  it('supports multiple renames and archive without losing an unfinished edit', () => {
    const from = '/文章/第一篇.md'
    const key = editNoteDraftKey(from, 'zh', 'note-1')
    const draft = { quote: '选中的内容', comment: '还没有保存的修改\n' }
    let drafts: NoteDrafts = { [key]: draft }
    for (const [oldPath, newPath] of [[from, '/文章/新标题.md'], ['/文章/新标题.md', '/归档/新标题.md'], ['/归档/新标题.md', '/文章/已恢复.md']]) {
      drafts = relocateNoteDrafts(drafts, [{ from: oldPath, to: newPath }])
    }
    expect(drafts).toEqual({ [editNoteDraftKey('/文章/已恢复.md', 'zh', 'note-1')]: draft })
  })

  it('relocates a swap using the original draft snapshot only once', () => {
    const a = noteDraftKey('/a.md', 'source', block)
    const b = noteDraftKey('/b.md', 'source', block)
    const first = { quote: 'a', comment: 'first draft' }
    const second = { quote: 'b', comment: 'second draft' }
    const moves = [{ from: '/a.md', to: '/b.md' }, { from: '/b.md', to: '/a.md' }]
    expect(relocateNoteDraftKey(a, moves)).toBe(b)
    expect(relocateNoteDrafts({ [a]: first, [b]: second }, moves)).toEqual({ [b]: first, [a]: second })
  })

  it('does not chain mappings inside a batch or overwrite an occupied chain destination', () => {
    const a = noteDraftKey('/a.md', 'source', block)
    const b = noteDraftKey('/b.md', 'source', block)
    const c = noteDraftKey('/c.md', 'source', block)
    const first = { quote: 'a', comment: 'first draft' }
    const second = { quote: 'b', comment: 'second draft' }
    const third = { quote: 'c', comment: 'third draft' }
    const moves = [{ from: '/a.md', to: '/b.md' }, { from: '/b.md', to: '/c.md' }]
    expect(relocateNoteDrafts({ [a]: first, [b]: second }, moves)).toEqual({ [b]: first, [c]: second })
    expect(relocateNoteDrafts({ [a]: first, [b]: second, [c]: third }, moves)).toEqual({ [a]: first, [b]: second, [c]: third })
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
