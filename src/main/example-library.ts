import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const excludedDirectories = new Set(['node_modules', 'out', 'dist', 'build'])
type ExampleFile = { source: string; relative: string }

function unsafe(): never { throw new Error('EXAMPLE_PATH_UNSAFE') }
function errorCode(error: unknown) { return (error as NodeJS.ErrnoException)?.code }
async function entry(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  })
}
function inside(parent: string, child: string) {
  const suffix = relative(parent, child)
  return suffix === '' || !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
}

// Existing parent aliases, including macOS /tmp, are allowed. A dangling alias is not.
async function canonicalParent(path: string): Promise<string> {
  let current = path
  const suffix: string[] = []
  while (true) {
    try { return join(await realpath(current), ...suffix) } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
      const appeared = await entry(current)
      if (appeared) {
        if (appeared.isSymbolicLink() || !appeared.isDirectory()) return unsafe()
        return join(await realpath(current), ...suffix)
      }
      const parent = dirname(current)
      if (parent === current) return unsafe()
      suffix.unshift(basename(current))
      current = parent
    }
  }
}

async function sourceFiles(root: string): Promise<ExampleFile[]> {
  const result: ExampleFile[] = []
  async function visit(directory: string, parts: string[]) {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      if (child.name.startsWith('.')) continue
      const path = join(directory, child.name)
      if (child.isSymbolicLink()) return unsafe()
      if (child.isDirectory()) {
        if (!excludedDirectories.has(child.name)) await visit(path, [...parts, child.name])
      } else if (child.isFile() && (/\.(md|markdown)$/i.test(child.name) || parts.includes('assets'))) {
        result.push({ source: path, relative: join(...parts, child.name) })
      }
    }
  }
  await visit(root, [])
  return result
}

async function assertTarget(root: string, path: string, kind: 'file' | 'directory') {
  if (!inside(root, path)) return unsafe()
  const suffix = relative(root, path)
  const parts = suffix ? suffix.split(sep) : []
  let current = root
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = join(current, parts[index])
    const found = await entry(current)
    if (!found) continue
    if (found.isSymbolicLink()) return unsafe()
    const directory = index < parts.length - 1 || kind === 'directory'
    if (directory ? !found.isDirectory() : !found.isFile()) return unsafe()
  }
  const foundRoot = await entry(root)
  if (foundRoot && await realpath(root) !== root) return unsafe()
}

async function rejectExistingLinks(directory: string) {
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, child.name)
    const found = await entry(path)
    if (!found) continue
    if (found.isSymbolicLink()) return unsafe()
    if (found.isDirectory()) await rejectExistingLinks(path)
  }
}

async function fillFile(root: string, file: ExampleFile) {
  const target = join(root, file.relative)
  await assertTarget(root, target, 'file')
  if (await entry(target)) return
  await mkdir(dirname(target), { recursive: true })
  await assertTarget(root, target, 'file')
  const temporary = join(dirname(target), `.md-duck-example-${randomUUID()}.tmp`)
  let created = false
  try {
    const output = await open(temporary, 'wx', 0o600)
    created = true
    try {
      const input = await open(file.source, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if (!(await input.stat()).isFile()) return unsafe()
        await output.writeFile(await input.readFile())
      } finally { await input.close() }
      await output.sync()
    } finally { await output.close() }
    await assertTarget(root, temporary, 'file')
    await assertTarget(root, target, 'file')
    try {
      // An atomic hard link publishes a complete file without replacing a user's file.
      await link(temporary, target)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      await assertTarget(root, target, 'file')
    }
  } finally {
    if (created) await unlink(temporary).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
  }
}

/** Seed writable examples once and fill only missing files on subsequent opens. */
export async function prepareExampleLibrary(sourceDir: string, targetDir: string): Promise<string> {
  if (typeof sourceDir !== 'string' || typeof targetDir !== 'string' || !isAbsolute(sourceDir) || !isAbsolute(targetDir)) return unsafe()
  const source = await realpath(sourceDir)
  if (!(await entry(source))?.isDirectory()) return unsafe()
  const requestedTarget = resolve(targetDir)
  if ((await entry(requestedTarget))?.isSymbolicLink()) return unsafe()
  const target = join(await canonicalParent(dirname(requestedTarget)), basename(requestedTarget))
  if (inside(source, target) || inside(target, source)) return unsafe()
  const files = await sourceFiles(source)
  await assertTarget(target, target, 'directory')
  await mkdir(target, { recursive: true })
  await assertTarget(target, target, 'directory')
  await rejectExistingLinks(target)
  for (const file of files) await fillFile(target, file)
  return target
}
