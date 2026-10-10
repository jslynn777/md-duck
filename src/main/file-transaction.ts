import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { createNoteQueue } from './note-queue'

type Options = { timeoutMs?: number }
// Windows file IDs can exceed Number.MAX_SAFE_INTEGER. Keep exact identities
// when deciding whether a lock still belongs to the descriptor we opened.
type Identity = { dev: bigint; ino: bigint }
type Owner = { pid: number; token: string; hostname?: string }
type Lock = Identity & Owner

const enqueue = createNoteQueue()
const host = hostname()
const maxRecoveryDepth = 8

function busy() {
  return Object.assign(new Error('REVIEW_STORAGE_BUSY'), { code: 'REVIEW_STORAGE_BUSY' })
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

function sameFile(left: Identity, right: Identity) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameOwner(left: Lock, right: Lock) {
  return sameFile(left, right) && left.pid === right.pid && left.token === right.token
}

function isDead(owner: Owner) {
  if (owner.hostname && owner.hostname !== host) return false
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    // EPERM, PID reuse, and an unrecognised error are not proof of a dead owner.
    return errorCode(error) === 'ESRCH'
  }
}

async function statLock(path: string) {
  const stat = await lstat(path, { bigint: true }).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  })
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw busy()
  return stat
}

async function readLock(path: string): Promise<Lock | null> {
  const before = await statLock(path)
  if (!before) return null

  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    if (errorCode(error) === 'ELOOP') throw busy()
    throw error
  })
  if (!handle) return null
  try {
    const stat = await handle.stat({ bigint: true })
    if (!stat.isFile() || !sameFile(before, stat)) return null
    // Windows has no O_NOFOLLOW. Before reading any bytes, require the path to
    // remain a regular file with the same exact identity as both the pre-open
    // lstat and descriptor. A substituted symlink is rejected even if it points
    // at the original inode; a link to another file fails the descriptor check.
    const after = await statLock(path)
    if (!after || !sameFile(stat, after)) return null
    // A new owner may still be writing its record. Never reclaim an empty,
    // incomplete, or unrecognised file: there is no confirmed dead PID yet.
    if (stat.size === 0n || stat.size > 4096n) return null
    let owner: unknown
    try { owner = JSON.parse(await handle.readFile('utf8')) } catch { return null }
    if (!owner || typeof owner !== 'object') return null
    const value = owner as Partial<Owner>
    const pid = value.pid
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) return null
    if (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 200) return null
    if (value.hostname !== undefined && typeof value.hostname !== 'string') return null
    const final = await statLock(path)
    if (!final || !sameFile(stat, final)) return null
    return { dev: stat.dev, ino: stat.ino, pid, token: value.token, hostname: value.hostname }
  } finally {
    await handle.close()
  }
}

async function release(path: string, own: Lock) {
  const current = await readLock(path)
  if (!current || !sameOwner(current, own)) return
  // Cooperating processes cannot replace a live owner's lock. The inode and
  // token checks also leave externally replaced files untouched.
  await unlink(path).catch((error: unknown) => {
    if (errorCode(error) !== 'ENOENT') throw error
  })
}

async function createLock(path: string): Promise<Lock | null> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600).catch((error: unknown) => {
    if (errorCode(error) === 'EEXIST') return null
    if (errorCode(error) === 'ELOOP') throw busy()
    throw error
  })
  if (!handle) return null
  let identity: Identity | null = null
  const owner: Owner = { pid: process.pid, token: randomUUID(), hostname: host }
  try {
    identity = await handle.stat({ bigint: true })
    await handle.writeFile(JSON.stringify(owner), 'utf8')
    return { dev: identity.dev, ino: identity.ino, ...owner }
  } catch (error) {
    // This creation has not been published to a task. Clean only the inode
    // obtained by our exclusive open, even if its record could not be written.
    const current = await lstat(path, { bigint: true }).catch(() => null)
    if (identity && current?.isFile() && sameFile(current, identity)) await unlink(path).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
}

async function acquire(path: string, deadline: number, depth = 0): Promise<Lock> {
  if (depth > maxRecoveryDepth) throw busy()
  while (true) {
    const own = await createLock(path)
    if (own) return own
    const existing = await readLock(path)
    if (existing && isDead(existing)) {
      if (performance.now() >= deadline) throw busy()
      // Serialize stale-lock cleanup. Without this guard, two stale readers
      // could unlink each other's newly acquired lock after a stat/unlink race.
      // A crashed cleanup guard is recovered by the same protocol, bounded above.
      const recoveryPath = `${path}.recovery`
      const recovery = await acquire(recoveryPath, deadline, depth + 1)
      try {
        const current = await readLock(path)
        if (current && sameOwner(current, existing) && isDead(current)) {
          await unlink(path).catch((error: unknown) => {
            if (errorCode(error) !== 'ENOENT') throw error
          })
        }
      } finally {
        await release(recoveryPath, recovery)
      }
    }
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw busy()
    await delay(Math.min(remaining, 20))
  }
}

/** The caller creates the parent directory and supplies a canonical resource path.
 * timeoutMs bounds lock acquisition; it never cancels a transaction already running.
 */
export function withFileTransaction<T>(resourcePath: string, task: () => Promise<T>, options: Options = {}): Promise<T> {
  return enqueue(resourcePath, async () => {
    const requestedTimeout = options.timeoutMs ?? 5000
    const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(0, Math.min(requestedTimeout, 60_000)) : 5000
    const path = `${resourcePath}.lock`
    const own = await acquire(path, performance.now() + timeoutMs)
    let result: T
    try {
      result = await task()
    } catch (error) {
      await release(path, own).catch(() => undefined)
      throw error
    }
    await release(path, own)
    return result
  })
}
