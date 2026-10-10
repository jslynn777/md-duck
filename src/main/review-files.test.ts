import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { isPathInsideRoot } from './allowed-path'
import { assertReviewPath, assertReviewSource, readReviewFile, writeReviewFile } from './review-files'

const platform = vi.hoisted(() => ({ noFollow: true }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    constants: {
      ...actual.constants,
      get O_NOFOLLOW() { return platform.noFollow ? actual.constants.O_NOFOLLOW : undefined }
    }
  }
})
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>()
}))

let sandbox: string
let root: string
let outside: string
let source: string
let target: string
const isAllowed = (path: string) => isPathInsideRoot(path, root)

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'md-duck-review-files-')))
  root = join(sandbox, 'articles')
  outside = join(sandbox, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
  source = join(root, 'article.md')
  target = join(root, '.review', 'notes.json')
  await writeFile(source, '# Article')
})

afterEach(async () => { vi.restoreAllMocks(); await rm(sandbox, { recursive: true, force: true }) })

describe.each([true, false])('review file boundaries (native O_NOFOLLOW: %s)', (noFollow) => {
  beforeEach(() => { platform.noFollow = noFollow })
  it('reads and atomically replaces ordinary review files, leaving no temporary files', async () => {
    expect(await assertReviewSource(source, isAllowed)).toBe(source)
    expect(await readReviewFile(source, target, isAllowed)).toBeNull()
    await writeReviewFile(source, target, 'first', isAllowed)
    await writeReviewFile(source, target, 'second', isAllowed)
    expect(await readReviewFile(source, target, isAllowed)).toBe('second')
    expect(await readdir(join(root, '.review'))).toEqual(['notes.json'])
    expect(await readFile(source, 'utf8')).toBe('# Article')
  })

  it('supports a selected root alias without allowing aliases inside .review', async () => {
    const alias = join(sandbox, 'selected-root')
    await symlink(root, alias, 'dir')
    const aliasSource = join(alias, 'article.md')
    const aliasTarget = join(alias, '.review', 'nested', 'notes.json')
    const allowedAlias = (path: string) => isPathInsideRoot(path, alias)
    expect(await assertReviewSource(aliasSource, allowedAlias)).toBe(source)
    await writeReviewFile(aliasSource, aliasTarget, 'aliased', allowedAlias)
    expect(await readReviewFile(aliasSource, aliasTarget, allowedAlias)).toBe('aliased')
    expect(await readFile(join(root, '.review', 'nested', 'notes.json'), 'utf8')).toBe('aliased')
  })

  it('returns null only for a missing target and does not create directories while reading', async () => {
    expect(await readReviewFile(source, target, isAllowed)).toBeNull()
    expect(await readdir(root)).toEqual(['article.md'])
    await mkdir(target, { recursive: true })
    await expect(readReviewFile(source, target, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
  })

  it('rejects missing, non-Markdown and directory sources', async () => {
    const text = join(root, 'file.txt')
    const directory = join(root, 'directory.md')
    await writeFile(text, 'Not Markdown')
    await mkdir(directory)
    for (const input of [join(root, 'missing.md'), text, directory, 'relative.md']) {
      await expect(assertReviewSource(input, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
      await expect(readReviewFile(input, target, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    }
  })

  it('rejects a source outside the selected library and a symlink pointing to it', async () => {
    const externalSource = join(outside, 'private.md')
    const linkedSource = join(root, 'linked.md')
    await writeFile(externalSource, '# Private')
    await symlink(externalSource, linkedSource)
    for (const input of [externalSource, linkedSource]) {
      await expect(assertReviewSource(input, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    }
  })

  it('rejects targets outside this document directory, including similarly named review folders', async () => {
    await mkdir(join(root, 'other'))
    for (const input of [join(outside, 'notes.json'), join(root, 'notes.json'), join(root, '.review-other', 'notes.json'), join(root, 'other', '.review', 'notes.json'), join(root, '.review'), 'notes.json']) {
      await expect(assertReviewPath(source, input, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
      await expect(writeReviewFile(source, input, 'blocked', isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    }
    for (const traversal of [`${root}${sep}.review${sep}linked${sep}..${sep}notes.json`, `${root}/.review/linked/../notes.json`]) {
      await expect(assertReviewPath(source, traversal, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    }
  })

  it.each(['outside', 'inside', 'dangling'] as const)('rejects a .review directory symlink pointing %s', async (location) => {
    const destination = location === 'outside' ? outside : join(root, location)
    if (location === 'inside') await mkdir(destination)
    if (location !== 'dangling') await writeFile(join(destination, 'notes.json'), 'keep original')
    await symlink(destination, join(root, '.review'), 'dir')
    await expect(readReviewFile(source, target, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    await expect(writeReviewFile(source, target, 'blocked', isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    if (location !== 'dangling') expect(await readFile(join(destination, 'notes.json'), 'utf8')).toBe('keep original')
  })

  it('rejects symlink descendants inside .review even when the link stays inside the library', async () => {
    const realDirectory = join(root, '.review', 'real')
    await mkdir(realDirectory, { recursive: true })
    await symlink(realDirectory, join(root, '.review', 'nested'), 'dir')
    const linkedTarget = join(root, '.review', 'nested', 'notes.json')
    await expect(readReviewFile(source, linkedTarget, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    await expect(writeReviewFile(source, linkedTarget, 'blocked', isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(await readdir(realDirectory)).toEqual([])
  })

  it.each(['outside', 'inside'] as const)('rejects a target file symlink pointing %s without overwriting it', async (location) => {
    await mkdir(join(root, '.review'))
    const destination = join(location === 'outside' ? outside : root, 'original.json')
    await writeFile(destination, 'keep original')
    await symlink(destination, target)
    await expect(readReviewFile(source, target, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    await expect(writeReviewFile(source, target, 'blocked', isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(await readFile(destination, 'utf8')).toBe('keep original')
  })

  it.each(['another file', 'the original inode'])('rejects a target substituted with a link to %s before reading its contents', async (destination) => {
    await writeReviewFile(source, target, 'keep original', isAllowed)
    const detached = join(root, '.review', 'detached.json')
    const external = join(outside, 'private.json')
    await writeFile(external, 'Never read this file')
    const originalOpen = fs.open
    const reads = vi.fn()
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (path === target && typeof flags === 'number' && !(flags & constants.O_CREAT)) {
        await rename(target, detached)
        await symlink(destination === 'the original inode' ? detached : external, target)
        const handle = await originalOpen(path, flags, mode)
        vi.spyOn(handle, 'readFile').mockImplementation(reads)
        return handle
      }
      return originalOpen(path, flags, mode)
    })
    await expect(readReviewFile(source, target, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(reads).not.toHaveBeenCalled()
    expect(await readFile(detached, 'utf8')).toBe('keep original')
    expect(await readFile(external, 'utf8')).toBe('Never read this file')
  })

  it('rejects a parent directory changed to a link back to the original file before reading bytes', async () => {
    await writeReviewFile(source, target, 'keep original', isAllowed)
    const review = join(root, '.review')
    const detached = join(root, 'detached-review')
    const originalOpen = fs.open
    const reads = vi.fn()
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (path === target && typeof flags === 'number' && !(flags & constants.O_CREAT)) {
        await rename(review, detached)
        await symlink(detached, review, 'dir')
        const handle = await originalOpen(path, flags, mode)
        vi.spyOn(handle, 'readFile').mockImplementation(reads)
        return handle
      }
      return originalOpen(path, flags, mode)
    })
    await expect(readReviewFile(source, target, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(reads).not.toHaveBeenCalled()
    expect(await readFile(join(detached, 'notes.json'), 'utf8')).toBe('keep original')
  })

  it('preserves the previous file and removes the temporary when permission is revoked before publication', async () => {
    await writeReviewFile(source, target, 'keep original', isAllowed)
    const revokedDuringWrite = async (path: string) => !path.endsWith('.tmp') && isAllowed(path)
    await expect(writeReviewFile(source, target, 'blocked', revokedDuringWrite)).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(await readFile(target, 'utf8')).toBe('keep original')
    expect(await readdir(join(root, '.review'))).toEqual(['notes.json'])
  })

  it('cancels a pending write after the user switches the selected library', async () => {
    await writeReviewFile(source, target, 'keep original', isAllowed)
    let selectedRoot = root
    let resume!: () => void
    let signalReady!: () => void
    const paused = new Promise<void>((resolve) => { resume = resolve })
    const ready = new Promise<void>((resolve) => { signalReady = resolve })
    const selectedLibraryAllows = async (path: string) => {
      if (path.endsWith('.tmp')) {
        signalReady()
        await paused
      }
      return isPathInsideRoot(path, selectedRoot)
    }
    const pending = writeReviewFile(source, target, 'new value', selectedLibraryAllows)
    await ready
    selectedRoot = outside
    resume()
    await expect(pending).rejects.toThrow('REVIEW_PATH_UNSAFE')
    expect(await readFile(target, 'utf8')).toBe('keep original')
    expect(await readdir(join(root, '.review'))).toEqual(['notes.json'])
    expect(await readdir(outside)).toEqual([])
  })
})
