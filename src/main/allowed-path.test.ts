import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPathInsideRoot } from './allowed-path'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>()
}))

let sandbox: string
let root: string
let outside: string
beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'md-duck-paths-')))
  root = join(sandbox, 'articles')
  outside = join(sandbox, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
})
afterEach(async () => { vi.restoreAllMocks(); await rm(sandbox, { recursive: true, force: true }) })

describe('allowed reading and translation paths', () => {
  it('allows ordinary existing reading files and new metadata paths', async () => {
    const article = join(root, 'notes.md')
    await writeFile(article, '# Notes')
    expect(await isPathInsideRoot(article, root)).toBe(true)
    expect(await isPathInsideRoot(root, root)).toBe(true)
    expect(await isPathInsideRoot(join(root, '.review', 'translations', 'draft.json'), root)).toBe(true)
  })

  it('allows a new directory and file under a root alias like /tmp', async () => {
    const alias = join(sandbox, 'alias')
    await symlink(root, alias, 'dir')
    expect(await isPathInsideRoot(join(alias, '.review', 'translations', 'draft.json'), root)).toBe(true)
    expect(await isPathInsideRoot(join(root, 'notes.zh.md'), alias)).toBe(true)
    expect(await isPathInsideRoot(join(alias, 'new-folder', 'notes.md'), alias)).toBe(true)
  })

  it('allows a directory created by another save between realpath and lstat', async () => {
    const review = join(root, '.review')
    const original = fs.realpath
    let created = false
    vi.spyOn(fs, 'realpath').mockImplementation((async (path: string) => {
      try { return await original(path) } catch (error) {
        if (path === review && !created) {
          created = true
          await mkdir(review)
        }
        throw error
      }
    }) as typeof realpath)
    expect(await isPathInsideRoot(join(review, 'documents', 'notes.json'), root)).toBe(true)
    expect(created).toBe(true)
  })

  it.each(['outside', 'dangling'])('rejects a %s symlink created between realpath and lstat', async (kind) => {
    const review = join(root, '.review')
    const original = fs.realpath
    let created = false
    vi.spyOn(fs, 'realpath').mockImplementation((async (path: string) => {
      try { return await original(path) } catch (error) {
        if (path === review && !created) {
          created = true
          await symlink(kind === 'outside' ? outside : join(outside, 'missing'), review, 'dir')
        }
        throw error
      }
    }) as typeof realpath)
    expect(await isPathInsideRoot(join(review, 'documents', 'notes.json'), root)).toBe(false)
    expect(created).toBe(true)
  })

  it('rejects existing outside files', async () => {
    const article = join(outside, 'private.md')
    await writeFile(article, '# Outside')
    expect(await isPathInsideRoot(article, root)).toBe(false)
  })

  it('rejects missing files reached through a symlink to an outside directory', async () => {
    const escape = join(root, 'linked-folder')
    await symlink(outside, escape, 'dir')
    expect(await isPathInsideRoot(join(escape, 'not-created', 'notes.md'), root)).toBe(false)
  })

  it('rejects dangling symlinks and descendants instead of treating them as missing directories', async () => {
    const broken = join(root, 'broken')
    await symlink(join(outside, 'not-created'), broken, 'dir')
    expect(await isPathInsideRoot(broken, root)).toBe(false)
    expect(await isPathInsideRoot(join(broken, 'nested', 'notes.md'), root)).toBe(false)
  })

  it('rejects sibling directories that merely share the root name prefix', async () => {
    const sibling = `${root}-private`
    await mkdir(sibling)
    expect(await isPathInsideRoot(join(sibling, 'notes.md'), root)).toBe(false)
  })

  it('requires an existing selected root and an absolute file path', async () => {
    expect(await isPathInsideRoot(join(root, 'notes.md'), null)).toBe(false)
    expect(await isPathInsideRoot(join(root, 'notes.md'), join(sandbox, 'missing-root'))).toBe(false)
    expect(await isPathInsideRoot('notes.md', root)).toBe(false)
  })
})
