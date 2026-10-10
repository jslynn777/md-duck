import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BigIntStats } from 'node:fs'

const MAX_CACHE_BYTES = 24_000 * 120 * Float32Array.BYTES_PER_ELEMENT
const sameFile = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino
const unchanged = (left: BigIntStats, right: BigIntStats) => sameFile(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs

export function speechCacheFile(directory: string, voice: string, speed: number, text: string): string {
  const hash = createHash('sha256').update(`${voice}\n${speed}\n${text}`).digest('hex')
  return join(directory, `${hash}.f32`)
}

async function stat(path: string) { return fs.lstat(path, { bigint: true }).catch(() => null) }
async function directoryStat(path: string) {
  const info = await stat(path)
  return info?.isDirectory() && !info.isSymbolicLink() ? info : null
}
async function sameDirectory(path: string, before: BigIntStats) {
  const after = await directoryStat(path)
  return !!after && sameFile(before, after)
}
export function validSpeechSamples(samples: Float32Array): boolean {
  return samples.byteLength > 0 && samples.byteLength <= MAX_CACHE_BYTES &&
    samples.every((sample) => Number.isFinite(sample)) && samples.some((sample) => sample !== 0)
}

/** Cache faults are misses, never a reason to prevent neural synthesis. */
export async function readSpeechCache(directory: string, voice: string, speed: number, text: string): Promise<Float32Array | null> {
  if (!directory) return null
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const parent = await directoryStat(directory)
    if (!parent) return null
    const path = speechCacheFile(directory, voice, speed, text)
    const before = await stat(path)
    if (!before?.isFile() || before.isSymbolicLink() || before.size === 0n || before.size % 4n !== 0n || before.size > MAX_CACHE_BYTES) return null
    handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !unchanged(before, opened) || !await sameDirectory(directory, parent)) return null
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    const owned = await stat(path)
    if (!owned || !owned.isFile() || owned.isSymbolicLink() || !unchanged(opened, after) || !unchanged(after, owned) ||
        !await sameDirectory(directory, parent) || bytes.length === 0 || bytes.length % 4 !== 0 || bytes.length > MAX_CACHE_BYTES) return null
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    return validSpeechSamples(samples) ? samples : null
  } catch { return null }
  finally { await handle?.close().catch(() => {}) }
}

/** Publish only a complete sibling file; failed cache writes remain best effort. */
export async function writeSpeechCache(directory: string, voice: string, speed: number, text: string, samples: Float32Array): Promise<boolean> {
  if (!directory || !validSpeechSamples(samples)) return false
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  let parent: BigIntStats | null = null
  let temporary = ''
  let temporaryIdentity: BigIntStats | undefined
  try {
    const existing = await stat(directory)
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) return false
    if (!existing) await fs.mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    parent = await directoryStat(directory)
    if (!parent) return false
    const destination = speechCacheFile(directory, voice, speed, text)
    const owned = await stat(destination)
    if (owned && (!owned.isFile() || owned.isSymbolicLink())) return false
    temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    temporaryIdentity = await handle.stat({ bigint: true })
    if (!temporaryIdentity.isFile() || !await sameDirectory(directory, parent)) return false
    await handle.writeFile(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    await handle.sync()
    await handle.close()
    handle = undefined
    const current = await stat(destination)
    const ready = await stat(temporary)
    if (current && (!current.isFile() || current.isSymbolicLink()) || !ready || !ready.isFile() || ready.isSymbolicLink() ||
        !sameFile(temporaryIdentity, ready) || !await sameDirectory(directory, parent)) return false
    await fs.rename(temporary, destination)
    temporary = ''
    return true
  } catch { return false }
  finally {
    await handle?.close().catch(() => {})
    if (temporary && temporaryIdentity && parent && await sameDirectory(directory, parent)) {
      const remaining = await stat(temporary)
      if (remaining?.isFile() && !remaining.isSymbolicLink() && sameFile(temporaryIdentity, remaining)) {
        await fs.unlink(temporary).catch(() => {})
      }
    }
  }
}
