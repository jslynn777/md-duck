import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareExampleLibrary } from './example-library'

let sandbox: string
let source: string
let target: string
const article = '# A small example\n\nRead and annotate this text.\n'
const asset = Buffer.from([0, 137, 80, 78, 71, 255, 10, 0, 128])

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'md-duck-examples-')))
  source = join(sandbox, 'bundled')
  target = join(sandbox, 'user-data', 'examples')
  await mkdir(join(source, 'article', 'assets'), { recursive: true })
  await writeFile(join(source, 'article', 'article.md'), article)
  await writeFile(join(source, 'article', 'article.zh.md'), '# 简短示例\n')
  await writeFile(join(source, 'article', 'assets', 'picture.png'), asset)
  await writeFile(join(source, 'plain.markdown'), '# Plain\n')
})
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }) })

describe('writable built-in example library', () => {
  it('copies Markdown and binary assets into a new writable library', async () => {
    expect(await prepareExampleLibrary(source, target)).toBe(target)
    expect(await readFile(join(target, 'article', 'article.md'), 'utf8')).toBe(article)
    expect(await readFile(join(target, 'article', 'article.zh.md'), 'utf8')).toBe('# 简短示例\n')
    expect(await readFile(join(target, 'article', 'assets', 'picture.png'))).toEqual(asset)
    expect(await readFile(join(target, 'plain.markdown'), 'utf8')).toBe('# Plain\n')
    await writeFile(join(target, 'article', 'article.md'), 'A writable copy')
    expect(await readFile(join(source, 'article', 'article.md'), 'utf8')).toBe(article)
  })

  it('preserves edited articles, user assets, and annotation data on later opens', async () => {
    await prepareExampleLibrary(source, target)
    const review = join(target, 'article', '.review', 'documents', 'notes.json')
    await mkdir(dirname(review), { recursive: true })
    await writeFile(review, '{"notes":["my own annotation"]}')
    await writeFile(join(target, 'article', 'article.md'), 'My edited article')
    await writeFile(join(target, 'article', 'assets', 'picture.png'), Buffer.from([42]))
    await writeFile(join(source, 'article', 'article.md'), 'A bundled update')
    await prepareExampleLibrary(source, target)
    expect(await readFile(join(target, 'article', 'article.md'), 'utf8')).toBe('My edited article')
    expect(await readFile(join(target, 'article', 'assets', 'picture.png'))).toEqual(Buffer.from([42]))
    expect(await readFile(review, 'utf8')).toBe('{"notes":["my own annotation"]}')
  })

  it('fills missing files after interruption and adds newly bundled examples', async () => {
    await mkdir(join(target, 'article', 'assets'), { recursive: true })
    await writeFile(join(target, 'article', 'article.md'), 'Existing user content')
    await writeFile(join(target, 'article', '.md-duck-example-interrupted.tmp'), 'incomplete staging data')
    await writeFile(join(source, 'new.md'), '# New example\n')
    await prepareExampleLibrary(source, target)
    expect(await readFile(join(target, 'article', 'article.md'), 'utf8')).toBe('Existing user content')
    expect(await readFile(join(target, 'article', 'article.zh.md'), 'utf8')).toBe('# 简短示例\n')
    expect(await readFile(join(target, 'article', 'assets', 'picture.png'))).toEqual(asset)
    expect(await readFile(join(target, 'new.md'), 'utf8')).toBe('# New example\n')
  })

  it('excludes hidden files, review data, build directories, and unrelated files from the source', async () => {
    for (const folder of ['.review', '.private', 'node_modules', 'dist', 'out', 'build']) {
      await mkdir(join(source, folder))
      await writeFile(join(source, folder, 'private.md'), 'Not an example')
    }
    await writeFile(join(source, '.DS_Store'), 'private metadata')
    await writeFile(join(source, 'settings.json'), '{"private":true}')
    await writeFile(join(source, 'article', 'assets', '.secret'), 'do not copy')
    await prepareExampleLibrary(source, target)
    expect((await readdir(target)).sort()).toEqual(['article', 'plain.markdown'])
    expect(await readdir(join(target, 'article', 'assets'))).toEqual(['picture.png'])
  })

  it('accepts an aliased parent directory and returns the canonical target', async () => {
    const userData = dirname(target)
    const alias = join(sandbox, 'user-data-alias')
    await mkdir(userData)
    await symlink(userData, alias, 'dir')
    expect(await prepareExampleLibrary(source, join(alias, 'examples'))).toBe(target)
    expect(await readFile(join(target, 'plain.markdown'), 'utf8')).toBe('# Plain\n')
  })

  it.each(['root', 'directory', 'file', 'review'] as const)('rejects a target %s symlink without modifying its destination', async (kind) => {
    const outside = join(sandbox, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'original.md'), 'Leave me alone')
    if (kind === 'root') {
      await mkdir(dirname(target))
      await symlink(outside, target, 'dir')
    } else {
      await mkdir(join(target, 'article'), { recursive: true })
      if (kind === 'directory') await symlink(outside, join(target, 'article', 'assets'), 'dir')
      if (kind === 'file') await symlink(join(outside, 'original.md'), join(target, 'article', 'article.md'))
      if (kind === 'review') await symlink(outside, join(target, 'article', '.review'), 'dir')
    }
    await expect(prepareExampleLibrary(source, target)).rejects.toThrow('EXAMPLE_PATH_UNSAFE')
    expect(await readdir(outside)).toEqual(['original.md'])
    expect(await readFile(join(outside, 'original.md'), 'utf8')).toBe('Leave me alone')
  })

  it('rejects a dangling target link and never creates its external destination', async () => {
    await mkdir(dirname(target), { recursive: true })
    const absent = join(sandbox, 'absent')
    await symlink(absent, target, 'dir')
    await expect(prepareExampleLibrary(source, target)).rejects.toThrow('EXAMPLE_PATH_UNSAFE')
    await expect(readdir(absent)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('handles concurrent first opens without overwriting or leaving partially published files', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => prepareExampleLibrary(source, target)))
    expect(results.every((path) => path === target)).toBe(true)
    expect(await readFile(join(target, 'article', 'article.md'), 'utf8')).toBe(article)
    expect(await readFile(join(target, 'article', 'assets', 'picture.png'))).toEqual(asset)
    expect((await readdir(join(target, 'article'))).sort()).toEqual(['article.md', 'article.zh.md', 'assets'])
  })

  it('rejects overlapping source and target directories', async () => {
    await expect(prepareExampleLibrary(source, source)).rejects.toThrow('EXAMPLE_PATH_UNSAFE')
    await expect(prepareExampleLibrary(source, join(source, 'copy'))).rejects.toThrow('EXAMPLE_PATH_UNSAFE')
    await expect(prepareExampleLibrary(source, sandbox)).rejects.toThrow('EXAMPLE_PATH_UNSAFE')
  })
})
