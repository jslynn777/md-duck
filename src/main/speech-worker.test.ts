import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { speechCacheFile } from './speech-cache'

const mocked = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('./kokoro-runtime', () => ({ KokoroRuntime: { create: mocked.create } }))

let listener: (event: { data: unknown }) => void
let messages: Array<Record<string, any>>
let previousPort: unknown
let worker: typeof import('./speech-worker')
beforeEach(async () => {
  vi.resetModules()
  mocked.create.mockReset()
  messages = []
  previousPort = (process as any).parentPort
  ;(process as any).parentPort = {
    on: (_event: string, handler: typeof listener) => { listener = handler },
    postMessage: (message: Record<string, any>) => messages.push(message)
  }
  worker = await import('./speech-worker')
  listener({ data: { type: 'init', cacheDir: '', modelDir: '/test/model-cache', voiceDirectory: '/test/voices' } })
})
afterEach(() => { (process as any).parentPort = previousPort })

const speak = (id: string) => listener({ data: { type: 'speak', id, text: 'Hello world.', voice: 'af_heart', speed: 1 } })
const tts = () => ({ generate: vi.fn(async () => ({ audio: Float32Array.of(0, 0.1, 0) })) })

describe('speech model preparation', () => {
  it('never downloads on initialization and begins preparing only after an explicit speak request', async () => {
    await Promise.resolve()
    expect(mocked.create).not.toHaveBeenCalled()
    expect(messages).toEqual([])
    mocked.create.mockResolvedValueOnce(tts())
    speak('first')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'first' }))
    expect(mocked.create).toHaveBeenCalledOnce()
    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ cacheDir: '/test/model-cache', voiceDirectory: '/test/voices' }))
    expect(messages[0]).toEqual({ type: 'status', message: 'prepare' })
    expect(messages).toContainEqual({ type: 'status', message: '' })
  })
  it('clears a failed download status and retries preparation on the next request', async () => {
    mocked.create.mockImplementationOnce((options) => {
      options.progress_callback({ status: 'progress', progress: 30 })
      return Promise.reject(new Error('Network unavailable'))
    })
    speak('failed')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'error', id: 'failed', message: 'Network unavailable' }))
    expect(messages).toContainEqual({ type: 'status', message: 'download:30' })
    const errorIndex = messages.findIndex((event) => event.type === 'error')
    expect(messages[errorIndex - 1]).toEqual({ type: 'status', message: '' })
    mocked.create.mockResolvedValueOnce(tts())
    speak('retry')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'retry' }))
    expect(mocked.create).toHaveBeenCalledTimes(2)
  })
  it('clears progress on cancel and never speaks a canceled request when preparation completes', async () => {
    let finish!: (value: ReturnType<typeof tts>) => void
    let progress!: (value: unknown) => void
    mocked.create.mockImplementationOnce((options) => {
      progress = options.progress_callback
      return new Promise((resolve) => { finish = resolve })
    })
    speak('canceled')
    await vi.waitFor(() => expect(mocked.create).toHaveBeenCalledOnce())
    listener({ data: { type: 'cancel' } })
    progress({ status: 'progress', progress: 80 })
    expect(messages.at(-1)).toEqual({ type: 'status', message: '' })
    const loaded = tts()
    finish(loaded)
    speak('next')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'next' }))
    expect(messages.some((event) => event.id === 'canceled' && ['part', 'done', 'error'].includes(event.type))).toBe(false)
    expect(loaded.generate).toHaveBeenCalledOnce()
    expect(mocked.create).toHaveBeenCalledOnce()
  })
})

describe('speech recovery and complete text coverage', () => {
  it('regenerates partial cache data instead of repeatedly raising a Float32 error', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'md-duck-worker-cache-'))
    try {
      const file = speechCacheFile(directory, 'af_heart', 1, 'Hello world.')
      await fs.writeFile(file, Buffer.from([1]))
      listener({ data: { type: 'init', cacheDir: directory, modelDir: '/test/models', voiceDirectory: '/test/voices' } })
      const loaded = tts()
      mocked.create.mockResolvedValueOnce(loaded)
      speak('recover')
      await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'recover' }))
      expect(loaded.generate).toHaveBeenCalledOnce()
      expect(messages).toContainEqual(expect.objectContaining({ type: 'part', id: 'recover', samples: Float32Array.of(0, 0.1, 0) }))
      expect((await fs.readFile(file)).length).toBe(12)
      expect(messages.some((event) => event.type === 'error')).toBe(false)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('still plays generated audio when the cache cannot be written', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'md-duck-worker-no-cache-'))
    try {
      const unavailable = join(directory, 'cache')
      await fs.writeFile(unavailable, 'keep this existing file')
      listener({ data: { type: 'init', cacheDir: unavailable, modelDir: '/test/models', voiceDirectory: '/test/voices' } })
      mocked.create.mockResolvedValueOnce(tts())
      speak('uncached')
      await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'uncached' }))
      expect(messages.some((event) => event.type === 'part' && event.id === 'uncached')).toBe(true)
      expect(messages.some((event) => event.type === 'error')).toBe(false)
      expect(await fs.readFile(unavailable, 'utf8')).toBe('keep this existing file')
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('bounds long punctuation-free paragraphs on word boundaries and keeps all words', () => {
    const text = Array.from({ length: 180 }, (_, index) => `word${index}`).join(' ')
    const chunks = worker.splitSentences(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => Array.from(chunk).length <= 240)).toBe(true)
    expect(chunks.join(' ')).toBe(text)
    expect(chunks.at(-1)).toContain('word179')
  })

  it('keeps every character of an unusually long indivisible word without splitting surrogate pairs', () => {
    const text = 'é𐐀'.repeat(450)
    const chunks = worker.boundSpeechChunks(text)
    expect(chunks.every((chunk) => Array.from(chunk).length <= 240)).toBe(true)
    expect(chunks.join('')).toBe(text)
    expect(chunks.some((chunk) => /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(chunk))).toBe(false)
    expect(() => worker.boundSpeechChunks(text, 0)).toThrow('speech-chunk-size-invalid')
  })

  it('adaptively splits phoneme-heavy text instead of dropping its suffix after a model-limit error', async () => {
    const text = Array.from({ length: 28 }, (_, index) => `number${index}`).join(' ')
    const successful: string[] = []
    const generate = vi.fn(async (part: string) => {
      if (part.length > 45) throw new Error('speech-text-too-long')
      successful.push(part)
      return { audio: Float32Array.of(0.1), sampling_rate: 24_000 }
    })
    mocked.create.mockResolvedValueOnce({ generate })
    listener({ data: { type: 'speak', id: 'long', text, voice: 'af_heart', speed: 1 } })
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'long' }))
    expect(successful.join(' ')).toBe(text)
    expect(successful.at(-1)).toContain('number27')
    expect(messages.filter((event) => event.type === 'part')).toHaveLength(successful.length)
    expect(messages.some((event) => event.type === 'error')).toBe(false)
  })
})
