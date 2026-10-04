import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { LearnedWord, Note, NotesResult, ReviewCandidate, ReviewIssue } from '../shared/types'
import { editNoteComment } from '../shared/note-edits'
import { normalizeQuoteText, validQuoteAnchor } from '../shared/quote-anchor'
import { parseDocument } from '../shared/markdown'
import { assertReviewPath, assertReviewSource, readReviewFile, writeReviewFile } from './review-files'
import { withFileTransaction } from './file-transaction'
import { planLegacyReviewMigration } from './review-migration'

type Data = { notes: Note[]; words: LearnedWord[] }
type Snapshot = Data & { version: 2; document: string }
type Migration = ReturnType<typeof planLegacyReviewMigration> & { version: 1 }
type Candidate = { name: string; sourceText: string; zhText?: string | null }
type Loaded = NotesResult & { words: LearnedWord[] }
type Options = {
  isAllowed: (path: string) => Promise<boolean>
  userData: string
  candidates: (source: string) => Promise<Candidate[]>
}
const empty = (): Data => ({ notes: [], words: [] })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const nullableString = (value: unknown) => value === null || typeof value === 'string'
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === 'string')

function validNote(value: unknown): value is Note {
  return object(value) && strings(value, ['id', 'quote', 'comment', 'createdAt']) && !!value.id &&
    nullableString(value.blockId) && nullableString(value.blockKey) &&
    ['source', 'zh'].includes(value.quoteLang as string) &&
    ['open', 'outdated', 'orphaned', 'resolved'].includes(value.status as string) &&
    (value.orphanReason === undefined || typeof value.orphanReason === 'string') &&
    (value.quoteAnchor === undefined || validQuoteAnchor(value.quoteAnchor))
}
function validWord(value: unknown): value is LearnedWord {
  if (!object(value) || !strings(value, ['id', 'word', 'key', 'sentence', 'meaning', 'createdAt']) || !value.id || !nullableString(value.blockId)) return false
  const e = value.explanation
  return e === undefined || object(e) && strings(e, ['lemma', 'partOfSpeech', 'meaning']) &&
    ['formNote', 'usage', 'memoryHint', 'confusion'].every((key) => e[key] === undefined || typeof e[key] === 'string') &&
    (e.example === undefined || object(e.example) && strings(e.example, ['en', 'zh']))
}
function validData(value: unknown): value is Data {
  return object(value) && Array.isArray(value.notes) && value.notes.every(validNote) && Array.isArray(value.words) && value.words.every(validWord)
}
function parse(raw: string): unknown { try { return JSON.parse(raw) } catch { return null } }
function snapshot(raw: string | null, source: string): Snapshot | null {
  if (raw === null) return null
  const value = parse(raw)
  return validData(value) && 'version' in value && value.version === 2 && 'document' in value && value.document === basename(source) ? value as Snapshot : null
}
function legacyArray<T>(raw: string | null, key: string, valid: (item: unknown) => item is T): T[] | null {
  if (raw === null) return []
  const value = parse(raw)
  return object(value) && Array.isArray(value[key]) && value[key].every(valid) ? value[key] : null
}

export function createReviewStore(options: Options) {
  const { isAllowed, userData } = options
  const primary = (source: string) => join(dirname(source), '.review', 'documents', `${hash(basename(source))}.json`)
  const backup = (source: string) => join(userData, 'review-backups', `${hash(source)}.json`)
  const migrationPath = (source: string) => join(dirname(source), '.review', 'migration-v1.json')

  // Backup directories are private to the app; still reject redirected descendants.
  async function checkBackup(path: string) {
    const rel = relative(userData, path)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('REVIEW_PATH_UNSAFE')
    let part = userData
    const components = rel.split(sep)
    for (const [index, component] of components.entries()) {
      part = join(part, component)
      const stat = await fs.lstat(part).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (stat?.isSymbolicLink()) throw new Error('REVIEW_PATH_UNSAFE')
      if (stat && (index === components.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('REVIEW_PATH_UNSAFE')
    }
  }
  async function readBackupFile(path: string) {
    await checkBackup(path)
    return fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW).then(async (handle) => {
      try { return await handle.readFile('utf8') } finally { await handle.close() }
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
  }
  async function saveBackup(source: string, content: string) {
    const path = backup(source)
    await checkBackup(path)
    await fs.mkdir(dirname(path), { recursive: true })
    await checkBackup(path)
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
      await checkBackup(path)
      await fs.rename(temp, path)
    } finally { await fs.unlink(temp).catch(() => {}) }
  }
  async function transaction<T>(path: string, run: (source: string) => Promise<T>): Promise<T> {
    const source = await assertReviewSource(path, isAllowed)
    const resource = join(dirname(source), '.review', 'review-transaction')
    await assertReviewPath(source, resource, isAllowed)
    await fs.mkdir(dirname(resource), { recursive: true })
    await assertReviewPath(source, resource, isAllowed)
    return withFileTransaction(resource, async () => {
      await assertReviewPath(source, resource, isAllowed)
      return run(source)
    })
  }

  async function migration(source: string): Promise<Migration> {
    const file = migrationPath(source)
    const raw = await readReviewFile(source, file, isAllowed)
    if (raw !== null) {
      const value = parse(raw)
      if (!object(value) || value.version !== 1 || !object(value.documents) || !Object.values(value.documents).every(validData) || !validData(value.unassigned)) throw new Error('REVIEW_LEGACY_CORRUPT')
      return value as Migration
    }
    const dir = dirname(source)
    const notesRaw = await readReviewFile(source, join(dir, '.review', 'notes.json'), isAllowed)
    const wordsRaw = await readReviewFile(source, join(dir, '.review', 'words.json'), isAllowed)
    let notes = legacyArray(notesRaw, 'notes', validNote)
    const words = legacyArray(wordsRaw, 'words', validWord)
    const conflicts: Note[] = []
    const candidates = await options.candidates(source)
    if (!candidates.some((candidate) => candidate.name === basename(source))) throw new Error('REVIEW_LEGACY_CORRUPT')
    if (notesRaw === null || notes === null) {
      // Old backups were keyed by document path. Gather them once, then resolve
      // ownership from article content, never from the old shared-file order.
      const recovered = new Map<string, Note[]>()
      let foundBackup = false
      for (const candidate of candidates) {
        const old = await readBackupFile(join(userData, 'note-backups', hash(join(dir, candidate.name)), 'notes.json'))
        const records = legacyArray(old, 'notes', validNote)
        if (old !== null && records === null) throw new Error('REVIEW_LEGACY_CORRUPT')
        if (old !== null && records !== null) {
          foundBackup = true
          for (const record of records) {
            const versions = recovered.get(record.id) ?? []
            if (!versions.some((version) => JSON.stringify(version) === JSON.stringify(record))) versions.push(record)
            recovered.set(record.id, versions)
          }
        }
      }
      if (notes === null && !foundBackup) throw new Error('REVIEW_LEGACY_CORRUPT')
      notes = []
      for (const versions of recovered.values()) {
        if (versions.length === 1) notes.push(versions[0])
        else conflicts.push(...versions)
      }
    }
    if (words === null) throw new Error('REVIEW_LEGACY_CORRUPT')
    const result: Migration = { version: 1, ...planLegacyReviewMigration(candidates, notes ?? [], words) }
    result.unassigned.notes.push(...conflicts)
    await writeReviewFile(source, file, JSON.stringify(result, null, 2), isAllowed)
    return result
  }
  async function read(source: string): Promise<Loaded> {
    const raw = await readReviewFile(source, primary(source), isAllowed)
    if (raw !== null) {
      const value = snapshot(raw, source)
      if (!value) return recovery(source, 'corrupt')
      // Only validated primary data is allowed to refresh the last good backup.
      try { await saveBackup(source, raw) } catch {
        return { ...value, notesMissing: false, reviewIssue: 'backup-unavailable' }
      }
      return { ...value, notesMissing: false, ...await migrationStatus(source) }
    }
    const backupRaw = await readBackupFile(backup(source))
    const saved = snapshot(backupRaw, source)
    if (saved) return { ...saved, notesMissing: true, ...await migrationStatus(source), reviewIssue: 'missing' }
    if (backupRaw !== null) return { ...empty(), notesMissing: false, reviewIssue: 'corrupt' }
    const planned = await migration(source)
    const data = Object.hasOwn(planned.documents, basename(source)) ? planned.documents[basename(source)] : empty()
    await write(source, data)
    return { ...data, notesMissing: false, legacyUnassigned: planned.unassigned.notes.length + planned.unassigned.words.length }
  }
  async function unassignedCount(source: string) {
    const raw = await readReviewFile(source, migrationPath(source), isAllowed)
    if (raw === null) return 0
    const plan = await migration(source)
    return plan.unassigned.notes.length + plan.unassigned.words.length
  }
  async function migrationStatus(source: string): Promise<Pick<Loaded, 'legacyUnassigned' | 'reviewIssue'>> {
    try { return { legacyUnassigned: await unassignedCount(source) } } catch (error) {
      // A damaged migration manifest must not hide an already valid document.
      return { reviewIssue: error instanceof Error && error.message === 'REVIEW_PATH_UNSAFE' ? 'unsafe' : 'legacy-corrupt' }
    }
  }
  async function recovery(source: string, issue: ReviewIssue): Promise<Loaded> {
    const saved = snapshot(await readBackupFile(backup(source)), source)
    return { ...(saved ?? empty()), notesMissing: !!saved, reviewIssue: issue }
  }
  async function write(source: string, data: Data) {
    if (!validData(data)) throw new Error('REVIEW_INVALID_DATA')
    const value: Snapshot = { version: 2, document: basename(source), notes: data.notes, words: data.words }
    const content = JSON.stringify(value, null, 2)
    // Preflight backup destinations before committing the primary document.
    await checkBackup(backup(source))
    await saveBackup(source, content)
    await writeReviewFile(source, primary(source), content, isAllowed)
  }
  async function mutate(path: string, change: (data: Data) => Data): Promise<Loaded> {
    return transaction(path, async (source) => {
      const current = await read(source)
      if (current.reviewIssue) {
        const code = current.reviewIssue === 'unsafe' ? 'REVIEW_PATH_UNSAFE'
          : current.reviewIssue === 'legacy-corrupt' ? 'REVIEW_LEGACY_CORRUPT'
          : current.reviewIssue === 'backup-unavailable' || current.reviewIssue === 'unreadable' ? 'REVIEW_STORAGE_UNAVAILABLE'
          : current.notesMissing ? 'REVIEW_RECOVERY_REQUIRED' : 'REVIEW_NO_BACKUP'
        throw new Error(code)
      }
      const next = change(current)
      await write(source, next)
      return { ...next, notesMissing: false, legacyUnassigned: current.legacyUnassigned }
    })
  }

  async function candidateSnapshot(source: string, fileName: string) {
    if (!/^[a-f0-9]{64}\.json$/.test(fileName)) return null
    const raw = await readReviewFile(source, join(dirname(primary(source)), fileName), isAllowed)
    if (raw === null) return null
    const value = parse(raw)
    if (!validData(value) || !('version' in value) || value.version !== 2 || !('document' in value) || typeof value.document !== 'string' ||
        !/\.(md|markdown)$/i.test(value.document) || /[\\/]/.test(value.document) ||
        fileName !== `${hash(value.document)}.json` || value.document === basename(source) ||
        (!value.notes.length && !value.words.length)) return null
    // Only an absent source qualifies. A present file, directory, or symlink still owns its data.
    const oldPath = join(dirname(source), value.document)
    const old = await fs.lstat(oldPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (old) return null
    return { data: value as Snapshot, id: `${fileName.slice(0, -5)}:${hash(raw)}` }
  }

  async function listCandidates(path: string): Promise<ReviewCandidate[]> {
    return transaction(path, async (source) => {
      const current = await read(source)
      if (current.reviewIssue || current.notesMissing || current.notes.length || current.words.length) return []
      const directory = dirname(primary(source))
      // Validate the directory before enumerating; redirected .review children are never read.
      await assertReviewPath(source, join(directory, '.inventory'), isAllowed)
      const files = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const candidates: ReviewCandidate[] = []
      const sourceBlocks = parseDocument(await fs.readFile(source, 'utf8'), '').blocks.filter((block) => block.kind !== 'heading')
      let zhBlocks: ReturnType<typeof parseDocument>['blocks'] | null = null
      let inspectedTranslation = false
      for (const file of files) {
        const candidate = await candidateSnapshot(source, file)
        if (!candidate) continue
        if (!inspectedTranslation && candidate.data.notes.some((note) => note.quoteLang === 'zh')) {
          inspectedTranslation = true
          const article = (await options.candidates(source)).find((entry) => entry.name === basename(source))
          zhBlocks = article?.zhText ? parseDocument(article.zhText, '').blocks.filter((block) => block.kind !== 'heading') : []
        }
        const hasNoteContext = candidate.data.notes.some((note) => {
          const quote = normalizeQuoteText(note.quote)
          if (!quote) return false
          const texts = (note.quoteLang === 'zh' ? zhBlocks ?? [] : sourceBlocks).map((block) => normalizeQuoteText(block.text))
          // A saved word alone is too common to justify a banner on unrelated articles.
          if (quote.replace(/\s/g, '').length >= 20 && texts.some((text) => text.includes(quote))) return true
          const anchor = note.quoteAnchor
          if (!anchor || (anchor.prefix + anchor.suffix).replace(/\s/g, '').length < 12) return false
          return texts.some((text) => {
            let from = 0
            while (from <= text.length - quote.length) {
              const start = text.indexOf(quote, from)
              if (start < 0) return false
              const end = start + quote.length
              if (text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix &&
                  text.slice(end, end + anchor.suffix.length) === anchor.suffix) return true
              from = start + 1
            }
            return false
          })
        })
        const hasWordContext = candidate.data.words.some((word) => {
          const sentence = normalizeQuoteText(word.sentence)
          return sentence.replace(/\s/g, '').length >= 32 && sourceBlocks.some((block) => normalizeQuoteText(block.text).includes(sentence))
        })
        if (!hasNoteContext && !hasWordContext) continue
        candidates.push({ id: candidate.id, document: candidate.data.document,
          noteCount: candidate.data.notes.length, wordCount: candidate.data.words.length,
          quotes: candidate.data.notes.slice(0, 3).map((note) => note.quote.slice(0, 240)) })
      }
      return candidates.sort((a, b) => a.document.localeCompare(b.document))
    })
  }

  async function associate(path: string, candidateId: string): Promise<Loaded> {
    return transaction(path, async (source) => {
      if (typeof candidateId !== 'string' || !/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(candidateId)) throw new Error('REVIEW_CANDIDATE_INVALID')
      const current = await read(source)
      if (current.reviewIssue || current.notesMissing) throw new Error('REVIEW_RECOVERY_REQUIRED')
      if (current.notes.length || current.words.length) throw new Error('REVIEW_TARGET_NOT_EMPTY')
      const candidate = await candidateSnapshot(source, `${candidateId.split(':')[0]}.json`)
      if (!candidate || candidate.id !== candidateId) throw new Error('REVIEW_CANDIDATE_CHANGED')
      // Explicitly copy, preserving the original snapshot and its private backup for recovery.
      await write(source, candidate.data)
      return { notes: candidate.data.notes, words: candidate.data.words, notesMissing: false,
        legacyUnassigned: current.legacyUnassigned }
    })
  }
  return {
    async load(path: string): Promise<Loaded> {
      try { return await transaction(path, read) } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const reviewIssue: ReviewIssue = message === 'REVIEW_PATH_UNSAFE' ? 'unsafe' : message === 'REVIEW_LEGACY_CORRUPT' ? 'legacy-corrupt' : 'unreadable'
        return { ...empty(), notesMissing: false, reviewIssue }
      }
    },
    listCandidates,
    associate,
    saveNote: (path: string, note: Note) => mutate(path, (data) => ({ ...data, notes: [...data.notes.filter((n) => n.id !== note.id), note] })),
    editNote: (path: string, id: string, comment: string) => mutate(path, (data) => ({ ...data, notes: editNoteComment(data.notes, id, comment) })),
    setNoteStatus: (path: string, id: string, status: Note['status']) => mutate(path, (data) => ({ ...data, notes: data.notes.map((n) => n.id === id ? { ...n, status, orphanReason: undefined } : n) })),
    deleteNote: (path: string, id: string) => mutate(path, (data) => ({ ...data, notes: data.notes.filter((n) => n.id !== id) })),
    saveWord: async (path: string, word: LearnedWord) => (await mutate(path, (data) => ({ ...data, words: [word, ...data.words.filter((w) => w.key !== word.key)] }))).words,
    deleteWord: async (path: string, id: string) => (await mutate(path, (data) => ({ ...data, words: data.words.filter((w) => w.id !== id) }))).words,
    restore: (path: string) => transaction(path, async (source): Promise<Loaded> => {
      const raw = await readReviewFile(source, primary(source), isAllowed)
      // A stale restore click must never overwrite newer, valid edits.
      const current = snapshot(raw, source)
      if (current) return { ...current, notesMissing: false, ...await migrationStatus(source) }
      const saved = snapshot(await readBackupFile(backup(source)), source)
      if (!saved) throw new Error('REVIEW_NO_BACKUP')
      if (raw !== null) await writeReviewFile(source, `${primary(source)}.corrupt-${randomUUID()}`, raw, isAllowed)
      await write(source, saved)
      return { ...saved, notesMissing: false, ...await migrationStatus(source) }
    }),
    // Kept in a separate file so ambiguous legacy data remains discoverable.
    legacyFile: async (path: string) => {
      const source = await assertReviewSource(path, isAllowed)
      const file = migrationPath(source)
      await assertReviewPath(source, file, isAllowed)
      return file
    }
  }
}
