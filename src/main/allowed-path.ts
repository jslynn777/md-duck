import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'

/** Resolve existing ancestors so new files work under root aliases without escaping through symlinks. */
export async function isPathInsideRoot(filePath: string, root: string | null): Promise<boolean> {
  if (typeof filePath !== 'string' || typeof root !== 'string' || !isAbsolute(filePath) || !isAbsolute(root)) return false
  const rootReal = await realpath(root).catch(() => null)
  if (!rootReal) return false
  const inside = (path: string) => path === rootReal || path.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)
  let ancestor = filePath
  const remainder: string[] = []
  while (true) {
    try {
      const ancestorReal = await realpath(ancestor)
      const candidate = join(ancestorReal, ...remainder)
      return inside(candidate)
    } catch (error) {
      // ENOENT may identify a new path or a dangling symlink. Only the former can be created safely.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
      let entry
      try { entry = await lstat(ancestor) } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return false
      }
      if (entry) {
        if (entry.isSymbolicLink() || !(entry.isDirectory() || entry.isFile())) return false
        // Another save may create this ancestor between realpath and lstat.
        // Resolve that new ordinary object rather than treating it as a broken link.
        const appearedReal = await realpath(ancestor).catch(() => null)
        return appearedReal !== null && inside(join(appearedReal, ...remainder))
      }
      const parent = dirname(ancestor)
      if (parent === ancestor) return false
      remainder.unshift(basename(ancestor))
      ancestor = parent
    }
  }
}
