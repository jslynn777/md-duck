import { describe, expect, it } from 'vitest'
import {
  decodeNoteDraftKey,
  editNoteDraftKey,
  listNoteDrafts,
  noteDraftKey,
  readNoteDrafts,
  mergeNoteDraftChanges,
  writeNoteDraftChanges,
  relocateNoteDraftKey,
  relocateNoteDrafts,
  relocateSpaceNoteDrafts,
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

describe('independent draft records across space windows', () => {
  function storage() {
    const data = new Map<string, string>()
    return { data, get length() { return data.size }, key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  }
  it('retains legacy drafts and their exact backup while separate windows add drafts', () => {
    const saved = storage()
    const old = { old: { quote: 'old', comment: '  keep me\n' } }
    const legacy = JSON.stringify({ version: 1, drafts: old })
    saved.setItem(STORAGE_KEY, legacy)
    const a = { quote: 'a', comment: 'first space' }, b = { quote: 'b', comment: 'second space' }
    expect(writeNoteDraftChanges(saved, old, { ...old, a })).toBe(true)
    expect(writeNoteDraftChanges(saved, old, { ...old, b })).toBe(true)
    expect(readNoteDrafts(saved)).toEqual({ ...old, a, b })
    expect(saved.getItem(STORAGE_KEY)).toBe(legacy)
    expect(saved.getItem('md-duck:note-drafts:v1:spaces-backup')).toBe(legacy)
  })
  it('does not resurrect a deleted legacy draft when another window saves stale state', () => {
    const saved = storage()
    const old = { old: { quote: 'old', comment: 'remove me' } }
    saved.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts: old }))
    writeNoteDraftChanges(saved, old, {})
    writeNoteDraftChanges(saved, old, { ...old, b: { quote: 'b', comment: 'keep this' } })
    expect(readNoteDrafts(saved)).toEqual({ b: { quote: 'b', comment: 'keep this' } })
  })
  it('leaves the original untouched when the backup or first entry cannot be written', () => {
    const saved = storage()
    const old = { old: { quote: 'old', comment: 'unchanged' } }
    saved.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts: old }))
    const fail = { ...saved, setItem: () => { throw new Error('quota') } }
    expect(writeNoteDraftChanges(fail, old, { old: { quote: 'old', comment: 'new edit' } })).toBe(false)
    expect(readNoteDrafts(saved)).toEqual(old)
    expect(writeNoteDraftChanges(saved, old, { old: { quote: 'old', comment: 'new edit' } })).toBe(true)
    expect(readNoteDrafts(saved).old.comment).toBe('new edit')
  })
  it('keeps failed local edits while accepting another space’s storage events', () => {
    const a = { quote: 'a', comment: 'original' }, edited = { quote: 'a', comment: 'unsaved edit' }, b = { quote: 'b', comment: 'other space' }
    expect(mergeNoteDraftChanges({ a }, { a: edited }, { a, b })).toEqual({ a: edited, b })
    expect(mergeNoteDraftChanges({ a }, {}, { a, b })).toEqual({ b })
  })
  it('writes relocation destinations before hiding source records', () => {
    const saved = storage()
    const source = noteDraftKey('/old/article.md', 'source', { id: 'one', key: 'p' }), target = noteDraftKey('/new/article.md', 'source', { id: 'one', key: 'p' })
    const draft = { quote: 'one', comment: 'Keep the only copy' }
    saved.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts: { [source]: draft } }))
    const attempted: string[] = []
    const failing = { getItem: saved.getItem, setItem: (key: string, value: string) => { attempted.push(key); if (key.startsWith('md-duck:note-draft:v2:')) throw new Error('disk full'); saved.setItem(key, value) } }
    expect(writeNoteDraftChanges(failing, { [source]: draft }, { [target]: draft })).toBe(false)
    expect(attempted.at(-1)).toContain(encodeURIComponent(target))
    expect(readNoteDrafts(saved)[source]).toEqual(draft)
  })
  it('reads the previous complete state if the source tombstone fails after the destination is staged', () => {
    const saved = storage(), draft = { quote: 'q', comment: 'preserve' }
    saved.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts: { old: draft } }))
    const failing = { getItem: saved.getItem, setItem: (key: string, value: string) => { if (key.endsWith(':old')) throw new Error('denied'); saved.setItem(key, value) } }
    expect(writeNoteDraftChanges(failing, { old: draft }, { moved: draft })).toBe(false)
    expect(readNoteDrafts(saved)).toEqual({ old: draft })
  })
  it('keeps both originals after an interrupted swap and retries without touching another window’s entry', () => {
    const saved = storage(), first = { quote: 'one', comment: 'first unique draft' }, second = { quote: 'two', comment: 'second unique draft' }, third = { quote: 'three', comment: 'other space' }
    writeNoteDraftChanges(saved, {}, { a: first })
    writeNoteDraftChanges(saved, { a: first }, { a: first, b: second })
    const original = { a: first, b: second }, swapped = { a: second, b: first }
    const failing = { getItem: saved.getItem, setItem: (key: string, value: string) => { if (key.endsWith(':b')) throw new Error('quota'); saved.setItem(key, value) } }
    expect(writeNoteDraftChanges(failing, original, swapped)).toBe(false)
    expect(readNoteDrafts(saved)).toEqual(original)
    expect(writeNoteDraftChanges(saved, original, { ...original, c: third })).toBe(true)
    expect(writeNoteDraftChanges(saved, original, swapped)).toBe(true)
    expect(readNoteDrafts(saved)).toEqual({ ...swapped, c: third })
  })
  it('keeps previous values when the commit marker fails, without reviving an entry later rewritten by another window', () => {
    const saved = storage(), first = { quote: 'a', comment: 'original A' }, second = { quote: 'b', comment: 'original B' }, updated = { quote: 'a', comment: 'newest A' }
    writeNoteDraftChanges(saved, {}, { a: first, b: second })
    const before = { a: first, b: second }
    const failing = { getItem: saved.getItem, setItem: (key: string, value: string) => { if (key.startsWith('md-duck:note-draft-commit:v2:')) throw new Error('denied'); saved.setItem(key, value) } }
    expect(writeNoteDraftChanges(failing, before, { a: second, b: first })).toBe(false)
    expect(readNoteDrafts(saved)).toEqual(before)
    expect(writeNoteDraftChanges(saved, before, { a: updated, b: second })).toBe(true)
    expect(readNoteDrafts(saved)).toEqual({ a: updated, b: second })
  })
  it('rejects stale writes to the same draft without replacing the newer value', () => {
    const saved = storage(), first = { quote: 'a', comment: 'first' }, newer = { quote: 'a', comment: 'newer' }, stale = { quote: 'a', comment: 'stale edit' }
    writeNoteDraftChanges(saved, {}, { a: first })
    writeNoteDraftChanges(saved, { a: first }, { a: newer })
    expect(writeNoteDraftChanges(saved, { a: first }, { a: stale })).toBe(false)
    expect(readNoteDrafts(saved)).toEqual({ a: newer })
  })
})

describe('space root draft migration', () => {
  const key = (path: string) => noteDraftKey(path, 'source', { id: 'intro', key: 'p' })
  const draft = { quote: 'sentence', comment: 'unfinished' }
  it('normalizes a Windows alias and separator spelling while keeping another space untouched', () => {
    const old = key('c:/Old/series/article.md'), other = key('C:\\Old\\other-space\\article.md')
    const result = relocateSpaceNoteDrafts({ [old]: draft, [other]: draft }, 'D:\\New', ['C:\\OLD'], ['C:\\Old\\other-space'])
    expect(result).toEqual({ [key('D:\\New\\series\\article.md')]: draft, [other]: draft })
  })
  it('migrates a Mac symlink alias once and never remaps an already-current nested path', () => {
    const old = key('/alias/article.md'), current = key('/alias/real/another.md')
    const result = relocateSpaceNoteDrafts({ [old]: draft, [current]: draft }, '/alias/real', ['/alias'])
    expect(result).toEqual({ [key('/alias/real/article.md')]: draft, [current]: draft })
    expect(relocateSpaceNoteDrafts(result, '/alias/real', ['/alias'])).toEqual(result)
  })
  it('preserves both draft versions at occupied destinations', () => {
    const old = key('/old/article.md'), current = key('/new/article.md'), newer = { quote: 'new', comment: 'different' }
    expect(relocateSpaceNoteDrafts({ [old]: draft, [current]: newer }, '/new', ['/old'])).toEqual({ [old]: draft, [current]: newer })
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
