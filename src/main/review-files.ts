import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

type AllowedPath = (path: string) => Promise<boolean>

function unsafe(): never {
  throw new Error('REVIEW_PATH_UNSAFE')
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function markdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

export async function assertReviewSource(sourcePath: string, isAllowed: AllowedPath): Promise<string> {
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath) || !markdown(sourcePath)) return unsafe()
  let canonical: string
  try {
    canonical = await realpath(sourcePath)
    if (!markdown(canonical) || !(await stat(canonical)).isFile()) return unsafe()
  } catch (error) {
    if (missing(error)) return unsafe()
    throw error
  }
  if (!(await isAllowed(sourcePath)) || !(await isAllowed(canonical))) return unsafe()
  return canonical
}

function childPath(parent: string, target: string): string | null {
  const suffix = relative(parent, target)
  return suffix && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`) ? suffix : null
}

async function reviewPaths(sourcePath: string, targetPath: string, isAllowed: AllowedPath) {
  const source = await assertReviewSource(sourcePath, isAllowed)
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath)) return unsafe()
  const reviewDir = join(dirname(source), '.review')
  const requestedTarget = resolve(targetPath)
  if (targetPath.split(sep).some((part) => part === '.' || part === '..')) return unsafe()
  let suffix = childPath(reviewDir, requestedTarget)

  // Root aliases may occur before .review; links inside .review are never followed.
  if (suffix === null && await realpath(dirname(sourcePath)) === dirname(source)) {
    suffix = childPath(join(resolve(dirname(sourcePath)), '.review'), requestedTarget)
  }
  if (suffix === null) return unsafe()
  const target = join(reviewDir, suffix)
  const parts = ['.review', ...suffix.split(sep)]
  let current = dirname(source)
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index])
    const entry = await lstat(current).catch((error: unknown) => {
      if (missing(error)) return null
      throw error
    })
    if (!entry) continue
    if (entry.isSymbolicLink()) return unsafe()
    if (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile()) return unsafe()
  }
  if (!(await isAllowed(source)) || !(await isAllowed(target))) return unsafe()
  return { source, target }
}

export async function assertReviewPath(sourcePath: string, targetPath: string, isAllowed: AllowedPath): Promise<void> {
  await reviewPaths(sourcePath, targetPath, isAllowed)
}

export async function readReviewFile(sourcePath: string, targetPath: string, isAllowed: AllowedPath): Promise<string | null> {
  const { target } = await reviewPaths(sourcePath, targetPath, isAllowed)
  try {
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      return await handle.readFile('utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (missing(error)) return null
    if ((error as NodeJS.ErrnoException)?.code === 'ELOOP') return unsafe()
    throw error
  }
}

export async function writeReviewFile(sourcePath: string, targetPath: string, content: string, isAllowed: AllowedPath): Promise<void> {
  const { source, target } = await reviewPaths(sourcePath, targetPath, isAllowed)
  await mkdir(dirname(target), { recursive: true })
  await assertReviewPath(source, target, isAllowed)
  const temporary = `${target}.${randomBytes(16).toString('hex')}.tmp`
  let created = false
  try {
    const handle = await open(temporary, 'wx', 0o600)
    created = true
    try {
      await handle.writeFile(content, 'utf8')
    } finally {
      await handle.close()
    }
    await assertReviewPath(source, temporary, isAllowed)
    await assertReviewPath(source, target, isAllowed)
    await rename(temporary, target)
  } finally {
    if (created) await rm(temporary, { force: true })
  }
}
