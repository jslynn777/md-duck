import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import type { LibraryEntry } from '../shared/types'
import type { ArticleStage, LibraryChange, LibraryCommand, LibraryFolder, LibraryRelocation } from '../shared/library'

export const ARCHIVE_DIRECTORY = 'Archive'
const stages: ArticleStage[] = ['unmarked', 'writing', 'review', 'done']
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const portable = (value: string) => value.split(sep).join('/')
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
function fail(message: string): never { throw new Error(message) }
type Item = { id: string; path: string; identity: string; digest: string; translation: string | null; translationIdentity?: string; stage: ArticleStage; order: number; aliases?: string[]; ownedPaths?: string[] }
type Manifest = { version: 1; items: Item[]; archived: Record<string, string>; lastRoot?: string; rootAliases?: string[] }
type Move = { from: string; to: string; identity: string }
type Write = { path: string; before: string | null; after: string }
type Journal = { version: 1; moves: Move[]; writes: Write[]; created: string[]; removed?: string[] }
type Options = { userData: string; listEntries: (root: string) => Promise<LibraryEntry[]>; isBusy?: () => boolean }
const empty = (): Manifest => ({ version: 1, items: [], archived: {} })
const identity = (stat: { dev: bigint; ino: bigint }) => `${stat.dev}:${stat.ino}`
const under = (root: string, path: string) => { const suffix = relative(root, path); return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix) }
const relPath = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('\0') && !isAbsolute(value) && !win32.isAbsolute(value) && !/^[a-z]:/i.test(value) && !value.split(/[\\/]/).some((part) => part === '..')
function validName(value: string) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 160 && !/[<>:"/\\|?*\x00-\x1f]/.test(value) && !/[. ]$/.test(value) && !value.startsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) && !['node_modules', '$RECYCLE.BIN', 'System Volume Information'].includes(value)
}
async function stat(path: string) { try { return await fs.lstat(path, { bigint: true }) } catch (error) { if (missing(error)) return null; throw error } }
async function checked(root: string, path: string, includeRoot = true) {
  if (!under(root, path) || path.includes('\0')) fail('LIBRARY_PATH_UNSAFE')
  const parts = relative(root, path).split(sep).filter(Boolean)
  let current = root
  const rootStat = await stat(root)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) fail('LIBRARY_PATH_UNSAFE')
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const value = await stat(current)
    if (value?.isSymbolicLink() || value && index < parts.length - 1 && !value.isDirectory()) fail('LIBRARY_PATH_UNSAFE')
  }
  if (!includeRoot && path === root) fail('LIBRARY_ROOT_IMMOVABLE')
}
async function bytes(root: string, path: string): Promise<Buffer | null> {
  await checked(root, path)
  const before = await stat(path)
  if (!before) return null
  if (!before.isFile()) fail('LIBRARY_PATH_UNSAFE')
  const file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await file.stat({ bigint: true })
    await checked(root, path)
    const after = await stat(path)
    if (!after || identity(before) !== identity(opened) || identity(after) !== identity(opened) || !after.isFile()) fail('LIBRARY_PATH_UNSAFE')
    return await file.readFile()
  } finally { await file.close() }
}
async function atomic(root: string, path: string, data: Buffer) {
  await checked(root, path)
  await fs.mkdir(dirname(path), { recursive: true })
  await checked(root, path)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await fs.open(temporary, 'wx', 0o600)
    try { await file.writeFile(data); await file.sync() } finally { await file.close() }
    await checked(root, path)
    await fs.rename(temporary, path)
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}
function decode(raw: Buffer, code: string): Record<string, any> {
  try { const parsed = JSON.parse(raw.toString('utf8')); if (record(parsed)) return parsed } catch { /* Preserve damaged input. */ }
  return fail(code)
}
function validateManifest(raw: Buffer): Manifest {
  const value = decode(raw, 'LIBRARY_METADATA_CORRUPT')
  if (value.version !== 1 || !Array.isArray(value.items) || !record(value.archived) || !Object.entries(value.archived).every(([from, to]) => relPath(from) && relPath(to))) fail('LIBRARY_METADATA_CORRUPT')
  if (value.lastRoot !== undefined && typeof value.lastRoot !== 'string' || value.rootAliases !== undefined && (!Array.isArray(value.rootAliases) || value.rootAliases.length > 4 || !value.rootAliases.every((path: unknown) => typeof path === 'string'))) fail('LIBRARY_METADATA_CORRUPT')
  const ids = new Set<string>(), paths = new Set<string>()
  for (const item of value.items) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !relPath(item.path) || paths.has(item.path) || typeof item.identity !== 'string' || typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest) || item.translation !== null && !relPath(item.translation) || item.translationIdentity !== undefined && typeof item.translationIdentity !== 'string' || !stages.includes(item.stage) || !Number.isFinite(item.order) || item.aliases !== undefined && (!Array.isArray(item.aliases) || item.aliases.length > 16 || !item.aliases.every(relPath)) || item.ownedPaths !== undefined && (!Array.isArray(item.ownedPaths) || !item.ownedPaths.every(relPath))) fail('LIBRARY_METADATA_CORRUPT')
    ids.add(item.id); paths.add(item.path)
  }
  return value as Manifest
}

export function createLibraryManager(options: Options) {
  let tail: Promise<unknown> = Promise.resolve()
  function exclusive<T>(task: () => Promise<T>): Promise<T> { const next = tail.catch(() => undefined).then(task); tail = next; return next }
  const manifestPath = (root: string) => join(root, '.mdduck', 'library.json')
  const journalPath = (root: string) => join(root, '.mdduck', 'transaction.json')
  async function load(root: string): Promise<Manifest> { const raw = await bytes(root, manifestPath(root)); return raw ? validateManifest(raw) : empty() }
  async function save(root: string, state: Manifest) { await atomic(root, manifestPath(root), Buffer.from(JSON.stringify(state, null, 2))) }
  async function fileRoot(root: string, path: string) {
    if (under(root, path)) return root
    const privateRoot = resolve(options.userData)
    if (under(privateRoot, path)) { await checked(privateRoot, path); return privateRoot }
    return fail('LIBRARY_PATH_UNSAFE')
  }
  async function rollback(root: string, journal: Journal) {
    for (const folder of [...(journal.removed ?? [])].sort((a, b) => a.split(sep).length - b.split(sep).length)) { await checked(root, folder); await fs.mkdir(folder, { recursive: true }) }
    // Undo only exact transaction output. An external edit is never overwritten.
    for (const write of [...journal.writes].reverse()) {
      const guard = await fileRoot(root, write.path)
      const current = await bytes(guard, write.path)
      if (current?.toString('base64') === write.before || current === null && write.before === null) continue
      if (current?.toString('base64') !== write.after) fail('LIBRARY_RECOVERY_REQUIRED')
      if (write.before === null) await fs.unlink(write.path)
      else await atomic(guard, write.path, Buffer.from(write.before, 'base64'))
    }
    for (const move of [...journal.moves].reverse()) {
      await checked(root, move.from); await checked(root, move.to)
      const from = await stat(move.from), to = await stat(move.to)
      const rewritten = journal.writes.find((write) => write.path === move.to && write.before !== null)
      const unchanged = async (path: string, info: Awaited<ReturnType<typeof stat>>) => !!info && (identity(info) === move.identity || !!rewritten && (await bytes(root, path))?.toString('base64') === rewritten.before)
      if (await unchanged(move.from, from) && (!to || identity(to) !== move.identity)) continue
      if (from && to && identity(from) === move.identity && identity(to) === move.identity) { await fs.unlink(move.to); continue }
      if (from || !(await unchanged(move.to, to))) fail('LIBRARY_RECOVERY_REQUIRED')
      await fs.link(move.to, move.from); await fs.unlink(move.to)
    }
    for (const folder of [...journal.created].reverse()) await fs.rmdir(folder).catch((error) => { if (!missing(error) && error.code !== 'ENOTEMPTY') throw error })
  }
  async function recover(root: string) {
    const raw = await bytes(root, journalPath(root))
    if (!raw) return
    const value = decode(raw, 'LIBRARY_RECOVERY_REQUIRED')
    if (value.version !== 1 || !Array.isArray(value.moves) || !Array.isArray(value.writes) || !Array.isArray(value.created)) fail('LIBRARY_RECOVERY_REQUIRED')
    for (const move of value.moves) if (!record(move) || typeof move.from !== 'string' || typeof move.to !== 'string' || typeof move.identity !== 'string' || !under(root, move.from) || !under(root, move.to)) fail('LIBRARY_RECOVERY_REQUIRED')
    for (const write of value.writes) if (!record(write) || typeof write.path !== 'string' || typeof write.after !== 'string' || write.before !== null && typeof write.before !== 'string' || !under(root, write.path) && !under(resolve(options.userData), write.path)) fail('LIBRARY_RECOVERY_REQUIRED')
    for (const folder of [...value.created, ...(Array.isArray(value.removed) ? value.removed : [])]) if (typeof folder !== 'string' || !under(root, folder) || folder === root) fail('LIBRARY_RECOVERY_REQUIRED')
    await rollback(root, value as Journal)
    await fs.unlink(journalPath(root))
  }
  async function run(root: string, journal: Journal, operation?: () => Promise<void>) {
    // Exclusive directory creation plus no-replace hard links prevent POSIX rename from
    // overwriting a file created concurrently in the destination. Every leaf is journaled.
    const expanded: Move[] = []
    async function expand(move: Move) {
      const source = await stat(move.from)
      if (!source || identity(source) !== move.identity) fail('LIBRARY_SOURCE_CHANGED')
      if (source.isFile()) { expanded.push(move); return }
      if (!source.isDirectory() || source.isSymbolicLink()) fail('LIBRARY_PATH_UNSAFE')
      if (await stat(move.to)) fail('LIBRARY_DESTINATION_EXISTS')
      journal.created.push(move.to); (journal.removed ??= []).push(move.from)
      for (const child of await fs.readdir(move.from)) { const from = join(move.from, child); const info = await stat(from); if (!info || info.isSymbolicLink()) fail('LIBRARY_PATH_UNSAFE'); await expand({ from, to: join(move.to, child), identity: identity(info) }) }
    }
    for (const move of journal.moves) await expand(move)
    journal.moves = expanded
    journal.created = [...new Set(journal.created)].sort((a, b) => a.split(sep).length - b.split(sep).length)
    await atomic(root, journalPath(root), Buffer.from(JSON.stringify(journal)))
    try {
      for (const folder of journal.created) { await checked(root, folder); await fs.mkdir(folder) }
      for (const move of journal.moves) {
        await checked(root, move.from); await checked(root, move.to)
        if (await stat(move.to)) fail('LIBRARY_DESTINATION_EXISTS')
        const source = await stat(move.from)
        if (!source || identity(source) !== move.identity) fail('LIBRARY_SOURCE_CHANGED')
        await fs.link(move.from, move.to); await fs.unlink(move.from)
      }
      for (const write of journal.writes) {
        const guard = await fileRoot(root, write.path)
        const current = await bytes(guard, write.path)
        if (current?.toString('base64') !== write.before && !(current === null && write.before === null)) fail('LIBRARY_SOURCE_CHANGED')
        await atomic(guard, write.path, Buffer.from(write.after, 'base64'))
      }
      for (const folder of [...(journal.removed ?? [])].sort((a, b) => b.split(sep).length - a.split(sep).length)) { await checked(root, folder); await fs.rmdir(folder) }
      await operation?.()
      await fs.unlink(journalPath(root))
    } catch (error) {
      try { await rollback(root, journal); await fs.unlink(journalPath(root)) } catch { fail('LIBRARY_RECOVERY_REQUIRED') }
      throw error
    }
  }
  async function folders(root: string) {
    const result: LibraryFolder[] = []
    async function walk(folder: string, depth: number) {
      if (depth > 24) return
      for (const child of await fs.readdir(folder, { withFileTypes: true })) {
        if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.') || ['node_modules', 'dist', 'out', 'build', '$RECYCLE.BIN', 'System Volume Information'].includes(child.name)) continue
        const path = join(folder, child.name)
        result.push({ path, name: child.name, parentPath: folder, archived: isArchived(root, path), fileIdentity: identity((await stat(path))!) })
        await walk(path, depth + 1)
      }
    }
    await walk(root, 0)
    return result.sort((a, b) => a.path.localeCompare(b.path))
  }
  function isArchived(root: string, path: string) { return under(join(root, ARCHIVE_DIRECTORY), path) }
  async function currentEntries(root: string) {
    const entries = await options.listEntries(root)
    const scanned: Array<{ entry: LibraryEntry; identity: string; digest: string }> = []
    for (const entry of entries) {
      await checked(root, entry.path, false)
      if (relative(root, entry.path).split(sep).some((part) => part.startsWith('.'))) continue
      const value = await stat(entry.path)
      if (!value?.isFile()) continue
      const content = await bytes(root, entry.path)
      if (entry.zhPath) await checked(root, entry.zhPath, false)
      scanned.push({ entry, identity: identity(value), digest: hash(content!) })
    }
    return scanned
  }
  function articleGroup(path: string, items: Array<{ path: string }>) { const folder = dirname(path); return /^article\.(?:md|markdown)$/i.test(basename(path)) && folder !== '.' && items.filter((item) => under(resolve(folder), resolve(item.path))).length === 1 ? dirname(folder) : folder }
  function enrich(root: string, entries: LibraryEntry[], state: Manifest) {
    const byPath = new Map(state.items.map((item) => [item.path, item]))
    return entries.map((entry) => {
      const item = byPath.get(portable(relative(root, entry.path)))
      return { ...entry, id: item?.id, fileIdentity: item?.identity, stage: item?.stage ?? 'unmarked' as const, archived: isArchived(root, entry.path) }
    }).sort((a, b) => articleGroup(a.path, entries).localeCompare(articleGroup(b.path, entries)) || (byPath.get(portable(relative(root, a.path)))?.order ?? 0) - (byPath.get(portable(relative(root, b.path)))?.order ?? 0) || a.title.localeCompare(b.title))
  }
  async function addWrite(root: string, journal: Journal, path: string, content: Buffer, physical = path) {
    const guard = await fileRoot(root, physical)
    const before = await bytes(guard, physical)
    if (before?.equals(content)) return
    const existing = journal.writes.find((write) => write.path === path)
    if (existing) { existing.after = content.toString('base64'); return }
    journal.writes.push({ path, before: before?.toString('base64') ?? null, after: content.toString('base64') })
  }
  async function assertTree(root: string, folder: string) {
    await checked(root, folder)
    for (const child of await fs.readdir(folder, { withFileTypes: true })) {
      const path = join(folder, child.name)
      const info = await stat(path)
      if (!info || info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) fail('LIBRARY_PATH_UNSAFE')
      if (info.isDirectory()) await assertTree(root, path)
    }
  }
  async function assertPortableResources(root: string, folder: string, destination: string) {
    if (dirname(folder) === dirname(destination)) return
    async function walk(directory: string) {
      for (const child of await fs.readdir(directory, { withFileTypes: true })) {
        if (child.name.startsWith('.')) continue
        const path = join(directory, child.name)
        if (child.isDirectory()) { await walk(path); continue }
        if (!child.isFile() || !/\.(md|markdown)$/i.test(child.name)) continue
        const text = (await bytes(root, path))!.toString('utf8')
        const links = [...text.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))|^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|([^\s]+))|(?:src|href)=["']([^"']+)/gmi)].map((match) => match.slice(1).find(Boolean)!)
        for (const link of links) {
          if (!link || /^(?:[a-z][a-z0-9+.-]*:|[\/#])/i.test(link)) continue
          let decoded: string; try { decoded = decodeURIComponent(link.split(/[?#]/)[0]) } catch { decoded = link.split(/[?#]/)[0] }
          const resource = resolve(dirname(path), decoded)
          if (!under(folder, resource)) fail('LIBRARY_MOVE_FOLDER_WITH_ASSETS')
        }
      }
    }
    await walk(folder)
  }
  async function migration(root: string, oldState: Manifest, mappings: LibraryRelocation[], journal: Journal, external = false, directoryMove?: LibraryRelocation, directoryRelocations: LibraryRelocation[] = directoryMove ? [directoryMove] : []) {
    const mapped = (path: string) => { const direct = mappings.find((move) => move.from === path); if (direct) return direct.to; const folder = directoryRelocations.filter((move) => under(move.from, path)).sort((a, b) => b.from.length - a.from.length)[0]; return folder ? join(folder.to, relative(folder.from, path)) : path }
    const physically = (path: string) => external && directoryRelocations.some((move) => under(move.from, path)) ? mapped(path) : path
    const registered = await load(root)
    for (const item of oldState.items) {
      let currentReview: Record<string, any> | null = null
      const oldSource = resolve(root, item.path), newSource = mapped(oldSource)
      const oldTarget = item.translation ? resolve(root, item.translation) : null
      const newTarget = oldTarget ? mapped(oldTarget) : null
      const sourceMoved = oldSource !== newSource
      const ownedHistoricalDestination = [...(item.ownedPaths ?? []), ...(item.aliases ?? [])].includes(portable(relative(root, newSource))) && !registered.items.some((other) => other.id !== item.id && other.path === portable(relative(root, newSource)))
      const preserveHistorical = async (path: string, content: Buffer, privateFile = false) => {
        const history = privateFile ? join(resolve(options.userData), 'review-backup-history', `${hash(path)}-${hash(item.id)}-${hash(content)}.json`) : join(root, '.mdduck', 'recovery', `${hash(path)}-${hash(content)}.json`)
        const guard = privateFile ? resolve(options.userData) : root
        const existing = await bytes(guard, history)
        if (existing && !existing.equals(content)) fail('LIBRARY_DESTINATION_EXISTS')
        if (!existing) await addWrite(root, journal, history, content)
      }
      if (external && sourceMoved && !directoryMove && !(await stat(join(dirname(oldSource), '.review', 'documents', `${hash(basename(oldSource))}.json`))) && (await stat(join(dirname(oldSource), '.review', 'notes.json')) || await stat(join(dirname(oldSource), '.review', 'words.json')))) fail('LIBRARY_OPEN_ARTICLE_BEFORE_MOVE')
      if (!sourceMoved && oldTarget === newTarget) continue
      const paths: Array<{ old: string; next: string; kind: 'review' | 'translation' }> = [
        { old: join(dirname(oldSource), '.review', 'documents', `${hash(basename(oldSource))}.json`), next: join(dirname(newSource), '.review', 'documents', `${hash(basename(newSource))}.json`), kind: 'review' },
        ...['association', 'alignment', 'draft'].map((suffix) => ({ old: join(dirname(oldSource), '.review', 'translations', `${hash(basename(oldSource)).slice(0, 24)}.${suffix}.json`), next: join(dirname(newSource), '.review', 'translations', `${hash(basename(newSource)).slice(0, 24)}.${suffix}.json`), kind: 'translation' as const }))
      ]
      for (const sidecar of paths) {
        const physical = physically(sidecar.old)
        const raw = await bytes(root, physical)
        if (!raw) continue
        const value = decode(raw, 'LIBRARY_ARTICLE_METADATA_CORRUPT')
        if (sidecar.kind === 'review') {
          if (value.version !== 2 || value.document !== basename(oldSource) || !Array.isArray(value.notes) || !Array.isArray(value.words)) fail('LIBRARY_ARTICLE_METADATA_CORRUPT')
          value.document = basename(newSource)
          currentReview = value
        } else {
          let target: string | null = null
          if (value.version === 2 && value.sourceFile === basename(oldSource) && typeof value.targetRelative === 'string' && !isAbsolute(value.targetRelative) && !win32.isAbsolute(value.targetRelative) && !/^[a-z]:/i.test(value.targetRelative)) target = resolve(dirname(oldSource), value.targetRelative.replace(/\\/g, '/'))
          else if (value.version === 1 && value.sourcePath === oldSource && typeof value.targetPath === 'string') target = resolve(value.targetPath)
          if (!target || !under(root, target)) fail('LIBRARY_ARTICLE_METADATA_CORRUPT')
          await checked(root, external ? physically(target) : target)
          value.version = 2; value.sourceFile = basename(newSource); value.targetRelative = portable(relative(dirname(newSource), mapped(target)))
          delete value.sourcePath; delete value.targetPath
        }
        // Whole-folder moves already carry the sidecar; loose article moves carry only their own files.
        const physicalDestination = physically(sidecar.next)
        const carried = directoryMove && under(directoryMove.from, sidecar.old) && mapped(sidecar.old) === sidecar.next
        let replacedHistorical = false
        if (physical !== sidecar.next && (sidecar.old !== sidecar.next && !carried && !external || external)) {
          const destination = await bytes(root, sidecar.next)
          if (destination) {
            if (!ownedHistoricalDestination) fail('LIBRARY_DESTINATION_EXISTS')
            const previous = decode(destination, 'LIBRARY_ARTICLE_METADATA_CORRUPT')
            if (sidecar.kind === 'review' ? previous.version !== 2 || previous.document !== basename(newSource) || !Array.isArray(previous.notes) || !Array.isArray(previous.words) : ![1, 2].includes(previous.version)) fail('LIBRARY_ARTICLE_METADATA_CORRUPT')
            await preserveHistorical(sidecar.next, destination)
            const retainedSource = join(root, '.mdduck', 'recovery', `${randomUUID()}-${basename(sidecar.old)}`)
            journal.moves.push({ from: physical, to: retainedSource, identity: identity((await stat(physical))!) })
            await addWrite(root, journal, sidecar.next, Buffer.from(JSON.stringify(value, null, 2)))
            replacedHistorical = true
          } else journal.moves.push({ from: physical, to: sidecar.next, identity: identity((await stat(physical))!) })
        }
        if (!replacedHistorical) await addWrite(root, journal, sidecar.next, Buffer.from(JSON.stringify(value, null, 2)), carried || physical !== sidecar.next ? physical : physicalDestination)
      }
      if ((sourceMoved || oldTarget !== newTarget) && oldTarget) {
        const association = paths.find((path) => path.old.endsWith('.association.json'))!
        if (!(await bytes(root, physically(association.old)))) {
          const destinationTarget = mapped(oldTarget)
          await checked(root, external ? physically(oldTarget) : oldTarget)
          const value = { version: 2, sourceFile: basename(newSource), targetRelative: portable(relative(dirname(newSource), destinationTarget)) }
          if (await stat(association.next)) fail('LIBRARY_DESTINATION_EXISTS')
          await addWrite(root, journal, association.next, Buffer.from(JSON.stringify(value, null, 2)))
        }
      }
      if (sourceMoved) {
        const oldBackup = join(resolve(options.userData), 'review-backups', `${hash(oldSource)}.json`)
        const newBackup = join(resolve(options.userData), 'review-backups', `${hash(newSource)}.json`)
        const raw = await bytes(resolve(options.userData), oldBackup)
        if (raw || currentReview) {
          const value = currentReview ?? decode(raw!, 'LIBRARY_ARTICLE_METADATA_CORRUPT')
          if (value.version !== 2 || value.document !== (currentReview ? basename(newSource) : basename(oldSource)) || !Array.isArray(value.notes) || !Array.isArray(value.words)) fail('LIBRARY_ARTICLE_METADATA_CORRUPT')
          value.document = basename(newSource)
          const data = Buffer.from(JSON.stringify(value, null, 2))
          const existing = await bytes(resolve(options.userData), newBackup)
          if (existing && JSON.stringify(decode(existing, 'LIBRARY_ARTICLE_METADATA_CORRUPT')) !== JSON.stringify(value)) {
            if (!ownedHistoricalDestination) fail('LIBRARY_DESTINATION_EXISTS')
            await preserveHistorical(newBackup, existing, true)
            await addWrite(root, journal, newBackup, data)
          } else if (!existing) await addWrite(root, journal, newBackup, data)
        }
        const migrationFile = join(dirname(oldSource), '.review', 'migration-v1.json')
        const migrationRaw = await bytes(root, physically(migrationFile))
        if (migrationRaw && dirname(oldSource) === dirname(newSource) && basename(oldSource) !== basename(newSource)) {
          const value = decode(migrationRaw, 'LIBRARY_ARTICLE_METADATA_CORRUPT')
          if (!record(value.documents)) fail('LIBRARY_ARTICLE_METADATA_CORRUPT')
          if (Object.hasOwn(value.documents, basename(oldSource))) {
            if (Object.hasOwn(value.documents, basename(newSource))) fail('LIBRARY_DESTINATION_EXISTS')
            value.documents[basename(newSource)] = value.documents[basename(oldSource)]; delete value.documents[basename(oldSource)]
            await addWrite(root, journal, migrationFile, Buffer.from(JSON.stringify(value, null, 2)), physically(migrationFile))
          }
        }
      }
    }
    // Preflight and create only missing metadata ancestors; parents of planned moved directories appear during rename.
    const parents = new Set<string>()
    for (const target of [...journal.moves.map((move) => move.to), ...journal.writes.map((write) => write.path)]) {
      if (!under(root, target)) continue
      let parent = dirname(target)
      while (parent !== root && !(await stat(parent))) { if (!directoryMove || !under(directoryMove.to, parent)) parents.add(parent); parent = dirname(parent) }
      await checked(root, target)
    }
    for (const parent of [...parents].sort((a, b) => a.split(sep).length - b.split(sep).length)) if (!journal.created.includes(parent)) journal.created.push(parent)
  }
  async function protectReusedPaths(root: string, previous: Manifest, items: Item[], journal: Journal) {
    for (const item of items) {
      if (previous.items.some((old) => old.id === item.id && old.path === item.path) || !(await stat(resolve(root, item.path)))) continue
      const owner = previous.items.find((old) => old.id !== item.id && (old.path === item.path || old.aliases?.includes(item.path) || old.ownedPaths?.includes(item.path)))
      if (!owner) continue
      const source = resolve(root, item.path)
      const path = join(dirname(source), '.review', 'documents', `${hash(basename(source))}.json`)
      const oldPrimaryWillMove = journal.moves.some((move) => move.from === path)
      const currentPrimary = await bytes(root, path)
      if (currentPrimary && !oldPrimaryWillMove) {
        const value = decode(currentPrimary, 'LIBRARY_ARTICLE_METADATA_CORRUPT')
        if (value.version !== 2 || value.document !== basename(source) || !Array.isArray(value.notes) || !Array.isArray(value.words) || value.notes.length || value.words.length) fail('LIBRARY_RELOCATION_REVIEW_REQUIRED')
      }
      const backupPath = join(resolve(options.userData), 'review-backups', `${hash(source)}.json`)
      const saved = await bytes(resolve(options.userData), backupPath)
      if (saved) {
        const historical = join(resolve(options.userData), 'review-backup-history', `${hash(source)}-${hash(owner.id)}.json`)
        const existing = await bytes(resolve(options.userData), historical)
        if (existing && !existing.equals(saved)) fail('LIBRARY_DESTINATION_EXISTS')
        if (!existing) await addWrite(root, journal, historical, saved)
      }
      const emptyReview = Buffer.from(JSON.stringify({ version: 2, document: basename(source), notes: [], words: [] }, null, 2))
      if (oldPrimaryWillMove) journal.writes.push({ path, before: null, after: emptyReview.toString('base64') })
      else await addWrite(root, journal, path, emptyReview)
      await addWrite(root, journal, backupPath, emptyReview)
    }
  }
  async function scan(root: string, state: Manifest): Promise<LibraryChange> {
    if (state.lastRoot !== root) {
      const journal: Journal = { version: 1, moves: [], writes: [], created: [] }
      if (state.lastRoot && isAbsolute(state.lastRoot) && !(await stat(state.lastRoot))) {
        if (options.isBusy?.()) fail('LIBRARY_TRANSLATION_BUSY')
        for (const item of state.items) {
          const oldSource = resolve(state.lastRoot, item.path), newSource = resolve(root, item.path)
          if (!(await stat(newSource))) continue
          const oldBackup = join(resolve(options.userData), 'review-backups', `${hash(oldSource)}.json`)
          const newBackup = join(resolve(options.userData), 'review-backups', `${hash(newSource)}.json`)
          const saved = await bytes(resolve(options.userData), oldBackup)
          if (saved) {
            const value = decode(saved, 'LIBRARY_ARTICLE_METADATA_CORRUPT')
            if (value.version !== 2 || value.document !== basename(oldSource) || !Array.isArray(value.notes) || !Array.isArray(value.words)) fail('LIBRARY_ARTICLE_METADATA_CORRUPT')
            const current = await bytes(resolve(options.userData), newBackup)
            if (current && !current.equals(saved)) fail('LIBRARY_DESTINATION_EXISTS')
            if (!current) await addWrite(root, journal, newBackup, saved)
          }
        }
        state.rootAliases = [...new Set([...(state.rootAliases ?? []), state.lastRoot])].slice(-4)
      }
      state.lastRoot = root
      await addWrite(root, journal, manifestPath(root), Buffer.from(JSON.stringify(state, null, 2)))
      await run(root, journal)
    }
    const scanned = await currentEntries(root)
    const oldByPath = new Map(state.items.map((item) => [item.path, item]))
    const currentByIdentity = new Map<string, typeof scanned>()
    for (const item of scanned) currentByIdentity.set(item.identity, [...(currentByIdentity.get(item.identity) ?? []), item])
    const oldByIdentity = new Map<string, Item[]>()
    for (const item of state.items) oldByIdentity.set(item.identity, [...(oldByIdentity.get(item.identity) ?? []), item])
    const relocations: LibraryRelocation[] = []
    let issue: string | undefined
    const nextItems: Item[] = []
    for (const current of scanned) {
      const path = portable(relative(root, current.entry.path))
      let item = oldByPath.get(path)
      if (item && item.identity !== current.identity && currentByIdentity.has(item.identity)) item = undefined
      if (!item) {
        const candidates = oldByIdentity.get(current.identity) ?? []
        if (candidates.length === 1 && currentByIdentity.get(current.identity)?.length === 1 && (identity((await stat(resolve(root, candidates[0].path))) ?? { dev: -1n, ino: -1n }) !== candidates[0].identity)) {
          item = candidates[0]
          relocations.push({ from: resolve(root, item.path), to: current.entry.path })
        }
      }
      nextItems.push({ id: item?.id ?? randomUUID(), path, identity: current.identity, digest: current.digest, translation: current.entry.zhPath ? portable(relative(root, current.entry.zhPath)) : item?.translation ?? null, translationIdentity: current.entry.zhPath && await stat(current.entry.zhPath) ? `${identity((await stat(current.entry.zhPath))!)}:${(await stat(current.entry.zhPath))!.birthtimeNs}` : item?.translationIdentity, stage: item?.stage ?? 'unmarked', order: item?.order ?? nextItems.length, ...(item ? { aliases: [...new Set([...(item.aliases ?? []), ...(item.path !== path ? [item.path] : [])])].slice(-16), ownedPaths: [...new Set([...(item.ownedPaths ?? item.aliases ?? []), ...(item.path !== path ? [item.path] : [])])] } : {}) })
    }
    // Retain missing records to allow a disconnected drive or later relocation to recover its identity.
    const foundIds = new Set(nextItems.map((item) => item.id))
    for (const old of state.items) if (!foundIds.has(old.id)) nextItems.push(old)
    const targetCandidates = new Map<string, string[]>()
    for (const path of new Set(scanned.flatMap((current) => [current.entry.path, ...(current.entry.zhPath ? [current.entry.zhPath] : [])]))) {
      const value = await stat(path)
      if (!value?.isFile()) continue
      const key = `${identity(value)}:${value.birthtimeNs}`
      targetCandidates.set(key, [...(targetCandidates.get(key) ?? []), path])
    }
    for (const item of state.items) {
      if (!item.translation || !item.translationIdentity) continue
      const oldTarget = resolve(root, item.translation), existing = await stat(oldTarget)
      if (existing && `${identity(existing)}:${existing.birthtimeNs}` === item.translationIdentity) continue
      const candidates = targetCandidates.get(item.translationIdentity) ?? []
      if (candidates.length === 1 && !relocations.some((move) => move.from === oldTarget)) relocations.push({ from: oldTarget, to: candidates[0] })
    }
    if (relocations.length) {
      if (options.isBusy?.()) { issue = 'LIBRARY_TRANSLATION_BUSY'; return { snapshot: { entries: enrich(root, scanned.map((value) => value.entry), state), folders: await folders(root), issue }, relocations: [] } }
      const journal: Journal = { version: 1, moves: [], writes: [], created: [] }
      // Recognize directory renames only if every child mapping agrees and the old directory is absent.
      const directoryMoves = new Map<string, string>()
      for (const move of relocations) {
        let from = dirname(move.from), to = dirname(move.to)
        while (from !== root && under(root, from) && to !== root && under(root, to)) {
          if (from !== to && !(await stat(from)) && (await stat(to))?.isDirectory()) {
            const children = state.items.filter((item) => under(from, resolve(root, item.path)))
            if (children.every((item) => relocations.some((other) => other.from === resolve(root, item.path) && other.to === join(to, relative(from, other.from))))) directoryMoves.set(from, to)
            else if (from === dirname(move.from)) issue = 'LIBRARY_RELOCATION_REVIEW_REQUIRED'
          }
          from = dirname(from); to = dirname(to)
        }
      }
      const mappedDirectory = (path: string) => { const pair = [...directoryMoves].filter(([from]) => under(from, path)).sort(([a], [b]) => b.length - a.length)[0]; return pair ? join(pair[1], relative(pair[0], path)) : path }
      const directoryRelocations = [...directoryMoves].map(([from, to]) => ({ from, to }))
      try {
        if (issue) fail(issue)
        for (const relocation of [...relocations]) {
          const oldItem = state.items.find((item) => resolve(root, item.path) === relocation.from)
          if (!oldItem?.translation || directoryMoves.has(dirname(relocation.from)) || relocations.some((move) => move.from === resolve(root, oldItem.translation!))) continue
          const oldTarget = resolve(root, oldItem.translation)
          const oldDefault = join(dirname(relocation.from), `${basename(relocation.from, extname(relocation.from))}.zh${extname(relocation.from)}`)
          if (oldTarget !== oldDefault || !(await stat(oldTarget))) continue
          const newTarget = join(dirname(relocation.to), `${basename(relocation.to, extname(relocation.to))}.zh${extname(relocation.to)}`)
          await checked(root, oldTarget); await checked(root, newTarget)
          if (await stat(newTarget)) fail('LIBRARY_DESTINATION_EXISTS')
          journal.moves.push({ from: oldTarget, to: newTarget, identity: identity((await stat(oldTarget))!) })
          relocations.push({ from: oldTarget, to: newTarget })
        }
        // A moved directory already contains sidecars. Loose external file renames leave them behind.
        for (const relocation of relocations) {
          const oldItem = state.items.find((item) => resolve(root, item.path) === relocation.from)
          if (!oldItem) continue
          const directoryMove = directoryMoves.has(dirname(relocation.from)) ? { from: dirname(relocation.from), to: directoryMoves.get(dirname(relocation.from))! } : undefined
          await migration(root, { ...state, items: [oldItem] }, relocations, journal, true, directoryMove, directoryRelocations)
        }
        for (const old of state.items.filter((item) => !relocations.some((move) => resolve(root, item.path) === move.from))) await migration(root, { ...state, items: [old] }, relocations, journal, true, undefined, directoryRelocations)
        const translationTargets = new Set<string>()
        for (const item of nextItems) {
          const old = state.items.find((old) => old.id === item.id)
          if (!old?.translation) continue
          const target = resolve(root, old.translation)
          const destination = relocations.find((move) => move.from === target)?.to ?? mappedDirectory(target)
          if (await stat(destination) || journal.moves.some((move) => move.to === destination)) { translationTargets.add(old.translation); item.translation = portable(relative(root, destination)); translationTargets.add(item.translation) }
        }
        const nextState = { ...state, items: nextItems.filter((item) => !translationTargets.has(item.path)) }
        await protectReusedPaths(root, state, nextState.items, journal)
        for (const [path, original] of Object.entries({ ...nextState.archived })) { const directory = mappedDirectory(resolve(root, path)); if (directory !== resolve(root, path)) { delete nextState.archived[path]; nextState.archived[portable(relative(root, directory))] = original } }
        await addWrite(root, journal, manifestPath(root), Buffer.from(JSON.stringify(nextState, null, 2)))
        await run(root, journal)
      } catch (error) {
        issue = error instanceof Error ? error.message : 'LIBRARY_RELOCATION_REVIEW_REQUIRED'
        return { snapshot: { entries: enrich(root, scanned.map((value) => value.entry), state), folders: await folders(root), issue }, relocations: [] }
      }
    } else {
      const nextState = { ...state, items: nextItems }
      if (JSON.stringify(nextState) !== JSON.stringify(state)) {
        const journal: Journal = { version: 1, moves: [], writes: [], created: [] }
        await protectReusedPaths(root, state, nextState.items, journal)
        await addWrite(root, journal, manifestPath(root), Buffer.from(JSON.stringify(nextState, null, 2)))
        await run(root, journal)
      }
    }
    if (state.items.some((old) => !scanned.some((current) => current.entry.path === resolve(root, old.path)) && !relocations.some((move) => move.from === resolve(root, old.path)))) issue = 'LIBRARY_MISSING_ARTICLES'
    const updated = await load(root)
    for (const item of updated.items) if (await stat(resolve(root, item.path))) for (const alias of item.aliases ?? []) if (!(await stat(resolve(root, alias))) && !relocations.some((move) => move.from === resolve(root, alias))) relocations.push({ from: resolve(root, alias), to: resolve(root, item.path) })
    for (const previousRoot of updated.rootAliases ?? []) if (isAbsolute(previousRoot) && !(await stat(previousRoot))) for (const item of updated.items) if (await stat(resolve(root, item.path))) for (const previousPath of [item.path, ...(item.aliases ?? [])]) relocations.push({ from: resolve(previousRoot, previousPath), to: resolve(root, item.path) })
    return { snapshot: { entries: enrich(root, (await currentEntries(root)).map((value) => value.entry), updated), folders: await folders(root), ...(issue ? { issue } : {}) }, relocations }
  }
  async function refreshImpl(root: string): Promise<LibraryChange> {
    root = resolve(root)
    try { await checked(root, root); await recover(root); return await scan(root, await load(root)) } catch (error) {
      const entries = await options.listEntries(root)
      return { snapshot: { entries, folders: await folders(root), issue: error instanceof Error ? error.message : 'LIBRARY_UNAVAILABLE' }, relocations: [] }
    }
  }
  async function mutateImpl(root: string, command: LibraryCommand): Promise<LibraryChange> {
    root = resolve(root)
    await checked(root, root)
    if (options.isBusy?.()) fail('LIBRARY_TRANSLATION_BUSY')
    await recover(root)
    await load(root) // Never let refresh's read-only fallback hide damaged metadata.
    const initial = await refreshImpl(root)
    if (initial.snapshot.issue && initial.snapshot.issue !== 'LIBRARY_MISSING_ARTICLES') fail(initial.snapshot.issue)
    const state = await load(root)
    if ('path' in command) {
      const selected = initial.snapshot.entries.find((entry) => entry.path === resolve(command.path))
      if (command.documentId && selected?.id !== command.documentId) fail('LIBRARY_SOURCE_CHANGED')
      const selectedStat = await stat(resolve(command.path))
      if (command.expectedIdentity && (!selectedStat || identity(selectedStat) !== command.expectedIdentity)) fail('LIBRARY_SOURCE_CHANGED')
    }
    const journal: Journal = { version: 1, moves: [], writes: [], created: [] }
    let relocations: LibraryRelocation[] = []
    const requiredDirectory = async (path: string) => { if (!isAbsolute(path)) fail('LIBRARY_PATH_UNSAFE'); await checked(root, resolve(path)); if (!(await stat(path))?.isDirectory()) fail('LIBRARY_FOLDER_MISSING'); return resolve(path) }
    const ensureName = (name: string) => { if (!validName(name)) fail('LIBRARY_INVALID_NAME'); return name }
    if (command.type === 'create-folder') {
      const parent = await requiredDirectory(command.parent)
      const target = join(parent, ensureName(command.name))
      if (await stat(target)) fail('LIBRARY_DESTINATION_EXISTS')
      journal.created.push(target)
    } else if (command.type === 'create-articles') {
      const folder = await requiredDirectory(command.folder)
      if (!Array.isArray(command.titles) || !command.titles.length || command.titles.length > 50) fail('LIBRARY_INVALID_TITLES')
      const names = new Set<string>()
      for (const title of command.titles) {
        if (typeof title !== 'string' || !title.trim() || title.length > 500 || /[\r\n\x00-\x1f]/.test(title)) fail('LIBRARY_INVALID_TITLES')
        let stem = title.trim().replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+|[. ]+$/g, '').slice(0, 120).trim() || 'Untitled article'
        while (Buffer.byteLength(stem, 'utf8') > 220) stem = Array.from(stem).slice(0, -1).join('')
        if (!validName(stem)) stem = `_${stem}`
        let name = stem, suffix = 2
        while (names.has(name.toLocaleLowerCase()) || await stat(join(folder, name))) name = `${stem} ${suffix++}`
        names.add(name.toLocaleLowerCase())
        const directory = join(folder, name)
        journal.created.push(directory)
        await addWrite(root, journal, join(directory, 'article.md'), Buffer.from(`# ${title}\n\n`))
      }
    } else if (command.type === 'stage' || command.type === 'reorder') {
      const item = state.items.find((item) => resolve(root, item.path) === resolve(command.path))
      if (!item || !(await stat(resolve(root, item.path)))) fail('LIBRARY_ARTICLE_MISSING')
      if (command.type === 'stage') { if (!stages.includes(command.stage)) fail('LIBRARY_INVALID_STAGE'); item.stage = command.stage }
      else {
        const siblings = state.items.filter((other) => articleGroup(other.path, state.items) === articleGroup(item.path, state.items)).sort((a, b) => a.order - b.order)
        const index = siblings.indexOf(item), target = index + (command.direction === 'up' ? -1 : 1)
        if (siblings[target]) { [siblings[index], siblings[target]] = [siblings[target], siblings[index]]; siblings.forEach((sibling, order) => { sibling.order = order }) }
      }
    } else {
      if (!isAbsolute(command.path)) fail('LIBRARY_PATH_UNSAFE')
      let from = resolve(command.path)
      await checked(root, from, false)
      if (from === join(root, ARCHIVE_DIRECTORY)) fail('LIBRARY_ROOT_IMMOVABLE')
      const requestedEntry = initial.snapshot.entries.find((entry) => entry.path === from)
      if (requestedEntry && /^article\.(?:md|markdown)$/i.test(basename(from)) && dirname(from) !== root && dirname(from) !== join(root, ARCHIVE_DIRECTORY) && initial.snapshot.entries.filter((entry) => under(dirname(from), entry.path)).length === 1) from = dirname(from)
      await checked(root, from, false)
      if (relative(root, from).split(sep).some((part) => part.startsWith('.'))) fail('LIBRARY_PATH_UNSAFE')
      const source = await stat(from)
      if (!source) fail('LIBRARY_ARTICLE_MISSING')
      if (source.isDirectory()) await assertTree(root, from)
      let to: string
      if (command.type === 'rename') {
        let name = ensureName(command.name)
        if (source.isFile() && !/\.(md|markdown)$/i.test(name)) name += extname(from)
        to = join(dirname(from), name)
      } else if (command.type === 'move') to = join(await requiredDirectory(command.destination), basename(from))
      else if (command.type === 'archive') {
        if (isArchived(root, from)) fail('LIBRARY_ALREADY_ARCHIVED')
        const archive = join(root, ARCHIVE_DIRECTORY)
        await checked(root, archive)
        if (!(await stat(archive))) journal.created.push(archive)
        else if (!(await stat(archive))?.isDirectory()) fail('LIBRARY_PATH_UNSAFE')
        to = join(archive, basename(from))
        state.archived[portable(relative(root, to))] = portable(relative(root, from))
      } else {
        if (!isArchived(root, from)) fail('LIBRARY_NOT_ARCHIVED')
        const archivedPath = Object.keys(state.archived).filter((path) => under(resolve(root, path), from)).sort((a, b) => b.length - a.length)[0]
        const original = archivedPath ? state.archived[archivedPath] : null
        if (!original) fail('LIBRARY_RESTORE_LOCATION_UNKNOWN')
        to = resolve(root, original, relative(resolve(root, archivedPath), from))
        let parent = dirname(to); const missingParents: string[] = []; while (parent !== root && !(await stat(parent))) { missingParents.push(parent); parent = dirname(parent) }
        if (!(await stat(parent))?.isDirectory()) fail('LIBRARY_RESTORE_FOLDER_MISSING')
        journal.created.push(...missingParents.reverse())
        delete state.archived[portable(relative(root, from))]
      }
      await checked(root, to, false)
      if (to === from) return initial
      if (source.isDirectory() && under(from, to)) fail('LIBRARY_MOVE_INTO_SELF')
      if (source.isDirectory()) await assertPortableResources(root, from, to)
      if (await stat(to)) fail('LIBRARY_DESTINATION_EXISTS')
      const affected = initial.snapshot.entries.filter((entry) => entry.path === from || source.isDirectory() && under(from, entry.path))
      if (source.isFile() && affected.length !== 1) fail('LIBRARY_ARTICLE_MISSING')
      if (source.isFile()) {
        // Relative assets belong to the containing folder. Never silently break their paths or duplicate shared files.
        const content = (await bytes(root, from))!.toString('utf8')
        if (dirname(from) !== dirname(to) && /!?\[[^\]]*\]\(\s*(?![a-z]+:|\/|#)([^)]+)\)|(?:src|href)=["'](?![a-z]+:|\/|#)/i.test(content)) fail('LIBRARY_MOVE_FOLDER_WITH_ASSETS')
      }
      journal.moves.push({ from, to, identity: identity(source) })
      relocations = affected.map((entry) => ({ from: entry.path, to: source.isDirectory() ? join(to, relative(from, entry.path)) : to }))
      if (source.isFile()) {
        const article = affected[0]
        if (article.zhPath) {
          const oldTarget = article.zhPath
          const defaultTarget = join(dirname(from), `${basename(from, extname(from))}.zh${extname(from)}`)
          const newTarget = oldTarget === defaultTarget ? join(dirname(to), `${basename(to, extname(to))}.zh${extname(to)}`) : dirname(oldTarget) === dirname(from) ? join(dirname(to), basename(oldTarget)) : oldTarget
          if (newTarget !== oldTarget) {
            await checked(root, oldTarget); await checked(root, newTarget)
            if (await stat(newTarget)) fail('LIBRARY_DESTINATION_EXISTS')
            const targetStat = await stat(oldTarget)
            if (!targetStat?.isFile()) fail('LIBRARY_TRANSLATION_MISSING')
            const targetText = (await bytes(root, oldTarget))!.toString('utf8')
            if (dirname(from) !== dirname(to) && /!?\[[^\]]*\]\(\s*(?![a-z]+:|\/|#)([^)]+)\)|(?:src|href)=["'](?![a-z]+:|\/|#)/i.test(targetText)) fail('LIBRARY_MOVE_FOLDER_WITH_ASSETS')
            journal.moves.push({ from: oldTarget, to: newTarget, identity: identity(targetStat) })
            relocations.push({ from: oldTarget, to: newTarget })
          }
        }
        // An un-migrated legacy shared review cannot safely be split between two article folders.
        const primary = join(dirname(from), '.review', 'documents', `${hash(basename(from))}.json`)
        if (!(await stat(primary)) && (await stat(join(dirname(from), '.review', 'notes.json')) || await stat(join(dirname(from), '.review', 'words.json')) || await stat(join(dirname(from), '.review', 'migration-v1.json')))) fail('LIBRARY_OPEN_ARTICLE_BEFORE_MOVE')
      }
      await migration(root, state, relocations, journal, false, source.isDirectory() ? { from, to } : undefined)
      const map = (path: string) => relocations.find((move) => move.from === path)?.to ?? (source.isDirectory() && under(from, path) ? join(to, relative(from, path)) : path)
      for (const item of state.items) { const oldPath = item.path; item.path = portable(relative(root, map(resolve(root, item.path)))); if (oldPath !== item.path) { item.ownedPaths = [...new Set([...(item.ownedPaths ?? item.aliases ?? []), oldPath])]; item.aliases = [...new Set([...(item.aliases ?? []), oldPath])].slice(-16); } if (item.translation) item.translation = portable(relative(root, map(resolve(root, item.translation)))) }
      for (const [path, original] of Object.entries({ ...state.archived })) {
        if (under(from, resolve(root, path))) { delete state.archived[path]; state.archived[portable(relative(root, map(resolve(root, path))))] = original }
      }
    }
    await addWrite(root, journal, manifestPath(root), Buffer.from(JSON.stringify(state, null, 2)))
    await run(root, journal)
    const next = await refreshImpl(root)
    return { ...next, relocations: [...new Map([...initial.relocations, ...relocations, ...next.relocations].map((move) => [move.from, move])).values()] }
  }
  return { exclusive, refresh: (root: string) => exclusive(() => refreshImpl(root)), mutate: (root: string, command: LibraryCommand) => exclusive(() => mutateImpl(root, command)) }
}
