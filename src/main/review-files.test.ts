import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPathInsideRoot } from './allowed-path'
import { assertReviewPath, assertReviewSource, readReviewFile, writeReviewFile } from './review-files'

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

afterEach(async () => { await rm(sandbox, { recursive: true, force: true }) })

describe('review file boundaries', () => {
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
    await expect(assertReviewPath(source, `${root}/.review/linked/../notes.json`, isAllowed)).rejects.toThrow('REVIEW_PATH_UNSAFE')
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
