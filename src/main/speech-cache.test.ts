import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSpeechCache, speechCacheFile, writeSpeechCache } from './speech-cache'

let root: string
let cache: string
const voice = 'af_heart'
const text = 'Hello world.'
const audio = Float32Array.of(0, 0.25, -0.1, 0)
const bytes = (samples: Float32Array) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-speech-cache-'))); cache = join(root, 'cache') })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('optional speech audio cache', () => {
  it('publishes a complete audio file atomically and reads it without modifying it', async () => {
    expect(await writeSpeechCache(cache, voice, 1, text, audio)).toBe(true)
    const file = speechCacheFile(cache, voice, 1, text)
    const before = await fs.stat(file)
    expect(await fs.readFile(file)).toEqual(bytes(audio))
    expect(await readSpeechCache(cache, voice, 1, text)).toEqual(audio)
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs)
    expect(await fs.readdir(cache)).toEqual([file.split(/[\\/]/).at(-1)])
  })

  it.each([
    ['empty', Buffer.alloc(0)], ['partial', Buffer.from([1])], ['non-finite', bytes(Float32Array.of(NaN, 0.1))],
    ['infinite', bytes(Float32Array.of(Infinity, -0.1))], ['silence', bytes(Float32Array.of(0, 0, 0))]
  ])('treats %s cached audio as a miss, preserving it until a complete replacement exists', async (_name, corrupt) => {
    await fs.mkdir(cache)
    const file = speechCacheFile(cache, voice, 1, text)
    await fs.writeFile(file, corrupt)
    expect(await readSpeechCache(cache, voice, 1, text)).toBeNull()
    expect(await fs.readFile(file)).toEqual(corrupt)
    expect(await writeSpeechCache(cache, voice, 1, text, audio)).toBe(true)
    expect(await readSpeechCache(cache, voice, 1, text)).toEqual(audio)
    expect(await fs.readdir(cache)).toHaveLength(1)
  })

  it('never creates missing cache folders during reads or stores invalid generated samples', async () => {
    expect(await readSpeechCache(cache, voice, 1, text)).toBeNull()
    expect(await writeSpeechCache(cache, voice, 1, text, Float32Array.of(NaN))).toBe(false)
    expect(await fs.readdir(root)).toEqual([])
  })

  it('refuses a symlinked cache directory without reading or changing its destination', async () => {
    const external = join(root, 'external')
    await fs.mkdir(external)
    const file = speechCacheFile(external, voice, 1, text)
    await fs.writeFile(file, bytes(audio))
    await fs.symlink(external, cache, 'dir')
    expect(await readSpeechCache(cache, voice, 1, text)).toBeNull()
    expect(await writeSpeechCache(cache, voice, 1, text, Float32Array.of(0.5))).toBe(false)
    expect(await fs.readFile(file)).toEqual(bytes(audio))
    expect(await fs.readdir(external)).toHaveLength(1)
  })

  it('refuses symlinked cache files instead of reading or overwriting unrelated data', async () => {
    await fs.mkdir(cache)
    const external = join(root, 'outside.f32')
    await fs.writeFile(external, bytes(audio))
    const file = speechCacheFile(cache, voice, 1, text)
    await fs.symlink(external, file, 'file')
    expect(await readSpeechCache(cache, voice, 1, text)).toBeNull()
    expect(await writeSpeechCache(cache, voice, 1, text, Float32Array.of(0.5))).toBe(false)
    expect(await fs.readFile(external)).toEqual(bytes(audio))
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true)
  })

  it('uses exclusive random sibling temps and leaves an old predictable symlink untouched', async () => {
    await fs.mkdir(cache)
    const external = join(root, 'unrelated.txt')
    await fs.writeFile(external, 'keep this text')
    const predictable = `${speechCacheFile(cache, voice, 1, text)}.${process.pid}.tmp`
    await fs.symlink(external, predictable, 'file')
    expect(await writeSpeechCache(cache, voice, 1, text, audio)).toBe(true)
    expect(await fs.readFile(external, 'utf8')).toBe('keep this text')
    expect((await fs.lstat(predictable)).isSymbolicLink()).toBe(true)
    expect(await fs.readdir(cache)).toHaveLength(2)
  })

  it('cleans only its own temp after a publish failure and keeps old audio and unrelated temps', async () => {
    await fs.mkdir(cache)
    const file = speechCacheFile(cache, voice, 1, text)
    await fs.writeFile(file, Buffer.from([1]))
    const unrelated = join(cache, 'unrelated.tmp')
    await fs.writeFile(unrelated, 'keep')
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('disk unavailable'), { code: 'EACCES' }))
    try { expect(await writeSpeechCache(cache, voice, 1, text, audio)).toBe(false) }
    finally { rename.mockRestore() }
    expect(await fs.readFile(file)).toEqual(Buffer.from([1]))
    expect(await fs.readFile(unrelated, 'utf8')).toBe('keep')
    expect(await fs.readdir(cache)).toHaveLength(2)
  })

  it('treats a non-directory cache entry as optional and never modifies it', async () => {
    await fs.writeFile(cache, 'a file is in the way')
    expect(await readSpeechCache(cache, voice, 1, text)).toBeNull()
    expect(await writeSpeechCache(cache, voice, 1, text, audio)).toBe(false)
    expect(await fs.readFile(cache, 'utf8')).toBe('a file is in the way')
  })
})
