import { createHash } from 'node:crypto'
import { constants, promises as fs, type BigIntStats } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export const CODEX_SNAPSHOT_MAX_FILES = 2000
export const CODEX_SNAPSHOT_HASH_LIMIT = 20 * 1024 * 1024
export const CODEX_SNAPSHOT_TOTAL_HASH_LIMIT = 64 * 1024 * 1024
const MAX_ENTRIES = 20_000
const MAX_DEPTH = 24
const IGNORED = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '$RECYCLE.BIN', 'System Volume Information'])
const MARKDOWN = /\.(?:md|markdown)$/i
const TRACKED = /\.(?:md|markdown|png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)$/i
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const fingerprint = (info: BigIntStats) => `stat:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.birthtimeNs}`
const identity = (info: BigIntStats) => `${info.dev}:${info.ino}`
const inside = (root: string, candidate: string) => {
  const suffix = relative(root, candidate)
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}
const fail = (limit = false): never => { throw new Error(limit ? 'ERR_CODEX_SNAPSHOT_LIMIT' : 'ERR_CODEX_SNAPSHOT') }

/** Record article files only. This never follows nested symlinks or reads application metadata.
 * Reject oversized trees rather than silently comparing two differently truncated snapshots.
 */
export async function snapshotCodexFiles(root: string): Promise<Record<string, string>> {
  if (!isAbsolute(root)) return fail()
  let canonicalRoot: string
  try {
    canonicalRoot = await fs.realpath(root)
    if (!(await fs.lstat(canonicalRoot)).isDirectory()) return fail()
  } catch { return fail() }
  const result: Record<string, string> = {}
  let visited = 0, count = 0, hashBytes = 0
  const buffer = Buffer.alloc(64 * 1024)

  async function snapshotFile(path: string): Promise<string | null> {
    try {
      const before = await fs.lstat(path, { bigint: true })
      if (!before.isFile() || before.isSymbolicLink()) return null
      const canonical = await fs.realpath(path)
      if (!inside(canonicalRoot, canonical)) return fail()
      const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = await handle.stat({ bigint: true })
        const checked = await fs.realpath(path)
        if (!opened.isFile() || identity(opened) !== identity(before) || checked !== canonical || !inside(canonicalRoot, checked)) return fail()
        // Keep the strategy dependent on this file alone. A global byte budget
        // would make unrelated files switch fingerprints when a sibling grows.
        if (!MARKDOWN.test(path) || opened.size > BigInt(CODEX_SNAPSHOT_HASH_LIMIT)) return fingerprint(opened)
        hashBytes += Number(opened.size)
        if (hashBytes > CODEX_SNAPSHOT_TOTAL_HASH_LIMIT) return fail(true)
        const hash = createHash('sha256')
        let position = 0
        while (position < Number(opened.size)) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position)
          if (!bytesRead) return fail()
          hash.update(buffer.subarray(0, bytesRead))
          position += bytesRead
        }
        const after = await handle.stat({ bigint: true })
        const linked = await fs.lstat(path, { bigint: true })
        if (fingerprint(opened) !== fingerprint(after) || linked.isSymbolicLink() || identity(linked) !== identity(opened) ||
          !inside(canonicalRoot, await fs.realpath(path))) return fail()
        return `sha256:${hash.digest('hex')}`
      } finally { await handle.close() }
    } catch (error) {
      if (missing(error)) return null
      if (error instanceof Error && error.message === 'ERR_CODEX_SNAPSHOT_LIMIT') throw error
      return fail()
    }
  }

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return fail(true)
    const canonical = await fs.realpath(directory)
    if (!inside(canonicalRoot, canonical) || (await fs.lstat(directory)).isSymbolicLink()) return fail()
    const entries = await fs.opendir(directory)
    for await (const entry of entries) {
      if (++visited > MAX_ENTRIES) return fail(true)
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        try { await walk(path, depth + 1) } catch (error) { if (!missing(error)) throw error }
      } else if (entry.isFile() && TRACKED.test(entry.name)) {
        if (++count > CODEX_SNAPSHOT_MAX_FILES) return fail(true)
        const value = await snapshotFile(path)
        if (value !== null) result[relative(canonicalRoot, path).split(sep).join('/')] = value
      }
    }
  }
  try { await walk(canonicalRoot, 0) } catch (error) {
    if (error instanceof Error && error.message === 'ERR_CODEX_SNAPSHOT_LIMIT') throw error
    return fail()
  }
  return result
}
