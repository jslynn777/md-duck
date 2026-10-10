import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { lstat, mkdtemp, readFile, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { withFileTransaction } from './file-transaction'

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

let root: string
const children = new Set<ChildProcess>()
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'md-duck-file-transaction-')))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit')
      child.kill('SIGKILL')
      await ended
    }
  }))
  children.clear()
  await rm(root, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

async function childFixture() {
  for (const name of ['note-queue', 'file-transaction']) {
    const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8')
    let compiled = stripTypeScriptTypes(source).replace("from './note-queue'", "from './note-queue.mjs'")
    if (!platform.noFollow) {
      // Run real child processes through the same unavailable-constant branch
      // as Windows, rather than only exercising a mocked in-process queue.
      compiled = compiled.replace("import { constants } from 'node:fs'", "import { constants as nativeConstants } from 'node:fs'\nconst constants = { ...nativeConstants, O_NOFOLLOW: undefined }")
    }
    await writeFile(join(root, `${name}.mjs`), compiled)
  }
  const runner = join(root, 'worker.cjs')
  await writeFile(runner, `
const fs = require('node:fs/promises');
const transactionModule = import('./file-transaction.mjs');
const [resource, name, mode] = process.argv.slice(2);
process.once('message', async () => {
  try {
    const { withFileTransaction } = await transactionModule;
    await withFileTransaction(resource, async () => {
      if (mode === 'crash') {
        process.send({ type: 'entered' }, () => process.exit(0));
        await new Promise(() => {});
      }
      process.send({ type: 'entered' });
      const saved = JSON.parse(await fs.readFile(resource, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 120));
      saved.push(name);
      await fs.writeFile(resource, JSON.stringify(saved));
    });
    process.send({ type: 'done' }, () => process.disconnect());
  } catch (error) {
    process.send({ type: 'failed', error: String(error) }, () => { process.exitCode = 1; process.disconnect(); });
  }
});
process.send({ type: 'ready' });
`)
  return runner
}

function launch(runner: string, resource: string, name: string, mode = 'write') {
  const child = fork(runner, [resource, name, mode], { silent: true })
  children.add(child)
  const ready = deferred<void>()
  const entered = deferred<void>()
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  child.on('message', (message: unknown) => {
    const data = message as { type?: string; error?: string }
    if (data.type === 'ready') ready.resolve()
    if (data.type === 'entered') entered.resolve()
    if (data.type === 'failed') stderr += data.error
  })
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Child ${name} exited ${code ?? signal}: ${stderr}`))
    })
  })
  // The child may fail before the test has reached its final await.
  void finished.catch(() => undefined)
  return { child, ready: ready.promise, entered: entered.promise, finished }
}

async function abandonedLock(resource: string, runner: string) {
  const child = launch(runner, resource, 'dead-owner', 'crash')
  await child.ready
  child.child.send('start')
  await child.entered
  await child.finished
  return JSON.parse(await readFile(`${resource}.lock`, 'utf8')) as { pid: number; token: string; hostname: string }
}

describe.each([true, false])('file transactions (native O_NOFOLLOW: %s)', (noFollow) => {
  beforeEach(() => { platform.noFollow = noFollow })
  it('serializes same-process reads and writes, and returns each task result', async () => {
    const resource = join(root, 'notes.json')
    await writeFile(resource, JSON.stringify(['original']))
    const firstEntered = deferred<void>()
    const finishFirst = deferred<void>()
    const first = withFileTransaction(resource, async () => {
      const saved = JSON.parse(await readFile(resource, 'utf8')) as string[]
      firstEntered.resolve()
      await finishFirst.promise
      await writeFile(resource, JSON.stringify([...saved, 'one']))
      return 'first'
    })
    let secondEntered = false
    const second = withFileTransaction(resource, async () => {
      secondEntered = true
      const saved = JSON.parse(await readFile(resource, 'utf8')) as string[]
      await writeFile(resource, JSON.stringify([...saved, 'two']))
      return 2
    })
    await firstEntered.promise
    expect(secondEntered).toBe(false)
    finishFirst.resolve()
    expect(await Promise.all([first, second])).toEqual(['first', 2])
    expect(JSON.parse(await readFile(resource, 'utf8'))).toEqual(['original', 'one', 'two'])
    expect(await lstat(`${resource}.lock`).catch(() => null)).toBeNull()
  })

  it('preserves both read-modify-write changes from two real child processes', async () => {
    const resource = join(root, 'notes.json')
    await writeFile(resource, JSON.stringify(['original']))
    const runner = await childFixture()
    const one = launch(runner, resource, 'one')
    const two = launch(runner, resource, 'two')
    await Promise.all([one.ready, two.ready])
    one.child.send('start')
    two.child.send('start')
    await Promise.all([one.finished, two.finished])
    expect(JSON.parse(await readFile(resource, 'utf8')).sort()).toEqual(['one', 'original', 'two'])
    expect(await lstat(`${resource}.lock`).catch(() => null)).toBeNull()
  })

  it('releases a failed task and allows the next transaction to run', async () => {
    const resource = join(root, 'notes.json')
    const failure = new Error('Write failed')
    const rejected = withFileTransaction(resource, async () => { throw failure })
    const next = withFileTransaction(resource, async () => 'next saved')
    await expect(rejected).rejects.toBe(failure)
    expect(await next).toBe('next saved')
    expect(await lstat(`${resource}.lock`).catch(() => null)).toBeNull()
  })

  it('recovers a confirmed dead owner and an abandoned cleanup guard', async () => {
    const resource = join(root, 'notes.json')
    const runner = await childFixture()
    const dead = await abandonedLock(resource, runner)
    await writeFile(`${resource}.lock.recovery`, JSON.stringify({ ...dead, token: 'dead-cleanup-owner' }))
    expect(await withFileTransaction(resource, async () => 'recovered')).toBe('recovered')
    expect(await lstat(`${resource}.lock`).catch(() => null)).toBeNull()
    expect(await lstat(`${resource}.lock.recovery`).catch(() => null)).toBeNull()
    expect(await lstat(`${resource}.lock.recovery.recovery`).catch(() => null)).toBeNull()
  })

  it('keeps both changes when two processes concurrently recover the same dead lock', async () => {
    const resource = join(root, 'notes.json')
    await writeFile(resource, JSON.stringify(['original']))
    const runner = await childFixture()
    await abandonedLock(resource, runner)
    const one = launch(runner, resource, 'one')
    const two = launch(runner, resource, 'two')
    await Promise.all([one.ready, two.ready])
    one.child.send('start')
    two.child.send('start')
    await Promise.all([one.finished, two.finished])
    expect(JSON.parse(await readFile(resource, 'utf8')).sort()).toEqual(['one', 'original', 'two'])
  })

  it('times out on a live owner even when the lock timestamp is very old', async () => {
    const resource = join(root, 'notes.json')
    const record = JSON.stringify({ pid: process.pid, token: 'live-owner', hostname: hostname() })
    await writeFile(`${resource}.lock`, record)
    await utimes(`${resource}.lock`, new Date(0), new Date(0))
    let ran = false
    await expect(withFileTransaction(resource, async () => { ran = true }, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'REVIEW_STORAGE_BUSY' })
    expect(ran).toBe(false)
    expect(await readFile(`${resource}.lock`, 'utf8')).toBe(record)
  })

  it('does not reclaim a lock with an unidentifiable owner', async () => {
    const resource = join(root, 'notes.json')
    await writeFile(`${resource}.lock`, '')
    await expect(withFileTransaction(resource, async () => 'not run', { timeoutMs: 5 })).rejects.toThrow('REVIEW_STORAGE_BUSY')
    expect(await readFile(`${resource}.lock`, 'utf8')).toBe('')
  })

  it('rejects a symlink lock without reading or changing the linked file', async () => {
    const resource = join(root, 'notes.json')
    const target = join(root, 'untouched.json')
    const content = 'Do not follow this file'
    await writeFile(target, content)
    await symlink(target, `${resource}.lock`)
    await expect(withFileTransaction(resource, async () => 'not run', { timeoutMs: 5 })).rejects.toThrow('REVIEW_STORAGE_BUSY')
    expect((await lstat(`${resource}.lock`)).isSymbolicLink()).toBe(true)
    expect(await readFile(target, 'utf8')).toBe(content)
  })

  it.each(['another file', 'the original inode'])('rejects a lock swapped to a symlink to %s between lstat and open', async (destination) => {
    const resource = join(root, 'notes.json')
    const lock = `${resource}.lock`
    const detached = join(root, 'detached.lock')
    const outside = join(root, 'untouched.json')
    const content = JSON.stringify({ pid: process.pid, token: 'live-owner', hostname: hostname() })
    await writeFile(lock, content)
    await writeFile(outside, 'Do not read or change this file')
    const originalOpen = fs.open
    let swapped = false
    const reads = vi.fn()
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (path === lock && typeof flags === 'number' && !(flags & constants.O_CREAT)) {
        if (!swapped) {
          swapped = true
          await rename(lock, detached)
          await symlink(destination === 'the original inode' ? detached : outside, lock)
        }
        const handle = await originalOpen(path, flags, mode)
        vi.spyOn(handle, 'readFile').mockImplementation(reads)
        return handle
      }
      return originalOpen(path, flags, mode)
    })
    let ran = false
    await expect(withFileTransaction(resource, async () => { ran = true }, { timeoutMs: 5 })).rejects.toThrow('REVIEW_STORAGE_BUSY')
    expect(swapped).toBe(true)
    expect(ran).toBe(false)
    expect(reads).not.toHaveBeenCalled()
    expect((await lstat(lock)).isSymbolicLink()).toBe(true)
    expect(await readFile(detached, 'utf8')).toBe(content)
    expect(await readFile(outside, 'utf8')).toBe('Do not read or change this file')
  })

  it('compares large file IDs exactly before reading lock content', async () => {
    const resource = join(root, 'notes.json')
    const lock = `${resource}.lock`
    const content = JSON.stringify({ pid: process.pid, token: 'live-owner', hostname: hostname() })
    await writeFile(lock, content)
    // These two file IDs are different BigInts but collapse to the same Number.
    const inode = 2n ** 53n
    expect(Number(inode)).toBe(Number(inode + 1n))
    const originalLstat = fs.lstat
    vi.spyOn(fs, 'lstat').mockImplementation((async (path, options) => {
      const stat = await originalLstat(path, options)
      if (path === lock) Object.assign(stat, { dev: 1n, ino: inode })
      return stat
    }) as typeof lstat)
    const originalOpen = fs.open
    const reads = vi.fn()
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await originalOpen(path, flags, mode)
      if (path === lock && typeof flags === 'number' && !(flags & constants.O_CREAT)) {
        const stat = await handle.stat({ bigint: true })
        vi.spyOn(handle, 'stat').mockResolvedValue(Object.assign(stat, { dev: 1n, ino: inode + 1n }))
        vi.spyOn(handle, 'readFile').mockImplementation(reads)
      }
      return handle
    })
    await expect(withFileTransaction(resource, async () => 'not run', { timeoutMs: 5 })).rejects.toThrow('REVIEW_STORAGE_BUSY')
    expect(reads).not.toHaveBeenCalled()
    expect(await readFile(lock, 'utf8')).toBe(content)
  })

  it('leaves a replacement lock owned by another token and inode untouched', async () => {
    const resource = join(root, 'notes.json')
    const other = JSON.stringify({ pid: process.pid, token: 'replacement', hostname: hostname() })
    expect(await withFileTransaction(resource, async () => {
      await rename(`${resource}.lock`, join(root, 'detached.lock'))
      await writeFile(`${resource}.lock`, other)
      return 'saved'
    })).toBe('saved')
    expect(await readFile(`${resource}.lock`, 'utf8')).toBe(other)
  })

  it('leaves a replacement made while the owner record is being read untouched', async () => {
    const resource = join(root, 'notes.json')
    const lock = `${resource}.lock`
    const other = JSON.stringify({ pid: process.pid, token: 'replacement', hostname: hostname() })
    const originalOpen = fs.open
    let replaced = false
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await originalOpen(path, flags, mode)
      if (path === lock && typeof flags === 'number' && !(flags & constants.O_CREAT)) {
        const originalRead = handle.readFile.bind(handle)
        vi.spyOn(handle, 'readFile').mockImplementation((async (...args: Parameters<typeof originalRead>) => {
          const record = await originalRead(...args)
          if (!replaced) {
            replaced = true
            await rename(lock, join(root, 'detached.lock'))
            await writeFile(lock, other)
          }
          return record
        }) as typeof handle.readFile)
      }
      return handle
    })
    expect(await withFileTransaction(resource, async () => 'saved')).toBe('saved')
    expect(replaced).toBe(true)
    expect(await readFile(lock, 'utf8')).toBe(other)
  })

  it('does not block a different resource behind a running transaction', async () => {
    const entered = deferred<void>()
    const finish = deferred<void>()
    const first = withFileTransaction(join(root, 'one.json'), async () => {
      entered.resolve()
      await finish.promise
    })
    await entered.promise
    try {
      expect(await withFileTransaction(join(root, 'two.json'), async () => 'independent')).toBe('independent')
    } finally {
      finish.resolve()
      await first
    }
  })
})
