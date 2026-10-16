import { promises as fs } from 'node:fs'
import type { LibraryEntry } from '../shared/types'
import { isPathInsideRoot } from './allowed-path'

/** Reject a stale editor response before it can write to a reused pathname. */
export async function assertLibraryDocument(root: string | null, entries: LibraryEntry[], path: string, expectedId?: string) {
  const entry = entries.find((item) => item.path === path)
  if (!entry?.id || !entry.fileIdentity || !expectedId || expectedId !== entry.id || !(await isPathInsideRoot(path, root))) throw new Error('LIBRARY_SOURCE_CHANGED')
  const info = await fs.lstat(path, { bigint: true }).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink() || entry.fileIdentity && entry.fileIdentity !== `${info.dev}:${info.ino}`) throw new Error('LIBRARY_SOURCE_CHANGED')
}
