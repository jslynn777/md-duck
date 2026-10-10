import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LearnedWord, Note } from '../shared/types'
import { isPathInsideRoot } from './allowed-path'
import { createReviewStore } from './review-store'
import { makeQuoteAnchor } from '../shared/quote-anchor'

type Article = { name: string; sourceText: string; zhText?: string | null }
let fixture: string
let library: string
let userData: string
let articles: Map<string, Article>

beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-review-store-')))
  library = join(fixture, 'library')
  userData = join(fixture, 'user-data')
  await fs.mkdir(library)
  await fs.mkdir(userData)
  articles = new Map()
})
afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }) })

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const primary = (source: string) => join(dirname(source), '.review', 'documents', `${hash(basename(source))}.json`)
const backup = (source: string) => join(userData, 'review-backups', `${hash(source)}.json`)
const snapshot = (source: string, notes: Note[], words: LearnedWord[] = []) => ({ version: 2, document: basename(source), notes, words })

function note(id: string, quote = `Quote ${id}`, patch: Partial<Note> = {}): Note {
  return { id, quote, quoteLang: 'source', blockId: 'intro', blockKey: 'id:intro', comment: `Comment ${id}`,
    createdAt: '2026-09-28T00:00:00.000Z', status: 'open', ...patch }
}
function word(id: string, sentence = `Sentence ${id}`, patch: Partial<LearnedWord> = {}): LearnedWord {
  return { id, word: 'bank', key: 'bank', sentence, meaning: `Meaning ${id}`, blockId: 'intro',
    createdAt: '2026-09-28T00:00:00.000Z', ...patch }
}
async function article(name: string, sourceText = `# ${name}`, zhText?: string) {
  const source = join(library, name)
  await fs.mkdir(dirname(source), { recursive: true })
  await fs.writeFile(source, sourceText)
  articles.set(source, { name: basename(source), sourceText, zhText })
  return source
}
function store() {
  return createReviewStore({
    isAllowed: (path) => isPathInsideRoot(path, library),
    userData,
    candidates: async (source) => [...articles.entries()].filter(([path]) => dirname(path) === dirname(source)).map(([, value]) => value)
  })
}
async function seedLegacy(source: string, notes: Note[], words: LearnedWord[] = []) {
  const dir = join(dirname(source), '.review')
  await fs.mkdir(dir, { recursive: true })
  const notesRaw = JSON.stringify({ version: 1, notes }, null, 2)
  const wordsRaw = JSON.stringify({ version: 1, words }, null, 2)
  await fs.writeFile(join(dir, 'notes.json'), notesRaw)
  await fs.writeFile(join(dir, 'words.json'), wordsRaw)
  return { notesRaw, wordsRaw }
}

describe('review store document isolation and edits', () => {
  it('preserves optional quote anchors across storage and rejects invalid anchors', async () => {
    const source = await article('anchor.md')
    const reviews = store()
    const anchored = note('range', 'bank', { quoteAnchor: { start: 14, end: 18, prefix: 'near the ', suffix: '.' } })
    await reviews.saveNote(source, anchored)
    expect((await store().load(source)).notes).toEqual([anchored])
    const invalid = { ...anchored, quoteAnchor: { start: 14, end: 3, prefix: '', suffix: '' } }
    await expect(reviews.saveNote(source, invalid)).rejects.toThrow('REVIEW_INVALID_DATA')
    expect((await store().load(source)).notes).toEqual([anchored])
  })
  it('accepts the shared 48-character context boundary without truncating stored anchors', async () => {
    const source = await article('anchor.md')
    const anchored = note('range', 'bank', { quoteAnchor: { start: 48, end: 52, prefix: 'a'.repeat(48), suffix: 'b'.repeat(48) } })
    await store().saveNote(source, anchored)
    expect((await store().load(source)).notes).toEqual([anchored])
  })
  it.each([
    { start: 4, end: 8, prefix: 'a'.repeat(49), suffix: '' },
    { start: 4, end: 8, prefix: '', suffix: 'a'.repeat(49) },
    { start: 4.5, end: 8, prefix: '', suffix: '' },
    { start: -1, end: 8, prefix: '', suffix: '' }
  ])('rejects an anchor outside the shared validation rules: %j', async (quoteAnchor) => {
    const source = await article('anchor.md')
    const reviews = store()
    const original = note('saved')
    await reviews.saveNote(source, original)
    await expect(reviews.saveNote(source, note('invalid', 'bank', { quoteAnchor }))).rejects.toThrow('REVIEW_INVALID_DATA')
    expect((await reviews.load(source)).notes).toEqual([original])
  })
  it('keeps same-folder articles and same-word meanings in separate document snapshots', async () => {
    const a = await article('a.md')
    const b = await article('b.md')
    const reviews = store()
    const aNote = note('a')
    const bNote = note('b')
    const aWord = word('a-bank', 'I visited the bank.', { meaning: '银行' })
    const bWord = word('b-bank', 'We sat on the bank.', { meaning: '河岸' })
    await reviews.saveNote(a, aNote)
    await reviews.saveWord(a, aWord)
    await reviews.saveNote(b, bNote)
    await reviews.saveWord(b, bWord)

    expect(await reviews.load(a)).toMatchObject({ notes: [aNote], words: [aWord], notesMissing: false })
    expect(await reviews.load(b)).toMatchObject({ notes: [bNote], words: [bWord], notesMissing: false })
    expect(JSON.parse(await fs.readFile(primary(a), 'utf8'))).toEqual(snapshot(a, [aNote], [aWord]))
    expect(JSON.parse(await fs.readFile(primary(b), 'utf8'))).toEqual(snapshot(b, [bNote], [bWord]))
  })

  it('edits, changes status, and deletes records without affecting the other document or record type', async () => {
    const a = await article('a.md')
    const b = await article('b.md')
    const reviews = store()
    const saved = note('a', 'Original quote', { status: 'resolved' })
    const learned = word('a-bank')
    const other = note('b')
    await reviews.saveNote(a, saved)
    await reviews.saveWord(a, learned)
    await reviews.saveNote(b, other)
    expect((await reviews.editNote(a, saved.id, ' Updated opinion ')).notes).toEqual([{ ...saved, comment: 'Updated opinion' }])
    expect((await reviews.setNoteStatus(a, saved.id, 'open')).notes[0].status).toBe('open')
    await reviews.deleteNote(a, saved.id)
    expect(await reviews.load(a)).toMatchObject({ notes: [], words: [learned] })
    await reviews.deleteWord(a, learned.id)
    expect(await reviews.load(a)).toMatchObject({ notes: [], words: [] })
    expect((await reviews.load(b)).notes).toEqual([other])
  })

  it('retains every concurrent note and word update across independent store instances', async () => {
    const source = await article('article.md')
    const first = store()
    const second = store()
    const notes = Array.from({ length: 8 }, (_, index) => note(`n${index}`))
    const words = Array.from({ length: 8 }, (_, index) => word(`w${index}`, `Sentence ${index}`, { word: `word${index}`, key: `word${index}` }))
    const transactions = await Promise.allSettled([
      ...notes.map((record) => first.saveNote(source, record)),
      ...words.map((record) => second.saveWord(source, record))
    ])
    expect(transactions.filter((result) => result.status === 'rejected')).toEqual([])
    const result = await store().load(source)
    expect(result.notes.map((record) => record.id).sort()).toEqual(notes.map((record) => record.id).sort())
    expect(result.words.map((record) => record.id).sort()).toEqual(words.map((record) => record.id).sort())
    expect(JSON.parse(await fs.readFile(backup(source), 'utf8'))).toEqual(JSON.parse(await fs.readFile(primary(source), 'utf8')))
  })
})

describe('review store explicit association after a rename', () => {
  const originalQuote = 'Exact old quote with reliable article context.'
  async function renamed() {
    const old = await article('old.md', `# Old title\n\n${originalQuote}`)
    const reviews = store()
    await reviews.saveNote(old, note('saved', originalQuote))
    await reviews.saveWord(old, word('saved-word'))
    const original = await fs.readFile(primary(old), 'utf8')
    const next = join(library, 'renamed.md')
    await fs.rename(old, next)
    articles.delete(old)
    articles.set(next, { name: 'renamed.md', sourceText: `# New title\n\n${originalQuote}` })
    await fs.writeFile(next, `# New title\n\n${originalQuote}`)
    return { reviews, old, next, original }
  }
  it('offers absent same-folder documents for explicit review and copies without deleting the original snapshot', async () => {
    const { reviews, old, next, original } = await renamed()
    expect((await reviews.load(next)).notes).toEqual([])
    const candidates = await reviews.listCandidates(next)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ document: 'old.md', noteCount: 1, wordCount: 1, quotes: [originalQuote] })
    const result = await reviews.associate(next, candidates[0].id)
    expect(result).toMatchObject({ notes: [note('saved', originalQuote)], words: [word('saved-word')], notesMissing: false })
    expect(await fs.readFile(primary(old), 'utf8')).toBe(original)
    expect((await store().load(next)).notes).toEqual(result.notes)
    expect(await reviews.listCandidates(next)).toEqual([])
  })
  it('does not offer a snapshot while its source still exists', async () => {
    const old = await article('old.md')
    const next = await article('next.md')
    const reviews = store()
    await reviews.saveNote(old, note('old'))
    expect(await reviews.listCandidates(next)).toEqual([])
  })
  it('rejects stale candidate content and an old file that reappears after preview', async () => {
    const { reviews, old, next } = await renamed()
    const [candidate] = await reviews.listCandidates(next)
    await fs.writeFile(primary(old), JSON.stringify(snapshot(old, [note('different', originalQuote)])) )
    await expect(reviews.associate(next, candidate.id)).rejects.toThrow('REVIEW_CANDIDATE_CHANGED')
    expect((await reviews.load(next)).notes).toEqual([])
    const [newCandidate] = await reviews.listCandidates(next)
    await fs.writeFile(old, '# Reappeared')
    await expect(reviews.associate(next, newCandidate.id)).rejects.toThrow('REVIEW_CANDIDATE_CHANGED')
  })
  it('never overwrites records added to the target after a candidate was shown', async () => {
    const { reviews, next } = await renamed()
    const [candidate] = await reviews.listCandidates(next)
    await reviews.saveNote(next, note('new'))
    await expect(reviews.associate(next, candidate.id)).rejects.toThrow('REVIEW_TARGET_NOT_EMPTY')
    expect((await reviews.load(next)).notes).toEqual([note('new')])
  })
  it('rejects fabricated candidate paths and redirected candidate snapshots', async () => {
    const { reviews, old, next, original } = await renamed()
    await expect(reviews.associate(next, '../../outside.json')).rejects.toThrow('REVIEW_CANDIDATE_INVALID')
    const outside = join(fixture, 'outside.json')
    await fs.writeFile(outside, original)
    await fs.unlink(primary(old))
    await fs.symlink(outside, primary(old))
    await expect(reviews.listCandidates(next)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(await fs.readFile(outside, 'utf8')).toBe(original)
    expect((await reviews.load(next)).notes).toEqual([])
  })
  it('shows an anchored short quote after a filename and title change, but not on an unrelated article sharing bank', async () => {
    const text = 'We walked past the bank near the bank before returning home.'
    const old = await article('precision.md', `# Precision\n\n${text}`)
    const reviews = store()
    const start = text.lastIndexOf('bank')
    await reviews.saveNote(old, note('bank', 'bank', { blockId: null, blockKey: 'old-block', quoteAnchor: makeQuoteAnchor(text, start, start + 4) }))
    const next = join(library, 'precision-renamed.md')
    await fs.rename(old, next)
    articles.delete(old)
    articles.set(next, { name: 'precision-renamed.md', sourceText: `# Changed title\n\n${text}` })
    await fs.writeFile(next, `# Changed title\n\n${text}`)
    expect(await reviews.listCandidates(next)).toHaveLength(1)
    const unrelated = await article('unrelated.md', '# Other article\n\nA bank can hold money. This paragraph has a different purpose.')
    expect(await reviews.listCandidates(unrelated)).toEqual([])
  })
  it('does not show a candidate based only on a short quote or a saved word with an insufficient sentence', async () => {
    const old = await article('short.md', '# Old\n\nbank near the bank')
    const reviews = store()
    await reviews.saveNote(old, note('bank', 'bank', { quoteAnchor: { start: 14, end: 18, prefix: 'near the ', suffix: '' } }))
    await reviews.saveWord(old, word('word', 'bank near the bank'))
    await fs.unlink(old)
    articles.delete(old)
    const unrelated = await article('short-new.md', '# Different\n\nA bank near the bank.')
    expect(await reviews.listCandidates(unrelated)).toEqual([])
  })
  it('offers saved words only when a complete sufficiently long sentence matches the current body', async () => {
    const sentence = 'We walked past the bank near the bank before returning home.'
    const old = await article('words.md', `# Old\n\n${sentence}`)
    const reviews = store()
    await reviews.saveWord(old, word('saved', sentence))
    await fs.unlink(old)
    articles.delete(old)
    const next = await article('words-renamed.md', `# Changed\n\n${sentence}`)
    expect(await reviews.listCandidates(next)).toHaveLength(1)
    const unrelated = await article('word-unrelated.md', '# Other\n\nWe asked the bank about money.')
    expect(await reviews.listCandidates(unrelated)).toEqual([])
  })
})

describe('review store legacy migration', () => {
  it('migrates a single article without modifying either legacy file', async () => {
    const source = await article('article.md', 'Rewritten article with no old quote')
    const saved = note('legacy', 'Deleted old quote')
    const learned = word('legacy-word', 'Deleted old sentence')
    const legacy = await seedLegacy(source, [saved], [learned])
    const reviews = store()
    expect(await reviews.load(source)).toMatchObject({ notes: [saved], words: [learned], notesMissing: false, legacyUnassigned: 0 })
    expect(await fs.readFile(join(dirname(source), '.review', 'notes.json'), 'utf8')).toBe(legacy.notesRaw)
    expect(await fs.readFile(join(dirname(source), '.review', 'words.json'), 'utf8')).toBe(legacy.wordsRaw)
    expect(JSON.parse(await fs.readFile(primary(source), 'utf8'))).toEqual(snapshot(source, [saved], [learned]))
    expect(JSON.parse(await fs.readFile(await reviews.legacyFile(source), 'utf8'))).toMatchObject({
      version: 1, documents: { 'article.md': { notes: [saved], words: [learned] } }, unassigned: { notes: [], words: [] }
    })
  })

  it('persists unique and ambiguous assignments once and never assigns old ambiguity to a new article', async () => {
    const a = await article('a.md', 'Only A. Shared quote.', '甲文章的译文。')
    const b = await article('b.md', 'Only B. Shared quote.')
    const aNote = note('a', 'Only A.')
    const bNote = note('b', 'Only B.')
    const zhNote = note('zh', '甲文章的译文。', { quoteLang: 'zh' })
    const ambiguous = note('ambiguous', 'Shared quote.')
    const missing = note('missing', 'Lost source.')
    const bWord = word('b-word', 'Only B.')
    const ambiguousWord = word('shared-word', 'Shared quote.')
    await seedLegacy(a, [aNote, bNote, zhNote, ambiguous, missing], [bWord, ambiguousWord])
    const reviews = store()
    expect(await reviews.load(a)).toMatchObject({ notes: [aNote, zhNote], words: [], legacyUnassigned: 3 })
    const planFile = await reviews.legacyFile(a)
    const originalPlan = await fs.readFile(planFile, 'utf8')
    expect(JSON.parse(originalPlan).unassigned).toEqual({ notes: [ambiguous, missing], words: [ambiguousWord] })

    await article('a.md', 'Rewritten A without its old text')
    await article('b.md', 'Rewritten B without its old text')
    const added = await article('new.md', 'Shared quote. Lost source. Only A. Only B.')
    expect(await store().load(added)).toMatchObject({ notes: [], words: [], legacyUnassigned: 3 })
    expect(await store().load(b)).toMatchObject({ notes: [bNote], words: [bWord], legacyUnassigned: 3 })
    expect(await fs.readFile(planFile, 'utf8')).toBe(originalPlan)
  })

  it('recovers a corrupt legacy file from its old backup while preserving the damaged input', async () => {
    const source = await article('article.md')
    const damaged = '{"version":1,"notes":['
    await seedLegacy(source, [])
    await fs.writeFile(join(dirname(source), '.review', 'notes.json'), damaged)
    const oldBackup = join(userData, 'note-backups', hash(source), 'notes.json')
    await fs.mkdir(dirname(oldBackup), { recursive: true })
    const saved = note('old-backup')
    const backupRaw = JSON.stringify({ version: 1, notes: [saved] })
    await fs.writeFile(oldBackup, backupRaw)
    expect(await store().load(source)).toMatchObject({ notes: [saved], notesMissing: false })
    expect(await fs.readFile(join(dirname(source), '.review', 'notes.json'), 'utf8')).toBe(damaged)
    expect(await fs.readFile(oldBackup, 'utf8')).toBe(backupRaw)
  })

  it('reports corrupt legacy data without silently replacing it with an empty migration', async () => {
    const source = await article('article.md')
    await seedLegacy(source, [])
    const legacy = join(dirname(source), '.review', 'notes.json')
    const damaged = '{"notes":['
    await fs.writeFile(legacy, damaged)
    const reviews = store()
    expect(await reviews.load(source)).toMatchObject({ reviewIssue: 'legacy-corrupt' })
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow()
    expect(await fs.readFile(legacy, 'utf8')).toBe(damaged)
    expect(await fs.stat(primary(source)).catch(() => null)).toBeNull()
    expect(await fs.stat(await reviews.legacyFile(source)).catch(() => null)).toBeNull()
  })

  it('does not migrate empty data when the missing legacy primary has a damaged old backup', async () => {
    const source = await article('article.md')
    const oldBackup = join(userData, 'note-backups', hash(source), 'notes.json')
    await fs.mkdir(dirname(oldBackup), { recursive: true })
    const damaged = '{"version":1,"notes":['
    await fs.writeFile(oldBackup, damaged)
    const reviews = store()
    expect(await reviews.load(source)).toMatchObject({ reviewIssue: 'legacy-corrupt' })
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow()
    await expect(reviews.saveWord(source, word('new-word'))).rejects.toThrow()
    expect(await fs.readFile(oldBackup, 'utf8')).toBe(damaged)
    expect(await fs.stat(primary(source)).catch(() => null)).toBeNull()
    expect(await fs.stat(backup(source)).catch(() => null)).toBeNull()
    expect(await fs.stat(await reviews.legacyFile(source)).catch(() => null)).toBeNull()
  })
})

describe('review store corruption and recovery', () => {
  it('keeps valid document data visible when the migration manifest is damaged', async () => {
    const source = await article('article.md')
    const reviews = store()
    const saved = note('saved')
    await reviews.saveNote(source, saved)
    const file = await reviews.legacyFile(source)
    await fs.writeFile(file, '{ damaged manifest')
    expect(await reviews.load(source)).toMatchObject({ notes: [saved], reviewIssue: 'legacy-corrupt', notesMissing: false })
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow('REVIEW_LEGACY_CORRUPT')
    expect(JSON.parse(await fs.readFile(primary(source), 'utf8')).notes).toEqual([saved])
    expect(await fs.readFile(file, 'utf8')).toBe('{ damaged manifest')
  })

  it('rejects a redirected backup directory while preserving valid primary data', async () => {
    const source = await article('article.md')
    const reviews = store()
    const saved = note('saved')
    await reviews.saveNote(source, saved)
    const outside = join(fixture, 'outside-backups')
    await fs.rename(dirname(backup(source)), outside)
    await fs.symlink(outside, dirname(backup(source)), 'dir')
    const original = await fs.readFile(join(outside, basename(backup(source))), 'utf8')
    expect(await reviews.load(source)).toMatchObject({ notes: [saved], reviewIssue: 'backup-unavailable' })
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow('REVIEW_STORAGE_UNAVAILABLE')
    expect(await fs.readFile(join(outside, basename(backup(source))), 'utf8')).toBe(original)
    expect(JSON.parse(await fs.readFile(primary(source), 'utf8')).notes).toEqual([saved])
  })

  it('keeps the valid backup intact, reports corruption, and blocks all writes until explicit restore', async () => {
    const source = await article('article.md')
    const saved = note('saved')
    const learned = word('saved-word')
    const reviews = store()
    await reviews.saveNote(source, saved)
    await reviews.saveWord(source, learned)
    const backupRaw = await fs.readFile(backup(source), 'utf8')
    const damaged = '{"version":2,"notes":['
    await fs.writeFile(primary(source), damaged)
    expect(await reviews.load(source)).toMatchObject({ notes: [saved], words: [learned], reviewIssue: 'corrupt', notesMissing: true })
    const attempts = [
      () => reviews.saveNote(source, note('new')),
      () => reviews.editNote(source, saved.id, 'New comment'),
      () => reviews.setNoteStatus(source, saved.id, 'resolved'),
      () => reviews.deleteNote(source, saved.id),
      () => reviews.saveWord(source, word('new-word')),
      () => reviews.deleteWord(source, learned.id)
    ]
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow('REVIEW_RECOVERY_REQUIRED')
    expect(await fs.readFile(primary(source), 'utf8')).toBe(damaged)
    expect(await fs.readFile(backup(source), 'utf8')).toBe(backupRaw)

    expect(await reviews.restore(source)).toMatchObject({ notes: [saved], words: [learned], notesMissing: false })
    const copies = (await fs.readdir(dirname(primary(source)))).filter((name) => name.startsWith(`${basename(primary(source))}.corrupt-`))
    expect(copies).toHaveLength(1)
    expect(await fs.readFile(join(dirname(primary(source)), copies[0]), 'utf8')).toBe(damaged)
    expect(JSON.parse(await fs.readFile(primary(source), 'utf8'))).toEqual(snapshot(source, [saved], [learned]))
    expect((await reviews.load(source)).reviewIssue).toBeUndefined()
    expect((await reviews.saveNote(source, note('new'))).notes.map((record) => record.id)).toEqual(['saved', 'new'])
  })

  it('recognizes a valid empty backup and restores it rather than treating it as absent', async () => {
    const source = await article('article.md')
    const reviews = store()
    await reviews.load(source)
    const backupRaw = await fs.readFile(backup(source), 'utf8')
    await fs.writeFile(primary(source), 'not json')
    expect(await reviews.load(source)).toMatchObject({ notes: [], words: [], notesMissing: true, reviewIssue: 'corrupt' })
    expect(await fs.readFile(backup(source), 'utf8')).toBe(backupRaw)
    expect(await reviews.restore(source)).toMatchObject({ notes: [], words: [], notesMissing: false })
    expect(JSON.parse(await fs.readFile(primary(source), 'utf8'))).toEqual(snapshot(source, []))
  })

  it('uses the saved backup for a missing primary but requires explicit restoration before mutations', async () => {
    const source = await article('article.md')
    const saved = note('saved')
    const reviews = store()
    await reviews.saveNote(source, saved)
    await fs.unlink(primary(source))
    expect(await reviews.load(source)).toMatchObject({ notes: [saved], notesMissing: true, reviewIssue: 'missing' })
    await expect(reviews.deleteNote(source, saved.id)).rejects.toThrow('REVIEW_RECOVERY_REQUIRED')
    expect(await fs.stat(primary(source)).catch(() => null)).toBeNull()
    expect(await reviews.restore(source)).toMatchObject({ notes: [saved], notesMissing: false })
  })

  it('does not let a stale restore click overwrite a newer valid document', async () => {
    const source = await article('article.md')
    const oldNote = note('old')
    const newNote = note('new')
    const reviews = store()
    await reviews.saveNote(source, oldNote)
    await fs.unlink(primary(source))
    expect((await reviews.load(source)).reviewIssue).toBe('missing')
    const newerRaw = JSON.stringify(snapshot(source, [oldNote, newNote]))
    await fs.writeFile(primary(source), newerRaw)
    expect(await reviews.restore(source)).toMatchObject({ notes: [oldNote, newNote], notesMissing: false })
    expect(await fs.readFile(primary(source), 'utf8')).toBe(newerRaw)
  })

  it('rejects a structurally invalid snapshot without refreshing its valid backup', async () => {
    const source = await article('article.md')
    const saved = note('saved')
    const reviews = store()
    await reviews.saveNote(source, saved)
    const backupRaw = await fs.readFile(backup(source), 'utf8')
    const invalid = JSON.stringify({ version: 2, document: 'article.md', notes: [{ id: 'bad' }], words: [] })
    await fs.writeFile(primary(source), invalid)
    expect(await reviews.load(source)).toMatchObject({ notes: [saved], reviewIssue: 'corrupt' })
    expect(await fs.readFile(backup(source), 'utf8')).toBe(backupRaw)
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow('REVIEW_RECOVERY_REQUIRED')
    expect(await fs.readFile(primary(source), 'utf8')).toBe(invalid)
  })

  it.each(['broken JSON', 'unsupported version'])('preserves a %s backup when the primary is missing', async (kind) => {
    const source = await article('article.md')
    const damaged = kind === 'broken JSON' ? '{"version":2,"notes":['
      : JSON.stringify({ ...snapshot(source, [note('future-record')]), version: 99 })
    await fs.mkdir(dirname(backup(source)), { recursive: true })
    await fs.writeFile(backup(source), damaged)
    const reviews = store()
    expect(await reviews.load(source)).toMatchObject({ reviewIssue: 'corrupt', notesMissing: false })
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow('REVIEW_NO_BACKUP')
    await expect(reviews.saveWord(source, word('new-word'))).rejects.toThrow('REVIEW_NO_BACKUP')
    await expect(reviews.restore(source)).rejects.toThrow('REVIEW_NO_BACKUP')
    expect(await fs.readFile(backup(source), 'utf8')).toBe(damaged)
    expect(await fs.stat(primary(source)).catch(() => null)).toBeNull()
    expect(await fs.stat(await reviews.legacyFile(source)).catch(() => null)).toBeNull()
  })
})

describe('review store path protection', () => {
  it('rejects a redirected .review directory without reading or changing the outside files', async () => {
    const source = await article('article.md')
    const outside = join(fixture, 'outside')
    await fs.mkdir(outside)
    const sentinel = JSON.stringify({ version: 1, notes: [note('outside')] })
    await fs.writeFile(join(outside, 'notes.json'), sentinel)
    await fs.symlink(outside, join(library, '.review'), 'dir')
    const reviews = store()
    expect(await reviews.load(source)).toMatchObject({ notes: [], words: [], reviewIssue: 'unsafe' })
    await expect(reviews.saveNote(source, note('new'))).rejects.toThrow('REVIEW_PATH_UNSAFE')
    await expect(reviews.saveWord(source, word('new'))).rejects.toThrow('REVIEW_PATH_UNSAFE')
    await expect(reviews.restore(source)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    await expect(reviews.legacyFile(source)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(await fs.readFile(join(outside, 'notes.json'), 'utf8')).toBe(sentinel)
    expect(await fs.readdir(outside)).toEqual(['notes.json'])
  })

  it('uses the canonical article path for a root alias and shares the same backup', async () => {
    const source = await article('article.md')
    const alias = join(fixture, 'alias')
    await fs.symlink(library, alias, 'dir')
    const reviews = store()
    const saved = note('canonical')
    await reviews.saveNote(join(alias, 'article.md'), saved)
    expect((await reviews.load(source)).notes).toEqual([saved])
    expect(JSON.parse(await fs.readFile(backup(source), 'utf8'))).toEqual(snapshot(source, [saved]))
    expect(await fs.readdir(join(userData, 'review-backups'))).toEqual([`${hash(source)}.json`])
  })
})
