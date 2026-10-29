import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { LibraryEntry } from '../shared/types'
import type { ArticleChangeSummary, DocumentChangeState, DocumentContent } from '../shared/document-changes'

type Baseline = { version: 1; documentId: string; content: DocumentContent; revision: string; confirmedAt: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const documentRevision = (content: DocumentContent) => digest(JSON.stringify([content.sourceText, content.zhText]))
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const fail = (code = 'DOCUMENT_CHANGES_UNAVAILABLE'): never => { throw new Error(code) }
const identity = (info: { dev: bigint; ino: bigint }) => `${info.dev}:${info.ino}`

/** Change records stay inside the library, independent of an article's pathname.
 * A failed/corrupt read is never replaced by a new baseline. */
export function createDocumentChangeStore() {
  let tail: Promise<unknown> = Promise.resolve()
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.catch(() => undefined).then(task); tail = next; return next
  }
  function recordPath(root: string, id: string) {
    if (!id || typeof id !== 'string') return fail()
    return join(root, '.mdduck', 'change-baselines', `${digest(id)}.json`)
  }
  async function safe(root: string, path: string) {
    if (!isAbsolute(root) || !isAbsolute(path)) return fail()
    const suffix = relative(root, path)
    if (!suffix || isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) return fail()
    const rootInfo = await fs.lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return fail()
    let current = root
    const parts = suffix.split(sep)
    for (const [index, part] of parts.entries()) {
      current = join(current, part)
      const info = await fs.lstat(current).catch(error => { if (missing(error)) return null; throw error })
      if (info?.isSymbolicLink() || info && index < parts.length - 1 && !info.isDirectory()) return fail()
    }
  }
  async function read(root: string, path: string): Promise<string | null> {
    await safe(root, path)
    try {
      const before = await fs.lstat(path, { bigint: true })
      if (!before.isFile() || before.isSymbolicLink()) return fail()
      const file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = await file.stat({ bigint: true })
        if (identity(opened) !== identity(before) || !opened.isFile()) return fail()
        await safe(root, path)
        const text = await file.readFile('utf8')
        const after = await fs.lstat(path, { bigint: true })
        if (after.isSymbolicLink() || identity(after) !== identity(opened) || after.mtimeNs !== before.mtimeNs || after.size !== before.size) return fail('ERR_DOCUMENT_CHANGED')
        return text
      } finally { await file.close() }
    } catch (error) { if (missing(error)) return null; throw error }
  }
  async function write(root: string, path: string, value: Baseline, createOnly = false) {
    await safe(root, path)
    await fs.mkdir(dirname(path), { recursive: true })
    await safe(root, path)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const file = await fs.open(temporary, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
      await safe(root, path)
      if (createOnly) {
        // Do not replace a record written by another instance after our read.
        await fs.link(temporary, path)
      } else await fs.rename(temporary, path)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  async function current(root: string, entry: LibraryEntry): Promise<DocumentContent> {
    const sourceText = await read(root, entry.path)
    if (sourceText === null) return fail('ERR_DOCUMENT_CHANGED')
    const zhText = entry.zhPath && entry.zhPath !== entry.path ? await read(root, entry.zhPath) : null
    return { sourceText, zhText }
  }
  async function load(root: string, entry: LibraryEntry): Promise<Baseline | null> {
    const text = await read(root, recordPath(root, entry.id!))
    if (text === null) return null
    let value: Baseline
    try { value = JSON.parse(text) } catch { return fail() }
    if (value?.version !== 1 || value.documentId !== entry.id || typeof value.content?.sourceText !== 'string' || value.content.zhText !== null && typeof value.content.zhText !== 'string' || typeof value.confirmedAt !== 'string' || !Number.isFinite(Date.parse(value.confirmedAt)) || value.revision !== documentRevision(value.content)) return fail()
    return value
  }
  function state(entry: LibraryEntry, baseline: Baseline, content: DocumentContent): DocumentChangeState {
    const revision = documentRevision(content)
    return { documentId: entry.id!, revision, baseline: baseline.content, current: content, changed: revision !== baseline.revision, baselineAt: baseline.confirmedAt }
  }
  async function inspect(root: string, entry: LibraryEntry) {
    const baseline = await load(root, entry)
    if (!baseline) return fail()
    return state(entry, baseline, await current(root, entry))
  }
  async function summary(root: string, entry: LibraryEntry): Promise<ArticleChangeSummary> {
    try {
      let baseline = await load(root, entry)
      const content = await current(root, entry)
      if (!baseline) {
        baseline = { version: 1, documentId: entry.id!, content, revision: documentRevision(content), confirmedAt: new Date().toISOString() }
        try { await write(root, recordPath(root, entry.id!), baseline, true) } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
          baseline = await load(root, entry)
          if (!baseline) return fail()
        }
      }
      const source = content.sourceText !== baseline.content.sourceText
      const translation = content.zhText !== baseline.content.zhText
      return { changed: source || translation, source, translation }
    } catch {
      // An unavailable comparison must not prevent opening and reading files.
      return { changed: false, source: false, translation: false, issue: 'DOCUMENT_CHANGES_UNAVAILABLE' }
    }
  }
  return {
    inspect: (root: string, entry: LibraryEntry) => exclusive(() => inspect(resolve(root), entry)),
    summarize: (root: string, entries: LibraryEntry[]) => exclusive(async () => {
      const result: LibraryEntry[] = []
      for (const entry of entries) result.push({ ...entry, changes: await summary(resolve(root), entry) })
      return result
    }),
    acknowledge: (root: string, entry: LibraryEntry, revision: string) => exclusive(async () => {
      const base = resolve(root)
      // A corrupt/missing record is not permission to silently reset history.
      const old = await load(base, entry)
      if (!old) return fail()
      const content = await current(base, entry)
      if (typeof revision !== 'string' || revision !== documentRevision(content)) return fail('ERR_DOCUMENT_CHANGED')
      const baseline: Baseline = { version: 1, documentId: entry.id!, content, revision, confirmedAt: new Date().toISOString() }
      await write(base, recordPath(base, entry.id!), baseline)
      // If an external writer changed files during the metadata write, only the
      // version just acknowledged is the baseline; the newer version stays pending.
      return state(entry, baseline, await current(base, entry))
    })
  }
}
